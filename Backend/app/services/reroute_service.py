import os
import re
import time
from datetime import datetime, timedelta, date
from typing import Dict, Any, List, Optional, Tuple
from zoneinfo import ZoneInfo

from app.utils.activity_identity import generate_persistent_activity_id, resolve_activity_status
from app.ai.agents.attraction_agent import (
    verify_and_enrich_place,
    discover_via_serpapi,
    discover_via_overpass,
    resolve_destination_coordinates,
)
from app.ai.agents.restaurant_agent import (
    discover_restaurants_serpapi,
    AUTHENTIC_DESTINATION_RESTAURANTS,
    get_authentic_fallback_restaurants,
)
from app.ai.agents.opening_hours_agent import determine_status_from_hours
from app.ai.agents.route_agent import (
    estimate_transit,
    minutes_to_hhmm,
    minutes_to_ampm,
    format_time_range,
    format_duration,
    parse_hhmm_to_minutes,
    haversine,
    _valid_coords,
    resolve_destination_timezone,
)


def classify_activity(stop: Dict[str, Any]) -> Dict[str, Any]:
    """
    Classifies an activity to preserve its purpose and category during rerouting.
    Returns:
        {
            "main_type": "meal" | "attraction" | "hotel" | "transit",
            "sub_type": "breakfast" | "lunch" | "dinner" | "temple" | "historic" | "beach" | "nature" | "shopping" | "general" | ...,
            "is_meal": bool
        }
    """
    stype = (stop.get("type") or "").lower().strip()
    cat = (stop.get("category") or "").lower().strip()
    title = (stop.get("title") or stop.get("name") or "").lower().strip()
    desc = (stop.get("description") or "").lower().strip()
    combined = f"{stype} {cat} {title} {desc}"

    start_m = parse_hhmm_to_minutes(stop.get("start_time"), 720)

    # 1. Meal Identification
    is_meal = (
        stype in ["restaurant", "dining", "breakfast", "cafe", "food", "bistro"]
        or cat in ["restaurant", "dining", "breakfast", "cafe", "food", "bistro"]
        or any(k in combined for k in [
            "breakfast", "lunch", "dinner", "dining", "bistro", "buffet",
            "cafe", "restaurant", "biryani", "cuisine", "tandoori", "thali", "eatery"
        ])
    )

    if is_meal:
        if "breakfast" in combined or start_m < 630:  # Before 10:30 AM
            meal_type = "breakfast"
        elif "dinner" in combined or start_m >= 1020:  # 17:00 PM or later
            meal_type = "dinner"
        else:
            meal_type = "lunch"
        return {
            "main_type": "meal",
            "sub_type": meal_type,
            "is_meal": True
        }

    # 2. Hotel / Stay
    if stype in ["hotel", "accommodation"] or any(k in combined for k in ["hotel", "check-in", "check-out", "resort", "accommodation"]):
        return {
            "main_type": "hotel",
            "sub_type": "hotel",
            "is_meal": False
        }

    # 3. Airport Transit
    if stype in ["airport", "transit"] or any(k in combined for k in ["airport", "terminal", "flight"]):
        return {
            "main_type": "transit",
            "sub_type": "airport",
            "is_meal": False
        }

    # 4. Attraction Sub-Categories
    sub = "general"
    if any(k in combined for k in ["temple", "mandir", "church", "mosque", "cathedral", "shrine", "spiritual", "worship", "gurudwara"]):
        sub = "temple"
    elif any(k in combined for k in ["museum", "fort", "palace", "monument", "historic", "heritage", "ruins", "tomb", "castle"]):
        sub = "historic"
    elif any(k in combined for k in ["beach", "sea", "cove", "coast", "shore"]):
        sub = "beach"
    elif any(k in combined for k in ["park", "garden", "nature", "lake", "waterfall", "wildlife", "sanctuary", "valley"]):
        sub = "nature"
    elif any(k in combined for k in ["market", "bazaar", "shopping", "mall", "souvenir"]):
        sub = "shopping"

    return {
        "main_type": "attraction",
        "sub_type": sub,
        "is_meal": False
    }


def generate_reroute_proposal(
    trip: Dict[str, Any],
    day_number: int,
    skipped_activity_id: str,
    current_location: Optional[Dict[str, float]] = None,
    current_time_str: Optional[str] = None
) -> Dict[str, Any]:
    """
    Builds a realistic, meal-aware, chronological schedule proposal for the remaining
    portion of day_number after an activity is skipped.
    """
    destination = trip.get("destination", "Destination")
    pace = (trip.get("pace") or "balanced").lower()
    interests = trip.get("interests") or []
    dest_tz_name = trip.get("destination_timezone") or resolve_destination_timezone(destination)
    dest_tz = ZoneInfo(dest_tz_name)
    now_in_dest = datetime.now(dest_tz)

    route_details = trip.get("route_details") or {}
    daily_routes = route_details.get("day_by_day_route") or []
    if not daily_routes:
        raise ValueError("Trip has no day_by_day_route itinerary to reroute")

    # Locate the target day
    target_day = None
    target_day_idx = -1
    for idx, d in enumerate(daily_routes):
        d_num = d.get("day") or d.get("day_number") or (idx + 1)
        if int(d_num) == int(day_number):
            target_day = d
            target_day_idx = idx
            break

    if not target_day:
        raise ValueError(f"Day {day_number} not found in trip itinerary")

    raw_stops = target_day.get("stops") or target_day.get("activities") or []
    if not raw_stops:
        raise ValueError(f"Day {day_number} has no scheduled stops")

    # Locate the skipped stop
    skipped_idx = -1
    skipped_stop = None
    for idx, s in enumerate(raw_stops):
        s_id = s.get("id")
        canonical_id = generate_persistent_activity_id(
            s.get("type") or s.get("category"),
            s.get("title") or s.get("name"),
            s.get("place_id")
        )
        if s_id == skipped_activity_id or canonical_id == skipped_activity_id:
            skipped_idx = idx
            skipped_stop = s
            break

    if not skipped_stop:
        raise ValueError(f"Skipped activity '{skipped_activity_id}' not found on day {day_number}")

    # Partition stops:
    # 1. Historical stops strictly before skipped_idx are frozen untouched
    historical_stops = [dict(s) for idx, s in enumerate(raw_stops) if idx < skipped_idx]
    # 2. Subsequent stops occurring after the skipped stop
    subsequent_stops = [dict(s) for idx, s in enumerate(raw_stops) if idx > skipped_idx]

    prev_stop = historical_stops[-1] if historical_stops else None
    prev_end_m = parse_hhmm_to_minutes(prev_stop.get("end_time"), 0) if prev_stop else 0

    # Resolve Reference Origin Coordinates
    origin_lat: Optional[float] = None
    origin_lon: Optional[float] = None
    origin_location_label = destination

    if current_location and _valid_coords(current_location.get("lat"), current_location.get("lon")):
        origin_lat = float(current_location["lat"])
        origin_lon = float(current_location["lon"])
        origin_location_label = "Current GPS Location"
    elif prev_stop and _valid_coords(prev_stop.get("lat"), prev_stop.get("lon")):
        origin_lat = float(prev_stop["lat"])
        origin_lon = float(prev_stop["lon"])
        origin_location_label = prev_stop.get("name") or prev_stop.get("title") or "Previous Completed Stop"
    elif _valid_coords(skipped_stop.get("lat"), skipped_stop.get("lon")):
        origin_lat = float(skipped_stop["lat"])
        origin_lon = float(skipped_stop["lon"])
        origin_location_label = skipped_stop.get("name") or skipped_stop.get("title") or "Scheduled Stop Location"
    else:
        dest_coords = resolve_destination_coordinates(destination)
        origin_lat = dest_coords["lat"]
        origin_lon = dest_coords["lon"]
        origin_location_label = f"Central {destination}"

    # Timing Cutoff & Chronology Enforcement
    skipped_start_m = parse_hhmm_to_minutes(skipped_stop.get("start_time"), 600)
    skipped_end_m = parse_hhmm_to_minutes(skipped_stop.get("end_time"), skipped_start_m + 60)

    try:
        from dateutil import parser
        target_date_obj = parser.parse(target_day.get("date")).date() if target_day.get("date") else now_in_dest.date()
    except Exception:
        target_date_obj = now_in_dest.date()

    target_date_dt = datetime(target_date_obj.year, target_date_obj.month, target_date_obj.day, 12, 0, tzinfo=dest_tz)

    is_today = (target_date_obj == now_in_dest.date())
    dest_now_m = (now_in_dest.hour * 60 + now_in_dest.minute) if is_today else None
    user_now_m = parse_hhmm_to_minutes(current_time_str, -1) if current_time_str else -1
    effective_now_m = user_now_m if user_now_m >= 0 else dest_now_m

    # CRITICAL: Replacement CANNOT start earlier than the skipped stop's scheduled time!
    earliest_feasible_start_m = skipped_start_m
    time_adjustment_note = ""

    # If scheduled time has already elapsed in destination today:
    if effective_now_m is not None and effective_now_m > earliest_feasible_start_m:
        earliest_feasible_start_m = effective_now_m
        time_adjustment_note = f" (Adjusted to {minutes_to_ampm(earliest_feasible_start_m)} as original time passed)"

    # Pace duration settings
    if pace == "relaxed":
        target_visit_duration = 105
        bed_mins = 1290  # 21:30
    elif pace == "packed":
        target_visit_duration = 60
        bed_mins = 1350  # 22:30
    else:
        target_visit_duration = 90
        bed_mins = 1320  # 22:00

    # Collect already used place slugs to prevent duplication
    used_place_slugs = set()
    for d in daily_routes:
        for s in (d.get("stops") or d.get("activities") or []):
            name_str = (s.get("name") or s.get("title") or "").strip().lower()
            if name_str:
                slug = re.sub(r'[^a-z0-9]+', '', name_str)
                used_place_slugs.add(slug)

    # Skipped activity is strictly excluded from ever being re-selected
    skipped_slug = re.sub(r'[^a-z0-9]+', '', (skipped_stop.get("name") or skipped_stop.get("title") or "").strip().lower())
    if skipped_slug:
        used_place_slugs.add(skipped_slug)

    # Next stop in schedule to measure transit to
    next_anchor_stop = subsequent_stops[0] if subsequent_stops else None
    next_anchor_lat = next_anchor_stop.get("lat") if next_anchor_stop else None
    next_anchor_lon = next_anchor_stop.get("lon") if next_anchor_stop else None

    # Classify skipped stop purpose and category
    skipped_classification = classify_activity(skipped_stop)
    is_meal = skipped_classification["is_meal"]
    meal_type = skipped_classification["sub_type"] if is_meal else None
    attr_sub = skipped_classification["sub_type"] if not is_meal else None

    replacement_stop_obj = None
    reason_msg = ""

    # =========================================================================
    # CASE 1: SKIPPED ACTIVITY IS A MEAL (Preserve Meal Requirement)
    # =========================================================================
    if is_meal:
        meal_duration = 45 if meal_type == "breakfast" else (75 if meal_type == "dinner" else 60)
        
        # 1. Search verified restaurant candidates
        cand_pool: List[Dict[str, Any]] = []

        # Source A: Check trip pre-fetched restaurants
        for r in (trip.get("restaurants") or []):
            r_name = (r.get("name") or r.get("title") or "").strip()
            slug = re.sub(r'[^a-z0-9]+', '', r_name.lower())
            if slug and slug not in used_place_slugs:
                cand_pool.append(dict(r))

        # Source B: Check authentic curated restaurants for destination
        if not cand_pool:
            clean_dest = destination.lower().split(",")[0].strip()
            curated_list = AUTHENTIC_DESTINATION_RESTAURANTS.get(clean_dest) or []
            for cr in curated_list:
                c_name = cr.get("name", "").strip()
                slug = re.sub(r'[^a-z0-9]+', '', c_name.lower())
                if slug and slug not in used_place_slugs:
                    cand_pool.append(dict(cr))

        # Source C: Real-time discovery fallback
        if not cand_pool:
            try:
                serp_res = discover_restaurants_serpapi(destination, 5)
                for sr in (serp_res or []):
                    s_name = sr.get("name", "").strip()
                    slug = re.sub(r'[^a-z0-9]+', '', s_name.lower())
                    if slug and slug not in used_place_slugs:
                        cand_pool.append(sr)
            except Exception as e:
                print(f"--- REROUTE SERVICE: Restaurant discovery fallback notice: {e} ---")

        best_cand = None
        best_score = float('inf')

        for cand in cand_pool:
            c_lat = cand.get("lat")
            c_lon = cand.get("lon")
            if not _valid_coords(c_lat, c_lon):
                continue

            t_to_cand, dist_to_cand, mode_to_cand = estimate_transit(origin_lat, origin_lon, c_lat, c_lon)
            
            # Feasible start time: must not start before earliest cutoff and transit from preceding stop
            cand_start = max(earliest_feasible_start_m, prev_end_m + t_to_cand)
            cand_end = cand_start + meal_duration

            # Feasibility windows:
            if meal_type == "lunch":
                if not (700 <= cand_start <= 930):  # 11:40 - 15:30
                    continue
            elif meal_type == "dinner":
                if not (1110 <= cand_start <= 1320): # 18:30 - 22:00
                    continue
            elif meal_type == "breakfast":
                if not (420 <= cand_start <= 630):   # 07:00 - 10:30
                    continue

            # Transit to next stop
            t_to_next = 0
            if next_anchor_stop and _valid_coords(next_anchor_lat, next_anchor_lon):
                t_to_next, _, _ = estimate_transit(c_lat, c_lon, next_anchor_lat, next_anchor_lon)

            if cand_end + t_to_next > bed_mins:
                continue

            dist_km = haversine(origin_lat, origin_lon, c_lat, c_lon)
            score = dist_km
            if score < best_score:
                best_score = score
                cand["_transit_mins"] = t_to_cand
                cand["_transit_dist"] = dist_to_cand
                cand["_transit_mode"] = mode_to_cand
                cand["_start_m"] = cand_start
                cand["_end_m"] = cand_end
                best_cand = cand

        if best_cand:
            rep_name = best_cand.get("name") or f"Curated {destination} Bistro"
            rep_place_id = best_cand.get("place_id")
            rep_id = generate_persistent_activity_id("restaurant", rep_name, rep_place_id)
            if rep_id == skipped_activity_id:
                rep_id = f"{rep_id}_rep"

            replacement_stop_obj = {
                "id": rep_id,
                "name": rep_name,
                "title": rep_name,
                "type": "restaurant",
                "category": "restaurant",
                "matched_interest": f"{meal_type.title()} Dining",
                "priority_rank": 10,
                "match_type": "reroute_replacement",
                "start_time": minutes_to_hhmm(best_cand["_start_m"]),
                "end_time": minutes_to_hhmm(best_cand["_end_m"]),
                "time": format_time_range(best_cand["_start_m"], best_cand["_end_m"]),
                "duration_minutes": meal_duration,
                "duration": format_duration(meal_duration),
                "travel_time_from_prev_minutes": best_cand["_transit_mins"],
                "travel_time_from_prev": f"{best_cand['_transit_mins']} mins",
                "distance_from_prev_km": best_cand["_transit_dist"],
                "travel_mode": best_cand["_transit_mode"],
                "lat": float(best_cand["lat"]),
                "lon": float(best_cand["lon"]),
                "location": best_cand.get("address", destination),
                "address": best_cand.get("address", destination),
                "description": best_cand.get("description") or f"Curated authentic dining at {rep_name} in {destination}.",
                "why_visit": f"Alternative {meal_type} venue near your route.",
                "image_url": best_cand.get("image_url"),
                "rating": best_cand.get("rating"),
                "review_count": best_cand.get("review_count"),
                "status": "OPEN",
                "place_id": rep_place_id,
                "source": best_cand.get("source", "dynamic_reroute"),
                "scheduled_date": target_day.get("date"),
                "day_of_week": target_day.get("day_of_week"),
                "is_replacement": True,
                "status_label": "Replacement",
                "replaces_activity_id": skipped_activity_id,
                "rescheduled": True
            }
            reason_msg = f"Alternative {meal_type} venue '{rep_name}' scheduled near your route from {minutes_to_ampm(best_cand['_start_m'])}.{time_adjustment_note}"
        else:
            # Retain dedicated meal block without inventing fake restaurant
            meal_break_start = max(earliest_feasible_start_m, prev_end_m + 15)
            meal_break_end = meal_break_start + meal_duration
            
            dest_lower = destination.lower()
            if "hyderabad" in dest_lower:
                m_img = "https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=80"
            elif "goa" in dest_lower:
                m_img = "https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=800&q=80"
            elif "delhi" in dest_lower:
                m_img = "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80"
            else:
                m_img = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80"

            replacement_stop_obj = {
                "id": f"act_meal_break_{meal_type}_{target_day_idx + 1}",
                "name": f"{meal_type.title()} Break & Local Dining",
                "title": f"{meal_type.title()} Break & Local Dining",
                "type": "restaurant",
                "category": "dining",
                "matched_interest": f"{meal_type.title()} Dining",
                "priority_rank": 10,
                "match_type": "meal_break_replacement",
                "start_time": minutes_to_hhmm(meal_break_start),
                "end_time": minutes_to_hhmm(meal_break_end),
                "time": format_time_range(meal_break_start, meal_break_end),
                "duration_minutes": meal_duration,
                "duration": format_duration(meal_duration),
                "travel_time_from_prev_minutes": 15,
                "travel_time_from_prev": "15 mins",
                "distance_from_prev_km": 1.0,
                "travel_mode": "walking",
                "lat": float(origin_lat),
                "lon": float(origin_lon),
                "location": f"Near {prev_stop.get('name') if prev_stop else destination}",
                "address": f"Near {prev_stop.get('name') if prev_stop else destination}",
                "description": f"Dedicated {meal_type} time window along your route. Explore nearby authentic local cuisine and dining establishments at your leisure.",
                "why_visit": f"Essential mid-day culinary window near your route.",
                "image_url": m_img,
                "rating": "4.5",
                "status": "OPEN",
                "scheduled_date": target_day.get("date"),
                "day_of_week": target_day.get("day_of_week"),
                "is_replacement": True,
                "is_meal_break": True,
                "status_label": "Meal Break",
                "replaces_activity_id": skipped_activity_id,
                "rescheduled": True
            }
            reason_msg = f"Dedicated {meal_type} window preserved near your route from {minutes_to_ampm(meal_break_start)}.{time_adjustment_note}"

    # =========================================================================
    # CASE 2: SKIPPED ACTIVITY IS AN ATTRACTION (Preserve Category & Interests)
    # =========================================================================
    elif skipped_classification["main_type"] == "attraction":
        cand_pool = []
        for a in (trip.get("all_attractions") or trip.get("attractions") or []):
            a_name = (a.get("name") or a.get("title") or "").strip()
            slug = re.sub(r'[^a-z0-9]+', '', a_name.lower())
            if slug and slug not in used_place_slugs:
                cand_pool.append(dict(a))

        if not cand_pool:
            try:
                discovered = discover_via_serpapi(destination, 5)
                if not discovered:
                    discovered = discover_via_overpass(destination, 5)
                for d_cand in discovered:
                    c_name = (d_cand.get("name") or d_cand.get("title") or "").strip()
                    slug = re.sub(r'[^a-z0-9]+', '', c_name.lower())
                    if slug and slug not in used_place_slugs:
                        cand_pool.append(d_cand)
            except Exception as e:
                print(f"--- REROUTE SERVICE: Factual discovery fallback error: {e} ---")

        best_cand = None
        best_score = float('inf')

        for cand in cand_pool:
            c_lat = cand.get("lat")
            c_lon = cand.get("lon")
            if not _valid_coords(c_lat, c_lon):
                enriched = verify_and_enrich_place(cand.get("name"), destination)
                if enriched and _valid_coords(enriched.get("lat"), enriched.get("lon")):
                    cand.update(enriched)
                    c_lat = cand.get("lat")
                    c_lon = cand.get("lon")
                else:
                    continue

            # Operating hours check
            hours_status, _ = determine_status_from_hours(cand.get("opening_hours"), target_date_dt)
            if hours_status == "CLOSED":
                continue

            t_to_cand, dist_to_cand, mode_to_cand = estimate_transit(origin_lat, origin_lon, c_lat, c_lon)
            cand_start = max(earliest_feasible_start_m, prev_end_m + t_to_cand)
            cand_end = cand_start + target_visit_duration

            t_to_next = 0
            if next_anchor_stop and _valid_coords(next_anchor_lat, next_anchor_lon):
                t_to_next, _, _ = estimate_transit(c_lat, c_lon, next_anchor_lat, next_anchor_lon)

            total_conclude = cand_end + t_to_next
            if total_conclude > bed_mins:
                continue

            # If next stop is dinner, do not push past 20:30
            if next_anchor_stop and next_anchor_stop.get("type") == "restaurant":
                if cand_end > 1230:
                    continue

            dist_km = haversine(origin_lat, origin_lon, c_lat, c_lon)
            cand_text = f"{cand.get('category', '')} {cand.get('name', '')} {str(cand.get('interests', []))}".lower()

            category_bonus = 0.0
            if attr_sub and attr_sub != "general":
                if attr_sub in cand_text:
                    category_bonus = -8.0  # Strong category affinity

            interest_bonus = -4.0 if any(i.lower() in cand_text for i in interests) else 0.0
            score = dist_km + category_bonus + interest_bonus

            if score < best_score:
                best_score = score
                cand["_transit_mins"] = t_to_cand
                cand["_transit_dist"] = dist_to_cand
                cand["_transit_mode"] = mode_to_cand
                cand["_start_m"] = cand_start
                cand["_end_m"] = cand_end
                best_cand = cand

        if best_cand:
            rep_name = best_cand.get("name") or "Discovered Highlight"
            rep_type = best_cand.get("category") or "attraction"
            rep_place_id = best_cand.get("place_id")
            rep_id = generate_persistent_activity_id(rep_type, rep_name, rep_place_id)
            if rep_id == skipped_activity_id:
                rep_id = f"{rep_id}_rep"

            replacement_stop_obj = {
                "id": rep_id,
                "name": rep_name,
                "title": rep_name,
                "type": "attraction",
                "category": best_cand.get("category", "attraction"),
                "matched_interest": best_cand.get("matched_interest", "Dynamic Alternative"),
                "priority_rank": best_cand.get("priority_rank", 20),
                "match_type": "reroute_replacement",
                "start_time": minutes_to_hhmm(best_cand["_start_m"]),
                "end_time": minutes_to_hhmm(best_cand["_end_m"]),
                "time": format_time_range(best_cand["_start_m"], best_cand["_end_m"]),
                "duration_minutes": target_visit_duration,
                "duration": format_duration(target_visit_duration),
                "travel_time_from_prev_minutes": best_cand["_transit_mins"],
                "travel_time_from_prev": f"{best_cand['_transit_mins']} mins",
                "distance_from_prev_km": best_cand["_transit_dist"],
                "travel_mode": best_cand["_transit_mode"],
                "lat": float(best_cand["lat"]),
                "lon": float(best_cand["lon"]),
                "location": best_cand.get("address", destination),
                "address": best_cand.get("address", destination),
                "description": best_cand.get("description") or f"A verified alternative in {destination} seamlessly fitted into your schedule.",
                "why_visit": f"Nearby verified venue replacing {skipped_stop.get('name')}.",
                "image_url": best_cand.get("image_url"),
                "rating": best_cand.get("rating"),
                "review_count": best_cand.get("review_count"),
                "opening_hours": best_cand.get("opening_hours"),
                "opening_hours_status": "VERIFIED_OPEN" if best_cand.get("status") == "OPEN" else "UNVERIFIED",
                "status": "OPEN",
                "place_id": rep_place_id,
                "source": best_cand.get("source", "dynamic_reroute"),
                "fame_level": best_cand.get("fame_level"),
                "scheduled_date": target_day.get("date"),
                "day_of_week": target_day.get("day_of_week"),
                "is_replacement": True,
                "status_label": "Replacement",
                "replaces_activity_id": skipped_activity_id,
                "rescheduled": True
            }
            reason_msg = f"Discovered verified nearby attraction '{rep_name}' matching your interests from {minutes_to_ampm(best_cand['_start_m'])}.{time_adjustment_note}"
        else:
            reason_msg = f"No verified replacement attraction fits the remaining schedule on Day {day_number}. Remaining stops have been smoothly rescheduled.{time_adjustment_note}"

    # =========================================================================
    # CASE 3: HOTEL OR TRANSIT SKIPPED (Do not replace with tourist attraction)
    # =========================================================================
    else:
        reason_msg = f"Transit or hospitality stop skipped. Remaining schedule smoothly adjusted.{time_adjustment_note}"

    # =========================================================================
    # CONSTRUCT PROPOSED SCHEDULE (Preserve Historical Stops Untouched)
    # =========================================================================
    final_proposed_stops: List[Dict[str, Any]] = []

    # 1. Historical stops strictly before skipped_idx are frozen untouched
    for hs in historical_stops:
        hs_copy = dict(hs)
        hs_copy["rescheduled"] = False
        hs_copy["status_label"] = "Unchanged"
        final_proposed_stops.append(hs_copy)

    # 2. Insert Replacement Stop (if suitable verified venue found)
    if replacement_stop_obj:
        final_proposed_stops.append(replacement_stop_obj)
        time_cursor_m = parse_hhmm_to_minutes(replacement_stop_obj["end_time"], earliest_feasible_start_m)
        prev_coords_lat = float(replacement_stop_obj["lat"])
        prev_coords_lon = float(replacement_stop_obj["lon"])
    else:
        time_cursor_m = earliest_feasible_start_m
        prev_coords_lat = origin_lat
        prev_coords_lon = origin_lon

    # 3. Subsequent stops with recalculated non-overlapping times
    for ps in subsequent_stops:
        ps_copy = dict(ps)
        orig_s = parse_hhmm_to_minutes(ps_copy.get("start_time"), 0)
        orig_dur = ps_copy.get("duration_minutes") or 60

        curr_lat = ps_copy.get("lat")
        curr_lon = ps_copy.get("lon")
        t_mins, t_dist, t_mode = estimate_transit(prev_coords_lat, prev_coords_lon, curr_lat, curr_lon)

        earliest_ps_start = time_cursor_m + t_mins

        # Smart timing:
        # If ps is an evening meal (starts at or after 18:30)
        if ps_copy.get("type") == "restaurant" and orig_s >= 1110:
            new_s = max(1140, earliest_ps_start)  # Natural dinner time around 19:00+
        elif earliest_ps_start <= orig_s:
            # Fits within original window with comfortable buffer: preserve original start!
            new_s = orig_s
        else:
            # Shifted forward smoothly
            new_s = earliest_ps_start

        new_e = new_s + orig_dur
        is_changed = (new_s != orig_s)

        ps_copy["start_time"] = minutes_to_hhmm(new_s)
        ps_copy["end_time"] = minutes_to_hhmm(new_e)
        ps_copy["time"] = format_time_range(new_s, new_e)
        ps_copy["travel_time_from_prev_minutes"] = t_mins
        ps_copy["travel_time_from_prev"] = f"{t_mins} mins" if t_mins > 0 else "0 mins"
        ps_copy["distance_from_prev_km"] = t_dist
        ps_copy["travel_mode"] = t_mode
        ps_copy["rescheduled"] = is_changed
        ps_copy["status_label"] = "Rescheduled" if is_changed else "Unchanged"

        final_proposed_stops.append(ps_copy)
        time_cursor_m = new_e
        if _valid_coords(curr_lat, curr_lon):
            prev_coords_lat = float(curr_lat)
            prev_coords_lon = float(curr_lon)

    # 4. Strict Chronological Overlap Guard
    for i in range(len(final_proposed_stops) - 1):
        end_curr = parse_hhmm_to_minutes(final_proposed_stops[i].get("end_time"), 0)
        start_next = parse_hhmm_to_minutes(final_proposed_stops[i + 1].get("start_time"), 0)
        if start_next < end_curr:
            shift_gap = 10
            dur = final_proposed_stops[i + 1].get("duration_minutes") or 60
            new_s = end_curr + shift_gap
            new_e = new_s + dur
            final_proposed_stops[i + 1]["start_time"] = minutes_to_hhmm(new_s)
            final_proposed_stops[i + 1]["end_time"] = minutes_to_hhmm(new_e)
            final_proposed_stops[i + 1]["time"] = format_time_range(new_s, new_e)
            final_proposed_stops[i + 1]["rescheduled"] = True
            if final_proposed_stops[i + 1].get("status_label") != "Replacement":
                final_proposed_stops[i + 1]["status_label"] = "Rescheduled"

    proposal_id = f"prop_{int(time.time())}_{day_number}"
    rescheduled_stops = [s for s in final_proposed_stops if s.get("rescheduled")]

    return {
        "status": "success",
        "proposal_id": proposal_id,
        "day_number": int(day_number),
        "revision": trip.get("revision", 1),
        "replacement_found": bool(replacement_stop_obj),
        "origin_location_label": origin_location_label,
        "skipped_activity": {
            "id": skipped_activity_id,
            "title": skipped_stop.get("title") or skipped_stop.get("name"),
            "time": skipped_stop.get("time"),
            "category": skipped_stop.get("category") or skipped_stop.get("type"),
            "type": skipped_stop.get("type"),
            "purpose": skipped_classification["main_type"],
            "sub_type": skipped_classification["sub_type"]
        },
        "replacement_activity": replacement_stop_obj,
        "original_stops": raw_stops,
        "proposed_stops": final_proposed_stops,
        "rescheduled_stops": rescheduled_stops,
        "reason": reason_msg
    }


def apply_reroute_proposal(
    db,
    trip_id: str,
    day_number: int,
    skipped_activity_id: str,
    proposed_stops: List[Dict[str, Any]],
    replacement_activity_id: Optional[str] = None,
    reason: Optional[str] = None,
    expected_revision: Optional[int] = None,
    x_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Applies the accepted reroute proposal to the trip.
    Freezes all other days, updates Day day_number, records reroute history,
    increments revision counter, and stores updated execution state.
    """
    from bson import ObjectId
    from bson.errors import InvalidId
    from fastapi import HTTPException

    try:
        query = {"_id": ObjectId(trip_id)}
    except (InvalidId, Exception):
        query = {"id": trip_id}

    trip = db.trips.find_one(query)
    if not trip and "_id" in query:
        query = {"id": trip_id}
        trip = db.trips.find_one(query)

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    # Authorization Check
    if trip.get("user_id"):
        if not x_user_id or x_user_id != trip["user_id"]:
            raise HTTPException(status_code=403, detail="Unauthorized: Trip belongs to another user")

    # Revision Check (Concurrency Protection)
    current_revision = int(trip.get("revision", 1))
    if expected_revision is not None and int(expected_revision) != current_revision:
        raise HTTPException(
            status_code=409,
            detail=f"Concurrent modification detected. Current revision is {current_revision}, expected {expected_revision}."
        )

    route_details = trip.get("route_details") or {}
    daily_routes = list(route_details.get("day_by_day_route") or [])
    if not daily_routes:
        raise HTTPException(status_code=400, detail="Trip has no daily routes to update")

    # Locate and update ONLY the target day
    day_found = False
    for idx, d in enumerate(daily_routes):
        d_num = d.get("day") or d.get("day_number") or (idx + 1)
        if int(d_num) == int(day_number):
            cleaned_stops = []
            for s in proposed_stops:
                s_copy = dict(s)
                s_copy.pop("rescheduled", None)
                s_copy.pop("status_label", None)
                cleaned_stops.append(s_copy)

            d["stops"] = cleaned_stops
            d["activities"] = cleaned_stops
            day_found = True
            break

    if not day_found:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found in itinerary")

    # Update Execution State
    exec_state = dict(trip.get("execution_state") or {})
    activity_log = dict(exec_state.get("activity_log") or {})

    # Mark the skipped activity as skipped (NOT completed)
    activity_log[skipped_activity_id] = {
        "status": "skipped",
        "activity_id": skipped_activity_id,
        "actual_end_time": datetime.utcnow().isoformat()
    }
    exec_state["activity_log"] = activity_log

    # Append to reroute_history
    reroute_history = list(exec_state.get("reroute_history") or [])
    new_revision = current_revision + 1

    reroute_record = {
        "timestamp": datetime.utcnow().isoformat(),
        "day_number": int(day_number),
        "skipped_activity_id": skipped_activity_id,
        "replacement_activity_id": replacement_activity_id,
        "reason": reason or "Traveler skipped stop and accepted dynamic reroute proposal.",
        "accepted": True,
        "revision": new_revision
    }
    reroute_history.append(reroute_record)
    exec_state["reroute_history"] = reroute_history

    # Persist atomically to MongoDB
    update_doc = {
        "route_details": route_details,
        "execution_state": exec_state,
        "revision": new_revision,
        "updated_at": datetime.utcnow().isoformat()
    }

    db.trips.update_one(query, {"$set": update_doc})

    return {
        "status": "success",
        "trip_id": str(trip.get("_id") or trip_id),
        "revision": new_revision,
        "route_details": route_details,
        "execution_state": exec_state,
        "reroute_record": reroute_record
    }
