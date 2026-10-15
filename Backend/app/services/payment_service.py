"""Persistent, bank-free payment simulator. Mongo compare-and-swap owns state."""
from datetime import datetime, timedelta
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from app.services.trip_service import owned_trip

PRODUCT = 'trip_plus'
AMOUNT = 49900


def now():
    return datetime.utcnow()


def public(order, db=None):
    result = dict(order)
    result['id'] = str(result.pop('_id'))
    if db is not None and order.get('booking'):
        from app.services.booking_service import notice
        result['booking_notice'] = notice(db, order)
    return result


def plus_access(db, trip_id, user_id):
    return plus_source(db, trip_id, user_id) is not None


def plus_source(db, trip_id, user_id):
    key = {'user_id': user_id, 'trip_id': str(trip_id), 'status': 'succeeded', 'mode': 'demo'}
    for product in ('flight_demo', 'hotel_demo'):
        order = db.payments.find_one(dict(key, product=product))
        if order and order.get('booking') and order.get('amount', 0) > 0:
            return 'booking'
    if db.payments.find_one(dict(key, product=PRODUCT, amount=AMOUNT, currency='INR')):
        return 'upgrade'
    return None


def require_plus(db, trip_id, user_id):
    if not plus_access(db, trip_id, user_id):
        raise HTTPException(402, 'Upgrade this trip to Trip Plus to use this feature.')


def settle(db, order):
    if order['status'] != 'pending':
        return order
    instant = now()
    try:
        owned_trip(db, order['trip_id'], order['user_id'])
        status = order['completion_outcome'] if instant >= order['settle_at'] else None
    except HTTPException as error:
        if error.status_code != 404:
            raise
        status = 'cancelled'
    if status:
        attempts = [dict(item) for item in order['attempts']]
        attempts[-1].update(status=status, completed_at=instant)
        db.payments.update_one({'_id': order['_id'], 'status': 'pending',
            'attempt_version': order['attempt_version']}, {'$set': {
                'status': status, 'updated_at': instant, 'attempts': attempts}})
        return db.payments.find_one({'_id': order['_id']})
    return order


def get_order(db, order_id, user_id):
    try:
        identity = ObjectId(order_id)
    except (InvalidId, TypeError):
        raise HTTPException(404, 'Demo order not found')
    order = db.payments.find_one({'_id': identity, 'user_id': user_id})
    if not order:
        raise HTTPException(404, 'Demo order not found')
    return settle(db, order)


def create_order(db, trip_id, user_id):
    trip, _ = owned_trip(db, trip_id, user_id)
    # Normalize aliases to the trip's canonical identity.
    trip_id = str(trip.get('_id') or trip.get('id'))
    key = {'user_id': user_id, 'trip_id': trip_id, 'product': PRODUCT}
    existing = db.payments.find_one(key)
    if existing:
        return settle(db, existing)
    instant = now()
    order = dict(key, mode='demo', amount=AMOUNT, currency='INR',
        trip_title=trip.get('title') or trip.get('destination') or 'Your trip',
        days=trip.get('days', 1), travelers=trip.get('travelers', 1),
        status='created', attempt_version=0, attempts=[], created_at=instant, updated_at=instant)
    try:
        order['_id'] = db.payments.insert_one(order).inserted_id
    except DuplicateKeyError:
        return settle(db, db.payments.find_one(key))
    return order


def simulate(db, order_id, user_id, method, outcome):
    order = get_order(db, order_id, user_id)
    if order['status'] == 'succeeded':
        return order
    trip, _ = owned_trip(db, order['trip_id'], user_id)
    if order['status'] == 'pending' and outcome != 'cancel':
        return order
    if order.get('booking') and order['status'] != 'pending' and outcome != 'cancel':
        if int(trip.get('revision', 1)) != order['expected_revision']:
            raise HTTPException(409, 'Trip changed. Review a fresh demo booking before paying.')
    instant = now()
    status = 'cancelled' if outcome == 'cancel' else 'pending'
    attempts = [dict(item) for item in order['attempts']]
    if order['status'] == 'pending':
        attempts[-1].update(status='cancelled', completed_at=instant)
    else:
        attempts.append({'number': order['attempt_version'] + 1, 'method': method,
            'requested_outcome': outcome, 'status': status, 'started_at': instant,
            **({'completed_at': instant} if status == 'cancelled' else {})})
    update = {'status': status, 'method': method, 'attempts': attempts,
        'attempt_version': order['attempt_version'] + 1, 'updated_at': instant,
        'settle_at': instant + timedelta(seconds=20 if outcome == 'delayed' else 3),
        'completion_outcome': 'failed' if outcome == 'failure' else 'succeeded'}
    db.payments.update_one({'_id': order['_id'], 'status': order['status'],
        'attempt_version': order['attempt_version']}, {'$set': update})
    return get_order(db, order_id, user_id)
