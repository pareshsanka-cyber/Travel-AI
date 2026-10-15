import re
from fastapi import HTTPException


def revision_filter(query, trip):
    result = dict(query)
    if 'revision' in trip:
        result['revision'] = trip['revision']
    else:
        result['revision'] = {'$exists': False}
    return result


def clock_minutes(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value):
        raise ValueError('Activity times must use HH:MM within one calendar day.')
    h, m = value.split(':')
    return int(h) * 60 + int(m)


def validate_reroute(trip, day_number, skipped_id, stops):
    day = next((d for i, d in enumerate(trip['route_details']['day_by_day_route'])
                if int(d.get('day') or d.get('day_number') or i + 1) == int(day_number)), None)
    if not day:
        raise ValueError('Day not found.')
    original = day.get('stops') or day.get('activities') or []
    skipped = next((s for s in original if s.get('id') == skipped_id), None)
    if not skipped:
        raise ValueError('Skipped activity does not belong to this day.')
    log = (trip.get('execution_state') or {}).get('activity_log') or {}
    if log.get(skipped_id, {}).get('status') in {'completed', 'in_progress'}:
        raise ValueError('Completed or in-progress activities cannot be skipped.')
    if not stops or len(stops) > 100:
        raise ValueError('A reroute must contain between 1 and 100 activities.')
    ids = set()
    previous_end = None
    for stop in stops:
        identity = stop.get('id')
        if not identity or identity in ids or identity == skipped_id:
            raise ValueError('Reroute contains missing, duplicate, or skipped activity IDs.')
        ids.add(identity)
        start, end = clock_minutes(stop.get('start_time')), clock_minutes(stop.get('end_time'))
        transit = float(stop.get('travel_time_from_prev_minutes') or 0)
        if transit < 0 or end <= start or (previous_end is not None and start < previous_end + transit):
            raise ValueError('Reroute overlaps activities or omits transit time.')
        if trip.get('bedtime') and end > clock_minutes(trip['bedtime']):
            raise ValueError('Reroute extends beyond bedtime.')
        previous_end = end
    for old in original:
        if log.get(old['id'], {}).get('status') in {'completed', 'in_progress'}:
            proposed = next((s for s in stops if s['id'] == old['id']), None)
            if proposed is None or any(proposed.get(k) != old.get(k) for k in ('title', 'name', 'start_time', 'end_time', 'lat', 'lon')):
                raise ValueError('Reroute must preserve completed and in-progress activities.')
