"""Itinerary revision history tracking, diff calculation, and snapshot restoration."""
import copy
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import HTTPException
from app.services.trip_service import owned_trip, serialize_trip
from app.services.trip_consistency import revision_filter


def create_snapshot(trip: Dict[str, Any], summary: Optional[str] = None, trigger: str = 'initial') -> Dict[str, Any]:
    """Generates an immutable snapshot of an itinerary revision."""
    routes = (trip.get('route_details') or {}).get('day_by_day_route') or []
    days_snapshot = []
    
    for day in routes:
        stops = day.get('stops') or day.get('activities') or []
        stops_snapshot = []
        for s in stops:
            stop_id = str(s.get('id') or s.get('activity_id') or s.get('title') or '')
            title = s.get('title') or s.get('name') or ''
            start_time = s.get('start_time') or ''
            end_time = s.get('end_time') or ''
            time_display = s.get('time') or (f"{start_time} - {end_time}".strip(' -') if start_time or end_time else '')
            
            stops_snapshot.append({
                'id': stop_id,
                'title': title,
                'name': title,
                'time': time_display,
                'start_time': start_time,
                'end_time': end_time,
                'duration': s.get('duration') or (f"{s.get('duration_minutes')}m" if s.get('duration_minutes') else None),
                'duration_minutes': s.get('duration_minutes'),
                'location': s.get('location') or s.get('address') or '',
                'address': s.get('address') or '',
                'lat': s.get('lat'),
                'lon': s.get('lon'),
                'type': s.get('type') or 'attraction',
                'description': s.get('description') or '',
                'thumbnail': s.get('thumbnail') or s.get('image_url') or '',
                'category': s.get('category') or '',
                'operating_status': s.get('operatingStatus') or s.get('status') or 'UNKNOWN',
                'travel_time_from_prev_minutes': s.get('travel_time_from_prev_minutes') or 0,
            })
            
        day_num = int(day.get('day') or day.get('day_number') or (len(days_snapshot) + 1))
        days_snapshot.append({
            'dayNumber': day_num,
            'date': day.get('date') or '',
            'title': day.get('day_title') or day.get('title') or f"Day {day_num}",
            'activities': stops_snapshot,
            'stops': stops_snapshot,
        })

    rev = int(trip.get('revision', 1))
    
    # Meaningful default summary if omitted
    if not summary:
        if trigger == 'initial':
            summary = 'Initial AI generated itinerary'
        elif trigger == 'ai_edit':
            summary = f"Revision {rev} itinerary modifications"
        elif trigger == 'reroute':
            summary = f"Revision {rev} live schedule reroute"
        elif trigger == 'restore':
            summary = f"Restored to Revision {rev}"
        else:
            summary = f"Revision {rev} update"

    return {
        'revision': rev,
        'timestamp': datetime.utcnow().isoformat(),
        'summary': summary,
        'trigger': trigger,
        'daysCount': len(days_snapshot) or int(trip.get('days', 1)),
        'budgetEstimate': trip.get('budgetEstimate') or (f"₹{trip.get('budget', 0):,}" if trip.get('budget') else ''),
        'travelersCount': int(trip.get('travelers') or trip.get('travelersCount') or 1),
        'days': days_snapshot,
    }


def get_trip_revisions(db, trip_id: str, user_id: str) -> Dict[str, Any]:
    """Retrieves revision snapshots for a trip; initializes first snapshot if missing."""
    trip, query = owned_trip(db, trip_id, user_id)
    history = list(trip.get('revision_history') or [])
    curr_rev = int(trip.get('revision', 1))

    # If no history exists, seed Revision 1
    if not history:
        initial_snapshot = create_snapshot(trip, summary='Initial AI generated itinerary', trigger='initial')
        history = [initial_snapshot]
        db.trips.update_one({'_id': trip['_id']}, {'$set': {'revision_history': history}})
    elif not any(h.get('revision') == curr_rev for h in history):
        # Current revision was missing a snapshot (e.g. from an older edit), append it
        current_snapshot = create_snapshot(trip, summary=f"Revision {curr_rev} itinerary", trigger='ai_edit')
        history.append(current_snapshot)
        db.trips.update_one({'_id': trip['_id']}, {'$set': {'revision_history': history}})

    return {
        'trip_id': str(trip.get('_id') or trip.get('id')),
        'current_revision': curr_rev,
        'revisions': sorted(history, key=lambda x: x.get('revision', 1)),
    }


def restore_trip_revision(
    db,
    trip_id: str,
    user_id: str,
    target_revision: int,
    expected_revision: int
) -> Dict[str, Any]:
    """Restores itinerary state to a target revision, bumping revision count and saving a restore snapshot."""
    trip, query = owned_trip(db, trip_id, user_id)
    curr_rev = int(trip.get('revision', 1))

    if curr_rev != expected_revision:
        raise HTTPException(
            status_code=409,
            detail=f"Concurrent modification detected. Current revision is {curr_rev}, expected {expected_revision}."
        )

    history = list(trip.get('revision_history') or [])
    target_snapshot = next((h for h in history if int(h.get('revision', -1)) == target_revision), None)

    if not target_snapshot:
        raise HTTPException(
            status_code=404,
            detail=f"Revision {target_revision} not found in trip history."
        )

    # Reconstruct day_by_day_route from snapshot days
    new_route_days = []
    for d in target_snapshot.get('days', []):
        day_num = d.get('dayNumber') or 1
        stops = copy.deepcopy(d.get('activities') or d.get('stops') or [])
        new_route_days.append({
            'day': day_num,
            'day_number': day_num,
            'date': d.get('date') or '',
            'day_title': d.get('title') or f"Day {day_num}",
            'title': d.get('title') or f"Day {day_num}",
            'stops': stops,
            'activities': stops,
        })

    new_rev = curr_rev + 1
    new_route_details = copy.deepcopy(trip.get('route_details') or {})
    new_route_details['day_by_day_route'] = new_route_days

    # Build restore snapshot
    restored_trip_data = copy.deepcopy(trip)
    restored_trip_data['route_details'] = new_route_details
    restored_trip_data['revision'] = new_rev

    restore_snapshot = create_snapshot(
        restored_trip_data,
        summary=f"Restored from Revision {target_revision}",
        trigger='restore'
    )
    history.append(restore_snapshot)

    updates = {
        'route_details': new_route_details,
        'revision': new_rev,
        'revision_history': history,
        'updated_at': datetime.utcnow().isoformat(),
    }

    write_result = db.trips.update_one(revision_filter(query, trip), {'$set': updates})
    if write_result.matched_count != 1:
        raise HTTPException(
            status_code=409,
            detail="Trip changed while restoring revision. Refresh and try again."
        )

    trip.update(updates)
    return serialize_trip(trip, db)
