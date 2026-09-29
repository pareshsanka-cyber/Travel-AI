import os
import json
import httpx
import urllib.parse
from app.ai.llm import grok_llm, llm
from app.ai.orchestrator.state import TravelState
from langchain_core.prompts import ChatPromptTemplate

SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY")

enrichment_cache = {}

GROK_DISCOVERY_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert travel discovery assistant. Your role is to discover and recommend a diverse list of candidate attractions "
        "for a given destination, tailored to the traveler's preferences, budget, and trip duration.\n\n"
        "RULES:\n"
        "- Return ONLY a structured JSON response matching the schema below.\n"
        "- Discover 15 to 25 real, highly relevant attractions.\n"
        "- Do NOT invent or hallucinate attractions. Only use real-world places.\n"
        "- Provide diverse categories (e.g., landmark, museum, park, viewpoint, cultural).\n"
        "- Provide non-real-time descriptive information.\n"
        "- Do NOT provide coordinates (lat/lon), image URLs, live prices, or live opening hours.\n"
        "- Order by relevance and popularity.\n\n"
        "EXPECTED JSON SCHEMA:\n"
        "{{\n"
        '  "attractions": [\n'
        "    {{\n"
        '      "name": "Exact Place Name",\n'
        '      "category": "category type (e.g., landmark, museum, park)",\n'
        '      "description": "Short factual non-real-time description (2-3 sentences max).",\n'
        '      "why_visit": "Why this is a great fit for the user preferences.",\n'
        '      "estimated_visit_duration_minutes": 120,\n'
        '      "best_time_of_day": "morning|afternoon|evening",\n'
        '      "interests": ["culture", "history"]\n'
        "    }}\n"
        "  ]\n"
        "}}"
    ),
    (
        "human",
        "Destination: {destination}\n"
        "Trip Duration: {days} days\n"
        "Budget: {budget}\n"
        "Preferences/Interests: {preferences}\n"
        "Please discover candidate attractions."
    )
])

def enrich_place_nominatim(name: str, destination: str) -> dict:
    # Rate limited fallback for Nominatim (not for bulk, but single fallback)
    dest_clean = destination.lower().strip()
    query = f"{name}, {dest_clean}"
    try:
        resp = httpx.get(
            f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query)}&format=json&limit=1",
            headers={"User-Agent": "TravelAI_Agent/1.0 (contact: info@travelai.local)"},
            timeout=5.0
        )
        if resp.status_code == 200:
            data = resp.json()
            if data and len(data) > 0:
                print(f"MATCH: Nominatim fallback verified '{name}'")
                return {
                    "lat": float(data[0]["lat"]),
                    "lon": float(data[0]["lon"]),
                    "address": data[0].get("display_name"),
                }
    except Exception:
        pass
    print(f"REJECT: Nominatim fallback failed for '{name}'")
    return None

def verify_and_enrich_place(name: str, destination: str) -> dict:
    """Uses SerpApi Google Maps to verify place and grab coordinates/images."""
    cache_key = f"{name}_{destination}".lower()
    if cache_key in enrichment_cache:
        return enrichment_cache[cache_key]

    query = f"{name} {destination}"
    url = f"https://serpapi.com/search.json?engine=google_maps&q={urllib.parse.quote(query)}&api_key={SERPAPI_API_KEY}"
    
    print(f"--- ATTRACTION ENRICHMENT: Searching SerpApi for '{name}' ---")
    
    try:
        resp = httpx.get(url, timeout=10.0)
        if resp.status_code == 200:
            data = resp.json()
            local_results = data.get("local_results", [])
            place_results = data.get("place_results", {})
            
            result = None
            if "title" in place_results:
                result = place_results
            elif len(local_results) > 0:
                result = local_results[0]
                
            if result:
                result_title = result.get("title", "")
                
                # Basic Match Confidence Check
                name_words = set(name.lower().split())
                title_words = set(result_title.lower().split())
                
                # If there's an intersection or it returned a solid data_id, accept it
                if len(name_words.intersection(title_words)) > 0 or result.get("data_id") or result.get("gps_coordinates"):
                    coords = result.get("gps_coordinates", {})
                    lat = coords.get("latitude")
                    lon = coords.get("longitude")
                    
                    if lat and lon:
                        hours_str = None
                        op_hours = result.get("operating_hours")
                        if isinstance(op_hours, dict):
                            for k, v in op_hours.items():
                                if isinstance(v, str):
                                    hours_str = v
                                    break
                                
                        enriched = {
                            "lat": lat,
                            "lon": lon,
                            "place_id": result.get("place_id"),
                            "data_id": result.get("data_id"),
                            "rating": result.get("rating"),
                            "review_count": result.get("reviews"),
                            "address": result.get("address"),
                            "opening_hours": hours_str,
                            "image_url": result.get("thumbnail") or result.get("serpapi_thumbnail") or result.get("photos_link"),
                            "image_source": "google_maps" if result.get("thumbnail") else None,
                            "photos_link": result.get("photos_link")
                        }
                        
                        enrichment_cache[cache_key] = enriched
                        print(f"MATCH: '{name}' -> '{result_title}' (lat:{lat}, lon:{lon})")
                        return enriched
                        
                print(f"REJECT: '{name}' matched weakly with '{result_title}' or missing coords.")
            else:
                print(f"NOT FOUND: No SerpApi results for '{name}'")
        else:
            print(f"API ERROR: SerpApi status {resp.status_code}")
    except Exception as e:
        print(f"EXCEPTION: SerpApi error: {e}")

    # Fallback to Nominatim if SerpApi fails or rejects
    print(f"--- ATTRACTION ENRICHMENT: Falling back to Nominatim for '{name}' ---")
    nom_result = enrich_place_nominatim(name, destination)
    if nom_result:
        nom_result["image_url"] = None
        nom_result["image_source"] = None
        nom_result["photos_link"] = None
        nom_result["rating"] = None
        nom_result["review_count"] = None
        nom_result["opening_hours"] = None
        nom_result["place_id"] = None
        nom_result["data_id"] = None
        enrichment_cache[cache_key] = nom_result
        return nom_result
        
    enrichment_cache[cache_key] = None
    return None

def resolve_destination_coordinates(destination: str) -> dict:
    # Keep this helper available for route_agent fallbacks
    dest_clean = destination.lower().strip()
    try:
        resp = httpx.get(
            f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(dest_clean)}&format=json&limit=1",
            headers={"User-Agent": "TravelAI_Agent/1.0 (contact: info@travelai.local)"},
            timeout=5.0
        )
        if resp.status_code == 200:
            data = resp.json()
            if data and len(data) > 0:
                return {"lat": float(data[0]["lat"]), "lon": float(data[0]["lon"])}
    except Exception:
        pass
        
    return {"lat": 28.6139, "lon": 77.2090}


def attraction_node(state: TravelState) -> dict:
    destination = state.get("destination", "Unknown")
    days = state.get("days", 3)
    budget = state.get("budget", 500.0)
    preferences = state.get("preferences", "General tourist")
    
    print(f"--- ATTRACTION AGENT: Starting Grok Discovery for {destination} ---")
    
    if not grok_llm:
        print("CONFIGURATION ERROR: XAI_API_KEY is missing. Cannot perform attraction discovery.")
        raise ValueError("Configuration Error: XAI_API_KEY is missing. Please configure XAI_API_KEY in the backend .env file to use the Grok-based attraction discovery.")
    
    # 1. Grok Discovery Call
    prompt_val = GROK_DISCOVERY_PROMPT.format_messages(
        destination=destination,
        days=days,
        budget=budget,
        preferences=preferences
    )
    
    try:
        response = grok_llm.invoke(prompt_val)
        data = json.loads(response.content.strip())
        candidates = data.get("attractions", [])
        print(f"--- ATTRACTION AGENT: Discovery yielded {len(candidates)} candidate attractions ---")
    except Exception as e:
        print(f"--- ATTRACTION AGENT: Discovery failed: {e} ---")
        candidates = []
        
    final_attractions = []
    
    # 2. Factual Enrichment & Verification
    for idx, candidate in enumerate(candidates):
        name = candidate.get("name")
        if not name:
            continue
            
        print(f"Verifying [{idx+1}/{len(candidates)}]: {name}")
        enriched_data = verify_and_enrich_place(name, destination)
        
        if enriched_data:
            # Construct the final normalized object
            final_obj = {
                "name": name,
                "type": "attraction",
                "category": candidate.get("category"),
                "description": candidate.get("description"),
                "why_visit": candidate.get("why_visit"),
                "estimated_visit_duration_minutes": candidate.get("estimated_visit_duration_minutes", 120),
                "best_time_of_day": candidate.get("best_time_of_day", "morning"),
                "interests": candidate.get("interests", []),
                "lat": enriched_data.get("lat"),
                "lon": enriched_data.get("lon"),
                "image_url": enriched_data.get("image_url"),
                "image_source": enriched_data.get("image_source"),
                "photos_link": enriched_data.get("photos_link"),
                "rating": enriched_data.get("rating"),
                "review_count": enriched_data.get("review_count"),
                "address": enriched_data.get("address"),
                "opening_hours": enriched_data.get("opening_hours"),
                "place_id": enriched_data.get("place_id"),
                "data_id": enriched_data.get("data_id")
            }
            final_attractions.append(final_obj)
        else:
            print(f"⚠️ DISCARDED: {name} (Could not verify factually)")
            
        # Optimization: Stop enriching once we have enough verified places (e.g. 2 per day)
        target_count = min(15, int(days) * 2 + 2)
        if len(final_attractions) >= target_count:
            print(f"--- ATTRACTION AGENT: Reached target of {target_count} verified attractions. Halting enrichment. ---")
            break
            
    if not final_attractions:
        print("--- ATTRACTION AGENT: No verified attractions found! Returning empty list. ---")
        
    return {"attractions": final_attractions, "completed_steps": state.get("completed_steps", []) + ["attractions"]}
