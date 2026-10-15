"""Owned trip retrieval and atomic changes to saved planning choices."""
import copy
from datetime import datetime
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from app.services.trip_consistency import revision_filter


def owned_trip(db, trip_id, user_id):
    try:
        query = {'_id': ObjectId(trip_id), 'user_id': user_id}
    except (InvalidId, TypeError):
        query = {'id': trip_id, 'user_id': user_id}
    trip = db.trips.find_one(query)
    if not trip and '_id' in query:
        query = {'id': trip_id, 'user_id': user_id}
        trip = db.trips.find_one(query)
    if not trip:
        raise HTTPException(status_code=404, detail='Trip not found')
    return trip, query


def serialize_trip(trip, db=None):
    result = dict(trip)
    result['id'] = str(result.pop('_id', None) or result.get('id'))
    for key in ('created_at', 'updated_at'):
        if isinstance(result.get(key), datetime): result[key] = result[key].isoformat()
    if db is not None:
        from app.services.payment_service import plus_source
        result["plus_access_source"] = plus_source(db, result["id"], trip["user_id"])
        result["plus_access"] = result["plus_access_source"] is not None
    return result


def planning_options(trip, kind):
    if kind == 'flight':
        return [(str(item.get('id') or f'fl-{i + 1}'), item) for i, item in enumerate(trip.get('flights') or [])]
    return [(str(item.get('id') or f'{field}-{i}'), item)
            for field in ('hotels', 'nearby_hotels') for i, item in enumerate(trip.get(field) or [])
            if item.get('source') != 'planning_placeholder']


def default_selections(trip):
    return {kind + '_id': (planning_options(trip, kind)[0][0] if planning_options(trip, kind) else None)
            for kind in ('flight', 'hotel')}


def save_selections(db, trip_id, user_id, expected_revision, changes):
    trip, query = owned_trip(db, trip_id, user_id)
    if int(trip.get('revision', 1)) != expected_revision:
        raise HTTPException(status_code=409, detail='Trip changed. Refresh and try your selection again.')
    if not changes or not any(changes.values()):
        raise HTTPException(status_code=400, detail='Choose a flight or accommodation option.')
    effective = dict(default_selections(trip), **(trip.get('selections') or {}))
    selections = dict(effective)
    for key, identity in changes.items():
        if key not in {'flight_id', 'hotel_id'} or identity not in dict(planning_options(trip, key.split('_')[0])):
            raise HTTPException(status_code=400, detail='Choose an option returned for this trip.')
        selections[key] = identity
    if selections == trip.get('selections'):
        return serialize_trip(trip, db)
    if selections == effective:
        # Older trips already use the first options but have no explicit metadata.
        # Persist that choice without trying to rebuild an untimed legacy schedule.
        update = {'selections': selections, 'revision': expected_revision + 1}
        result = db.trips.update_one(revision_filter(query, trip), {'$set': update})
        if result.matched_count != 1:
            raise HTTPException(409, 'Trip changed while saving. Refresh and try again.')
        return serialize_trip(dict(trip, **update), db)
    log = (trip.get('execution_state') or {}).get('activity_log') or {}
    if (trip.get('execution_state') or {}).get('is_active') or any(v.get('status') in {'completed','in_progress'} for v in log.values()):
        raise HTTPException(status_code=409, detail='Travel choices cannot change after starting Companion Mode. Use rerouting to adjust the current day.')
    routes = (trip.get('route_details') or {}).get('day_by_day_route') or []
    if not routes or any(not day.get('date') or any(not stop.get('start_time') or not stop.get('end_time') or not stop.get('id')
            for stop in (day.get('stops') or day.get('activities') or [])) for day in routes):
        detail = ('This older itinerary needs updated timings before changing hotels. You can book the currently planned hotel or create an updated itinerary.'
            if 'hotel_id' in changes else 'This older itinerary needs updated timings before changing flights. You can book the currently planned flight or create an updated itinerary.')
        raise HTTPException(409, detail)

    # Keep custom visits and their durations; only update selected travel anchors.
    from app.services.itinerary_edit_service import reflow_day
    from app.ai.agents.route_agent import parse_hhmm_to_minutes, minutes_to_hhmm, format_time_range
    from app.ai.agents.opening_hours_agent import opening_hours_node
    from app.ai.reviewer.reviewer_agent import reviewer_node
    from app.ai.agents.synthesis_agent import synthesis_node
    from app.utils.activity_identity import generate_persistent_activity_id
    working = copy.deepcopy(trip)
    working['selections'] = selections
    original_days = (working.get('route_details') or {}).get('day_by_day_route') or []
    if original_days:
        working['start_date'] = working.get('start_date') or original_days[0].get('date')
        working['end_date'] = working.get('end_date') or original_days[-1].get('date')
    selected_flight = dict(planning_options(trip, 'flight')).get(selections.get('flight_id'))
    selected_hotel = dict(planning_options(trip, 'hotel')).get(selections.get('hotel_id'))
    old_hotel = dict(planning_options(trip, 'hotel')).get((trip.get('selections') or default_selections(trip)).get('hotel_id'))
    identities = {}
    for day_index, day in enumerate(original_days):
        stops = day.get('stops') or day.get('activities') or []
        if 'hotel_id' in changes and selected_hotel:
            for stop in stops:
                if stop.get('type') not in {'hotel','hotel_checkout','breakfast'}: continue
                name = (stop.get('name') or stop.get('title') or '').replace((old_hotel or {}).get('name') or 'Accommodation', selected_hotel['name'])
                if stop.get('type') == 'hotel': name = selected_hotel['name']
                identities[name] = identities.get(name, 0) + 1
                stop.update(name=name, title=name, lat=selected_hotel.get('lat'), lon=selected_hotel.get('lon'),
                            place_id=selected_hotel.get('place_id'),
                            address=selected_hotel.get('address'), location=selected_hotel.get('address'),
                            image_url=selected_hotel.get('image_url') or selected_hotel.get('imageUrl'),
                            id=generate_persistent_activity_id(stop['type'], name, selected_hotel.get('place_id'), identities[name]))
                stop['description'] = f"Planned {stop['type'].replace('_', ' ')} at {selected_hotel['name']}. Confirm arrangements with the property."
        if 'flight_id' in changes and selected_flight and day_index == 0:
            airport_stops = [stop for stop in stops if stop.get('type') == 'airport']
            previous_flight = dict(planning_options(trip, 'flight')).get((trip.get('selections') or default_selections(trip)).get('flight_id')) or {}
            if len(airport_stops) == 1 and selected_flight != previous_flight:
                raise HTTPException(status_code=409, detail='This flight change affects the arrival day. Generate a new trip plan to change it safely.')
            if len(airport_stops) >= 2:
                departure = parse_hhmm_to_minutes(selected_flight.get('departure_time'), -1)
                arrival = parse_hhmm_to_minutes(selected_flight.get('arrival_time'), -1)
                if departure < 120 or arrival <= departure or arrival + 60 >= 1440:
                    raise HTTPException(status_code=400, detail='This flight cannot fit the current same-day arrival schedule. Choose another flight or adjust the trip dates.')
                for stop, start, end in ((airport_stops[0], departure - 120, departure), (airport_stops[1], arrival, arrival + 60)):
                    stop.update(start_time=minutes_to_hhmm(start), end_time=minutes_to_hhmm(end), time=format_time_range(start, end), duration_minutes=end-start)
                airport_stops[1]['travel_time_from_prev_minutes'] = arrival - departure
                # The discovered alternatives must use the same airports as the saved route.
                # Airport changes require a new trip plan, rather than silently keeping stale coordinates.
                previous_flight = dict(planning_options(trip, 'flight')).get((trip.get('selections') or default_selections(trip)).get('flight_id')) or {}
                for key in ('departure_airport', 'arrival_airport'):
                    if previous_flight.get(key) and selected_flight.get(key) != previous_flight[key]:
                        raise HTTPException(status_code=400, detail='This alternative uses a different airport. Generate a new trip plan for that airport.')
        try:
            reflow_day(working, day, stops, allow_hotel_shift=True)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        day['stops'], day['activities'] = stops, stops
    working.update(opening_hours_node(working))
    review = reviewer_node(working)
    if not review['is_approved']:
        raise HTTPException(status_code=400, detail=review['reviewer_feedback'])
    working.update(synthesis_node(working))
    if selected_hotel:
        working['planner_draft'] = 'Accommodation option: ' + selected_hotel['name'] + '\n\n' + working['planner_draft']
    update = {key: working[key] for key in ('selections','route_details','planner_draft','final_itinerary','budget_breakdown','start_date','end_date','days')}
    update.update(revision=expected_revision + 1, updated_at=datetime.utcnow().isoformat())
    result = db.trips.update_one(revision_filter(query, trip), {'$set': update})
    if result.matched_count != 1:
        raise HTTPException(status_code=409, detail='Trip changed while saving. Refresh and try again.')
    return serialize_trip(dict(trip, **update), db)
