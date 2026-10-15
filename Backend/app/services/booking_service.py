"""Server-priced demo bookings. No reservation provider or money transfer."""
import hashlib
import json
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from app.services.trip_service import owned_trip, planning_options, default_selections
from app.services import payment_service as payments

PRODUCTS = ('flight_demo', 'hotel_demo')


def booking_dates(trip):
    routes = (trip.get('route_details') or {}).get('day_by_day_route') or []
    try:
        start = date.fromisoformat(trip.get('start_date') or routes[0]['date'])
        end = date.fromisoformat(trip.get('end_date') or (routes[-1]['date'] if routes else start.isoformat()))
    except (ValueError, TypeError, KeyError, IndexError):
        raise HTTPException(400, 'Set valid trip dates before creating a demo booking.')
    if end < start:
        raise HTTPException(400, 'Trip end date must be on or after the start date.')
    checkout = max(end, start + timedelta(days=1))
    return start.isoformat(), checkout.isoformat(), (checkout - start).days


def minor_units(value):
    try:
        value = Decimal(str(value))
        if not value.is_finite() or value <= 0:
            raise ValueError()
        amount = int((value * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        if not 0 < amount <= 10**12:
            raise ValueError()
        return amount
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(400, 'Price unavailable. Choose another option or try a sample demo booking.')


def priced(item, kind):
    if kind == 'hotel' and not hotel_supported(item):
        return False
    try:
        minor_units((item.get('price_per_person') or item.get('price')) if kind == 'flight' else item.get('price_per_night'))
        return True
    except HTTPException:
        return False


def hotel_supported(item):
    return not re.search(r'\bhostels?\b', str(item.get('name') or '') + ' ' + str(item.get('accommodation_type') or item.get('property_type') or ''), re.IGNORECASE)


def matches_trip(booking, trip):
    """Purchase validity depends on travel details, not price or itinerary revision."""
    try:
        start, checkout, _ = booking_dates(trip)
    except HTTPException:
        return False
    routes = (trip.get('route_details') or {}).get('day_by_day_route') or []
    end = trip.get('end_date') or (routes[-1].get('date') if routes else start)
    return (booking.get('departure_date') == start and booking.get('check_out') == checkout
        and booking.get('trip_end_date', end) == end
        and booking.get('travelers') == int(trip.get('travelers') or 1)
        and booking.get('origin') == (trip.get('origin') or 'Origin not specified')
        and booking.get('destination') == (trip.get('destination') or 'Your destination'))


def trip_status(db, trip_id, user_id):
    trip, _ = owned_trip(db, trip_id, user_id)
    identity = str(trip.get('_id') or trip.get('id'))
    current, previous = {}, []
    priority = {'succeeded': 4, 'pending': 3, 'created': 1, 'failed': 1, 'cancelled': 1}
    orders = db.payments.find({'user_id': user_id, 'trip_id': identity, 'mode': 'demo', 'product': {'$in': list(PRODUCTS)}}).sort('created_at', -1)
    for raw in orders:
        order = payments.settle(db, raw)
        booking = order.get('booking') or {}
        if not matches_trip(booking, trip):
            if order['status'] == 'succeeded':
                previous.append(payments.public(order, db))
            continue
        key = (booking.get('kind'), booking.get('source'), booking.get('option_id'))
        existing = current.get(key)
        if existing is None or priority.get(order['status'], -1) > priority.get(existing['status'], -1):
            current[key] = order
    return {'trip_id': identity, 'current': [payments.public(order, db) for order in current.values()], 'previous': previous}


def create_order(db, payload, user_id):
    trip, _ = owned_trip(db, payload.trip_id, user_id)
    revision = int(trip.get('revision', 1))
    if revision != payload.expected_revision:
        raise HTTPException(409, 'Trip changed. Refresh and review the booking again.')
    kind = payload.kind
    if kind == 'flight' and payload.rooms != 1:
        raise HTTPException(400, 'Room count applies only to hotel bookings.')
    trip_id = str(trip.get('_id') or trip.get('id'))
    start, checkout, nights = booking_dates(trip)
    travelers = int(trip.get('travelers') or 1)
    if not 1 <= travelers <= 20:
        raise HTTPException(400, 'Choose between 1 and 20 travelers.')
    options = dict(planning_options(trip, kind))
    # Samples are deliberately isolated from travel selections/maps.
    if payload.source == 'sample':
        if any(priced(item, kind) for item in options.values()):
            raise HTTPException(409, 'Priced discovered options are available. Book one of those options instead.')
        if payload.option_id != 'sample-' + kind:
            raise HTTPException(400, 'Unknown sample option.')
        item = {'name': 'Sample demo hotel', 'airline_name': 'Sample demo airline', 'currency': 'INR',
            'price_per_person': 5000, 'price_per_night': 2500, 'departure_time': '08:00', 'arrival_time': '10:00'}
    else:
        item = options.get(payload.option_id)
        if not item:
            raise HTTPException(400, 'Choose an option saved on this trip.')
        if kind == 'hotel' and not hotel_supported(item):
            raise HTTPException(400, 'This version supports hotel demo bookings, not hostel beds.')
        selected = dict(default_selections(trip), **(trip.get('selections') or {}))
        if selected.get(kind + '_id') != payload.option_id:
            raise HTTPException(409, 'Select this option for your trip before booking it.')
    # A changed estimate must not sell the same already-confirmed travel again.
    for paid in db.payments.find({'user_id': user_id, 'trip_id': trip_id, 'product': kind + '_demo', 'mode': 'demo', 'status': 'succeeded'}).sort('created_at', -1):
        snapshot = paid.get('booking') or {}
        if (matches_trip(snapshot, trip) and snapshot.get('source') == payload.source and snapshot.get('option_id') == payload.option_id
                and (kind == 'flight' or (snapshot.get('rooms') or 1) == payload.rooms)):
            return paid
    currency = str(item.get('currency') or trip.get('currency') or 'INR').upper()
    if len(currency) != 3 or not currency.isalpha():
        raise HTTPException(400, 'Option currency is unavailable.')
    unit_amount = minor_units((item.get('price_per_person') or item.get('price')) if kind == 'flight' else item.get('price_per_night'))
    quantity = travelers if kind == 'flight' else nights * payload.rooms
    booking = {'kind': kind, 'source': payload.source, 'option_id': payload.option_id,
        'name': (item.get('airline_name') or item.get('airline') or 'Flight') if kind == 'flight' else item.get('name') or 'Hotel',
        'origin': trip.get('origin') or 'Origin not specified', 'destination': trip.get('destination') or 'Your destination',
        'departure_date': start, 'departure_time': item.get('departure_time') or item.get('departureTime'),
        'arrival_time': item.get('arrival_time') or item.get('arrivalTime'),
        'arrival_date': item.get('arrival_date'),
        'flight_number': item.get('flight_number') or item.get('flight_no'),
        'check_in': start, 'check_out': checkout, 'nights': nights,
        'trip_end_date': trip.get('end_date') or ((trip.get('route_details') or {}).get('day_by_day_route') or [{'date': start}])[-1].get('date'),
        'travelers': travelers, 'rooms': payload.rooms if kind == 'hotel' else None,
        'unit_amount': unit_amount, 'quantity': quantity, 'currency': currency, 'amount': unit_amount * quantity}
    canonical = hashlib.sha256(json.dumps(booking, sort_keys=True).encode()).hexdigest()
    key = {'user_id': user_id, 'trip_id': trip_id, 'product': kind + '_demo', 'booking_key': canonical}
    existing = db.payments.find_one(key)
    if existing:
        existing = payments.settle(db, existing)
        if existing['status'] not in ('pending', 'succeeded'):
            db.payments.update_one({'_id': existing['_id'], 'status': existing['status'], 'attempt_version': existing['attempt_version']},
                {'$set': {'expected_revision': revision}})
            existing = db.payments.find_one({'_id': existing['_id']})
        return existing
    instant = payments.now()
    order = dict(key, booking=booking, expected_revision=revision, mode='demo', currency=currency,
        amount=booking['amount'], trip_title=trip.get('title') or trip.get('destination') or 'Your trip',
        days=trip.get('days', 1), travelers=travelers, status='created', attempt_version=0,
        attempts=[], created_at=instant, updated_at=instant)
    try:
        order['_id'] = db.payments.insert_one(order).inserted_id
    except DuplicateKeyError:
        return payments.settle(db, db.payments.find_one(key))
    return order


def notice(db, order):
    try:
        trip, _ = owned_trip(db, order['trip_id'], order['user_id'])
    except HTTPException:
        return 'The trip was deleted. This demo booking retains its original details.'
    booking = order['booking']
    try:
        start, checkout, _ = booking_dates(trip)
    except HTTPException:
        return 'Current trip dates differ from the original demo booking.'
    current_end = trip.get('end_date') or ((trip.get('route_details') or {}).get('day_by_day_route') or [{'date': start}])[-1].get('date')
    changed = start != booking['departure_date'] or checkout != booking['check_out'] or current_end != booking['trip_end_date'] or int(trip.get('travelers') or 1) != booking['travelers']
    changed = changed or trip.get('destination') != booking['destination'] or (trip.get('origin') or 'Origin not specified') != booking['origin']
    if booking['source'] == 'discovered':
        selected = dict(default_selections(trip), **(trip.get('selections') or {}))
        changed = changed or selected.get(booking['kind'] + '_id') != booking['option_id']
    return 'Your trip details or selections changed. This demo booking retains its original details.' if changed else None


def setup_indexes(db):
    # Establish replacement constraints before dropping the old all-products index.
    db.payments.create_index([('user_id', 1), ('trip_id', 1), ('product', 1)],
        unique=True, name='trip_plus_unique', partialFilterExpression={'product': 'trip_plus'})
    db.payments.create_index([('user_id', 1), ('trip_id', 1), ('product', 1), ('booking_key', 1)],
        unique=True, name='demo_booking_unique', partialFilterExpression={'booking_key': {'$exists': True}})
    old_name = 'user_id_1_trip_id_1_product_1'
    old = db.payments.index_information().get(old_name)
    if old and old.get('unique') and not old.get('partialFilterExpression') and old['key'] == [('user_id', 1), ('trip_id', 1), ('product', 1)]:
        db.payments.drop_index(old_name)
    db.payments.create_index([('user_id', 1), ('created_at', -1)])
