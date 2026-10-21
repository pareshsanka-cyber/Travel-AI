import os
import json
import httpx
from datetime import datetime, timedelta
from app.ai.orchestrator.state import TravelState
from app.services.discovery_status import search_guard, classify_response, remember_failure, status
from app.services.travel_offer_identity import stable_offer_id
from app.ai.rag.retriever import retrieve_travel_knowledge
from app.ai.agents.attraction_agent import resolve_destination_coordinates


def get_fallback_hotel(destination: str, days: int, currency: str) -> dict:
    return {"name": f"Accommodation to be selected in {destination}", "price_per_night": 0,
            "total_cost": 0, "address": destination, "amenities": [], "hotel_category": "primary",
            "source": "planning_placeholder", "data_status": "unavailable"}


def hotel_node(state: TravelState) -> dict:
    destination = state.get("destination") or "Goa"
    days = int(state.get("days") or 3)
    currency = state.get("currency") or "INR"

    print(f"--- HOTEL AGENT: Finding real-time hotels in {destination} ---")

    blocked = search_guard()
    if blocked:
        return {"hotels": [get_fallback_hotel(destination, days, currency)], "nearby_hotels": [],
                "hotel_metadata": dict(blocked, data_status="error")}
    metadata = status('empty_results')
    dest_coords = resolve_destination_coordinates(destination)
    api_key = os.getenv("SERPAPI_API_KEY")
    all_hotels = []

    if api_key:
        try:
            from dateutil.parser import parse
            from zoneinfo import ZoneInfo
            check_in = parse(state['start_date']).date() if state.get('start_date') else (datetime.now(ZoneInfo('Asia/Kolkata')) + timedelta(days=7)).date()
            check_out = parse(state['end_date']).date() if state.get('end_date') else check_in + timedelta(days=max(1, days - 1))
            if check_out <= check_in: check_out = check_in + timedelta(days=1)
            nights = (check_out - check_in).days
            check_in_date, check_out_date = check_in.isoformat(), check_out.isoformat()

            params = {
                "engine": "google_hotels",
                "q": destination,
                "check_in_date": check_in_date,
                "check_out_date": check_out_date,
                "adults": str(state.get("travelers") or 1),
                "currency": currency,
                "api_key": api_key
            }

            response = httpx.get("https://serpapi.com/search.json", params=params, timeout=15.0)
            reason = classify_response(response)
            if reason:
                remember_failure(reason)
                return {"hotels": [get_fallback_hotel(destination, days, currency)], "nearby_hotels": [],
                        "hotel_metadata": dict(status(reason), data_status="error")}
            if response.status_code == 200:
                data = response.json()
                properties = data.get("properties", [])
                
                for idx, prop in enumerate(properties[:8]):
                    price_per_night = prop.get("rate_per_night", {}).get("extracted_lowest") or 0.0
                    total_cost = price_per_night * nights

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
                        "id": stable_offer_id('hotel', prop),
                        "provider_id": prop.get('property_token') or prop.get('data_id') or prop.get('place_id'),
                        "currency": currency, "source": "serpapi_google_hotels",
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
            metadata = status('connection_failure' if isinstance(e, httpx.RequestError) else 'provider_unavailable')
            print(f"--- HOTEL AGENT: Search failed ({type(e).__name__}) ---")

        if not all_hotels and not metadata.get('failure_reason') in {'connection_failure', 'provider_unavailable'} and not search_guard():
            try:
                maps_params = {
                    "engine": "google_maps",
                    "q": f"hotels in {destination}",
                    "api_key": api_key
                }
                maps_resp = httpx.get("https://serpapi.com/search.json", params=maps_params, timeout=10.0)
                maps_reason = classify_response(maps_resp)
                if maps_reason:
                    remember_failure(maps_reason)
                    metadata = status(maps_reason)
                if maps_resp.status_code == 200 and not maps_reason:
                    mdata = maps_resp.json()
                    local_results = mdata.get("local_results", [])
                    for idx, prop in enumerate(local_results[:8]):
                        h_lat = prop.get("gps_coordinates", {}).get("latitude") or dest_coords["lat"]
                        h_lon = prop.get("gps_coordinates", {}).get("longitude") or dest_coords["lon"]
                        thumb = prop.get("thumbnail")
                        all_hotels.append({
                            "id": stable_offer_id('hotel', prop),
                            "provider_id": prop.get('place_id') or prop.get('data_id'),
                            "currency": currency, "source": "serpapi_google_maps",
                            "name": prop.get("title", f"Hotel in {destination}"),
                            "rating": str(prop.get("rating") or 0),
                            "price_per_night": 0.0,
                            "total_cost": 0.0,
                            "address": prop.get("address") or destination,
                            "amenities": [],
                            "imageUrl": thumb,
                            "image_url": thumb,
                            "lat": float(h_lat),
                            "lon": float(h_lon),
                            "hotel_category": "primary" if idx < 3 else "nearby",
                        })
                    if all_hotels:
                        print(f"--- HOTEL AGENT: Google Maps yielded {len(all_hotels)} verified hotels ---")
            except Exception as me:
                metadata = status("connection_failure" if isinstance(me, httpx.RequestError) else "provider_unavailable")

    primary_hotels = [h for h in all_hotels if h.get("hotel_category") == "primary"]
    nearby_hotels = [h for h in all_hotels if h.get("hotel_category") == "nearby"]

    if not primary_hotels:
        primary_hotels.append(get_fallback_hotel(destination, days, currency))

    print(f"--- HOTEL AGENT: Found {len(primary_hotels)} primary + {len(nearby_hotels)} nearby hotels ---")

    return {
        "hotels": primary_hotels,
        "nearby_hotels": nearby_hotels,
        "hotel_metadata": dict(status('available') if all_hotels else metadata,
                               data_status='search_results' if all_hotels else 'error' if metadata['failure_reason'] != 'empty_results' else 'no_results'),
    }
