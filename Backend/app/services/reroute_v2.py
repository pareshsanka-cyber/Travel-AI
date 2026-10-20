"""Review-only proposals and revision-guarded acceptance. No LLM invents schedules."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import logging
import math
import secrets
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from app.services.road_routing import RoutingSession, coords, distance
from app.services.trip_consistency import clock_minutes, has_complete_timings, revision_filter
from app.utils.activity_identity import routes_with_activity_ids, resolve_activity_status, migrate_legacy_activity_log
from app.ai.agents.opening_hours_agent import determine_status_from_hours

log = logging.getLogger(__name__)


def purpose(stop):
    """Structured types take precedence over prose in older records."""
    kind = str(stop.get('type') or '').lower()
    category = str(stop.get('category') or '').lower()
    if kind in {'airport', 'flight', 'transit', 'train', 'bus', 'hotel', 'accommodation', 'check_in', 'check_out'}:
        return 'commitment'
    if kind in {'restaurant', 'meal', 'dining', 'breakfast', 'lunch', 'dinner', 'cafe', 'food'}:
        return 'meal'
    if kind in {'attraction', 'sightseeing', 'activity', 'museum', 'park', 'temple', 'beach'}:
        return 'attraction'
    if category in {'airport', 'flight', 'transit', 'hotel', 'accommodation'}:
        return 'commitment'
    if category in {'meal', 'restaurant', 'food', 'dining', 'cafe'}:
        return 'meal'
    if category in {'attraction', 'museum', 'park', 'temple', 'beach', 'nature', 'historic', 'shopping'}:
        return 'attraction'
    from app.services.reroute_service import classify_activity
    return {'hotel': 'commitment', 'transit': 'commitment'}.get(classify_activity(stop)['main_type'], 'meal' if category in {'food', 'meal', 'restaurant'} else classify_activity(stop)['main_type'])


def fixed(stop):
    return purpose(stop) == 'commitment' or bool(stop.get('fixed_time') or stop.get('is_fixed') or stop.get('booking_id'))


def must_visit(stop, trip):
    names = {str(s).strip().casefold() for s in trip.get('must_visit_places') or []}
    return bool(stop.get('must_visit') or stop.get('is_must_visit') or (stop.get('name') or stop.get('title') or '').strip().casefold() in names)


def get_day(trip, number):
    routes = routes_with_activity_ids((trip.get('route_details') or {}).get('day_by_day_route') or [])
    day = next((d for i, d in enumerate(routes) if int(d.get('day') or d.get('day_number') or i+1) == number), None)
    if day is None:
        raise ValueError('Day not found.')
    return routes, day, day.get('stops') or day.get('activities') or []


def local_day(trip, day, number, now):
    # No defaulted frontend timezone is treated as evidence.
    zone_name = trip.get('timezone') or trip.get('destination_timezone') or (trip.get('travel_context') or {}).get('timezone') or day.get('timezone')
    if not zone_name:
        supplied = {s.get('timezone') for s in day.get('stops') or day.get('activities') or [] if s.get('timezone') and purpose(s) != 'commitment'}
        if len(supplied) == 1:
            zone_name = supplied.pop()
    try:
        zone = ZoneInfo(zone_name)
        raw = day.get('date') or day.get('scheduled_date')
        if raw:
            date = datetime.fromisoformat(str(raw)[:10]).date()
        else:
            date = datetime.fromisoformat(str(trip.get('start_date'))[:10]).date()+timedelta(days=number-1)
        return zone, date, now.astimezone(zone)
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        return None, None, None


def zoned_start(date, value, zone):
    minutes = clock_minutes(value)
    naive = datetime.combine(date, datetime.min.time())+timedelta(minutes=minutes)
    a, b = naive.replace(tzinfo=zone, fold=0), naive.replace(tzinfo=zone, fold=1)
    if a.utcoffset() != b.utcoffset() or a.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != naive:
        raise ValueError('Ambiguous or unavailable local time. Update the itinerary timings first.')
    return a


def origin_for(stops, index, supplied, current_day, now, warnings):
    planned = coords(stops[index-1]) if index else coords(stops[index])
    if supplied:
        try:
            point = coords(supplied)
            stamp = datetime.fromisoformat(str(supplied['timestamp']).replace('Z', '+00:00'))
            if stamp.tzinfo is None:
                raise ValueError()
            age = (now-stamp.astimezone(timezone.utc)).total_seconds()
            accuracy = float(supplied['accuracy'])
            if not current_day or not point or not planned or not 0 <= age <= 60 or not math.isfinite(accuracy) or not 0 <= accuracy <= 200 or distance(point, planned) > 100:
                raise ValueError()
            return point, 'Your recent location (used for this preview only)'
        except (ValueError, TypeError, KeyError):
            warnings.append('Location not used: it is stale, imprecise, distant or not for today. Using the planned starting point.')
    return planned, 'Planned starting point: '+str((stops[index-1] if index else stops[index]).get('name') or (stops[index-1] if index else stops[index]).get('title') or 'saved stop')


def candidates(trip, target, used, origin=None, discovery_only=False, limit=6, timeout_seconds=2.0):
    meal = purpose(target) == 'meal'
    pool = list(trip.get('restaurants') or []) if meal else list(trip.get('all_attractions') or trip.get('attractions') or [])
    if discovery_only:
        pool = []
    unique = {}
    seen_names, seen_points = set(), []
    used_names = {str(s.get('name') or s.get('title') or '').strip().casefold() for s in used}
    used_places = {str(s.get('place_id')) for s in used if s.get('place_id')}
    def collect(items):
        for item in items:
            if not isinstance(item, dict) or not coords(item):
                continue
            name = str(item.get('name') or item.get('title') or '').strip()
            if not name or name.casefold() in used_names or str(item.get('place_id')) in used_places:
                continue
            candidate = dict(item, type='restaurant' if meal else item.get('type') or 'attraction')
            if purpose(candidate) != purpose(target):
                continue
            key = str(item.get('place_id') or name.casefold())
            if name.casefold() in seen_names or any(distance(coords(candidate), point) < 0.03 for point in seen_points):
                continue
            seen_names.add(name.casefold()); seen_points.append(coords(candidate))
            unique.setdefault(key, candidate)
    collect(pool)
    # Exhaust saved candidates before optional discovery. Missing/used coordinates
    # cannot prevent discovery from supplying genuinely usable options.
    if not unique:
        try:
            if meal:
                from app.ai.agents.restaurant_agent import discover_restaurants_serpapi
                collect(discover_restaurants_serpapi(trip.get('destination', ''), limit=12, timeout_seconds=timeout_seconds) or [])
            else:
                from app.ai.agents.attraction_agent import discover_via_serpapi
                collect(discover_via_serpapi(trip.get('destination', ''), 12, timeout_seconds=timeout_seconds) or [])
        except Exception:
            log.info('reroute_v2 discovery unavailable')
    keys = sorted(unique, key=lambda key: (distance(origin, coords(unique[key])) if origin else 0, key))
    return [unique[key] for key in keys[:limit]]


def _clock(minutes):
    return f'{minutes//60:02d}:{minutes%60:02d}'


def _price(item, currency):
    raw = item.get('entry_fee', item.get('entrance_fee', item.get('cost', item.get('price'))))
    try:
        price = float(raw)
        if math.isfinite(price) and price >= 0 and item.get('currency', currency) == currency:
            return price
    except (ValueError, TypeError):
        pass
    return None


def preview(trip, number, target_id, trigger, mode, delay=30, location=None, now=None):
    started = time.monotonic()
    now = now or datetime.now(timezone.utc)
    routes, day, original = get_day(trip, number)
    index = next((i for i, s in enumerate(original) if s['id'] == target_id), None)
    if index is None:
        raise ValueError('Activity does not belong to this day.')
    target = original[index]
    activity_log = (trip.get('execution_state') or {}).get('activity_log') or {}
    statuses = {s['id']: resolve_activity_status(s, number, i, activity_log)[0] for i, s in enumerate(original)}
    if statuses[target_id] != 'pending':
        raise ValueError('Only unfinished, not yet started stops can be adjusted.')
    warnings = []
    zone, date, local_now = local_day(trip, day, number, now)
    historical = bool(date and date < local_now.date())
    if historical and trigger != 'skip':
        raise ValueError('Historical days keep progress controls but cannot be replanned live.')
    today = bool(date and date == local_now.date())
    origin, origin_label = origin_for(original, index, location, today, now, warnings)
    protected = fixed(target) or must_visit(target, trip)
    complete = has_complete_timings(original) and bool(zone and date) and not historical
    if complete:
        try:
            for stop in original:
                # Airport commitments require their own explicit zone.
                airport = str(stop.get('type', '')).lower() in {'airport', 'flight'}
                stop_zone = ZoneInfo(stop['timezone']) if airport or stop.get('timezone') else zone
                if stop_zone != zone:
                    # Cross-zone flight days retain their commitments. Do not treat
                    # local clocks from different zones as the same timeline.
                    raise ValueError('Cross-timezone commitment')
                zoned_start(date, stop['start_time'], stop_zone)
                zoned_start(date, stop['end_time'], stop_zone)
        except (ValueError, KeyError, ZoneInfoNotFoundError):
            complete = False
    if historical:
        warnings.append('Past itinerary day: skipping records progress only. Saved timings remain unchanged.')
    elif not complete:
        warnings.append('This older itinerary has incomplete or unverified dates, times or timezones. Only progress-only skipping is available; timings stay unchanged.')
    routing = RoutingSession(mode)
    choices = []
    rejections = {}
    def reject(reason):
        rejections[reason] = rejections.get(reason, 0)+1

    def option(stops, kind, replacement=None, legs=None, confidence='Unknown', reason=''):
        before = {s['id']: s for s in original}
        changed = [dict(id=s['id'], title=s.get('name') or s.get('title'), before_start=before.get(s['id'], {}).get('start_time'), after_start=s.get('start_time'), before_end=before.get(s['id'], {}).get('end_time'), after_end=s.get('end_time')) for s in stops if s['id'] not in before or any(s.get(k) != before[s['id']].get(k) for k in ('start_time', 'end_time'))]
        old_cost, new_cost = _price(target, trip.get('currency', 'INR')), _price(replacement or {}, trip.get('currency', 'INR'))
        return dict(id=secrets.token_urlsafe(12), kind=kind, title='Skip only — keep saved timings' if kind=='skip_only' else ('Suggested replacement: '+str(replacement.get('name') or replacement.get('title')) if replacement else 'Reschedule existing stops'), reason=reason,
            proposed_stops=deepcopy(stops), replacement_activity=deepcopy(replacement), impact=dict(changed_stops=changed, finish_time=stops[-1].get('end_time') if stops else None, original_finish=original[-1].get('end_time'), travel_minutes=sum(l['duration_minutes'] for l in legs or []), price_difference=(new_cost-old_cost) if old_cost is not None and new_cost is not None else None, currency=trip.get('currency', 'INR'), opening_hours=confidence), travel=legs or [], warnings=list(warnings))

    pool = []
    if complete and not protected:
        used = [s for d in routes for s in d.get('stops') or d.get('activities') or []]
        if trigger != 'delay':
            pool = candidates(trip, target, used, origin)
    if complete:
        routing.batch([origin]+[coords(s) for s in original[index:]]+[coords(s) for s in pool])
        cutoff = clock_minutes(trip.get('bedtime') or (trip.get('travel_context') or {}).get('bedtime') or '22:00')
        def schedule(replacement):
            result = deepcopy(original[:index])
            cursor = clock_minutes(original[index-1]['end_time']) if index else 0
            earliest = clock_minutes(target['start_time'])+(delay if trigger=='delay' else 0)
            if today:
                earliest = max(earliest, local_now.hour*60+local_now.minute)
            if today:
                cursor = max(cursor, local_now.hour*60+local_now.minute)
            previous = origin
            tail = ([replacement] if replacement else [])+original[index+(0 if trigger=='delay' else 1):]
            legs, hours_confidence = [], 'Unknown — opening hours not supplied'
            for s in tail:
                stop = deepcopy(s)
                status = statuses.get(s['id'], 'pending')
                # Already skipped records remain in history and never consume time again.
                if status == 'skipped':
                    result.append(stop)
                    continue
                leg = routing.leg(previous, coords(stop))
                if leg['source']=='unavailable':
                    raise ValueError('missing_coordinates')
                buffer = 10 if fixed(stop) else 5
                arrival = cursor+leg['duration_minutes']+buffer
                saved_start, saved_end = clock_minutes(s['start_time']), clock_minutes(s['end_time'])
                immutable = fixed(s) or status in {'completed', 'in_progress'}
                if immutable:
                    if arrival > saved_start:
                        raise ValueError('fixed_or_completed_commitment')
                    start, end = saved_start, saved_end
                else:
                    start = max(saved_start, arrival, earliest if len(result)==index else 0)
                    end = start+(saved_end-saved_start)
                if end > cutoff or end >= 1440:
                    raise ValueError('day_cutoff')
                if not immutable:
                    opening, detail = determine_status_from_hours(s.get('opening_hours'), datetime.combine(date, datetime.min.time()).replace(tzinfo=zone), _clock(start), _clock(end))
                    if opening == 'CLOSED':
                        raise ValueError('opening_window')
                    if replacement and s['id']==replacement['id']:
                        hours_confidence = 'Listed hours cover the proposed visit' if opening=='OPEN' else 'Unknown — verify opening hours before travel'
                    stop.update(duration_minutes=saved_end-saved_start, travel_time_from_prev_minutes=leg['duration_minutes'], transition_buffer_minutes=buffer, travel_mode=mode, distance_from_prev_km=leg['distance_km'])
                    if start != saved_start or end != saved_end:
                        stop.update(start_time=_clock(start), end_time=_clock(end), time=f'{_clock(start)} - {_clock(end)}')
                legs.append(dict(to_id=s['id'], **{k: v for k,v in leg.items() if k != 'geometry'}))
                result.append(stop)
                cursor, previous = end, coords(stop)
            return result, legs, hours_confidence

        if not protected or trigger=='delay':
            def consider(candidate):
                candidate = dict(candidate)
                candidate.update(id='reroute_'+hashlib.sha256(str(candidate.get('place_id') or candidate.get('name') or candidate.get('title')).encode()).hexdigest()[:20], start_time=target['start_time'], end_time=target['end_time'], scheduled_date=date.isoformat())
                try:
                    result, legs, confidence = schedule(candidate)
                    item = option(result, 'replacement', next(s for s in result if s['id']==candidate['id']), legs, confidence, 'Same visit purpose; preserves the order and duration of remaining visits.')
                    known = confidence.startswith('Listed')
                    category_match = candidate.get('category') == target.get('category')
                    interest_match = any(str(i).casefold() in str(candidate).casefold() for i in trip.get('interests') or [])
                    try:
                        rating = float(candidate.get('rating') or 0)
                        if not math.isfinite(rating): rating = 0
                    except (TypeError, ValueError):
                        rating = 0
                    item['_rank'] = (not known, not category_match, not interest_match, item['impact']['travel_minutes'], len(item['impact']['changed_stops']), -rating, candidate['id'])
                    choices.append(item)
                except ValueError as error:
                    reject(str(error))
            for candidate in pool:
                consider(candidate)
            # At most twelve shortlisted candidates in total: six saved, then up
            # to six newly discovered only if no saved choice fits the whole day.
            remaining = routing.deadline-time.monotonic()
            if not choices and pool and trigger != 'delay' and remaining > .25:
                discovered = candidates(trip, target, used+pool, origin, discovery_only=True,
                    limit=12-len(pool), timeout_seconds=min(2., remaining))
                if discovered:
                    routing.batch([origin]+[coords(s) for s in original[index:]]+[coords(s) for s in discovered])
                    for candidate in discovered:
                        consider(candidate)
            choices.sort(key=lambda x:x['_rank'])
            choices = choices[:2]  # Reserve a place for a safe no-replacement choice.
            if not choices or trigger=='delay':
                try:
                    result, legs, confidence = schedule(None)
                    choices.append(option(result, 'reschedule', legs=legs, confidence=confidence, reason='Keeps existing visits and durations without adding a place.'))
                except ValueError as error:
                    reject(str(error))
    if trigger in {'skip', 'closed'} and not protected:
        # Skip-only is progress-only: even legacy timings remain byte-for-byte intact.
        choices.append(option(original, 'skip_only', reason='Only marks the requested stop skipped after confirmation. No new timings are calculated.'))
    if protected and trigger != 'delay':
        warnings.append('This is a fixed commitment or must-visit stop. It cannot be removed by replanning.')
    for i, item in enumerate(choices):
        item.pop('_rank', None)
        item['recommended'] = i==0
        item['warnings'] = list(warnings)
    elapsed = round((time.monotonic()-started)*1000)
    log.info('reroute_v2 preview latency_ms=%s fallback_count=%s rejection_reasons=%s options=%s', elapsed, routing.fallbacks, rejections, len(choices))
    return dict(version=2, status='success', day_number=number, revision=int(trip.get('revision', 1)), target_activity_id=target_id, trigger=trigger, origin_location_label=origin_label, original_stops=deepcopy(original), options=choices, warnings=warnings, rejection_reasons=rejections, expires_at=(now+timedelta(minutes=15)).isoformat(), server_time=now.isoformat(), timezone=str(zone) if zone else None)


def apply(db, trip_id, user_id, saved, option_id, expected_revision):
    from app.services.trip_service import owned_trip
    trip, query = owned_trip(db, trip_id, user_id)
    if expected_revision != saved['revision'] or int(trip.get('revision', 1)) != saved['revision']:
        raise HTTPException(409, 'Trip changed. Review a fresh proposal before confirming.')
    proposal = saved['proposal']
    selected = next((o for o in proposal['options'] if o['id']==option_id), None)
    if selected is None:
        raise HTTPException(400, 'Option does not belong to this saved proposal.')
    routes, day, original = get_day(trip, proposal['day_number'])
    if original != proposal['original_stops']:
        raise HTTPException(409, 'The saved schedule changed. Review again.')
    if selected['kind'] != 'skip_only':
        zone, date, now = local_day(trip, day, proposal['day_number'], datetime.now(timezone.utc))
        if not zone or date < now.date():
            raise HTTPException(409, 'The day has passed. Request a fresh review.')
        changed_ids = {s['id'] for s in selected['impact']['changed_stops']}
        if date == now.date() and any(zoned_start(date, s['start_time'], zone) < now for s in selected['proposed_stops'] if s['id'] in changed_ids):
            raise HTTPException(409, 'These proposed start times have passed. Request a fresh review.')
    state = deepcopy(trip.get('execution_state') or {})
    state['activity_log'] = migrate_legacy_activity_log(state.get('activity_log') or {}, routes)
    target_id = proposal['target_activity_id']
    if proposal['trigger'] in {'skip', 'closed'}:
        state['activity_log'][target_id] = dict(status='skipped', activity_id=target_id, actual_end_time=datetime.now(timezone.utc).isoformat())
    revision = saved['revision']+1
    record = dict(version=2, proposal_id=saved['proposal_id'], option_id=option_id, day_number=proposal['day_number'], trigger=proposal['trigger'], target_activity_id=target_id, accepted=True, timestamp=datetime.now(timezone.utc).isoformat(), revision=revision)
    state['reroute_history'] = list(state.get('reroute_history') or [])+[record]
    update = dict(execution_state=state, revision=revision, updated_at=datetime.now(timezone.utc).isoformat())
    if selected['kind'] != 'skip_only':
        day['stops'] = deepcopy(selected['proposed_stops'])
        day['activities'] = deepcopy(selected['proposed_stops'])
        route_details = deepcopy(trip['route_details'])
        route_details['day_by_day_route'] = routes
        update['route_details'] = route_details
        replacement = selected.get('replacement_activity')
        if replacement and purpose(replacement) == 'attraction':
            replacement = deepcopy(replacement)
            # Retain the quote's currency; foreign/unknown fees are not converted.
            if replacement.get('currency', trip.get('currency', 'INR')) != trip.get('currency', 'INR'):
                replacement.pop('entrance_fee', None)
            update['attractions'] = deepcopy(trip.get('attractions') or [])+[replacement]
        from app.services.itinerary_edit_service import render_schedule
        from app.ai.agents.budget_agent import budget_node
        from app.ai.agents.synthesis_agent import synthesis_node
        update['planner_draft'] = render_schedule(route_details)
        update['budget_breakdown'] = budget_node(dict(trip, **update))['budget_breakdown']
        update['final_itinerary'] = synthesis_node(dict(trip, **update))['final_itinerary']
    write = db.trips.update_one(revision_filter(query, trip), {'$set': update})
    if write.matched_count != 1:
        raise HTTPException(409, 'Trip changed during confirmation. Review again.')
    return dict(status='success', trip_id=str(trip.get('_id') or trip_id), revision=revision, mode=selected['kind'], execution_state=state, route_details=update.get('route_details', dict(trip['route_details'], day_by_day_route=routes)), reroute_record=record, planner_draft=update.get('planner_draft', trip.get('planner_draft')), budget_breakdown=update.get('budget_breakdown', trip.get('budget_breakdown')), final_itinerary=update.get('final_itinerary', trip.get('final_itinerary')))
