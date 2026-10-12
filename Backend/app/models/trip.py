from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime

class TripModel(BaseModel):
    id: Optional[str] = Field(None, alias="_id") # MongoDB ID
    origin: Optional[str] = None
    destination: str
    days: int
    budget: float
    currency: Optional[str] = "INR"
    travelers: Optional[int] = 1
    preferences: Optional[str] = None
    interests: Optional[List[str]] = None
    must_visit_places: Optional[List[str]] = None
    pace: Optional[str] = "balanced"
    wake_up_time: Optional[str] = None
    bedtime: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    
    # Generated Itinerary
    planner_draft: str
    flights: List[Dict[str, Any]] = []
    flight_metadata: Optional[Dict[str, Any]] = None
    hotels: List[Dict[str, Any]] = []
    weather: Dict[str, Any] = {}
    attractions: List[Dict[str, Any]] = []
    restaurants: List[Dict[str, Any]] = []
    route_details: Dict[str, Any] = {}
    budget_breakdown: Dict[str, Any] = {}
    execution_state: Optional[Dict[str, Any]] = None
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
