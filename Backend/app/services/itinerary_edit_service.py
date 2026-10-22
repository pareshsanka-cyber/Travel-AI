"""Constrained edits to the structured schedule, shared by maps and itinerary text."""
import copy
import json
from app.ai.llm import llm
from app.ai.agents.route_agent import parse_hhmm_to_minutes, minutes_to_hhmm, format_time_range, estimate_transit
from app.ai.agents.budget_agent import budget_node
from app.ai.agents.synthesis_agent import synthesis_node
from app.utils.activity_identity import generate_persistent_activity_id


def render_schedule(routes):
    return '\n\n'.join(
        f"Day {day.get('day', day.get('day_number'))}: {day.get('date', '')}\n" +
        '\n'.join(f"{s.get('start_time', '')}–{s.get('end_time', '')}: {s.get('title') or s.get('name')}" for s in (day.get('stops') or day.get('activities') or []))
        for day in routes['day_by_day_route']
    )


def reflow_day(trip, day, stops, allow_hotel_shift=False):
    log = (trip.get('execution_state') or {}).get('activity_log') or {}
    cursor = None
    previous = None
    for item in stops:
        start = parse_hhmm_to_minutes(item['start_time'], -1)
        duration = int(item.get('duration_minutes') or (parse_hhmm_to_minutes(item['end_time'], -1) - start))
        transit = (item.get('travel_time_from_prev_minutes') or 0) if item.get('travel_mode') == 'flight' else estimate_transit(previous.get('lat'), previous.get('lon'), item.get('lat'), item.get('lon'))[0] if previous else 0
        proposed_start = max(start, cursor + transit) if cursor is not None else start
        protected = item.get('type') == 'airport' or (not allow_hotel_shift and item.get('type') in {'hotel', 'hotel_checkout'}) or log.get(item['id'], {}).get('status') in {'completed', 'in_progress'}
        if protected and proposed_start != start:
            raise ValueError('This edit would move a protected travel or completed activity.')
        end = proposed_start + duration
        deadline = 1439 if item.get('type') == 'airport' else parse_hhmm_to_minutes(trip.get('bedtime'), 1439)
        if end > deadline:
            raise ValueError('This edit would extend the schedule beyond the end of the day.')
        item.update(start_time=minutes_to_hhmm(proposed_start), end_time=minutes_to_hhmm(end),
                    time=format_time_range(proposed_start, end), duration_minutes=duration,
                    travel_time_from_prev_minutes=transit)
        if item.get('type') in {'attraction', 'restaurant'}:
            from datetime import datetime
            from app.ai.agents.opening_hours_agent import determine_status_from_hours
            status, reason = determine_status_from_hours(item.get('opening_hours'), datetime.fromisoformat(day['date']), item['start_time'], item['end_time'])
            if status == 'CLOSED':
                raise ValueError('This edit falls outside the venue opening hours.')
            item.update(status=status, status_reason=reason, opening_hours_status='VERIFIED_OPEN' if status == 'OPEN' else 'UNVERIFIED')
        cursor, previous = end, item


def apply_schedule_edits(trip, edits):
    result = copy.deepcopy(trip)
    days = result['route_details']['day_by_day_route']
    if not edits or len(edits) > 20:
        raise ValueError('No supported schedule changes were identified.')
    log = (trip.get('execution_state') or {}).get('activity_log') or {}
    for edit in edits:
        day = next((d for i, d in enumerate(days) if int(d.get('day') or d.get('day_number') or i + 1) == int(edit['day_number'])), None)
        if not day:
            raise ValueError('Requested day does not exist.')
        stops = day.get('stops') or day.get('activities') or []

        if edit.get('action') == 'add':
            new_place = edit.get('place') or {}
            place_name = new_place.get('name') or edit.get('place_name') or 'Sightseeing Spot'
            cat = str(new_place.get('category') or '').lower()
            place_type = new_place.get('type') or ('restaurant' if any(w in cat for w in ('restaurant', 'food', 'cafe', 'dining', 'catering')) else 'attraction')
            duration = int(edit.get('duration_minutes') or 90)
            if not 15 <= duration <= 240:
                raise ValueError('Activity duration must be between 15 and 240 minutes.')

            # Calculate appropriate slot for the added activity:
            # Place after preceding daytime stops, before end-of-day hotel or late departure
            insert_idx = len(stops)
            if stops and stops[-1].get('type') in {'hotel', 'airport'} and len(stops) > 1:
                insert_idx = len(stops) - 1

            if insert_idx > 0:
                prev = stops[insert_idx - 1]
                prev_end = parse_hhmm_to_minutes(prev.get('end_time', '10:00'), 600)
                init_start = prev_end + 30
            else:
                init_start = 600  # 10:00 AM default
            init_end = init_start + duration

            new_stop = {
                'id': generate_persistent_activity_id(place_type, place_name, new_place.get('place_id')),
                'title': place_name,
                'name': place_name,
                'type': place_type,
                'category': new_place.get('category') or place_type,
                'lat': new_place.get('lat') if new_place.get('lat') is not None else new_place.get('latitude'),
                'lon': new_place.get('lon') if new_place.get('lon') is not None else new_place.get('longitude'),
                'address': new_place.get('address'),
                'description': new_place.get('description') or f"Visit {place_name}.",
                'image_url': new_place.get('image_url'),
                'opening_hours': new_place.get('opening_hours'),
                'duration_minutes': duration,
                'start_time': minutes_to_hhmm(init_start),
                'end_time': minutes_to_hhmm(init_end),
                'time': format_time_range(init_start, init_end),
                'travel_mode': 'driving'
            }
            stops.insert(insert_idx, new_stop)
            catalog_key = 'restaurants' if place_type == 'restaurant' else 'attractions'
            catalog = result.setdefault(catalog_key, [])
            if not any(c.get('name') == place_name for c in catalog):
                catalog.append(new_stop)
        else:
            stop = next((s for s in stops if s['id'] == edit.get('activity_id')), None)
            if not stop or stop.get('type') in {'airport', 'hotel', 'hotel_checkout', 'breakfast'}:
                raise ValueError('Choose an attraction or restaurant to edit; travel and accommodation stops are protected.')
            if log.get(stop['id'], {}).get('status') in {'completed', 'in_progress'}:
                raise ValueError('Completed and in-progress activities cannot be edited.')
            if edit['action'] == 'remove':
                stops.remove(stop)
            elif edit['action'] == 'replace':
                catalog = result.get('restaurants' if stop.get('type') == 'restaurant' else 'attractions') or []
                candidate = next((c for c in catalog if c.get('name') == edit.get('replacement_name')), None)
                if not candidate:
                    raise ValueError('Replacement must be a discovered place from this trip.')
                stop.update({k: candidate.get(k) for k in {'name', 'lat', 'lon', 'address', 'description', 'image_url', 'opening_hours', 'place_id', 'category'}})
                stop['title'] = candidate['name']
                stop['id'] = generate_persistent_activity_id(stop['type'], candidate['name'], candidate.get('place_id'))
            elif edit['action'] == 'duration':
                duration = int(edit['duration_minutes'])
                if not 15 <= duration <= 240:
                    raise ValueError('Activity duration must be between 15 and 240 minutes.')
                stop['duration_minutes'] = duration
            else:
                raise ValueError('Unsupported schedule edit.')
        reflow_day(trip, day, stops, allow_hotel_shift=(edit.get('action') == 'add'))
        day['stops'] = stops
        day['activities'] = stops
    ids = [s['id'] for d in days for s in d['stops']]
    if len(ids) != len(set(ids)):
        raise ValueError('The edit would introduce a duplicate activity.')
    result['planner_draft'] = render_schedule(result['route_details'])
    result.update(budget_node(result))
    result.update(synthesis_node(result))
    return result


def add_activity_to_day(trip: dict, place: dict, day_number: int, duration_minutes: int = 90) -> dict:
    """Helper to add a discovered place to a given day in the itinerary."""
    return apply_schedule_edits(trip, [{
        'action': 'add',
        'day_number': day_number,
        'place': place,
        'duration_minutes': duration_minutes
    }])


def modify_itinerary(trip, instruction):
    schedule = [{'day_number': d.get('day') or d.get('day_number') or i + 1,
                 'stops': [{k: s.get(k) for k in ('id', 'title', 'name', 'type', 'duration_minutes')} for s in d.get('stops', [])]}
                for i, d in enumerate(trip['route_details']['day_by_day_route'])]
    prompt = ('Return JSON only: {"edits": [{"action": "remove|replace|duration", "day_number": 2, '
              '"activity_id": "existing id", "replacement_name": "catalog name", "duration_minutes": 90}]}. '
              'Use only existing activity IDs and replacement catalog names. Protect airport, hotel, breakfast stops. '
              'Do not invent venues or claim unsupported edits. Return an empty edits list if the request cannot be represented.\n'
              f'Schedule:\n{json.dumps(schedule, ensure_ascii=False)}\nRequest: {instruction}')
    try:
        response = llm.invoke(prompt).content
        data = json.loads(response[response.find('{'):response.rfind('}') + 1])
        edits = data.get('edits') or []
    except Exception as error:
        raise ValueError('Unable to parse schedule edits.') from error
    return apply_schedule_edits(trip, edits)
