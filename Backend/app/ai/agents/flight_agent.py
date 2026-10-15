import os
import json
import httpx
import re
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Dict, Any, List, Optional, Tuple
from dotenv import load_dotenv
load_dotenv()

from app.ai.orchestrator.state import TravelState

SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY")

# Explicit product default timezone (strictly decoupled from OS timezone)
PRODUCT_TIMEZONE = ZoneInfo("Asia/Kolkata")

# Comprehensive mapping of domestic and global destinations to IATA airport codes
AIRPORT_CODES = {
    # India Domestic
    "hyderabad": "HYD",
    "hyd": "HYD",
    "secunderabad": "HYD",
    "delhi": "DEL",
    "new delhi": "DEL",
    "ncr": "DEL",
    "mumbai": "BOM",
    "bombay": "BOM",
    "bengaluru": "BLR",
    "bangalore": "BLR",
    "chennai": "MAA",
    "madras": "MAA",
    "kolkata": "CCU",
    "calcutta": "CCU",
    "goa": "GOI",
    "dabolim": "GOI",
    "mopa": "GOX",
    "north goa": "GOX",
    "south goa": "GOI",
    "kerala": "COK",
    "kochi": "COK",
    "cochin": "COK",
    "trivandrum": "TRV",
    "thiruvananthapuram": "TRV",
    "calicut": "CCJ",
    "kozhikode": "CCJ",
    "kannur": "CNN",
    "jaipur": "JAI",
    "rajasthan": "JAI",
    "udaipur": "UDR",
    "jodhpur": "JDH",
    "pune": "PNQ",
    "ahmedabad": "AMD",
    "surat": "STV",
    "vadodara": "BDQ",
    "indore": "IDR",
    "bhopal": "BHO",
    "nagpur": "NAG",
    "varanasi": "VNS",
    "banaras": "VNS",
    "agra": "AGR",
    "lucknow": "LKO",
    "chandigarh": "IXC",
    "amritsar": "ATQ",
    "srinagar": "SXR",
    "kashmir": "SXR",
    "leh": "IXL",
    "ladakh": "IXL",
    "shimla": "SLV",
    "manali": "KUU",
    "kullu": "KUU",
    "dehradun": "DED",
    "darjeeling": "IXB",
    "bagdogra": "IXB",
    "guwahati": "GAU",
    "patna": "PAT",
    "bhubaneswar": "BBI",
    "ranchi": "IXR",
    "visakhapatnam": "VTZ",
    "vizag": "VTZ",
    "vijayawada": "VGA",
    "tirupati": "TIR",
    "coimbatore": "CJB",
    "madurai": "IXM",
    "trichy": "TRZ",
    "mangaluru": "IXE",
    "mangalore": "IXE",

    # Asia & Pacific (Verified IATA codes for Google Flights)
    "tokyo": "NRT",  # Google Flights requires NRT/HND; TYO is unsupported metropolitan group
    "narita": "NRT",
    "haneda": "HND",
    "japan": "NRT",
    "osaka": "KIX",
    "kyoto": "KIX",
    "sapporo": "CTS",
    "fukuoka": "FUK",
    "sydney": "SYD",
    "melbourne": "MEL",
    "brisbane": "BNE",
    "perth": "PER",
    "adelaide": "ADL",
    "auckland": "AKL",
    "singapore": "SIN",
    "changi": "SIN",
    "bangkok": "BKK",
    "suvarnabhumi": "BKK",
    "phuket": "HKT",
    "bali": "DPS",
    "denpasar": "DPS",
    "jakarta": "CGK",
    "kuala lumpur": "KUL",
    "penang": "PEN",
    "hong kong": "HKG",
    "seoul": "ICN",
    "incheon": "ICN",
    "taipei": "TPE",
    "manila": "MNL",
    "colombo": "CMB",
    "male": "MLE",
    "maldives": "MLE",
    "kathmandu": "KTM",
    "ho chi minh": "SGN",
    "hanoi": "HAN",
    "da nang": "DAD",

    # Middle East
    "dubai": "DXB",
    "abu dhabi": "AUH",
    "sharjah": "SHJ",
    "doha": "DOH",
    "muscat": "MCT",
    "bahrain": "BAH",
    "kuwait": "KWI",
    "riyadh": "RUH",
    "jeddah": "JED",

    # Europe
    "london": "LHR",
    "heathrow": "LHR",
    "gatwick": "LGW",
    "paris": "CDG",
    "charles de gaulle": "CDG",
    "orly": "ORY",
    "france": "CDG",
    "rome": "FCO",
    "fiumicino": "FCO",
    "milan": "MXP",
    "frankfurt": "FRA",
    "munich": "MUC",
    "berlin": "BER",
    "amsterdam": "AMS",
    "schiphol": "AMS",
    "zurich": "ZRH",
    "geneva": "GVA",
    "madrid": "MAD",
    "barcelona": "BCN",
    "vienna": "VIE",
    "brussels": "BRU",
    "dublin": "DUB",
    "copenhagen": "CPH",
    "stockholm": "ARN",
    "oslo": "OSL",
    "helsinki": "HEL",
    "athens": "ATH",
    "istanbul": "IST",
    "prague": "PRG",
    "budapest": "BUD",

    # Americas
    "new york": "JFK",
    "jfk": "JFK",
    "newark": "EWR",
    "san francisco": "SFO",
    "los angeles": "LAX",
    "chicago": "ORD",
    "boston": "BOS",
    "washington": "IAD",
    "seattle": "SEA",
    "miami": "MIA",
    "orlando": "MCO",
    "toronto": "YYZ",
    "vancouver": "YVR",
    "montreal": "YUL",
    "cancun": "CUN",
    "mexico city": "MEX",

    # Africa
    "cairo": "CAI",
    "johannesburg": "JNB",
    "cape town": "CPT",
    "nairobi": "NBO",
    "mauritius": "MRU",
    "seychelles": "SEZ"
}

# In-memory bounded cache with 1-hour TTL
_FLIGHT_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 3600.0


def get_airport_code(location_name: str, is_origin: bool = False) -> str:
    """
    Resolves genuine IATA airport code for any location string.
    Checks regex patterns, known airports, and airport registries.
    Never defaults blindly to BOM or GOI when real codes exist.
    """
    if not location_name:
        return "HYD" if is_origin else "DEL"

    raw = str(location_name).strip()
    if "->" in raw:
        parts = raw.split("->")
        raw = parts[0].strip() if is_origin else parts[1].strip()

    # 1. Check if raw contains 3-letter uppercase IATA code e.g. "(SYD)" or "HYD"
    iata_match = re.search(r'\b([A-Z]{3})\b', raw)
    if iata_match and iata_match.group(1) != "AND" and iata_match.group(1) != "FOR":
        code = iata_match.group(1)
        # Avoid common words matching 3 letters
        if code not in {"THE", "NEW", "DAY", "TOP", "HOT", "CAR", "AIR", "OUT"}:
            return code

    lower_raw = raw.lower().strip()

    # 2. Direct match in dictionary
    if lower_raw in AIRPORT_CODES:
        return AIRPORT_CODES[lower_raw]

    # 3. Match first city part before comma, hyphen, or parentheses
    city_part = re.split(r'[,–\-\(/]', lower_raw)[0].strip()
    if city_part in AIRPORT_CODES:
        return AIRPORT_CODES[city_part]

    # 4. Check substring match prioritizing longer/most specific keys first
    sorted_keys = sorted(AIRPORT_CODES.keys(), key=len, reverse=True)
    for key in sorted_keys:
        if key in lower_raw or key in city_part:
            return AIRPORT_CODES[key]

    # 5. Check route_agent AIRPORT_REGISTRY if available
    try:
        from app.ai.agents.route_agent import AIRPORT_REGISTRY
        for key, info in AIRPORT_REGISTRY.items():
            if key in lower_raw or lower_raw in key:
                if info.get("iata"):
                    return info["iata"]
    except Exception:
        pass

    # Default fallback: HYD for origin, DEL for domestic destination
    return "HYD" if is_origin else "DEL"


def get_current_product_date(tz: ZoneInfo = PRODUCT_TIMEZONE, reference_dt: Optional[datetime] = None) -> datetime.date:
    """
    Returns the authoritative current calendar date in the product timezone (Asia/Kolkata).
    Decoupled from the host operating system's configured timezone.
    """
    if reference_dt is not None:
        if reference_dt.tzinfo is None:
            # If naive, treat as UTC and convert to product timezone
            dt = reference_dt.replace(tzinfo=timezone.utc).astimezone(tz)
        else:
            dt = reference_dt.astimezone(tz)
    else:
        dt = datetime.now(tz)
    return dt.date()


def parse_and_validate_flight_date(
    raw_date: Any = None,
    tz: ZoneInfo = PRODUCT_TIMEZONE,
    reference_dt: Optional[datetime] = None
) -> Tuple[Optional[str], bool, bool, str]:
    """
    Parses and validates flight departure date against current product date in Asia/Kolkata timezone.
    Returns: (iso_date, is_past_date, is_estimated, formatted_display_date)

    Policy:
    - Authoritative timezone: ZoneInfo("Asia/Kolkata").
    - Explicit valid date: preserved exactly (is_estimated=False).
    - Past date: identified as is_past_date=True (is_estimated=False).
    - Missing or unparseable date: current product date (Asia/Kolkata) + 7 calendar days (is_estimated=True).
    """
    today = get_current_product_date(tz=tz, reference_dt=reference_dt)
    parsed_date = None

    if raw_date:
        # Check if already a datetime/date object
        if hasattr(raw_date, "year") and hasattr(raw_date, "month") and hasattr(raw_date, "day"):
            parsed_date = raw_date if not hasattr(raw_date, "date") else raw_date.date()

        # 1. ISO format: YYYY-MM-DD
        if not parsed_date:
            m_iso = re.search(r'(\d{4})-(\d{2})-(\d{2})', str(raw_date))
            if m_iso:
                try:
                    parsed_date = datetime(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3))).date()
                except ValueError:
                    pass

        # 2. Format: "25 Oct 2026" or "25-Oct-2026"
        if not parsed_date:
            months = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
            m = re.search(r'(\d{1,2})[\s\-]+([a-zA-Z]{3,9})[\s\-]+(\d{4})', str(raw_date))
            if m:
                try:
                    day = int(m.group(1))
                    month_str = m.group(2)[:3].lower()
                    year = int(m.group(3))
                    if month_str in months:
                        parsed_date = datetime(year, months[month_str], day).date()
                except ValueError:
                    pass

        # 3. Format: "October 25, 2026"
        if not parsed_date:
            m = re.search(r'([a-zA-Z]{3,9})[\s\-]+(\d{1,2})(?:,\s*|\s+)(\d{4})', str(raw_date))
            if m:
                try:
                    month_str = m.group(1)[:3].lower()
                    day = int(m.group(2))
                    year = int(m.group(3))
                    months = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
                    if month_str in months:
                        parsed_date = datetime(year, months[month_str], day).date()
                except ValueError:
                    pass

        # 4. Fallback parser using dateutil if available
        if not parsed_date:
            try:
                from dateutil import parser as dt_parser
                parsed_date = dt_parser.parse(str(raw_date), fuzzy=True).date()
            except Exception:
                pass

    if parsed_date:
        iso_str = parsed_date.strftime("%Y-%m-%d")
        display_str = parsed_date.strftime("%d %b %Y")
        is_past = parsed_date < today
        return (iso_str, is_past, False, display_str)

    # Missing or unparseable date: Consistent rule: current product date (Asia/Kolkata) + 7 calendar days
    future_date = today + timedelta(days=7)
    iso_str = future_date.strftime("%Y-%m-%d")
    display_str = future_date.strftime("%d %b %Y")
    return (iso_str, False, True, display_str)


def fetch_real_flights_serpapi(
    destination: str,
    origin: str = "Hyderabad",
    currency: str = "INR",
    budget: float = None,
    start_date: str = None,
    end_date: str = None,
    travelers_count: int = 1
) -> Dict[str, Any]:
    """
    Fetch genuine real-time flight options using SerpApi Google Flights engine.
    - Validates trip dates against current date.
    - Rejects past dates without attempting invalid provider calls.
    - Preserves all real provider fields (booking token, layovers, duration, deep link).
    - Returns structured metadata and genuine results, never inventing mock flights.
    """
    api_key = os.getenv("SERPAPI_API_KEY")
    arrival_code = get_airport_code(destination, is_origin=False)
    departure_code = get_airport_code(origin, is_origin=True)

    iso_outbound, is_past, is_estimated, display_date = parse_and_validate_flight_date(start_date)

    # Date Validation: Do not query Google Flights for dates in the past
    if is_past:
        print(f"--- FLIGHT AGENT: Requested departure date ({iso_outbound}) is in the past. Returning historical record status. ---")
        return {
            "flights": [],
            "metadata": {
                "source": "serpapi_google_flights",
                "data_status": "historical_record",
                "is_past_date": True,
                "is_estimated_date": False,
                "departure_date": iso_outbound,
                "departure_date_display": display_date,
                "timezone": "Asia/Kolkata",
                "origin": departure_code,
                "destination": arrival_code,
                "message": f"This itinerary departure date ({display_date}) is in the past. Fares and schedules are historical records and cannot be currently booked."
            }
        }

    # Same airport check
    if departure_code == arrival_code:
        print(f"--- FLIGHT AGENT: Origin and destination resolve to the same airport ({departure_code}). Flight transit is not applicable. ---")
        return {
            "flights": [],
            "metadata": {
                "source": "serpapi_google_flights",
                "data_status": "no_flights_found",
                "is_past_date": False,
                "is_estimated_date": is_estimated,
                "departure_date": iso_outbound,
                "departure_date_display": display_date,
                "timezone": "Asia/Kolkata",
                "origin": departure_code,
                "destination": arrival_code,
                "message": f"Origin and destination are in the same location ({departure_code}). Flight transit is not applicable."
            }
        }
    cache_key = f"{departure_code}_{arrival_code}_{iso_outbound}_{currency}_{travelers_count}"
    now_ts = time.time()
    if cache_key in _FLIGHT_CACHE:
        entry = _FLIGHT_CACHE[cache_key]
        if (now_ts - entry["timestamp"]) < CACHE_TTL_SECONDS:
            print(f"--- FLIGHT AGENT: Cache hit for {departure_code} -> {arrival_code} ({iso_outbound}) ---")
            cached_data = dict(entry["data"])
            cached_data["metadata"] = dict(entry["metadata"])
            cached_data["metadata"]["cached"] = True
            cached_data["metadata"]["last_checked_at"] = datetime.now(timezone.utc).isoformat()
            return cached_data

    if not api_key:
        print("--- FLIGHT AGENT: No SERPAPI_API_KEY configured. Returning provider unconfigured status. ---")
        return {
            "flights": [],
            "metadata": {
                "source": "serpapi_google_flights",
                "data_status": "error",
                "is_past_date": False,
                "departure_date": iso_outbound,
                "departure_date_display": display_date,
                "origin": departure_code,
                "destination": arrival_code,
                "message": "SerpApi API key not configured on backend. Flight search unavailable."
            }
        }

    print(f"--- FLIGHT AGENT: Querying SerpApi Google Flights ({departure_code} -> {arrival_code}, date={iso_outbound}) ---")

    params = {
        "engine": "google_flights",
        "departure_id": departure_code,
        "arrival_id": arrival_code,
        "outbound_date": iso_outbound,
        "currency": currency,
        "hl": "en",
        "gl": "in" if currency == "INR" else "us",
        "type": "2",  # One-way search
        "api_key": api_key
    }

    fetched_at = datetime.now(timezone.utc).isoformat()

    try:
        response = httpx.get("https://serpapi.com/search.json", params=params, timeout=15.0)
        
        if response.status_code == 400:
            error_json = response.json()
            error_msg = error_json.get("error", "Bad request from Google Flights")
            print(f"--- FLIGHT AGENT: SerpApi 400 Client Error: {error_msg} ---")
            return {
                "flights": [],
                "metadata": {
                    "source": "serpapi_google_flights",
                    "data_status": "error",
                    "is_past_date": is_past,
                    "departure_date": iso_outbound,
                    "departure_date_display": display_date,
                    "origin": departure_code,
                    "destination": arrival_code,
                    "message": f"Provider search error: {error_msg}"
                }
            }

        response.raise_for_status()
        data = response.json()

        google_flights_url = data.get("search_metadata", {}).get("google_flights_url") or (
            f"https://www.google.com/travel/flights?q=Flights%20to%20{arrival_code}%20from%20{departure_code}%20on%20{iso_outbound}"
        )

        best_flights = data.get("best_flights", [])
        other_flights = data.get("other_flights", [])
        candidate_groups = best_flights if best_flights else other_flights

        if not candidate_groups:
            print(f"--- FLIGHT AGENT: No flights returned from Google Flights for {departure_code} -> {arrival_code}. ---")
            empty_result = {
                "flights": [],
                "metadata": {
                    "source": "serpapi_google_flights",
                    "data_status": "no_flights_found",
                    "is_past_date": False,
                    "is_estimated_date": is_estimated,
                    "departure_date": iso_outbound,
                    "departure_date_display": display_date,
                    "origin": departure_code,
                    "destination": arrival_code,
                    "google_flights_url": google_flights_url,
                    "message": f"No commercial scheduled flights found for {departure_code} -> {arrival_code} on {display_date}."
                }
            }
            _FLIGHT_CACHE[cache_key] = {"timestamp": now_ts, "data": empty_result, "metadata": empty_result["metadata"]}
            return empty_result

        formatted_flights = []
        for idx, flight_group in enumerate(candidate_groups[:5]):
            flight_segments = flight_group.get("flights", [])
            if not flight_segments:
                continue

            first_segment = flight_segments[0]
            last_segment = flight_segments[-1]

            raw_price = flight_group.get("price")
            if raw_price is None:
                continue

            airline_name = first_segment.get("airline") or "Airline"
            flight_no = first_segment.get("flight_number") or f"FL-{idx + 1}"
            airline_code = flight_no.split()[0] if " " in flight_no else flight_no[:2]
            airline_logo = flight_group.get("airline_logo") or first_segment.get("airline_logo")

            # Format departure and arrival times cleanly
            dep_raw = first_segment.get("departure_airport", {}).get("time", "")
            arr_raw = last_segment.get("arrival_airport", {}).get("time", "")

            from app.services.flight_timing import provider_timestamp
            dep_date, dep_time = provider_timestamp(dep_raw)
            arr_date, arr_time = provider_timestamp(arr_raw)

            total_duration_mins = flight_group.get("total_duration") or 0
            hours = total_duration_mins // 60
            mins = total_duration_mins % 60
            duration_str = f"{hours}h {mins}m" if total_duration_mins > 0 else "Direct"

            # Parse stops and layovers
            raw_layovers = flight_group.get("layovers", [])
            formatted_layovers = []
            for layover in raw_layovers:
                l_dur = layover.get("duration", 0)
                l_hours = l_dur // 60
                l_mins = l_dur % 60
                l_str = f"{l_hours}h {l_mins}m" if l_dur > 0 else "Short layover"
                formatted_layovers.append({
                    "name": layover.get("name", "Connection"),
                    "id": layover.get("id", ""),
                    "duration": l_str
                })

            stops_count = len(flight_segments) - 1

            # Aircraft and travel class
            airplanes = [seg.get("airplane") for seg in flight_segments if seg.get("airplane")]
            aircraft_str = " • ".join(airplanes) if airplanes else first_segment.get("airplane", "Commercial Jet")
            travel_class = first_segment.get("travel_class") or "Economy"

            # Amenities & extensions (e.g. Free Wi-Fi, in-seat power, carbon emissions)
            extensions = []
            for seg in flight_segments:
                for ext in seg.get("extensions", []):
                    if ext and ext not in extensions:
                        extensions.append(ext)

            formatted_flights.append({
                "id": f"fl_{departure_code}_{arrival_code}_{idx + 1}",
                "airline": airline_name,
                "airline_name": airline_name,
                "airline_code": airline_code,
                "airline_logo": airline_logo,
                "flight_no": flight_no,
                "flight_number": flight_no,
                "departure_airport": departure_code,
                "departure_airport_name": first_segment.get("departure_airport", {}).get("name", departure_code),
                "departure_time": dep_time,
                "departure_date": dep_date or iso_outbound,
                "departure_date_display": display_date,
                "arrival_airport": arrival_code,
                "arrival_airport_name": last_segment.get("arrival_airport", {}).get("name", arrival_code),
                "arrival_time": arr_time,
                "arrival_date": arr_date,
                "departure_datetime": dep_raw,
                "arrival_datetime": arr_raw,
                "duration": duration_str,
                "duration_minutes": total_duration_mins,
                "price": float(raw_price),
                "price_per_person": float(raw_price),
                "currency": currency,
                "travelers": travelers_count,
                "total_price": float(raw_price) * travelers_count,
                "stops": stops_count,
                "layovers": formatted_layovers,
                "aircraft": aircraft_str,
                "travel_class": travel_class,
                "extensions": extensions,
                "google_flights_url": google_flights_url,
                "booking_token": flight_group.get("booking_token"),
                "source": "serpapi_google_flights",
                "fetched_at": fetched_at,
                "last_checked_at": fetched_at,
                "data_status": "search_results",
                "is_past_date": False,
                "is_estimated_date": is_estimated
            })

        metadata = {
            "source": "serpapi_google_flights",
            "data_status": "search_results",
            "fetched_at": fetched_at,
            "last_checked_at": fetched_at,
            "departure_date": iso_outbound,
            "departure_date_display": display_date,
            "is_past_date": False,
            "is_estimated_date": is_estimated,
            "timezone": "Asia/Kolkata",
            "origin": departure_code,
            "destination": arrival_code,
            "google_flights_url": google_flights_url,
            "total_options": len(formatted_flights)
        }

        result = {
            "flights": formatted_flights,
            "metadata": metadata
        }

        # Save to memory cache
        _FLIGHT_CACHE[cache_key] = {"timestamp": now_ts, "data": result, "metadata": metadata}
        print(f"--- FLIGHT AGENT: Successfully retrieved {len(formatted_flights)} genuine flights from Google Flights! ---")
        return result

    except Exception as e:
        print(f"--- FLIGHT AGENT: SerpApi request error: {e} ---")
        return {
            "flights": [],
            "metadata": {
                "source": "serpapi_google_flights",
                "data_status": "error",
                "is_past_date": is_past,
                "departure_date": iso_outbound,
                "departure_date_display": display_date,
                "origin": departure_code,
                "destination": arrival_code,
                "error": str(e),
                "message": "Flight search provider is temporarily unavailable. Live fares could not be loaded."
            }
        }


def flight_node(state: TravelState) -> dict:
    destination = state.get("destination") or "Delhi"
    origin = state.get("origin") or "Hyderabad"
    currency = state.get("currency") or "INR"
    start_date = state.get("start_date")
    end_date = state.get("end_date")
    travelers_count = int(state.get("travelers") or 1)

    dest_code = get_airport_code(destination, is_origin=False)
    origin_code = get_airport_code(origin, is_origin=True)

    print(f"--- FLIGHT AGENT: Finding genuine flights from {origin} ({origin_code}) to {destination} ({dest_code}) ---")

    # Query genuine SerpApi Google Flights
    result = fetch_real_flights_serpapi(
        destination=destination,
        origin=origin,
        currency=currency,
        budget=state.get("budget"),
        start_date=start_date,
        end_date=end_date,
        travelers_count=travelers_count
    )

    flights = result.get("flights", [])
    metadata = result.get("metadata", {})

    return {
        "flights": flights,
        "flight_metadata": metadata,
        "completed_steps": state.get("completed_steps", []) + ["flights"]
    }
