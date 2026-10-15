import os
import json
import math
from zoneinfo import ZoneInfo
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict, Any, Tuple
import urllib.parse
import httpx

from app.ai.llm import llm
from app.ai.orchestrator.state import TravelState
from app.ai.agents.attraction_agent import resolve_destination_coordinates
from app.utils.activity_identity import generate_persistent_activity_id

AIRPORT_REGISTRY = {
    "hyderabad": {
        "name": "Rajiv Gandhi International Airport (HYD)",
        "iata": "HYD",
        "lat": 17.2403,
        "lon": 78.4294,
        "city": "Hyderabad",
        "address": "Shamshabad, Hyderabad, Telangana 500409, India",
        "place_id": "ChIJRRvZsX-7yzsRUajqM-wpIFM",
        "image_url": "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80",
        "description": "Rajiv Gandhi International Airport (HYD) in Shamshabad, Hyderabad. Premier international hub featuring integrated departure terminal.",
    },
    "delhi": {
        "name": "Indira Gandhi International Airport (DEL)",
        "iata": "DEL",
        "lat": 28.5562,
        "lon": 77.1000,
        "city": "New Delhi",
        "address": "Palam, New Delhi, Delhi 110037, India",
        "place_id": "ChIJb_l2D9IeDTkR-3V_T_7uP0Y",
        "image_url": "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=800&q=80",
        "description": "Indira Gandhi International Airport (DEL) in Palam, New Delhi. Major aviation hub serving India's capital region.",
    },
    "new delhi": {
        "name": "Indira Gandhi International Airport (DEL)",
        "iata": "DEL",
        "lat": 28.5562,
        "lon": 77.1000,
        "city": "New Delhi",
        "address": "Palam, New Delhi, Delhi 110037, India",
        "place_id": "ChIJb_l2D9IeDTkR-3V_T_7uP0Y",
        "image_url": "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=800&q=80",
        "description": "Indira Gandhi International Airport (DEL) in Palam, New Delhi. Major aviation hub serving India's capital region.",
    },
    "bengaluru": {
        "name": "Kempegowda International Airport (BLR)",
        "iata": "BLR",
        "lat": 13.1986,
        "lon": 77.7066,
        "city": "Bengaluru",
        "address": "KIAL Rd, Devanahalli, Bengaluru, Karnataka 560300, India",
        "place_id": "ChIJA4_kF8VUrjsR_4TzL0f20iE",
        "image_url": "https://images.unsplash.com/photo-1508873696983-2df570464756?auto=format&fit=crop&w=800&q=80",
        "description": "Kempegowda International Airport (BLR) in Devanahalli, Bengaluru. India's Silicon Valley air gateway.",
    },
    "bangalore": {
        "name": "Kempegowda International Airport (BLR)",
        "iata": "BLR",
        "lat": 13.1986,
        "lon": 77.7066,
        "city": "Bengaluru",
        "address": "KIAL Rd, Devanahalli, Bengaluru, Karnataka 560300, India",
        "place_id": "ChIJA4_kF8VUrjsR_4TzL0f20iE",
        "image_url": "https://images.unsplash.com/photo-1508873696983-2df570464756?auto=format&fit=crop&w=800&q=80",
        "description": "Kempegowda International Airport (BLR) in Devanahalli, Bengaluru. India's Silicon Valley air gateway.",
    },
    "mumbai": {
        "name": "Chhatrapati Shivaji Maharaj International Airport (BOM)",
        "iata": "BOM",
        "lat": 19.0896,
        "lon": 72.8656,
        "city": "Mumbai",
        "address": "Sahar, Andheri East, Mumbai, Maharashtra 400099, India",
        "place_id": "ChIJq6g9-Y3A5zsR25G_26r0a7A",
        "image_url": "https://images.unsplash.com/photo-1542296332-2e4473faf563?auto=format&fit=crop&w=800&q=80",
        "description": "Chhatrapati Shivaji Maharaj International Airport (BOM) in Andheri, Mumbai. Premier financial capital aviation gateway.",
    },
    "chennai": {
        "name": "Chennai International Airport (MAA)",
        "iata": "MAA",
        "lat": 12.9941,
        "lon": 80.1709,
        "city": "Chennai",
        "address": "GST Rd, Meenambakkam, Chennai, Tamil Nadu 600027, India",
        "place_id": "ChIJ_38wD_tZlTkRvz8sA6Pfv1Q",
        "image_url": "https://images.unsplash.com/photo-1569154941061-e231b4725ef1?auto=format&fit=crop&w=800&q=80",
        "description": "Chennai International Airport (MAA) in Meenambakkam, Chennai. Premier aviation gateway to South India.",
    },
    "kolkata": {
        "name": "Netaji Subhash Chandra Bose International Airport (CCU)",
        "iata": "CCU",
        "lat": 22.6547,
        "lon": 88.4467,
        "city": "Kolkata",
        "address": "Dum Dum, Kolkata, West Bengal 700052, India",
        "place_id": "ChIJk9XwS6n3-DkRb3r3FjA-6f4",
        "image_url": "https://images.unsplash.com/photo-1578575437130-527eed3abbec?auto=format&fit=crop&w=800&q=80",
        "description": "Netaji Subhash Chandra Bose International Airport (CCU) in Dum Dum, Kolkata.",
    },
    "goa": {
        "name": "Manohar International Airport (GOX)",
        "iata": "GOX",
        "lat": 15.7303,
        "lon": 73.8694,
        "city": "Goa",
        "address": "Mopa, Pernem, Goa 403512, India",
        "image_url": "https://images.unsplash.com/photo-1520437358207-323b43b50729?auto=format&fit=crop&w=800&q=80",
        "description": "Manohar International Airport (Mopa / GOX), Goa.",
    },
    "kochi": {
        "name": "Cochin International Airport (COK)",
        "iata": "COK",
        "lat": 10.1518,
        "lon": 76.3930,
        "city": "Kochi",
        "address": "Nedumbassery, Kochi, Kerala 683111, India",
        "image_url": "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80",
        "description": "Cochin International Airport (COK) in Nedumbassery, Kochi. World's first fully solar-powered airport.",
    },
    "kerala": {
        "name": "Cochin International Airport (COK)",
        "iata": "COK",
        "lat": 10.1518,
        "lon": 76.3930,
        "city": "Kochi, Kerala",
        "address": "Nedumbassery, Kochi, Kerala 683111, India",
        "image_url": "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80",
        "description": "Cochin International Airport (COK) serving Kerala.",
    },
    "sydney": {
        "name": "Sydney Kingsford Smith Airport (SYD)",
        "iata": "SYD",
        "lat": -33.9399,
        "lon": 151.1753,
        "city": "Sydney",
        "address": "Mascot, Sydney NSW 2020, Australia",
        "place_id": "ChIJp4Fm_yquEmsR0n0xX0y1G2Y",
        "image_url": "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=800&q=80",
        "description": "Sydney Kingsford Smith Airport (SYD) in Mascot, Sydney. Australia's busiest international terminal.",
    },
    "tokyo": {
        "name": "Narita International Airport (NRT)",
        "iata": "NRT",
        "lat": 35.7720,
        "lon": 140.3929,
        "city": "Tokyo",
        "address": "Narita, Chiba 282-0004, Japan",
        "place_id": "ChIJT_2E22p5ImAR_yG4H4wV1a4",
        "image_url": "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=800&q=80",
        "description": "Narita International Airport (NRT), premier international gateway to Greater Tokyo.",
    },
    "paris": {
        "name": "Charles de Gaulle Airport (CDG)",
        "iata": "CDG",
        "lat": 49.0097,
        "lon": 2.5479,
        "city": "Paris",
        "address": "Roissy-en-France, 95700 Paris, France",
        "image_url": "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=800&q=80",
        "description": "Charles de Gaulle Airport (CDG) in Roissy, Paris. France's primary international hub.",
    },
    "london": {
        "name": "London Heathrow Airport (LHR)",
        "iata": "LHR",
        "lat": 51.4700,
        "lon": -0.4543,
        "city": "London",
        "address": "Hounslow, London TW6 1AP, UK",
        "image_url": "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=800&q=80",
        "description": "London Heathrow Airport (LHR), premier international gateway to the United Kingdom.",
    },
    "singapore": {
        "name": "Singapore Changi Airport (SIN)",
        "iata": "SIN",
        "lat": 1.3644,
        "lon": 103.9915,
        "city": "Singapore",
        "address": "Airport Blvd., Singapore 819642",
        "image_url": "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?auto=format&fit=crop&w=800&q=80",
        "description": "Singapore Changi Airport (SIN), world-renowned aviation hub in Singapore.",
    },
    "dubai": {
        "name": "Dubai International Airport (DXB)",
        "iata": "DXB",
        "lat": 25.2532,
        "lon": 55.3657,
        "city": "Dubai",
        "address": "Al Garhoud, Dubai, United Arab Emirates",
        "image_url": "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=800&q=80",
        "description": "Dubai International Airport (DXB), premier intercontinental transit hub.",
    },
    "new york": {
        "name": "John F. Kennedy International Airport (JFK)",
        "iata": "JFK",
        "lat": 40.6413,
        "lon": -73.7781,
        "city": "New York",
        "address": "Queens, NY 11430, United States",
        "image_url": "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?auto=format&fit=crop&w=800&q=80",
        "description": "John F. Kennedy International Airport (JFK) in Queens, New York.",
    },
}


def resolve_destination_timezone(destination: str) -> str:
    """Resolve destination IANA timezone to prevent local host timezone skew."""
    if not destination:
        return "Asia/Kolkata"
    d = destination.lower()
    if any(k in d for k in ["sydney", "melbourne", "australia", "nsw", "brisbane", "adelaide", "perth"]):
        if "perth" in d: return "Australia/Perth"
        if "adelaide" in d: return "Australia/Adelaide"
        if "brisbane" in d: return "Australia/Brisbane"
        return "Australia/Sydney"
    if any(k in d for k in ["paris", "france", "nice", "lyon"]):
        return "Europe/Paris"
    if any(k in d for k in ["tokyo", "japan", "kyoto", "osaka"]):
        return "Asia/Tokyo"
    if any(k in d for k in ["london", "uk", "united kingdom", "edinburgh"]):
        return "Europe/London"
    if any(k in d for k in ["dubai", "uae", "abu dhabi"]):
        return "Asia/Dubai"
    if any(k in d for k in ["singapore"]):
        return "Asia/Singapore"
    if any(k in d for k in ["new york", "nyc", "boston", "miami"]):
        return "America/New_York"
    if any(k in d for k in ["los angeles", "san francisco", "seattle"]):
        return "America/Los_Angeles"
    if any(k in d for k in ["rome", "italy", "milan", "florence", "venice"]):
        return "Europe/Rome"
    if any(k in d for k in ["bangkok", "thailand", "phuket", "chiang mai"]):
        return "Asia/Bangkok"
    if any(k in d for k in ["bali", "indonesia"]):
        return "Asia/Makassar"
    if any(k in d for k in ["auckland", "new zealand", "queenstown"]):
        return "Pacific/Auckland"
    return "Asia/Kolkata"


def resolve_airport_details(location: str) -> dict:
    """Resolve genuine airport details for a city or airport query."""
    if not location:
        return {
            "name": "Airport",
            "lat": None,
            "lon": None,
            "address": "Airport Terminal",
            "city": "Airport",
            "description": "Departure/Arrival Airport terminal."
        }
        
    loc_clean = location.lower().strip()
    
    for key, airport_info in AIRPORT_REGISTRY.items():
        if key in loc_clean or loc_clean in key or (airport_info.get("iata") and airport_info["iata"].lower() in loc_clean):
            return dict(airport_info)
            
    try:
        query = location if "airport" in loc_clean else f"{location} International Airport"
        resp = httpx.get(
            f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query)}&format=json&limit=1",
            headers={"User-Agent": "TravelAI_Agent/1.0 (contact: info@travelai.local)"},
            timeout=4.0
        )
        if resp.status_code == 200:
            data = resp.json()
            if data and len(data) > 0:
                return {
                    "name": data[0].get("display_name", "").split(",")[0] or f"{location} Airport",
                    "iata": None,
                    "lat": float(data[0]["lat"]),
                    "lon": float(data[0]["lon"]),
                    "city": location,
                    "address": data[0].get("display_name", f"{location} Airport"),
                    "place_id": str(data[0].get("place_id", "")),
                    "image_url": "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80",
                    "description": f"Airport terminal serving {location}."
                }
    except Exception:
        pass

    dest_coords = resolve_destination_coordinates(location)
    return {
        "name": f"{location} Airport",
        "iata": None,
        "lat": dest_coords.get("lat"),
        "lon": dest_coords.get("lon"),
        "city": location,
        "address": f"{location} Airport Terminal",
        "place_id": None,
        "image_url": "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80",
        "description": f"Airport terminal serving {location}."
    }


def haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))


def _valid_coords(lat, lon) -> bool:
    try:
        lat = float(lat)
        lon = float(lon)
        return (-90 <= lat <= 90) and (-180 <= lon <= 180) and not (lat == 0 and lon == 0)
    except (TypeError, ValueError):
        return False


def estimate_transit(lat1, lon1, lat2, lon2, default_mins: int = 20) -> Tuple[int, float, str]:
    """
    Returns (duration_minutes, distance_km, travel_mode).
    Uses haversine with realistic city road factor & walking threshold.
    """
    if not (_valid_coords(lat1, lon1) and _valid_coords(lat2, lon2)):
        return max(10, default_mins), 0.0, "driving"
        
    dist_km = round(haversine(float(lat1), float(lon1), float(lat2), float(lon2)), 1)
    
    if dist_km < 1.0:
        # Walking distance
        walk_mins = max(5, round((dist_km / 4.5) * 60))
        return walk_mins, dist_km, "walking"
        
    # Driving / Cab in city traffic (~25 km/h avg speed)
    drive_mins = max(10, round((dist_km / 25.0) * 60))
    return drive_mins, dist_km, "driving"


def parse_hhmm_to_minutes(val: str, default_mins: int) -> int:
    if not val:
        return default_mins
    try:
        clean = val.strip().lower()
        is_pm = "pm" in clean
        is_am = "am" in clean
        clean = clean.replace("am", "").replace("pm", "").strip()
        parts = clean.split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        if is_pm and h < 12: h += 12
        if is_am and h == 12: h = 0
        return h * 60 + m
    except Exception:
        return default_mins


def minutes_to_hhmm(mins: int) -> str:
    mins = max(0, mins) % 1440
    h = mins // 60
    m = mins % 60
    return f"{h:02d}:{m:02d}"


def minutes_to_ampm(mins: int) -> str:
    mins = max(0, mins) % 1440
    h = mins // 60
    m = mins % 60
    ampm = "AM" if h < 12 else "PM"
    display_h = h % 12
    if display_h == 0: display_h = 12
    return f"{display_h:02d}:{m:02d} {ampm}"


def format_time_range(start_mins: int, end_mins: int) -> str:
    return f"{minutes_to_ampm(start_mins)} - {minutes_to_ampm(end_mins)}"


def format_duration(dur_mins: int) -> str:
    dur_mins = max(1, dur_mins)
    h = dur_mins // 60
    m = dur_mins % 60
    if h > 0 and m > 0:
        return f"{h}h {m}m"
    elif h > 0:
        return f"{h}h 00m"
    return f"{m} mins"


def route_node(state: TravelState) -> dict:
    destination = state.get("destination", "Unknown")
    origin = state.get("origin")
    preferences = state.get("preferences") or ""
    pace = (state.get("pace") or "balanced").lower()
    
    print(f"--- ROUTE AGENT: Initializing priority-based time-aware schedule for {destination} (pace: {pace}) ---")

    # 1. Authoritative Destination Timezone & Date Range Calculation
    dest_tz_name = state.get("destination_timezone") or resolve_destination_timezone(destination)
    dest_tz = ZoneInfo(dest_tz_name)
    now_in_dest = datetime.now(dest_tz)

    start_date_obj: date
    end_date_obj: date
    days: int

    if state.get("start_date"):
        try:
            from dateutil import parser
            start_date_obj = parser.parse(state["start_date"]).date()
        except Exception:
            start_date_obj = (now_in_dest + timedelta(days=7)).date()
    else:
        start_date_obj = (now_in_dest + timedelta(days=7)).date()

    if state.get("end_date"):
        try:
            from dateutil import parser
            end_date_obj = parser.parse(state["end_date"]).date()
            if end_date_obj < start_date_obj:
                end_date_obj = start_date_obj
            days = (end_date_obj - start_date_obj).days + 1
        except Exception:
            days = int(state.get("days", 3))
            end_date_obj = start_date_obj + timedelta(days=days - 1)
    else:
        days = int(state.get("days", 3))
        end_date_obj = start_date_obj + timedelta(days=days - 1)

    # Generate authoritative date sequence (exactly one calendar date per day)
    calendar_dates = [start_date_obj + timedelta(days=i) for i in range(days)]

    # 2. Timing Parameters based on Pace & User Preferences
    if pace == "relaxed":
        def_wake = "08:30"
        def_bed = "21:30"
        attr_duration_mins = 135  # ~2h 15m visit duration
        lunch_duration_mins = 75
        dinner_duration_mins = 75
        target_attractions_per_day = 1
    elif pace == "packed":
        def_wake = "07:30"
        def_bed = "22:30"
        attr_duration_mins = 75   # ~1h 15m visit duration
        lunch_duration_mins = 60
        dinner_duration_mins = 75
        target_attractions_per_day = 3
    else:  # "balanced"
        def_wake = "08:00"
        def_bed = "22:00"
        attr_duration_mins = 105  # ~1h 45m visit duration
        lunch_duration_mins = 60
        dinner_duration_mins = 75
        target_attractions_per_day = 2

    wake_mins = parse_hhmm_to_minutes(state.get("wake_up_time"), parse_hhmm_to_minutes(def_wake, 480))
    bed_mins = parse_hhmm_to_minutes(state.get("bedtime"), parse_hhmm_to_minutes(def_bed, 1320))

    # 3. Airport & Hotel Resolution
    has_flight_transit = bool(origin and (days > 1 or state.get("flights")))
    orig_airport = resolve_airport_details(origin) if origin else None
    dest_airport = resolve_airport_details(((state.get("flights") or [{}])[0].get("arrival_airport_name")) or destination)

    hotels = state.get("hotels", [])
    hotel = hotels[0] if hotels else {}
    hotel_name = hotel.get("name") or f"Curated Accommodation in {destination}"
    hotel_lat = float(hotel.get("lat") or 0)
    hotel_lon = float(hotel.get("lon") or 0)
    if not _valid_coords(hotel_lat, hotel_lon):
        dest_coords = resolve_destination_coordinates(destination)
        hotel_lat = dest_coords["lat"]
        hotel_lon = dest_coords["lon"]
    hotel_address = hotel.get("address") or f"Center, {destination}"
    hotel_img = hotel.get("imageUrl") or hotel.get("image_url")
    if not hotel_img:
        dest_lower = (destination or "").lower()
        if "hyderabad" in dest_lower:
            hotel_img = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80"
        elif "goa" in dest_lower:
            hotel_img = "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80"
        elif "jaipur" in dest_lower or "rajasthan" in dest_lower:
            hotel_img = "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80"
        elif "delhi" in dest_lower:
            hotel_img = "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?auto=format&fit=crop&w=800&q=80"
        elif "mumbai" in dest_lower:
            hotel_img = "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80"
        else:
            hotel_img = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80"

    # 4. Filter and Prioritize Attractions & Restaurants
    raw_attractions = state.get("attractions", [])
    raw_restaurants = state.get("restaurants", [])

    # Sort attractions strictly by priority_score descending
    valid_attractions = [a for a in raw_attractions if a.get("status") != "CLOSED"]
    valid_attractions.sort(key=lambda x: x.get("priority_score", 0), reverse=True)

    used_attraction_names = set()
    used_restaurant_names = set()
    seen_activity_slugs: Dict[str, int] = {}
    used_activity_ids = set()
    schedule_notes = []

    daily_routes = []

    flight_dep_m, flight_arr_m, arrival_day_index, flight_duration = 480, 630, 0, 150
    normalized_flights = list(state.get('flights') or [])
    if has_flight_transit and normalized_flights:
        from app.services.flight_timing import flight_timing
        timing = flight_timing(normalized_flights[0], start_date_obj, resolve_destination_timezone(origin), dest_tz_name)
        if timing['departure_date'] != start_date_obj or not 0 <= timing['arrival_offset'] < days:
            raise ValueError('The flight arrival falls outside your selected trip dates. Extend the date range or choose another flight.')
        flight_dep_m, flight_arr_m = timing['departure'], timing['arrival']
        arrival_day_index, flight_duration = timing['arrival_offset'], timing['duration']
        normalized_flights[0] = dict(normalized_flights[0], departure_date=timing['departure_date'].isoformat(), arrival_date=timing['arrival_date'].isoformat())
        if arrival_day_index:
            schedule_notes.append(f"The outbound flight departs on {start_date_obj.isoformat()} and arrives on {timing['arrival_date'].isoformat()}. Destination activities start after arrival.")
    hotel_transfer = estimate_transit(dest_airport['lat'], dest_airport['lon'], hotel_lat, hotel_lon, default_mins=35)[0]
    hotel_checkin_absolute = arrival_day_index * 1440 + flight_arr_m + 50 + hotel_transfer
    if hotel_checkin_absolute % 1440 + 60 > 1439:
        hotel_checkin_absolute = (hotel_checkin_absolute // 1440 + 1) * 1440
    hotel_checkin_day = hotel_checkin_absolute // 1440

    # 5. Day-by-Day Route Construction with Exact Non-Overlapping Timetable
    for day_idx in range(days):
        day_num = day_idx + 1
        day_date = calendar_dates[day_idx]
        date_iso = day_date.strftime("%Y-%m-%d")
        date_display = day_date.strftime("%d %b %Y")
        day_of_week = day_date.strftime("%A")

        is_first_day = (day_idx == 0)
        is_last_day = (day_idx == days - 1)
        is_arrival_day = day_idx == arrival_day_index
        is_flight_day = (is_first_day or is_last_day or is_arrival_day) and has_flight_transit

        day_stops = []
        act_counter = 0

        # Helper to append an activity segment ensuring non-overlapping chronometry
        def add_stop(
            stop_type: str,
            name: str,
            category: str,
            start_m: int,
            end_m: int,
            prev_lat: Any,
            prev_lon: Any,
            curr_lat: Any,
            curr_lon: Any,
            location_str: str,
            description: str,
            why_visit: str,
            image_url: Optional[str] = None,
            rating: Optional[float] = None,
            review_count: Optional[int] = None,
            opening_hours: Optional[str] = None,
            opening_hours_status: str = "UNVERIFIED",
            matched_interest: str = "General",
            priority_rank: int = 99,
            match_type: str = "popular_recommendation",
            source: str = "curated",
            fame_level: Optional[str] = None,
            place_id: Optional[str] = None,
            status_reason: Optional[str] = None,
            custom_transit: Optional[Tuple[int, float, str]] = None
        ):
            nonlocal act_counter
            # Transit from previous stop
            if custom_transit:
                t_mins, t_dist, t_mode = custom_transit
            elif not day_stops:
                t_mins, t_dist, t_mode = 0, 0.0, "driving"
            else:
                previous_stop = day_stops[-1]
                t_mins, t_dist, t_mode = estimate_transit(previous_stop.get("lat"), previous_stop.get("lon"), curr_lat, curr_lon)

            stop_timezone = resolve_destination_timezone(origin) if stop_type == 'airport' and origin and name == orig_airport['name'] else dest_tz_name
            dur_mins = end_m - start_m
            if day_stops:
                previous = day_stops[-1]
                previous_stamp = datetime.fromisoformat(date_iso + 'T' + previous['end_time']).replace(tzinfo=ZoneInfo(previous.get('timezone') or dest_tz_name))
                local_previous = previous_stamp.astimezone(ZoneInfo(stop_timezone))
                previous_end = (local_previous.date() - day_date).days * 1440 + local_previous.hour * 60 + local_previous.minute
                earliest = previous_end + max(0, t_mins)
                if start_m < earliest:
                    start_m = earliest
                    end_m = start_m + dur_mins
            deadline = min(bed_mins, 1439) if stop_type in {'attraction', 'restaurant', 'breakfast'} else 1439
            if start_m < 0 or dur_mins <= 0 or end_m > deadline:
                schedule_notes.append(f'Day {day_num}: {name} could not fit the available time including transfer; it was not scheduled.')
                return

            # Count canonical identities, including names that share a truncated slug.
            base_key = generate_persistent_activity_id(stop_type, name, place_id)
            count = seen_activity_slugs.get(base_key, 0) + 1
            act_id = generate_persistent_activity_id(stop_type, name, place_id, disambiguator=count)
            while act_id in used_activity_ids:
                count += 1
                act_id = generate_persistent_activity_id(stop_type, name, place_id, disambiguator=count)
            seen_activity_slugs[base_key] = count

            # Operating hours status normalization
            op_stat = "OPEN" if opening_hours_status == "VERIFIED_OPEN" else ("CLOSED" if opening_hours_status == "VERIFIED_CLOSED" else "UNKNOWN")

            if stop_type in {'attraction', 'restaurant'}:
                from app.ai.agents.opening_hours_agent import determine_status_from_hours
                hours_status, status_reason = determine_status_from_hours(opening_hours, datetime.fromisoformat(date_iso), minutes_to_hhmm(start_m), minutes_to_hhmm(end_m))
                if hours_status == 'CLOSED':
                    # A morning visit may simply need to wait for the venue to open.
                    # Keep its full duration, and never move it past bedtime/midnight.
                    for candidate_start in range(start_m + 1, deadline - dur_mins + 1):
                        candidate_end = candidate_start + dur_mins
                        candidate_status, candidate_reason = determine_status_from_hours(opening_hours, datetime.fromisoformat(date_iso), minutes_to_hhmm(candidate_start), minutes_to_hhmm(candidate_end))
                        if candidate_status == 'OPEN':
                            start_m, end_m = candidate_start, candidate_end
                            hours_status, status_reason = candidate_status, candidate_reason
                            break
                    else:
                        schedule_notes.append(f'Day {day_num}: {name} could not fit its listed opening hours; it was not scheduled.')
                        return
                opening_hours_status = 'VERIFIED_OPEN' if hours_status == 'OPEN' else 'UNVERIFIED'
                op_stat = hours_status
            day_stops.append({
                "id": act_id,
                "activity_index": act_counter - 1,
                "name": name,
                "title": name,
                "type": stop_type,
                "category": category,
                "matched_interest": matched_interest,
                "priority_rank": priority_rank,
                "match_type": match_type,
                "start_time": minutes_to_hhmm(start_m),
                "end_time": minutes_to_hhmm(end_m),
                "time": format_time_range(start_m, end_m),
                "duration_minutes": dur_mins,
                "duration": format_duration(dur_mins),
                "travel_time_from_prev_minutes": t_mins,
                "travel_time_from_prev": f"{t_mins} mins" if t_mins > 0 else "0 mins",
                "distance_from_prev_km": t_dist,
                "travel_mode": t_mode,
                "lat": float(curr_lat) if _valid_coords(curr_lat, curr_lon) else None,
                "lon": float(curr_lon) if _valid_coords(curr_lat, curr_lon) else None,
                "location": location_str,
                "address": location_str,
                "description": description,
                "why_visit": why_visit,
                "image_url": image_url,
                "rating": rating,
                "review_count": review_count,
                "opening_hours": opening_hours,
                "opening_hours_status": opening_hours_status,
                "status": op_stat,
                "status_reason": status_reason,
                "place_id": place_id,
                "source": source,
                "fame_level": fame_level,
                "scheduled_date": date_iso,
                "timezone": stop_timezone,
                "day_of_week": day_of_week,
            })
            used_activity_ids.add(act_id)
            act_counter += 1
            if stop_type == "attraction": used_attraction_names.add(name)
            if stop_type == "restaurant": used_restaurant_names.add(name)

        # -------------------------------------------------------------------------
        # CASE A: ARRIVAL DAY (Origin Airport -> Destination Airport -> Hotel -> Evening)
        # -------------------------------------------------------------------------
        if (is_first_day or is_arrival_day) and has_flight_transit:
            day_title = f"Day {day_num}: Journey to {destination} & Check-in"
            
            airport_checkin_m = max(0, flight_dep_m - 120)

            if is_first_day:
                # Stop 1: Departure Flight at Origin Airport
                add_stop(
                    stop_type="airport",
                    name=orig_airport["name"],
                    category="airport",
                    start_m=airport_checkin_m,
                    end_m=flight_dep_m,
                    prev_lat=None, prev_lon=None,
                    curr_lat=orig_airport["lat"], curr_lon=orig_airport["lon"],
                    location_str=orig_airport.get("address", origin),
                    description=f"Airport arrival, baggage check, security clearance, and flight boarding at {orig_airport['name']}.",
                    why_visit=f"Departure air gateway for your journey to {destination}.",
                    image_url=orig_airport.get("image_url"),
                    custom_transit=(0, 0.0, "driving")
                )

                if not is_arrival_day:
                    daily_routes.append({'day': day_num, 'day_number': day_num, 'date': date_iso,
                        'formatted_date': date_display, 'day_of_week': day_of_week, 'title': f'Day {day_num}: Overnight journey to {destination}',
                        'is_flight_day': True, 'pace': pace, 'stops': day_stops, 'activities': day_stops,
                        'travel_tips': f'Your flight arrives on {calendar_dates[arrival_day_index].isoformat()}. Destination activities begin after arrival.'})
                    continue

            # Stop 2: Destination Airport Touchdown & Baggage Clearance (45-60 min)
            add_stop(
                stop_type="airport",
                name=dest_airport["name"],
                category="airport",
                start_m=flight_arr_m,
                end_m=min(1439, flight_arr_m + 50),
                prev_lat=orig_airport["lat"], prev_lon=orig_airport["lon"],
                curr_lat=dest_airport["lat"], curr_lon=dest_airport["lon"],
                location_str=dest_airport.get("address", destination),
                description=f"Touchdown at {dest_airport['name']}. Proceed through customs, collect baggage, and meet private ground transport.",
                why_visit=f"Arrival terminal serving Greater {destination}.",
                image_url=dest_airport.get("image_url"),
                custom_transit=(flight_duration, 0.0, "flight")
            )

            # Transfer to Hotel
            t_mins, t_dist, t_mode = estimate_transit(dest_airport["lat"], dest_airport["lon"], hotel_lat, hotel_lon, default_mins=35)
            hotel_checkin_start = hotel_checkin_absolute % 1440

            if day_idx == hotel_checkin_day:
                # Stop 3: Hotel Check-in & Relaxation
                add_stop(
                    stop_type="hotel",
                    name=hotel_name,
                    category="hotel",
                    start_m=hotel_checkin_start,
                    end_m=hotel_checkin_start + 60,
                    prev_lat=dest_airport["lat"], prev_lon=dest_airport["lon"],
                    curr_lat=hotel_lat, curr_lon=hotel_lon,
                    location_str=hotel_address,
                    description=f"Check into your accommodation at {hotel_name}. Unpack, freshen up, and settle in after your transit.",
                    why_visit=f"Base hospitality accommodation for your stay in {destination}.",
                    image_url=hotel_img,
                    rating=hotel.get("rating")
                )

                current_cursor = hotel_checkin_start + 60

            else:
                current_cursor = 1440

            # Lunch or Refreshment if checkin concludes between 12:30 and 15:00
            if current_cursor <= 870: # before 14:30
                lunch_start = max(current_cursor + 15, 750) # at least 12:30
                # Pick restaurant closest to hotel
                best_r = None
                for r in raw_restaurants:
                    if r.get("name") not in used_restaurant_names:
                        best_r = r
                        break
                if best_r:
                    r_lat = best_r.get("lat") or hotel_lat
                    r_lon = best_r.get("lon") or hotel_lon
                    add_stop(
                        stop_type="restaurant",
                        name=best_r.get("name", f"Bistro in {destination}"),
                        category="restaurant",
                        start_m=lunch_start,
                        end_m=lunch_start + 60,
                        prev_lat=hotel_lat, prev_lon=hotel_lon,
                        curr_lat=r_lat, curr_lon=r_lon,
                        location_str=best_r.get("address", destination),
                        description=best_r.get("description") or f"Sample authentic regional flavors for your welcome meal in {destination}.",
                        why_visit=f"Welcome dining experience in {destination}.",
                        image_url=best_r.get("image_url"),
                        rating=best_r.get("rating")
                    )
                    current_cursor = lunch_start + 60

            # Optional Relaxed Evening Sightseeing if arrival was early
            if current_cursor <= 960: # before 16:00
                cand_attr = None
                for a in valid_attractions:
                    if a.get("name") not in used_attraction_names:
                        cand_attr = a
                        break
                if cand_attr:
                    raw_lat = cand_attr.get("lat")
                    raw_lon = cand_attr.get("lon")
                    transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else hotel_lat
                    transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else hotel_lon
                    t_mins, _, _ = estimate_transit(hotel_lat, hotel_lon, transit_lat, transit_lon, default_mins=15)
                    sight_start = current_cursor + t_mins
                    sight_end = sight_start + min(90, attr_duration_mins)
                    add_stop(
                        stop_type="attraction",
                        name=cand_attr.get("name"),
                        category=cand_attr.get("category", "attraction"),
                        start_m=sight_start,
                        end_m=sight_end,
                        prev_lat=hotel_lat, prev_lon=hotel_lon,
                        curr_lat=raw_lat, curr_lon=raw_lon,
                        location_str=cand_attr.get("address", destination),
                        description=cand_attr.get("description"),
                        why_visit=cand_attr.get("why_visit"),
                        image_url=cand_attr.get("image_url"),
                        rating=cand_attr.get("rating"),
                        review_count=cand_attr.get("review_count"),
                        opening_hours=cand_attr.get("opening_hours"),
                        opening_hours_status=cand_attr.get("opening_hours_status", "UNVERIFIED"),
                        matched_interest=cand_attr.get("matched_interest", "General"),
                        priority_rank=cand_attr.get("priority_rank", 99),
                        match_type=cand_attr.get("match_type", "interest_match"),
                        source=cand_attr.get("source", "curated"),
                        fame_level=cand_attr.get("fame_level")
                    )
                    current_cursor = sight_end

            # Welcome Dinner (~19:30)
            dinner_start = max(1170, current_cursor + 30) # 19:30 PM
            dinner_end = dinner_start + dinner_duration_mins
            best_d = None
            for r in raw_restaurants:
                if r.get("name") not in used_restaurant_names:
                    best_d = r
                    break
            if best_d:
                raw_lat = best_d.get("lat")
                raw_lon = best_d.get("lon")
                transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else hotel_lat
                transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else hotel_lon
                add_stop(
                    stop_type="restaurant",
                    name=best_d.get("name", f"Evening Dining in {destination}"),
                    category="restaurant",
                    start_m=dinner_start,
                    end_m=dinner_end,
                    prev_lat=hotel_lat, prev_lon=hotel_lon,
                    curr_lat=raw_lat, curr_lon=raw_lon,
                    location_str=best_d.get("address", destination),
                    description=best_d.get("description") or f"Curated evening dinner celebrating your arrival in {destination}.",
                    why_visit=f"Regional dining and relaxed evening ambiance.",
                    image_url=best_d.get("image_url"),
                    rating=best_d.get("rating")
                )

            daily_routes.append({
                "day": day_num,
                "day_number": day_num,
                "date": date_iso,
                "formatted_date": date_display,
                "day_of_week": day_of_week,
                "title": day_title,
                "is_flight_day": True,
                "pace": pace,
                "stops": day_stops,
                "activities": day_stops,
                "travel_tips": f"Confirm the airport check-in window with your airline, especially for early departures. Keep digital boarding passes accessible.",
            })
            continue

        if has_flight_transit and 0 < day_idx < arrival_day_index:
            add_stop('flight', 'Outbound flight and connection', 'flight', 0, 1439,
                None, None, None, None, 'In transit', 'Continue your outbound flight and layovers.', 'Travel to your destination.', custom_transit=(0, 0.0, 'flight'))
            daily_routes.append({'day': day_num, 'day_number': day_num, 'date': date_iso,
                'formatted_date': date_display, 'day_of_week': day_of_week, 'title': f'Day {day_num}: Outbound journey',
                'is_flight_day': True, 'pace': pace, 'stops': day_stops, 'activities': day_stops})
            continue
        if has_flight_transit and day_idx == hotel_checkin_day and day_idx != arrival_day_index:
            checkin_start = hotel_checkin_absolute % 1440
            add_stop('hotel', hotel_name, 'hotel', checkin_start, checkin_start + 60,
                None, None, hotel_lat, hotel_lon, hotel_address,
                'Hotel check-in after your late arrival and transfer. Confirm early check-in with the property.',
                'Accommodation after arrival.', image_url=hotel_img, custom_transit=(hotel_transfer, 0.0, 'driving'))

        # -------------------------------------------------------------------------
        # CASE B: DEPARTURE DAY (Hotel Checkout -> Souvenir / Scenic -> Airport Buffer -> Return)
        # -------------------------------------------------------------------------
        if is_last_day and is_flight_day:
            day_title = f"Day {day_num}: Departure from {destination} & Journey Home"

            # 10:00 AM Hotel Checkout
            checkout_start = 600  # 10:00 AM
            checkout_end = 645    # 10:45 AM
            add_stop(
                stop_type="hotel",
                name=f"{hotel_name} - Check-out",
                category="hotel",
                start_m=checkout_start,
                end_m=checkout_end,
                prev_lat=None, prev_lon=None,
                curr_lat=hotel_lat, curr_lon=hotel_lon,
                location_str=hotel_address,
                description=f"Complete hotel check-out at {hotel_name}, settle room incidentals, and collect luggage.",
                why_visit="Accommodations check-out and luggage departure preparation.",
                image_url=hotel_img,
                custom_transit=(0, 0.0, "driving")
            )

            # Farewell Lunch (~12:30 PM)
            best_r = None
            for r in raw_restaurants:
                if r.get("name") not in used_restaurant_names:
                    best_r = r
                    break
            if best_r:
                raw_lat = best_r.get("lat")
                raw_lon = best_r.get("lon")
                transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else hotel_lat
                transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else hotel_lon
                add_stop(
                    stop_type="restaurant",
                    name=best_r.get("name", f"Farewell Dining in {destination}"),
                    category="restaurant",
                    start_m=750, # 12:30 PM
                    end_m=810,   # 01:30 PM
                    prev_lat=hotel_lat, prev_lon=hotel_lon,
                    curr_lat=raw_lat, curr_lon=raw_lon,
                    location_str=best_r.get("address", destination),
                    description=best_r.get("description") or f"A memorable farewell lunch concluding your stay in {destination}.",
                    why_visit=f"Final taste of authentic local cuisine.",
                    image_url=best_r.get("image_url"),
                    rating=best_r.get("rating")
                )

            # Return Flight timing (Buffer: 2.5 - 3 hours before departure)
            return_flight_dep_m = 1080  # 18:00 (6:00 PM)
            return_flight_arr_m = 1230  # 20:30 (8:30 PM)
            airport_buffer_start = max(870, return_flight_dep_m - 150) # 15:30 (2.5h prior)

            # Stop 2: Destination Airport Transfer & Departure
            add_stop(
                stop_type="airport",
                name=dest_airport["name"],
                category="airport",
                start_m=airport_buffer_start,
                end_m=return_flight_dep_m,
                prev_lat=hotel_lat, prev_lon=hotel_lon,
                curr_lat=dest_airport["lat"], curr_lon=dest_airport["lon"],
                location_str=dest_airport.get("address", destination),
                description=f"Transfer to {dest_airport['name']} for flight check-in, bag drop, security checks, and gate boarding.",
                why_visit=f"Departure international gateway for return journey to {origin}.",
                image_url=dest_airport.get("image_url"),
                custom_transit=(30, 0.0, "driving")
            )

            # Stop 3: Origin Airport Return Touchdown
            add_stop(
                stop_type="airport",
                name=orig_airport["name"],
                category="airport",
                start_m=return_flight_arr_m,
                end_m=return_flight_arr_m + 45,
                prev_lat=dest_airport["lat"], prev_lon=dest_airport["lon"],
                curr_lat=orig_airport["lat"], curr_lon=orig_airport["lon"],
                location_str=orig_airport.get("address", origin),
                description=f"Touchdown at {orig_airport['name']}. Retrieve baggage and conclude your expedition.",
                why_visit="Journey completion and home touchdown.",
                image_url=orig_airport.get("image_url"),
                custom_transit=(return_flight_arr_m - return_flight_dep_m, 0.0, "flight")
            )

            daily_routes.append({
                "day": day_num,
                "day_number": day_num,
                "date": date_iso,
                "formatted_date": date_display,
                "day_of_week": day_of_week,
                "title": day_title,
                "is_flight_day": True,
                "pace": pace,
                "stops": day_stops,
                "activities": day_stops,
                "travel_tips": f"Ensure hotel check-out is finalized before midday. Allow a 2.5-hour buffer at {dest_airport['name']} for international security screening.",
            })
            continue

        # -------------------------------------------------------------------------
        # CASE C: NORMAL EXPLORATION DAYS (Priority-Based, Time-Aware, Pace-Aligned)
        # -------------------------------------------------------------------------
        # Select target attractions for today respecting user priority ranking & geographic proximity
        day_attractions = []
        
        # Determine number of attractions for today based on pace
        daily_target = target_attractions_per_day
        if pace == "relaxed" and day_idx % 2 == 1:
            daily_target = 2  # Alternate 1 and 2 for relaxed

        for _ in range(daily_target):
            best_cand = None
            if not day_attractions:
                # First attraction of the day: pick highest priority candidate available
                for a in valid_attractions:
                    if a.get("name") not in used_attraction_names:
                        best_cand = a
                        break
            else:
                # Subsequent attraction of the day: pick candidate with highest priority AND closest proximity
                ref_lat = day_attractions[-1].get("lat")
                ref_lon = day_attractions[-1].get("lon")
                
                min_geo_score = float('inf')
                for a in valid_attractions:
                    if a.get("name") in used_attraction_names or any(chosen.get("name") == a.get("name") for chosen in day_attractions):
                        continue
                    a_lat = a.get("lat")
                    a_lon = a.get("lon")
                    # Proximity score (dist in km + penalty for lower priority rank)
                    dist = haversine(ref_lat, ref_lon, a_lat, a_lon) if (_valid_coords(ref_lat, ref_lon) and _valid_coords(a_lat, a_lon)) else 10.0
                    rank_penalty = a.get("priority_rank", 10) * 3.0
                    combined_score = dist + rank_penalty
                    if combined_score < min_geo_score:
                        min_geo_score = combined_score
                        best_cand = a

            if best_cand:
                day_attractions.append(best_cand)

        # Build day title reflecting primary matched interest
        primary_interest = day_attractions[0].get("matched_interest") if day_attractions else "Highlights"
        day_title = f"Day {day_num}: {destination} {primary_interest} Exploration"

        # Chronological Schedule Builder
        # Morning Breakfast & Preparation (~45 mins at accommodation)
        breakfast_start = wake_mins
        breakfast_end = wake_mins + 45
        add_stop(
            stop_type="breakfast",
            name=f"Breakfast & Morning Prep ({hotel_name})",
            category="breakfast",
            start_m=breakfast_start,
            end_m=breakfast_end,
            prev_lat=hotel_lat, prev_lon=hotel_lon,
            curr_lat=hotel_lat, curr_lon=hotel_lon,
            location_str=hotel_address,
            description=f"Morning breakfast and itinerary preparation at {hotel_name} before departure.",
            why_visit="Essential morning dining, energy, and daily exploration review.",
            image_url="https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=800&q=80",
            rating=4.5
        )
        current_cursor = breakfast_end
        prev_lat, prev_lon = hotel_lat, hotel_lon

        # Morning Attraction 1
        if len(day_attractions) > 0:
            a1 = day_attractions[0]
            raw_lat = a1.get("lat")
            raw_lon = a1.get("lon")
            transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else prev_lat
            transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else prev_lon
            t_mins, _, _ = estimate_transit(prev_lat, prev_lon, transit_lat, transit_lon, default_mins=20)
            
            start_m = current_cursor + t_mins
            end_m = start_m + attr_duration_mins
            add_stop(
                stop_type="attraction",
                name=a1.get("name"),
                category=a1.get("category", "attraction"),
                start_m=start_m,
                end_m=end_m,
                prev_lat=prev_lat, prev_lon=prev_lon,
                curr_lat=raw_lat, curr_lon=raw_lon,
                location_str=a1.get("address", destination),
                description=a1.get("description"),
                why_visit=a1.get("why_visit"),
                image_url=a1.get("image_url"),
                rating=a1.get("rating"),
                review_count=a1.get("review_count"),
                opening_hours=a1.get("opening_hours"),
                opening_hours_status=a1.get("opening_hours_status", "UNVERIFIED"),
                matched_interest=a1.get("matched_interest", "General"),
                priority_rank=a1.get("priority_rank", 99),
                match_type=a1.get("match_type", "interest_match"),
                source=a1.get("source", "curated"),
                fame_level=a1.get("fame_level")
            )
            current_cursor = end_m
            prev_lat, prev_lon = transit_lat, transit_lon

        # Lunch Break (~12:30 - 13:45)
        best_lunch = None
        min_lunch_dist = float('inf')
        for r in raw_restaurants:
            if r.get("name") in used_restaurant_names:
                continue
            r_lat = r.get("lat")
            r_lon = r.get("lon")
            dist = haversine(prev_lat, prev_lon, r_lat, r_lon) if (_valid_coords(prev_lat, prev_lon) and _valid_coords(r_lat, r_lon)) else 5.0
            if dist < min_lunch_dist:
                min_lunch_dist = dist
                best_lunch = r

        if not best_lunch and raw_restaurants:
            best_lunch = raw_restaurants[day_idx % len(raw_restaurants)]

        if best_lunch:
            raw_lat = best_lunch.get("lat")
            raw_lon = best_lunch.get("lon")
            transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else prev_lat
            transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else prev_lon
            t_mins, _, _ = estimate_transit(prev_lat, prev_lon, transit_lat, transit_lon, default_mins=15)
            
            # Ensure lunch window aligns naturally around 12:30 PM (750 mins)
            lunch_start = max(750, current_cursor + t_mins)
            lunch_end = lunch_start + lunch_duration_mins
            add_stop(
                stop_type="restaurant",
                name=best_lunch.get("name", f"Bistro in {destination}"),
                category="restaurant",
                start_m=lunch_start,
                end_m=lunch_end,
                prev_lat=prev_lat, prev_lon=prev_lon,
                curr_lat=raw_lat, curr_lon=raw_lon,
                location_str=best_lunch.get("address", destination),
                description=best_lunch.get("description") or f"Authentic regional dining experience in {destination}.",
                why_visit="Curated mid-day culinary refuel.",
                image_url=best_lunch.get("image_url"),
                rating=best_lunch.get("rating")
            )
            current_cursor = lunch_end
            prev_lat, prev_lon = transit_lat, transit_lon

        # Afternoon Attraction 2
        if len(day_attractions) > 1:
            a2 = day_attractions[1]
            raw_lat = a2.get("lat")
            raw_lon = a2.get("lon")
            transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else prev_lat
            transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else prev_lon
            t_mins, _, _ = estimate_transit(prev_lat, prev_lon, transit_lat, transit_lon, default_mins=20)
            
            start_m = current_cursor + t_mins
            end_m = start_m + attr_duration_mins
            add_stop(
                stop_type="attraction",
                name=a2.get("name"),
                category=a2.get("category", "attraction"),
                start_m=start_m,
                end_m=end_m,
                prev_lat=prev_lat, prev_lon=prev_lon,
                curr_lat=raw_lat, curr_lon=raw_lon,
                location_str=a2.get("address", destination),
                description=a2.get("description"),
                why_visit=a2.get("why_visit"),
                image_url=a2.get("image_url"),
                rating=a2.get("rating"),
                review_count=a2.get("review_count"),
                opening_hours=a2.get("opening_hours"),
                opening_hours_status=a2.get("opening_hours_status", "UNVERIFIED"),
                matched_interest=a2.get("matched_interest", "General"),
                priority_rank=a2.get("priority_rank", 99),
                match_type=a2.get("match_type", "interest_match"),
                source=a2.get("source", "curated"),
                fame_level=a2.get("fame_level")
            )
            current_cursor = end_m
            prev_lat, prev_lon = transit_lat, transit_lon

        # Late Afternoon Attraction 3 (Packed pace only)
        if len(day_attractions) > 2 and pace == "packed":
            a3 = day_attractions[2]
            raw_lat = a3.get("lat")
            raw_lon = a3.get("lon")
            transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else prev_lat
            transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else prev_lon
            t_mins, _, _ = estimate_transit(prev_lat, prev_lon, transit_lat, transit_lon, default_mins=20)
            
            start_m = current_cursor + t_mins
            end_m = start_m + min(75, attr_duration_mins)
            add_stop(
                stop_type="attraction",
                name=a3.get("name"),
                category=a3.get("category", "attraction"),
                start_m=start_m,
                end_m=end_m,
                prev_lat=prev_lat, prev_lon=prev_lon,
                curr_lat=raw_lat, curr_lon=raw_lon,
                location_str=a3.get("address", destination),
                description=a3.get("description"),
                why_visit=a3.get("why_visit"),
                image_url=a3.get("image_url"),
                rating=a3.get("rating"),
                review_count=a3.get("review_count"),
                opening_hours=a3.get("opening_hours"),
                opening_hours_status=a3.get("opening_hours_status", "UNVERIFIED"),
                matched_interest=a3.get("matched_interest", "General"),
                priority_rank=a3.get("priority_rank", 99),
                match_type=a3.get("match_type", "interest_match"),
                source=a3.get("source", "curated"),
                fame_level=a3.get("fame_level")
            )
            current_cursor = end_m
            prev_lat, prev_lon = transit_lat, transit_lon

        # Evening Dinner (~19:30 - 20:45)
        best_dinner = None
        min_din_dist = float('inf')
        for r in raw_restaurants:
            if r.get("name") in used_restaurant_names:
                continue
            r_lat = r.get("lat")
            r_lon = r.get("lon")
            dist = haversine(prev_lat, prev_lon, r_lat, r_lon) if (_valid_coords(prev_lat, prev_lon) and _valid_coords(r_lat, r_lon)) else 5.0
            if dist < min_din_dist:
                min_din_dist = dist
                best_dinner = r

        if not best_dinner and raw_restaurants:
            best_dinner = raw_restaurants[(day_idx + 1) % len(raw_restaurants)]

        if best_dinner:
            raw_lat = best_dinner.get("lat")
            raw_lon = best_dinner.get("lon")
            transit_lat = raw_lat if _valid_coords(raw_lat, raw_lon) else prev_lat
            transit_lon = raw_lon if _valid_coords(raw_lat, raw_lon) else prev_lon
            t_mins, _, _ = estimate_transit(prev_lat, prev_lon, transit_lat, transit_lon, default_mins=20)
            
            # Evening dinner window around 19:30 PM (1170 mins)
            dinner_start = max(1170, current_cursor + t_mins)
            dinner_end = dinner_start + dinner_duration_mins
            add_stop(
                stop_type="restaurant",
                name=best_dinner.get("name", f"Evening Dining in {destination}"),
                category="restaurant",
                start_m=dinner_start,
                end_m=dinner_end,
                prev_lat=prev_lat, prev_lon=prev_lon,
                curr_lat=raw_lat, curr_lon=raw_lon,
                location_str=best_dinner.get("address", destination),
                description=best_dinner.get("description") or f"Curated evening dinner celebrating local culinary traditions in {destination}.",
                why_visit="Evening fine dining and relaxing ambiance.",
                image_url=best_dinner.get("image_url"),
                rating=best_dinner.get("rating")
            )

        daily_routes.append({
            "day": day_num,
            "day_number": day_num,
            "date": date_iso,
            "formatted_date": date_display,
            "day_of_week": day_of_week,
            "title": day_title,
            "is_flight_day": False,
            "pace": pace,
            "stops": day_stops,
            "activities": day_stops,
            "travel_tips": f"Wear comfortable footwear for walking. Recommended bedtime at your hotel: {minutes_to_ampm(bed_mins)}.",
        })

    print(f"--- ROUTE AGENT: Successfully built {len(daily_routes)} priority-based calendar days for {destination} ---")

    return {
        "days": days,
        "start_date": start_date_obj.isoformat(),
        "end_date": end_date_obj.isoformat(),
        "flights": normalized_flights,
        "route_details": {
            "day_by_day_route": daily_routes,
            "schedule_notes": schedule_notes,
        },
        "completed_steps": state.get("completed_steps", []) + ["route"]
    }
