from app.ai.llm import llm
from app.ai.orchestrator.state import TravelState
from langchain_core.prompts import ChatPromptTemplate
import json
import math
from datetime import datetime, timedelta
from app.ai.agents.attraction_agent import resolve_destination_coordinates


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))


def _valid_coords(lat, lon) -> bool:
    """Return True only if both lat and lon are real, non-zero, in-range values."""
    try:
        lat = float(lat)
        lon = float(lon)
        return (-90 <= lat <= 90) and (-180 <= lon <= 180) and not (lat == 0 and lon == 0)
    except (TypeError, ValueError):
        return False


def route_node(state: TravelState) -> dict:
    print(f"--- ROUTE AGENT: Generating daily routes for {state['destination']} ---")
    origin = state.get("origin")
    destination = state.get("destination", "Unknown")
    days = int(state.get("days", 3))

    hotels = state.get("hotels", [])
    hotel = hotels[0] if hotels else {}
    hotel_name = hotel.get("name", "Hotel")

    # Hotel coordinates: use real coords from hotel_agent (now always present)
    hotel_lat = float(hotel.get("lat") or 0)
    hotel_lon = float(hotel.get("lon") or 0)
    if not _valid_coords(hotel_lat, hotel_lon):
        # Fallback to destination-level coords
        dest_coords = resolve_destination_coordinates(destination)
        hotel_lat = dest_coords["lat"]
        hotel_lon = dest_coords["lon"]

    # Origin coordinates if provided
    origin_lat, origin_lon = None, None
    if origin:
        orig_coords = resolve_destination_coordinates(origin)
        origin_lat = orig_coords["lat"]
        origin_lon = orig_coords["lon"]

    # Destination coordinates for Airport
    dest_coords = resolve_destination_coordinates(destination)
    dest_lat = dest_coords["lat"]
    dest_lon = dest_coords["lon"]

    attractions = state.get("attractions", [])
    restaurants = state.get("restaurants", [])

    daily_routes = []
    start_date = datetime.now() + timedelta(days=30)

    for i in range(days):
        current_day_date = (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
        
        is_first_day = (i == 0)
        is_last_day = (i == days - 1)
        
        # Determine if this day is a flight/transit day
        # Day 1 is flight day if days > 1. Last day is flight day if days > 1.
        is_flight_day = (is_first_day or is_last_day) and days > 1 and origin is not None

        if is_first_day and is_flight_day:
            # Dedicated transit day: Origin -> Destination -> Hotel
            daily_routes.append({
                "day": i + 1,
                "is_flight_day": True,
                "title": f"Day {i + 1}: Travel to {destination}",
                "stops": [
                    {
                        "name": f"{origin} Airport",
                        "lat": origin_lat,
                        "lon": origin_lon,
                        "type": "airport"
                    },
                    {
                        "name": f"{destination} Airport",
                        "lat": dest_lat,
                        "lon": dest_lon,
                        "type": "airport"
                    },
                    {
                        "name": hotel_name,
                        "lat": hotel_lat,
                        "lon": hotel_lon,
                        "type": "hotel"
                    }
                ],
                "travel_tips": "Arrive at the airport 3 hours before international departure.",
            })
            continue

        if is_last_day and is_flight_day:
            # Dedicated transit day: Hotel -> Destination -> Origin
            daily_routes.append({
                "day": i + 1,
                "is_flight_day": True,
                "title": f"Day {i + 1}: Departure from {destination}",
                "stops": [
                    {
                        "name": hotel_name,
                        "lat": hotel_lat,
                        "lon": hotel_lon,
                        "type": "hotel"
                    },
                    {
                        "name": f"{destination} Airport",
                        "lat": dest_lat,
                        "lon": dest_lon,
                        "type": "airport"
                    },
                    {
                        "name": f"{origin} Airport",
                        "lat": origin_lat,
                        "lon": origin_lon,
                        "type": "airport"
                    }
                ],
                "travel_tips": "Ensure you check out of your hotel by 11:00 AM.",
            })
            continue

        # For middle days (or if no origin specified, for all days)
        # 1. Filter attractions by scheduled date
        day_attractions = [a for a in attractions if a.get("scheduled_date") == current_day_date]

        # 2. Exclude CLOSED
        valid_attractions = [a for a in day_attractions if a.get("status") != "CLOSED"]

        # 3. Prioritize OPEN
        open_attractions = [a for a in valid_attractions if a.get("status") == "OPEN"]
        unknown_attractions = [a for a in valid_attractions if a.get("status") == "UNKNOWN"]

        attraction = {"name": "Local Walk", "lat": hotel_lat, "lon": hotel_lon, "status": "UNKNOWN"}

        if open_attractions:
            attraction = open_attractions[0]
        elif unknown_attractions:
            attraction = unknown_attractions[0]
        elif attractions:
            # Use any available attraction for this day index
            attraction = attractions[i % len(attractions)]

        # Resolve attraction coordinates
        a_lat = float(attraction.get("lat") or 0)
        a_lon = float(attraction.get("lon") or 0)
        if not _valid_coords(a_lat, a_lon):
            a_lat = dest_lat
            a_lon = dest_lon

        # Find closest restaurant to this attraction
        best_rest = None
        min_dist = float('inf')

        for r in restaurants:
            r_lat = float(r.get("lat") or 0)
            r_lon = float(r.get("lon") or 0)
            if not _valid_coords(r_lat, r_lon):
                continue
            dist = haversine(a_lat, a_lon, r_lat, r_lon)
            if dist < min_dist:
                min_dist = dist
                best_rest = r

        # Resolve restaurant coordinates
        if best_rest:
            rest_name = best_rest.get("name", "Restaurant")
            rest_lat = float(best_rest.get("lat") or 0)
            rest_lon = float(best_rest.get("lon") or 0)
            if not _valid_coords(rest_lat, rest_lon):
                rest_lat = dest_lat
                rest_lon = dest_lon
        else:
            rest_name = "Local Restaurant"
            rest_lat = dest_lat
            rest_lon = dest_lon

        dist_str = f"({min_dist:.1f} km away)" if min_dist != float('inf') and min_dist > 0 else ""
        travel_tips = f"Restaurant is close to the attraction {dist_str}. Use local transport or walk."
        if attraction.get("status") == "UNKNOWN" and attraction.get("name") != "Local Walk":
            travel_tips += " ⚠️ WARNING: Live operational hours unavailable; please verify locally before visiting."

        # Preserve rich fields from the Grok/SerpApi enrichment
        attraction_stop = {
            "name": attraction.get("name", "Attraction"),
            "lat": a_lat,
            "lon": a_lon,
            "type": "attraction",
            "description": attraction.get("description"),
            "why_visit": attraction.get("why_visit"),
            "image_url": attraction.get("image_url"),
            "rating": attraction.get("rating"),
            "review_count": attraction.get("review_count"),
            "opening_hours": attraction.get("opening_hours")
        }
        
        restaurant_stop = {
            "name": rest_name,
            "lat": rest_lat,
            "lon": rest_lon,
            "type": "restaurant"
        }
        if best_rest:
            restaurant_stop.update({
                "description": best_rest.get("description"),
                "image_url": best_rest.get("image_url"),
                "rating": best_rest.get("rating"),
                "review_count": best_rest.get("review_count"),
                "opening_hours": best_rest.get("opening_hours")
            })

        daily_routes.append({
            "day": i + 1,
            "is_flight_day": False,
            "title": f"Day {i + 1}: {destination} Exploration",
            "stops": [
                {
                    "name": hotel_name,
                    "lat": hotel_lat,
                    "lon": hotel_lon,
                    "type": "hotel",
                    "description": hotel.get("description"),
                    "image_url": hotel.get("imageUrl") or hotel.get("image_url"),
                    "rating": hotel.get("rating")
                },
                attraction_stop,
                restaurant_stop,
            ],
            "travel_tips": travel_tips,
        })

    return {
        "route_details": {
            "day_by_day_route": daily_routes
        },
        "completed_steps": state.get("completed_steps", []) + ["route"]
    }
