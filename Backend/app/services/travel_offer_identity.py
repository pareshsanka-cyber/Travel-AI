"""Offer identity excludes prices, result positions and rotating booking tokens."""
import hashlib
import json


def offer_identity(kind, item):
    def normalized(value):
        return ' '.join(str(value or '').lower().split())
    if kind == 'hotel':
        provider = item.get('provider_id') or item.get('property_token') or item.get('place_id') or item.get('data_id')
        gps = item.get('gps_coordinates') or {}
        return ('hotel', normalized(provider)) if provider else ('hotel', normalized(item.get('name') or item.get('title')),
            normalized(item.get('address') or item.get('neighborhood')),
            normalized(item.get('lat') or gps.get('latitude')), normalized(item.get('lon') or gps.get('longitude')))
    segments = item.get('provider_segments') or item.get('segments')
    if segments:
        return ('flight', tuple((normalized(s.get('flight_number')), normalized((s.get('departure_airport') or {}).get('id')),
            normalized((s.get('arrival_airport') or {}).get('id')), normalized((s.get('departure_airport') or {}).get('time')),
            normalized((s.get('arrival_airport') or {}).get('time'))) for s in segments), normalized(item.get('travel_class') or 'Economy'))
    item = dict(item, flight_no=item.get('flight_no') or item.get('flight_number') or item.get('flightNumber') or item.get('airline_name') or item.get('airline'))
    return ('flight', *(normalized(item.get(k)) for k in ('flight_no', 'departure_airport', 'arrival_airport',
            'departure_date', 'departure_time', 'arrival_date', 'arrival_time')), normalized(item.get('travel_class') or 'Economy'))


def stable_offer_id(kind, item):
    identity = json.dumps(offer_identity(kind, item), separators=(',', ':'), ensure_ascii=True)
    return f'{kind}-' + hashlib.sha256(identity.encode()).hexdigest()[:24]


def equivalent_offer(kind, old, fresh):
    if offer_identity(kind, old) == offer_identity(kind, fresh):
        return True
    if kind == 'flight':
        # Legacy records lack the original provider segments.
        a, b = dict(old), dict(fresh)
        for value in (a, b):
            value.pop('provider_segments', None)
            value.pop('segments', None)
        return offer_identity(kind, a) == offer_identity(kind, b)
    # A legacy property may not have a provider token. Require name + location.
    a, b = dict(old), dict(fresh)
    for value in (a, b):
        for key in ('provider_id', 'property_token', 'place_id', 'data_id'):
            value.pop(key, None)
    return offer_identity(kind, a) == offer_identity(kind, b)
