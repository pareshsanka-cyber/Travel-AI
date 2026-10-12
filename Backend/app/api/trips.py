from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from app.ai.orchestrator.langgraph_graph import graph
from app.database.mongodb import db
from app.models.trip import TripModel
from datetime import datetime

router = APIRouter()

# Input validation schemas for API requests
class PlanRequest(BaseModel):
    user_message: Optional[str] = None # Used for Chat UI
    origin: Optional[str] = None       # Used for Form UI
    destination: Optional[str] = None  # Used for Form UI
    days: Optional[int] = None         # Used for Form UI
    budget: Optional[float] = None     # Used for Form UI
    preferences: Optional[str] = None  # Extra preferences
    start_date: Optional[str] = None   # Explicit trip start date (ISO YYYY-MM-DD or display)
    end_date: Optional[str] = None     # Explicit trip end date (ISO YYYY-MM-DD)
    currency: Optional[str] = "INR"
    travelers: Optional[int] = 1
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
    travelers: Optional[int] = 1

@router.post("/flights/search")
def search_flights_endpoint(request: FlightSearchRequest):
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
def plan_trip(request: PlanRequest, x_user_id: Optional[str] = Header(None)):
    print(f"--- API: Received trip planning request (User: {x_user_id}) ---")
    
    # 0. Authoritative Date Range Validation
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
        "interests": final_state.get("interests"),
        "must_visit_places": final_state.get("must_visit_places"),
        "pace": final_state.get("pace") or "balanced",
        "wake_up_time": final_state.get("wake_up_time"),
        "bedtime": final_state.get("bedtime"),
        "planner_draft": final_state.get("planner_draft") or "No plan generated",
        "flights": final_state.get("flights") or [],
        "flight_metadata": final_state.get("flight_metadata") or {},
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
        print(f"Warning: Failed to save trip to MongoDB: {e}")
        trip_data["id"] = "temporary_id" # Return data even if DB save fails
        
    return trip_data

@router.get("/history")
def get_trip_history(x_user_id: Optional[str] = Header(None)):
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
            trips_list.append(doc)
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch history: {str(e)}"
        )
        
    return trips_list

@router.delete("/{id}")
def delete_trip(id: str, x_user_id: Optional[str] = Header(None)):
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

@router.post("/{id}/execution_state")
def update_execution_state(id: str, payload: dict, x_user_id: Optional[str] = Header(None)):
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
            
        new_state = payload.get("execution_state", {})
        if new_state.get("activity_log") and trip.get("route_details"):
            daily_routes = trip.get("route_details", {}).get("day_by_day_route") or []
            if daily_routes:
                from app.utils.activity_identity import migrate_legacy_activity_log
                new_state["activity_log"] = migrate_legacy_activity_log(new_state["activity_log"], daily_routes)

        db.trips.update_one(query, {"$set": {"execution_state": new_state}})
        
        return {"status": "success", "execution_state": new_state}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to update execution state: {str(e)}"
        )


class ReroutePreviewRequest(BaseModel):
    day_number: int
    skipped_activity_id: str
    current_location: Optional[Dict[str, float]] = None
    current_time: Optional[str] = None
    expected_revision: Optional[int] = None


class RerouteApplyRequest(BaseModel):
    day_number: int
    skipped_activity_id: str
    proposed_stops: List[Dict[str, Any]]
    replacement_activity_id: Optional[str] = None
    reason: Optional[str] = None
    expected_revision: Optional[int] = None


@router.post("/{id}/reroute/preview")
def preview_reroute(id: str, request: ReroutePreviewRequest, x_user_id: Optional[str] = Header(None)):
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
        if trip.get("user_id") and trip["user_id"] != x_user_id:
            raise HTTPException(status_code=403, detail="Unauthorized: Trip belongs to another user")

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
        return proposal
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reroute preview failed: {str(e)}")


@router.post("/{id}/reroute/apply")
def apply_reroute(id: str, request: RerouteApplyRequest, x_user_id: Optional[str] = Header(None)):
    print(f"--- API: Applying reroute proposal for trip '{id}', day {request.day_number} ---")
    try:
        from app.services.reroute_service import apply_reroute_proposal
        result = apply_reroute_proposal(
            db=db,
            trip_id=id,
            day_number=request.day_number,
            skipped_activity_id=request.skipped_activity_id,
            proposed_stops=request.proposed_stops,
            replacement_activity_id=request.replacement_activity_id,
            reason=request.reason,
            expected_revision=request.expected_revision,
            x_user_id=x_user_id
        )
        return result
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reroute application failed: {str(e)}")
