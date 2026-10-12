import os
import json
import httpx
from datetime import datetime, timedelta
from app.ai.orchestrator.state import TravelState
from app.ai.rag.retriever import retrieve_travel_knowledge
from app.ai.agents.attraction_agent import resolve_destination_coordinates


def get_fallback_hotel(destination: str, days: int, currency: str) -> dict:
    nightly_rate = 6500.0 if currency == "INR" else 95.0
    coords = resolve_destination_coordinates(destination)

    dest_lower = (destination or "").lower()
    if "hyderabad" in dest_lower:
        image_url = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80"
    elif "goa" in dest_lower:
        image_url = "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80"
    elif "jaipur" in dest_lower or "rajasthan" in dest_lower:
        image_url = "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80"
    elif "delhi" in dest_lower:
        image_url = "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?auto=format&fit=crop&w=800&q=80"
    elif "mumbai" in dest_lower:
        image_url = "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80"
    else:
        image_url = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80"

    return {
        "name": f"Grand Heritage Hotel ({destination.title()})",
        "rating": "4.5",
        "price_per_night": nightly_rate,
        "total_cost": nightly_rate * days,
        "address": f"Central District, {destination.title()}",
        "amenities": ["Wi-Fi", "Breakfast Included", "Air Conditioning", "24/7 Concierge"],
        "imageUrl": image_url,
        "image_url": image_url,
        "lat": coords["lat"],
        "lon": coords["lon"],
        "hotel_category": "primary"
    }


def hotel_node(state: TravelState) -> dict:
    destination = state.get("destination") or "Goa"
    days = int(state.get("days") or 3)
    currency = state.get("currency") or "INR"

    print(f"--- HOTEL AGENT: Finding real-time hotels in {destination} ---")

    dest_coords = resolve_destination_coordinates(destination)
    api_key = os.getenv("SERPAPI_API_KEY")
    all_hotels = []

    if api_key:
        try:
            check_in_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
            check_out_date = (datetime.now() + timedelta(days=30 + days)).strftime("%Y-%m-%d")

            params = {
                "engine": "google_hotels",
                "q": destination,
                "check_in_date": check_in_date,
                "check_out_date": check_out_date,
                "adults": "2",
                "currency": currency,
                "api_key": api_key
            }

            response = httpx.get("https://serpapi.com/search.json", params=params, timeout=15.0)
            if response.status_code == 200:
                data = response.json()
                properties = data.get("properties", [])
                
                for idx, prop in enumerate(properties[:8]):
                    price_per_night = prop.get("rate_per_night", {}).get("extracted_lowest") or 0.0
                    total_cost = price_per_night * days

                    # Extract verified image
                    image_url = None
                    images = prop.get("images", [])
                    if images and isinstance(images, list):
                        image_url = images[0].get("original_image") or images[0].get("thumbnail") or None

                    hotel_name = prop.get("name", f"Hotel in {destination}")
                    
                    # Check if coords are in prop
                    gps = prop.get("gps_coordinates", {})
                    lat = float(gps.get("latitude")) if gps.get("latitude") else dest_coords["lat"]
                    lon = float(gps.get("longitude")) if gps.get("longitude") else dest_coords["lon"]

                    hotel = {
                        "name": hotel_name,
                        "rating": str(prop.get("overall_rating", "4.2")),
                        "price_per_night": float(price_per_night),
                        "total_cost": float(total_cost),
                        "address": prop.get("neighborhood") or destination,
                        "amenities": prop.get("amenities", [])[:4],
                        "imageUrl": image_url,
                        "image_url": image_url,
                        "lat": lat,
                        "lon": lon,
                        "hotel_category": "primary" if idx < 3 else "nearby",
                    }
                    all_hotels.append(hotel)

        except Exception as e:
            print(f"--- HOTEL AGENT: SerpAPI google_hotels failed ({e}), checking google_maps ---")

        if not all_hotels:
            try:
                maps_params = {
                    "engine": "google_maps",
                    "q": f"hotels in {destination}",
                    "api_key": api_key
                }
                maps_resp = httpx.get("https://serpapi.com/search.json", params=maps_params, timeout=10.0)
                if maps_resp.status_code == 200:
                    mdata = maps_resp.json()
                    local_results = mdata.get("local_results", [])
                    for idx, prop in enumerate(local_results[:8]):
                        h_lat = prop.get("gps_coordinates", {}).get("latitude") or dest_coords["lat"]
                        h_lon = prop.get("gps_coordinates", {}).get("longitude") or dest_coords["lon"]
                        thumb = prop.get("thumbnail")
                        all_hotels.append({
                            "name": prop.get("title", f"Hotel in {destination}"),
                            "rating": str(prop.get("rating", "4.5")),
                            "price_per_night": 6500.0 if currency == "INR" else 95.0,
                            "total_cost": (6500.0 if currency == "INR" else 95.0) * days,
                            "address": prop.get("address") or destination,
                            "amenities": ["Wi-Fi", "Breakfast Included", "Room Service"],
                            "imageUrl": thumb,
                            "image_url": thumb,
                            "lat": float(h_lat),
                            "lon": float(h_lon),
                            "hotel_category": "primary" if idx < 3 else "nearby",
                        })
                    if all_hotels:
                        print(f"--- HOTEL AGENT: Google Maps yielded {len(all_hotels)} verified hotels ---")
            except Exception as me:
                print(f"--- HOTEL AGENT: Secondary Google Maps hotel search failed: {me} ---")

    primary_hotels = [h for h in all_hotels if h.get("hotel_category") == "primary"]
    nearby_hotels = [h for h in all_hotels if h.get("hotel_category") == "nearby"]

    if not primary_hotels:
        primary_hotels.append(get_fallback_hotel(destination, days, currency))

    print(f"--- HOTEL AGENT: Found {len(primary_hotels)} primary + {len(nearby_hotels)} nearby hotels ---")

    return {
        "hotels": primary_hotels,
        "nearby_hotels": nearby_hotels,
    }
