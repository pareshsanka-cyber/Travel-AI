from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from app.ai.orchestrator.langgraph_graph import graph
from app.database.mongodb import db
from app.models.trip import TripModel
from datetime import datetime

from app.utils.auth_utils import require_user_id

from app.services.payment_service import plus_source, require_plus

router = APIRouter()


@router.get('/{id}/weather')
def get_trip_weather(id: str, period: Literal['trip', 'upcoming'] = 'trip', user_id: str = Depends(require_user_id)):
    from app.services.trip_service import owned_trip
    from app.ai.agents.weather_agent import fetch_realtime_weather_openmeteo
    trip, _ = owned_trip(db, id, user_id)
    routes = (trip.get('route_details') or {}).get('day_by_day_route') or []
    start = trip.get('start_date') or (routes[0].get('date') if routes else None)
    end = trip.get('end_date') or (routes[-1].get('date') if routes else None)
    if period == 'trip' and not start:
        weather = {'data_status': 'unavailable', 'reason': 'invalid_dates', 'summary': 'Set trip dates to view its forecast.', 'dailyForecast': []}
    else:
        weather = fetch_realtime_weather_openmeteo(trip['destination'], 7 if period == 'upcoming' else int(trip.get('days') or 3),
            start if period == 'trip' else None, end if period == 'trip' else None)
    # Read-only: weather refresh must not revise itineraries or booking snapshots.
    return {'trip_id': str(trip.get('_id') or trip.get('id')), 'period': period, 'weather': weather}

# Input validation schemas for API requests
class PlanRequest(BaseModel):
    user_message: Optional[str] = None # Used for Chat UI
    origin: Optional[str] = None       # Used for Form UI
    destination: Optional[str] = None  # Used for Form UI
    days: Optional[int] = Field(default=None, ge=1, le=30)
    budget: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    preferences: Optional[str] = None  # Extra preferences
    budget_mode: Optional[str] = None
    travel_style: Optional[str] = None
    start_date: Optional[str] = None   # Explicit trip start date (ISO YYYY-MM-DD or display)
    end_date: Optional[str] = None     # Explicit trip end date (ISO YYYY-MM-DD)
    currency: Optional[str] = "INR"
    travelers: Optional[int] = Field(default=1, ge=1, le=20)
    interests: Optional[list[str]] = None
    must_visit_places: Optional[list[str]] = None
    pace: Optional[str] = "balanced"
    wake_up_time: Optional[str] = None
    bedtime: Optional[str] = None

class FlightSearchRequest(BaseModel):
    destination: str
    origin: Optional[str] = "Hyderabad"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    currency: Optional[str] = "INR"
    budget: Optional[float] = None
    travelers: Optional[int] = Field(default=1, ge=1, le=20)

@router.post("/flights/search")
def search_flights_endpoint(request: FlightSearchRequest, user_id: str = Depends(require_user_id)):
    """Real-time flight search endpoint leveraging SerpApi Google Flights."""
    from app.ai.agents.flight_agent import fetch_real_flights_serpapi
    result = fetch_real_flights_serpapi(
        destination=request.destination,
        origin=request.origin or "Hyderabad",
        currency=request.currency or "INR",
        budget=request.budget,
        start_date=request.start_date,
        end_date=request.end_date,
        travelers_count=request.travelers or 1
    )
    return result

@router.post("/plan")
def plan_trip(request: PlanRequest, x_user_id: str = Depends(require_user_id)):
    print(f"--- API: Received trip planning request (User: {x_user_id}) ---")
    
    # 0. Authoritative Date Range Validation
    from app.services.planning_dates import validate_planning_dates
    try:
        validate_planning_dates(request.start_date, request.end_date)
    except ValueError as error:
        raise HTTPException(400, str(error))
    request_days = request.days
    if request.start_date and request.end_date:
        try:
            from dateutil import parser
            s_d = parser.parse(request.start_date).date()
            e_d = parser.parse(request.end_date).date()
            if e_d < s_d:
                raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
            request_days = (e_d - s_d).days + 1
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format provided for start_date or end_date")

    # 1. Prepare initial state for LangGraph
    initial_state = {
        "user_message": request.user_message,
        "origin": request.origin,
        "destination": request.destination,
        "days": request_days,
        "budget": request.budget,
        "preferences": request.preferences,
        "budget_mode": request.budget_mode,
        "travel_style": request.travel_style,
        "interests": request.interests,
        "must_visit_places": request.must_visit_places,
        "pace": request.pace or "balanced",
        "wake_up_time": request.wake_up_time,
        "bedtime": request.bedtime,
        "start_date": request.start_date,
        "end_date": request.end_date,
        "currency": request.currency or "INR",
        "travelers": request.travelers or 1,
        "completed_steps": [],
        "is_approved": False,
        "error_logs": []
    }
    
    import time
    start_time = time.time()
    req_id = f"req_{int(start_time)}"
    
    print(f"\n[ITINERARY START] request_id={req_id} destination={request.destination} days={request.days}")
    
    try:
        final_state = graph.invoke(initial_state)
        duration_ms = int((time.time() - start_time) * 1000)
        print(f"[ITINERARY END] request_id={req_id} duration_ms={duration_ms} status=success\n")
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        print(f"[ITINERARY ERROR] request_id={req_id} duration_ms={duration_ms} status=failed error={e}\n")
        raise HTTPException(
            status_code=500, 
            detail=f"Agent graph execution failed: {str(e)}"
        )
        
    # 3. Create a clean dictionary to save to MongoDB
    trip_data = {
        "revision": 1,
        "final_itinerary": final_state.get("final_itinerary"),
        "nearby_hotels": final_state.get("nearby_hotels") or [],
        "user_message": final_state.get("user_message"),
        "origin": final_state.get("origin") or "Unknown",
        "destination": final_state.get("destination") or "Unknown",
        "days": int(final_state.get("days", 3)),
        "budget": float(final_state.get("budget", 500.0)),
        "currency": final_state.get("currency") or "INR",
        "travelers": int(final_state.get("travelers", 1)),
        "start_date": final_state.get("start_date"),
        "end_date": final_state.get("end_date"),
        "preferences": final_state.get("preferences"),
        "budget_mode": final_state.get("budget_mode"),
        "travel_style": final_state.get("travel_style"),
        "interests": final_state.get("interests"),
        "must_visit_places": final_state.get("must_visit_places"),
        "pace": final_state.get("pace") or "balanced",
        "wake_up_time": final_state.get("wake_up_time"),
        "bedtime": final_state.get("bedtime"),
        "planner_draft": final_state.get("planner_draft") or "No plan generated",
        "flights": final_state.get("flights") or [],
        "flight_metadata": final_state.get("flight_metadata") or {},
            "destination_timezone": final_state.get("destination_timezone"),
        "hotels": final_state.get("hotels") or [],
        "weather": final_state.get("weather") or {},
        "attractions": final_state.get("attractions") or [],
        "restaurants": final_state.get("restaurants") or [],
        "route_details": final_state.get("route_details") or {},
        "budget_breakdown": final_state.get("budget_breakdown") or {},
        "execution_state": final_state.get("execution_state") or {
            "is_active": False,
            "current_day_number": 1,
            "activity_log": {},
            "reroute_history": []
        },
        "created_at": datetime.utcnow().isoformat()
    }
    if x_user_id:
        trip_data["user_id"] = x_user_id
    
    # 4. Save to MongoDB in the "trips" collection
    try:
        result = db.trips.insert_one(trip_data)
        # Add the string version of the MongoDB ID to our response
        trip_data["id"] = str(result.inserted_id)
        # Remove the BSON Object ID so JSON serialization works
        if "_id" in trip_data:
            del trip_data["_id"]
    except Exception as e:
        raise HTTPException(status_code=503, detail="Unable to save itinerary. Please try again.") from e
        
    trip_data["plus_access"] = False
    return trip_data

@router.get("/history")
def get_trip_history(x_user_id: str = Depends(require_user_id)):
    print(f"--- API: Fetching trip history for user '{x_user_id}' ---")
    trips_list = []
    
    try:
        # Fetch latest 10 trips from MongoDB for this user if specified
        query = {}
        if x_user_id:
            query["user_id"] = x_user_id

        cursor = db.trips.find(query).sort("created_at", -1).limit(10)
        for doc in cursor:
            doc["id"] = str(doc["_id"])
            del doc["_id"]
            doc["plus_access_source"] = plus_source(db, doc["id"], x_user_id)
            doc["plus_access"] = doc["plus_access_source"] is not None
            trips_list.append(doc)
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch history: {str(e)}"
        )
        
    return trips_list

@router.delete("/{id}")
def delete_trip(id: str, x_user_id: str = Depends(require_user_id)):
    print(f"--- API: Deleting trip '{id}' for user '{x_user_id}' ---")
    try:
        from bson import ObjectId
        from bson.errors import InvalidId
        try:
            query = {"_id": ObjectId(id)}
        except InvalidId:
            # If not a valid ObjectId, try deleting by string id if that's how it's stored
            query = {"id": id}
            
        if x_user_id:
            query["user_id"] = x_user_id
            
        result = db.trips.delete_one(query)
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Trip not found")
            
        return {"status": "deleted", "trip_id": id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to delete trip: {str(e)}"
        )

@router.get("/{id}")
def get_trip(id: str, user_id: str = Depends(require_user_id)):
    from app.services.trip_service import owned_trip, serialize_trip
    trip, _ = owned_trip(db, id, user_id)
    return serialize_trip(trip, db)


class SelectionRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    flight_id: Optional[str] = Field(default=None, max_length=200)
    hotel_id: Optional[str] = Field(default=None, max_length=200)


@router.post("/{id}/selections")
def update_selections(id: str, request: SelectionRequest, user_id: str = Depends(require_user_id)):
    from app.services.trip_service import save_selections
    return {'status': 'success', 'trip': save_selections(db, id, user_id, request.expected_revision,
        request.model_dump(exclude={'expected_revision'}, exclude_unset=True))}


class ActivityProgress(BaseModel):
    status: Literal['pending', 'in_progress', 'completed', 'skipped']
    actual_start_time: Optional[str] = None
    actual_end_time: Optional[str] = None
    user_notes: Optional[str] = Field(default=None, max_length=2000)
    activity_id: Optional[str] = None
    activity_title: Optional[str] = None


class ExecutionState(BaseModel):
    is_active: bool = False
    current_day_number: int = Field(default=1, ge=1, le=30)
    activity_log: Dict[str, ActivityProgress] = Field(default_factory=dict, max_length=1000)
    reroute_history: List[Dict[str, Any]] = Field(default_factory=list)


class ExecutionStateRequest(BaseModel):
    execution_state: ExecutionState
    expected_revision: int = Field(ge=1)


@router.post("/{id}/execution_state")
def update_execution_state(id: str, payload: ExecutionStateRequest, x_user_id: str = Depends(require_user_id)):
    print(f"--- API: Updating execution state for trip '{id}' ---")
    try:
        from bson import ObjectId
        from bson.errors import InvalidId
        try:
            query = {"_id": ObjectId(id)}
        except (InvalidId, Exception):
            query = {"id": id}
            
        if x_user_id:
            query["user_id"] = x_user_id
            
        trip = db.trips.find_one(query)
        if not trip and "_id" in query:
            query = {"id": id}
            if x_user_id:
                query["user_id"] = x_user_id
            trip = db.trips.find_one(query)

        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
            
        require_plus(db, str(trip.get("_id") or trip.get("id")), x_user_id)
        if payload.expected_revision != int(trip.get('revision', 1)):
            raise HTTPException(status_code=409, detail="Trip changed. Refresh before updating progress.")
        new_state = payload.execution_state.model_dump(exclude_none=True)
        new_state['reroute_history'] = (trip.get('execution_state') or {}).get('reroute_history', [])
        if new_state.get("activity_log") and trip.get("route_details"):
            daily_routes = trip.get("route_details", {}).get("day_by_day_route") or []
            if daily_routes:
                from app.utils.activity_identity import migrate_legacy_activity_log
                new_state["activity_log"] = migrate_legacy_activity_log(new_state["activity_log"], daily_routes)

        known_ids = {s['id'] for d in (trip.get('route_details') or {}).get('day_by_day_route', []) for s in (d.get('stops') or d.get('activities') or [])}
        known_ids.update((trip.get('execution_state') or {}).get('activity_log', {}).keys())
        legacy_keys = set()
        for index, day in enumerate((trip.get('route_details') or {}).get('day_by_day_route', [])):
            day_number = day.get('day') or day.get('day_number') or index + 1
            for stop_index, stop in enumerate(day.get('stops') or day.get('activities') or []):
                legacy_keys.update({f'{day_number}_{stop_index}', f'day_{day_number}_act_{stop_index + 1}'})
        if set(new_state['activity_log']) - known_ids - legacy_keys:
            raise HTTPException(status_code=400, detail="Progress contains activities outside this itinerary.")
        new_state['activity_log'] = {key: value for key, value in new_state['activity_log'].items() if key not in legacy_keys}
        if new_state['current_day_number'] > int(trip.get('days', 1)):
            raise HTTPException(status_code=400, detail="Progress day is outside the itinerary.")
        from app.services.trip_consistency import revision_filter
        revision = int(trip.get('revision', 1)) + 1
        write = db.trips.update_one(revision_filter(query, trip), {"$set": {"execution_state": new_state, "revision": revision}})
        if write.matched_count != 1:
            raise HTTPException(status_code=409, detail="Trip changed. Refresh before updating progress.")
        
        return {"status": "success", "execution_state": new_state, "revision": revision}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to update execution state: {str(e)}"
        )


class ReroutePreviewRequest(BaseModel):
    day_number: int = Field(ge=1, le=30)
    skipped_activity_id: str
    current_location: Optional[Dict[str, float]] = None
    current_time: Optional[str] = None
    expected_revision: Optional[int] = None


class RerouteApplyRequest(BaseModel):
    proposal_id: str
    day_number: int = Field(ge=1, le=30)
    skipped_activity_id: str
    proposed_stops: List[Dict[str, Any]] = Field(max_length=100)
    replacement_activity_id: Optional[str] = None
    reason: Optional[str] = None
    expected_revision: Optional[int] = None


@router.post("/{id}/reroute/preview")
def preview_reroute(id: str, request: ReroutePreviewRequest, x_user_id: str = Depends(require_user_id)):
    print(f"--- API: Generating reroute preview for trip '{id}', day {request.day_number} ---")
    try:
        from bson import ObjectId
        from bson.errors import InvalidId
        try:
            query = {"_id": ObjectId(id)}
        except (InvalidId, Exception):
            query = {"id": id}

        trip = db.trips.find_one(query)
        if not trip and "_id" in query:
            query = {"id": id}
            trip = db.trips.find_one(query)

        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Authorization check
        if trip.get("user_id") != x_user_id:
            raise HTTPException(status_code=403, detail="Unauthorized: Trip belongs to another user")

        require_plus(db, str(trip.get("_id") or trip.get("id")), x_user_id)

        # Concurrency Revision check
        if request.expected_revision is not None:
            curr_rev = int(trip.get("revision", 1))
            if int(request.expected_revision) != curr_rev:
                raise HTTPException(
                    status_code=409,
                    detail=f"Concurrent modification detected. Current revision is {curr_rev}, expected {request.expected_revision}."
                )

        from app.services.reroute_service import generate_reroute_proposal
        proposal = generate_reroute_proposal(
            trip=trip,
            day_number=request.day_number,
            skipped_activity_id=request.skipped_activity_id,
            current_location=request.current_location,
            current_time_str=request.current_time
        )
        import secrets
        from datetime import timedelta
        proposal["proposal_id"] = secrets.token_urlsafe(24)
        db.reroute_proposals.insert_one({"proposal_id": proposal["proposal_id"], "trip_id": id,
            "user_id": x_user_id, "revision": int(trip.get("revision", 1)),
            "day_number": request.day_number, "skipped_activity_id": request.skipped_activity_id,
            "proposal": proposal, "expires_at": datetime.utcnow() + timedelta(minutes=15)})
        return proposal
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reroute preview failed: {str(e)}")


@router.post("/{id}/reroute/apply")
def apply_reroute(id: str, request: RerouteApplyRequest, x_user_id: str = Depends(require_user_id)):
    print(f"--- API: Applying reroute proposal for trip '{id}', day {request.day_number} ---")
    try:
        from app.services.trip_service import owned_trip
        trip, _ = owned_trip(db, id, x_user_id)
        require_plus(db, str(trip.get("_id") or trip.get("id")), x_user_id)
        saved = db.reroute_proposals.find_one({"proposal_id": request.proposal_id, "trip_id": id,
            "user_id": x_user_id, "day_number": request.day_number,
            "skipped_activity_id": request.skipped_activity_id, "expires_at": {"$gt": datetime.utcnow()}})
        if not saved:
            raise HTTPException(status_code=409, detail="Reroute preview expired. Generate a new preview.")
        if request.expected_revision is not None and request.expected_revision != saved["revision"]:
            raise HTTPException(status_code=409, detail="Reroute revision does not match preview.")
        from app.services.reroute_service import apply_reroute_proposal
        result = apply_reroute_proposal(
            db=db,
            trip_id=id,
            day_number=request.day_number,
            skipped_activity_id=request.skipped_activity_id,
            proposed_stops=saved["proposal"]["proposed_stops"],
            replacement_activity_id=(saved["proposal"].get("replacement_activity") or {}).get("id"),
            reason=saved["proposal"].get("reason"),
            expected_revision=saved["revision"],
            x_user_id=x_user_id
        )
        return result
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reroute application failed: {str(e)}")
