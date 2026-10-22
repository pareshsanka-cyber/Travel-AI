from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class PlaceRecommendation(BaseModel):
    name: str
    category: str
    description: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    distance_meters: Optional[float] = None
    travel_duration_minutes: Optional[int] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    opening_status: str = "UNKNOWN"  # "OPEN", "CLOSED", "UNKNOWN"
    source: str = "google_maps"  # "google_maps", "osm", "curated_verified", "rag_knowledge"
    source_url: Optional[str] = None
    image_url: Optional[str] = None
    reason_recommended: str = ""
    supported_actions: List[str] = Field(
        default_factory=lambda: ["view_details", "directions", "add_to_itinerary", "ask_followup"]
    )

class SuggestedAction(BaseModel):
    label: str
    action: str  # e.g. "show_more", "explore_category", "add_to_day", "ask_followup", "directions"
    payload: Optional[Dict[str, Any]] = None

class TravelGuideDataPayload(BaseModel):
    type: str = "place_recommendations"
    category: str
    destination: str
    user_location_used: bool = False
    places: List[PlaceRecommendation] = Field(default_factory=list)
    suggested_actions: List[SuggestedAction] = Field(default_factory=list)
