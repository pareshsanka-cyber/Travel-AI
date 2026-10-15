"""Open an owned trip's conversation without changing its itinerary."""
import hashlib
from datetime import datetime
from pymongo.errors import DuplicateKeyError
from app.models.conversation import TravelContext
from app.services.trip_service import owned_trip


def open_edit_session(db, trip_id, user_id):
    trip, _ = owned_trip(db, trip_id, user_id)
    identity = str(trip.get('_id') or trip.get('id'))
    destination = trip.get('destination') or ''
    for conversation in db.conversations.find({'user_id': user_id, 'current_trip_id': identity, 'status': 'active'}).sort('updated_at', -1):
        if (conversation.get('travel_context') or {}).get('destination') == destination:
            return {'conversation_id': conversation['conversation_id'], 'current_trip_id': identity}
    # Stable identity plus the existing unique conversation_id index handles duplicate clicks.
    key = hashlib.sha256(f'{user_id}\0{identity}\0{destination}'.encode()).hexdigest()[:32]
    conversation_id = 'trip_edit_' + key
    fields = {key: trip[key] for key in TravelContext.model_fields if key in trip}
    preferences = fields.get('preferences')
    if isinstance(preferences, str): fields['preferences'] = [preferences]
    fields.update(destination=destination, current_trip_id=identity)
    context = TravelContext(**fields).model_dump()
    now = datetime.utcnow()
    document = {'conversation_id': conversation_id, 'user_id': user_id, 'current_trip_id': identity,
        'title': f'Edit {destination}', 'status': 'active', 'travel_context': context, 'created_at': now, 'updated_at': now}
    try:
        db.conversations.insert_one(document)
    except DuplicateKeyError:
        existing = db.conversations.find_one({'conversation_id': conversation_id, 'user_id': user_id, 'current_trip_id': identity})
        if not existing: raise
    return {'conversation_id': conversation_id, 'current_trip_id': identity}
