"""Owned, revision-checked refreshes; discovery never rewrites the saved schedule."""
import copy
import threading
import time
from concurrent.futures import Future
from fastapi import HTTPException
from app.services.discovery_status import account_status, safe_metadata, search_guard
from app.services.trip_service import owned_trip, serialize_trip, default_selections, planning_options
from app.services.trip_consistency import revision_filter
from app.services.travel_offer_identity import equivalent_offer, stable_offer_id

_lock = threading.Lock()
_requests = {}


def discovery_status(db, trip_id, owner):
    trip, _ = owned_trip(db, trip_id, owner)
    return dict(trip_id=trip_id, revision=int(trip.get('revision', 1)), provider=account_status(),
                flight=safe_metadata(trip.get('flight_metadata')), hotel=safe_metadata(trip.get('hotel_metadata')))


def merge_options(db, trip, kind, discovered):
    """Retain all old offers and freeze selected/purchased quotes and their IDs."""
    fields = ['flights'] if kind == 'flight' else ['hotels', 'nearby_hotels']
    effective = dict(default_selections(trip), **(trip.get('selections') or {}))
    pinned = {effective.get(kind + '_id')}
    identity = str(trip.get('_id') or trip.get('id'))
    for order in db.payments.find({'user_id': trip['user_id'], 'trip_id': identity, 'product': kind + '_demo', 'status': 'succeeded'}):
        booking = order.get('booking') or {}
        if booking.get('source') == 'discovered':
            pinned.add(booking.get('option_id'))
    options = []
    for field in fields:
        for index, raw in enumerate(trip.get(field) or []):
            if raw.get('source') == 'planning_placeholder':
                continue
            old = copy.deepcopy(raw)
            old['id'] = str(old.get('id') or (f'fl-{index+1}' if kind == 'flight' else f'{field}-{index}'))
            options.append((field, old))
    for field in fields:
        for raw in discovered.get(field) or []:
            if raw.get('source') == 'planning_placeholder':
                continue
            fresh = copy.deepcopy(raw)
            matches = [(i, item) for i, (_, item) in enumerate(options) if equivalent_offer(kind, item, fresh)]
            if len(matches) == 1:
                index, old = matches[0]
                if old['id'] not in pinned:
                    fresh['id'] = old['id']
                    options[index] = (options[index][0], fresh)
            elif not matches:
                fresh['id'] = stable_offer_id(kind, fresh)
                if not any(item['id'] == fresh['id'] for _, item in options):
                    options.append((field, fresh))
    return {**{field: [item for group, item in options if group == field] for field in fields}, 'selections': effective}


def refresh(db, trip_id, owner, kind, revision):
    # Ownership is rechecked even for a cached/coalesced response.
    trip, query = owned_trip(db, trip_id, owner)
    key = (owner, trip_id, kind, revision)
    with _lock:
        now = time.monotonic()
        for expired in [k for k, (deadline, f) in _requests.items() if deadline < now and f.done()]:
            del _requests[expired]
        existing = _requests.get(key)
        if existing:
            future = existing[1]
            creator = False
        else:
            if int(trip.get('revision', 1)) != revision:
                raise HTTPException(409, 'Trip changed. Refresh the trip before checking live availability.')
            future = Future()
            _requests[key] = (now + 60, future)
            creator = True
    if not creator:
        result = copy.deepcopy(future.result())
        current, _ = owned_trip(db, trip_id, owner)
        if int(current.get('revision', 1)) != int(result['trip'].get('revision', 1)):
            raise HTTPException(409, 'Trip changed. Refresh before checking availability again.')
        return result
    try:
        from app.ai.agents.flight_agent import flight_node
        from app.ai.agents.hotel_agent import hotel_node
        meta_key = 'flight_metadata' if kind == 'flight' else 'hotel_metadata'
        blocked = search_guard()
        found = {meta_key: dict(blocked, data_status='error')} if blocked else (
            flight_node if kind == 'flight' else hotel_node)(dict(trip, _refresh_discovery=True))
        metadata = safe_metadata(found.get(meta_key))
        update = {meta_key: metadata, 'revision': revision + 1}
        if metadata.get('data_status') == 'search_results':
            update.update(merge_options(db, trip, kind, found))
        written = db.trips.update_one(revision_filter(query, trip), {'$set': update})
        if written.matched_count != 1:
            raise HTTPException(409, 'Trip changed during the search. Refresh and review again.')
        result = dict(trip=serialize_trip(dict(trip, **update), db), availability=metadata)
        future.set_result(copy.deepcopy(result))
        return result
    except BaseException as error:
        future.set_exception(error)
        with _lock:
            _requests.pop(key, None)
        raise
