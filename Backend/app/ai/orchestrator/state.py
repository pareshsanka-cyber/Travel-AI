from typing import TypedDict, List, Dict, Any, Optional, Annotated

def merge_steps(existing: List[str], new: List[str]) -> List[str]:
    if existing is None:
        existing = []
    if new is None:
        new = []
    res = list(existing)
    for step in new:
        if step not in res:
            res.append(step)
    return res

class TravelState(TypedDict):
    # Chat Input (Only used if the user uses the Chat UI)
    user_message: Optional[str]
    
    # User Inputs (Provided directly by Form UI, or extracted by Parser for Chat UI)
    origin: Optional[str]
    destination: Optional[str]
    days: Optional[int]
    budget: Optional[float]
    preferences: Optional[str]
    start_date: Optional[str]
    end_date: Optional[str]
    travelers: Optional[int]
    currency: Optional[str]
    budget_mode: Optional[str]
    travel_style: Optional[str]
    interests: Optional[List[str]]
    must_visit_places: Optional[List[str]]
    pace: Optional[str]
    wake_up_time: Optional[str]
    bedtime: Optional[str]
    destination_timezone: Optional[str]
    
    # Agent Outputs
    planner_draft: Optional[str]
    flights: Optional[List[Dict[str, Any]]]
    flight_metadata: Optional[Dict[str, Any]]
    hotels: Optional[List[Dict[str, Any]]]
    nearby_hotels: Optional[List[Dict[str, Any]]]
    weather: Optional[Dict[str, Any]]
    attractions: Optional[List[Dict[str, Any]]]
    restaurants: Optional[List[Dict[str, Any]]]
    route_details: Optional[Dict[str, Any]]
    budget_breakdown: Optional[Dict[str, Any]]
    execution_state: Optional[Dict[str, Any]]
    
    # Reviewer Output
    reviewer_feedback: Optional[str]
    is_approved: bool
    
    # Synthesis Output
    final_itinerary: Optional[str]
    
    # Execution Tracking
    completed_steps: Annotated[List[str], merge_steps]
    error_logs: Optional[List[str]]
