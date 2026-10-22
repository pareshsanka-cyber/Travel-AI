from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

def _utcnow():
    return datetime.now(timezone.utc)

class TravelContext(BaseModel):
    destination: Optional[str] = None
    origin: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    days: Optional[int] = None
    
    budget: Optional[float] = None
    currency: Optional[str] = "INR"
    budget_mode: Optional[str] = None  # FIXED, FLEXIBLE, ECONOMY, PREMIUM, LUXURY, NO_LIMIT
    travel_style: Optional[str] = None # BUDGET, STANDARD, PREMIUM, LUXURY
    
    travelers: Optional[int] = 1
    preferences: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)
    accommodation_preferences: List[str] = Field(default_factory=list)
    transport_preferences: List[str] = Field(default_factory=list)
    
    interests: List[str] = Field(default_factory=list)
    must_visit_places: List[str] = Field(default_factory=list)
    pace: str = "balanced"
    wake_up_time: Optional[str] = None
    bedtime: Optional[str] = None

    current_trip_id: Optional[str] = None
    last_recommendations: Optional[List[Dict[str, Any]]] = None

class ConversationModel(BaseModel):
    conversation_id: str
    title: str = "New Travel Chat"
    status: str = "active"
    travel_context: TravelContext = Field(default_factory=TravelContext)
    current_trip_id: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
