"""Calendar-aware flight timing shared by planning and booking snapshots."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def provider_timestamp(value):
    """Keep both parts of the provider's airport timestamp, not just HH:MM."""
    if not value:
        return None, None
    try:
        stamp = datetime.fromisoformat(str(value).strip().replace('Z', '+00:00'))
        return stamp.date().isoformat(), stamp.strftime('%H:%M')
    except ValueError:
        return None, str(value).strip()


def clock(value):
    for pattern in ('%H:%M', '%I:%M %p'):
        try:
            parsed = datetime.strptime(str(value).strip(), pattern)
            return parsed.hour * 60 + parsed.minute
        except ValueError:
            continue
    raise ValueError('Flight departure and arrival times are unavailable. Choose another option.')


def flight_timing(flight, start_date, origin_timezone='Asia/Kolkata', destination_timezone='Asia/Kolkata'):
    departure = clock(flight.get('departure_time') or flight.get('departureTime'))
    arrival = clock(flight.get('arrival_time') or flight.get('arrivalTime'))
    departure_date = date.fromisoformat(flight.get('departure_date') or start_date.isoformat())
    departure_stamp = datetime.combine(departure_date, datetime.min.time(), ZoneInfo(origin_timezone)) + timedelta(minutes=departure)
    duration = int(flight.get('duration_minutes') or 0)
    if flight.get('arrival_date'):
        arrival_date = date.fromisoformat(flight['arrival_date'])
    elif duration > 0:
        arrival_date = (departure_stamp.astimezone(timezone.utc) + timedelta(minutes=duration)).astimezone(ZoneInfo(destination_timezone)).date()
    else:
        # Compatibility for saved options that lost the provider date.
        arrival_date = departure_date + timedelta(days=1 if arrival <= departure else 0)
    arrival_stamp = datetime.combine(arrival_date, datetime.min.time(), ZoneInfo(destination_timezone)) + timedelta(minutes=arrival)
    elapsed = int((arrival_stamp.astimezone(timezone.utc) - departure_stamp.astimezone(timezone.utc)).total_seconds() / 60)
    if elapsed <= 0:
        raise ValueError('Flight dates and times are inconsistent. Choose another flight option.')
    return {'departure': departure, 'arrival': arrival, 'departure_date': departure_date,
        'arrival_date': arrival_date, 'arrival_offset': (arrival_date - start_date).days,
        'duration': elapsed, 'arrival_date_inferred': not bool(flight.get('arrival_date'))}
