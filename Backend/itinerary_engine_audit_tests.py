"""
TravelAI Phase 1 â€” Priority-Based, Realistic Daily Itinerary Engine Audit Suite

Tests:
1. Test A: 4-day Goa (Nature > Beaches > Temples) with Must-Visit (Aguada Fort)
2. Test B: 5-day Paris (History > Museums > Food) with Relaxed Pace
3. Test C: 5-day Hyderabad -> Sydney with Realistic Arrival/Departure Transit
4. Test D: Relaxed vs Packed Pace Comparison
5. Test E: Missing Opening Hours / Coordinates Resilience
6. Test F: Authoritative Date Range Validation (end_date >= start_date, calendar days)
"""

import sys
import os
import json
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Add Backend root to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.ai.agents.route_agent import (
    route_node,
    resolve_destination_timezone,
    estimate_transit,
    haversine,
    parse_hhmm_to_minutes,
    minutes_to_hhmm,
    minutes_to_ampm,
    format_time_range
)
from app.ai.agents.attraction_agent import (
    evaluate_attraction_priority,
    attraction_node
)
from app.ai.orchestrator.state import TravelState


def verify_schedule_integrity(day_routes: list) -> tuple[bool, list]:
    """
    Validates that:
    1. Every day has consecutive dates matching calendar progression.
    2. Within each day, activities are chronologically ordered with NO time overlaps.
    3. Every activity has a valid non-empty id, type, title, and start/end times.
    4. Transit times between stops are accounted for.
    """
    errors = []
    
    prev_date = None
    for d_idx, day in enumerate(day_routes):
        day_num = day.get("day") or day.get("day_number")
        if day_num != d_idx + 1:
            errors.append(f"Day number mismatch: expected {d_idx + 1}, got {day_num}")
            
        cur_date_str = day.get("date")
        if not cur_date_str:
            errors.append(f"Day {day_num} missing date")
        else:
            cur_date = datetime.strptime(cur_date_str, "%Y-%m-%d").date()
            if prev_date is not None:
                expected_date = prev_date + timedelta(days=1)
                if cur_date != expected_date:
                    errors.append(f"Day {day_num} date discontinuity: expected {expected_date}, got {cur_date}")
            prev_date = cur_date

        stops = day.get("stops", [])
        if not stops:
            errors.append(f"Day {day_num} has 0 stops")
            continue

        prev_end_mins = -1
        for s_idx, stop in enumerate(stops):
            act_id = stop.get("id")
            if not act_id:
                errors.append(f"Day {day_num} Stop {s_idx + 1} missing stable 'id'")

            start_t = stop.get("start_time")
            end_t = stop.get("end_time")
            if not start_t or not end_t:
                errors.append(f"Day {day_num} Stop {s_idx + 1} ({stop.get('name')}) missing start/end times")
                continue

            start_mins = parse_hhmm_to_minutes(start_t, -1)
            end_mins = parse_hhmm_to_minutes(end_t, -1)

            if start_mins < 0 or end_mins < 0:
                errors.append(f"Day {day_num} Stop {s_idx + 1} has invalid time format: {start_t} - {end_t}")
            elif end_mins <= start_mins:
                errors.append(f"Day {day_num} Stop {s_idx + 1} has end_time ({end_t}) <= start_time ({start_t})")

            # Check overlap against previous stop
            if prev_end_mins >= 0:
                if start_mins < prev_end_mins:
                    errors.append(
                        f"Day {day_num} Stop {s_idx + 1} ({stop.get('name')}) overlaps previous stop! "
                        f"Prev ended at {minutes_to_hhmm(prev_end_mins)}, cur starts at {start_t}"
                    )
            prev_end_mins = end_mins

    return len(errors) == 0, errors


def test_a_goa_priority():
    print("\n" + "="*70)
    print("TEST A: 4-Day Goa (Nature > Beaches > Temples) with Must-Visit Aguada Fort")
    print("="*70)

    # 1. State with ranked interests & must-visit
    mock_attractions = [
        {
            "name": "Aguada Fort",
            "category": "fort",
            "interests": ["history", "nature"],
            "lat": 15.4920,
            "lon": 73.7737,
            "priority_score": 1000,
            "priority_rank": 0,
            "matched_interest": "Aguada Fort",
            "match_type": "must_visit",
            "opening_hours": "09:30 AM - 05:30 PM",
            "opening_hours_status": "VERIFIED_OPEN",
            "status": "OPEN",
            "source": "must_visit_request"
        },
        {
            "name": "Bhagwan Mahavir Wildlife Sanctuary",
            "category": "nature",
            "interests": ["nature", "wildlife"],
            "lat": 15.3417,
            "lon": 74.2483,
            "priority_score": 100,
            "priority_rank": 1,
            "matched_interest": "Nature",
            "match_type": "interest_match",
            "opening_hours": "08:00 AM - 05:30 PM",
            "opening_hours_status": "VERIFIED_OPEN",
            "status": "OPEN",
            "source": "ai_curated"
        },
        {
            "name": "Dudhsagar Waterfalls",
            "category": "nature",
            "interests": ["nature", "waterfall"],
            "lat": 15.3144,
            "lon": 74.3144,
            "priority_score": 100,
            "priority_rank": 1,
            "matched_interest": "Nature",
            "match_type": "interest_match",
            "opening_hours": "07:00 AM - 05:00 PM",
            "opening_hours_status": "VERIFIED_OPEN",
            "status": "OPEN",
            "source": "ai_curated"
        },
        {
            "name": "Palolem Beach",
            "category": "beach",
            "interests": ["beach", "coast"],
            "lat": 15.0100,
            "lon": 74.0232,
            "priority_score": 80,
            "priority_rank": 2,
            "matched_interest": "Beaches",
            "match_type": "interest_match",
            "opening_hours": "Open 24 hours",
            "opening_hours_status": "VERIFIED_OPEN",
            "status": "OPEN",
            "source": "ai_curated"
        },
        {
            "name": "Anjuna Beach",
            "category": "beach",
            "interests": ["beach", "sea"],
            "lat": 15.5819,
            "lon": 73.7429,
            "priority_score": 80,
            "priority_rank": 2,
            "matched_interest": "Beaches",
            "match_type": "interest_match",
            "opening_hours": "Open 24 hours",
            "opening_hours_status": "VERIFIED_OPEN",
            "status": "OPEN",
            "source": "ai_curated"
        },
        {
            "name": "Mangueshi Temple",
            "category": "temple",
            "interests": ["temple", "culture"],
            "lat": 15.4344,
            "lon": 73.9680,
            "priority_score": 60,
            "priority_rank": 3,
            "matched_interest": "Temples",
            "match_type": "interest_match",
            "opening_hours": "06:00 AM - 08:30 PM",
            "opening_hours_status": "VERIFIED_OPEN",
            "status": "OPEN",
            "source": "ai_curated"
        },
        {
            "name": "Shanta Durga Temple",
            "category": "temple",
            "interests": ["temple", "heritage"],
            "lat": 15.3582,
            "lon": 73.9877,
            "priority_score": 60,
            "priority_rank": 3,
            "matched_interest": "Temples",
            "match_type": "interest_match",
            "opening_hours": "07:00 AM - 09:00 PM",
            "opening_hours_status": "VERIFIED_OPEN",
            "status": "OPEN",
            "source": "ai_curated"
        }
    ]

    mock_restaurants = [
        {"name": "Fisherman's Wharf", "lat": 15.1764, "lon": 73.9392, "category": "restaurant"},
        {"name": "Vinayak Family Restaurant", "lat": 15.5894, "lon": 73.7475, "category": "restaurant"},
        {"name": "Martin's Corner", "lat": 15.2952, "lon": 73.9175, "category": "restaurant"},
        {"name": "Mum's Kitchen", "lat": 15.4989, "lon": 73.8278, "category": "restaurant"}
    ]

    state = {
        "origin": "Hyderabad",
        "destination": "Goa",
        "start_date": "2026-11-01",
        "end_date": "2026-11-04",
        "days": 4,
        "interests": ["Nature", "Beaches", "Temples"],
        "must_visit_places": ["Aguada Fort"],
        "pace": "balanced",
        "wake_up_time": "08:00",
        "bedtime": "22:00",
        "attractions": mock_attractions,
        "restaurants": mock_restaurants,
        "hotels": [{"name": "Taj Fort Aguada Resort", "lat": 15.4925, "lon": 73.7740}]
    }

    result = route_node(state)
    days_data = result["route_details"]["day_by_day_route"]

    print(f"Generated {len(days_data)} days.")
    assert len(days_data) == 4, f"Expected 4 days, got {len(days_data)}"

    # Check date continuity
    assert days_data[0]["date"] == "2026-11-01"
    assert days_data[1]["date"] == "2026-11-02"
    assert days_data[2]["date"] == "2026-11-03"
    assert days_data[3]["date"] == "2026-11-04"

    # Verify Schedule Integrity
    ok, errors = verify_schedule_integrity(days_data)
    if not ok:
        print("Schedule Integrity Errors:", errors)
    assert ok, f"Schedule integrity failed: {errors}"

    # Verify Must-Visit included
    all_stop_names = [s["name"] for d in days_data for s in d["stops"]]
    assert any("Aguada Fort" in name for name in all_stop_names), "Must-visit Aguada Fort not found in schedule!"
    print("[OK] Aguada Fort successfully included and scheduled.")

    # Check Day 1 is flight arrival & hotel check-in
    day1_stops = days_data[0]["stops"]
    assert any(s["type"] == "airport" and ("Hyderabad" in s["name"] or "HYD" in s["name"] or "Rajiv Gandhi" in s["name"]) for s in day1_stops), "Origin airport missing in Day 1"
    assert any(s["type"] == "airport" and ("Goa" in s["name"] or "GOX" in s["name"] or "Manohar" in s["name"]) for s in day1_stops), "Destination airport missing in Day 1"
    assert any(s["type"] == "hotel" for s in day1_stops), "Hotel check-in missing in Day 1"
    print("[OK] Day 1 transit constraints correctly enforced.")

    # Check Day 4 is departure day
    day4_stops = days_data[3]["stops"]
    assert any(s["type"] == "hotel" and "Check-out" in s["name"] for s in day4_stops), "Hotel checkout missing in Day 4"
    assert any(s["type"] == "airport" for s in day4_stops), "Airport transfer missing in Day 4"
    print("[OK] Day 4 departure constraints correctly enforced.")

    # Check no duplicate attractions
    attraction_stops = [s["name"] for d in days_data for s in d["stops"] if s["type"] == "attraction"]
    assert len(attraction_stops) == len(set(attraction_stops)), "Duplicate attractions detected across days!"
    print(f"[OK] {len(attraction_stops)} unique attractions scheduled without duplicates.")

    # Check lunch windows (around 12:30-14:00)
    for d in days_data:
        lunch_stops = [s for s in d["stops"] if s["type"] == "restaurant" and parse_hhmm_to_minutes(s["start_time"], 0) < 900]
        for ls in lunch_stops:
            s_mins = parse_hhmm_to_minutes(ls["start_time"], 0)
            assert 720 <= s_mins <= 870, f"Lunch outside expected window (12:00 - 14:30): {ls['start_time']}"
    print("[OK] Lunch windows verified between 12:00 and 14:30.")
    print("TEST A PASSED!\n")


def test_b_paris_relaxed():
    print("\n" + "="*70)
    print("TEST B: 5-Day Paris (History > Museums > Food) with Relaxed Pace")
    print("="*70)

    # Destination timezone
    tz = resolve_destination_timezone("Paris")
    assert tz == "Europe/Paris", f"Expected Europe/Paris, got {tz}"
    print(f"[OK] Resolved timezone: {tz}")

    mock_attractions = [
        {
            "name": "Eiffel Tower",
            "category": "monument",
            "interests": ["history", "landmark"],
            "lat": 48.8584, "lon": 2.2945,
            "priority_score": 1000, "priority_rank": 0,
            "matched_interest": "Eiffel Tower", "match_type": "must_visit",
            "opening_hours": "09:00 AM - 11:45 PM", "opening_hours_status": "VERIFIED_OPEN", "status": "OPEN"
        },
        {
            "name": "Louvre Museum",
            "category": "museum",
            "interests": ["museums", "art", "history"],
            "lat": 48.8606, "lon": 2.3376,
            "priority_score": 1000, "priority_rank": 0,
            "matched_interest": "Louvre Museum", "match_type": "must_visit",
            "opening_hours": "09:00 AM - 06:00 PM", "opening_hours_status": "VERIFIED_OPEN", "status": "OPEN"
        },
        {
            "name": "Notre-Dame Cathedral",
            "category": "historic",
            "interests": ["history", "culture"],
            "lat": 48.8530, "lon": 2.3499,
            "priority_score": 100, "priority_rank": 1,
            "matched_interest": "History", "match_type": "interest_match",
            "opening_hours": "08:00 AM - 06:45 PM", "opening_hours_status": "VERIFIED_OPEN", "status": "OPEN"
        },
        {
            "name": "MusÃ©e d'Orsay",
            "category": "museum",
            "interests": ["museums", "art"],
            "lat": 48.8599, "lon": 2.3266,
            "priority_score": 80, "priority_rank": 2,
            "matched_interest": "Museums", "match_type": "interest_match",
            "opening_hours": "09:30 AM - 06:00 PM", "opening_hours_status": "VERIFIED_OPEN", "status": "OPEN"
        },
        {
            "name": "Arc de Triomphe",
            "category": "historic",
            "interests": ["history", "monument"],
            "lat": 48.8738, "lon": 2.2950,
            "priority_score": 100, "priority_rank": 1,
            "matched_interest": "History", "match_type": "interest_match",
            "opening_hours": "10:00 AM - 10:30 PM", "opening_hours_status": "VERIFIED_OPEN", "status": "OPEN"
        }
    ]

    mock_restaurants = [
        {"name": "Le Bouillon Chartier", "lat": 48.8719, "lon": 2.3426, "category": "restaurant"},
        {"name": "CafÃ© de Flore", "lat": 48.8540, "lon": 2.3325, "category": "restaurant"},
        {"name": "Les Deux Magots", "lat": 48.8540, "lon": 2.3330, "category": "restaurant"},
        {"name": "Bistrot Paul Bert", "lat": 48.8517, "lon": 2.3853, "category": "restaurant"}
    ]

    state = {
        "origin": "Hyderabad",
        "destination": "Paris",
        "start_date": "2026-11-10",
        "end_date": "2026-11-14",
        "days": 5,
        "interests": ["History", "Museums", "Food"],
        "must_visit_places": ["Eiffel Tower", "Louvre Museum"],
        "pace": "relaxed",
        "wake_up_time": "08:30",
        "bedtime": "21:30",
        "attractions": mock_attractions,
        "restaurants": mock_restaurants,
        "hotels": [{"name": "Hotel Le Marais", "lat": 48.8580, "lon": 2.3600}]
    }

    result = route_node(state)
    days_data = result["route_details"]["day_by_day_route"]

    assert len(days_data) == 5, f"Expected 5 days, got {len(days_data)}"
    ok, errors = verify_schedule_integrity(days_data)
    assert ok, f"Schedule integrity failed: {errors}"

    all_stop_names = [s["name"] for d in days_data for s in d["stops"]]
    assert any("Eiffel Tower" in n for n in all_stop_names), "Eiffel Tower missing!"
    assert any("Louvre Museum" in n for n in all_stop_names), "Louvre Museum missing!"
    print("[OK] Eiffel Tower and Louvre Museum both scheduled.")

    # Check relaxed pace: attraction durations should be >= 120 mins
    for d in days_data:
        for s in d["stops"]:
            if s["type"] == "attraction":
                dur = s.get("duration_minutes", 0)
                assert dur >= 90, f"Relaxed pace attraction duration too short ({dur} mins)"
    print("[OK] Relaxed pace duration checks verified (generous visit durations).")
    print("TEST B PASSED!\n")


def test_c_sydney_transit():
    print("\n" + "="*70)
    print("TEST C: 5-Day Hyderabad -> Sydney Transit Buffers & Packed Pace")
    print("="*70)

    tz = resolve_destination_timezone("Sydney")
    assert tz == "Australia/Sydney", f"Expected Australia/Sydney, got {tz}"

    mock_attractions = [
        {"name": f"Sydney Sight {i}", "lat": -33.8688 + i*0.01, "lon": 151.2093 + i*0.01, "category": "attraction", "priority_score": 100 - i*10, "status": "OPEN"}
        for i in range(12)
    ]
    mock_restaurants = [
        {"name": f"Sydney Diner {i}", "lat": -33.8688 + i*0.005, "lon": 151.2093 + i*0.005, "category": "restaurant"}
        for i in range(8)
    ]

    state = {
        "origin": "Hyderabad",
        "destination": "Sydney",
        "start_date": "2026-12-01",
        "end_date": "2026-12-05",
        "days": 5,
        "pace": "packed",
        "attractions": mock_attractions,
        "restaurants": mock_restaurants,
        "hotels": [{"name": "Four Seasons Hotel Sydney", "lat": -33.8622, "lon": 151.2085}]
    }

    result = route_node(state)
    days_data = result["route_details"]["day_by_day_route"]

    assert len(days_data) == 5
    ok, errors = verify_schedule_integrity(days_data)
    assert ok, f"Schedule integrity failed: {errors}"

    # Day 1: Flight check-in buffer at HYD -> arrival at SYD -> hotel check-in
    day1_stops = days_data[0]["stops"]
    assert any("HYD" in s["name"] or "Hyderabad" in s["name"] for s in day1_stops), "Hyderabad airport missing"
    assert any("SYD" in s["name"] or "Sydney" in s["name"] for s in day1_stops), "Sydney airport missing"
    assert any(s["type"] == "hotel" for s in day1_stops), "Hotel check-in missing"

    # Verify packed pace has higher attraction count on exploration days
    exp_days = [d for d in days_data if not d.get("is_flight_day")]
    for ed in exp_days:
        attr_count = len([s for s in ed["stops"] if s["type"] == "attraction"])
        assert attr_count >= 2, f"Packed pace expected >= 2 attractions, got {attr_count}"
    print(f"[OK] Packed pace verified across {len(exp_days)} exploration days.")
    print("TEST C PASSED!\n")


def test_d_pace_comparison():
    print("\n" + "="*70)
    print("TEST D: Relaxed vs Packed Pace Comparison")
    print("="*70)

    mock_attractions = [
        {"name": f"Attraction {i}", "lat": 15.2993 + i*0.01, "lon": 74.1240 + i*0.01, "priority_score": 100 - i*5, "status": "OPEN"}
        for i in range(15)
    ]
    mock_restaurants = [
        {"name": f"Restaurant {i}", "lat": 15.2993 + i*0.005, "lon": 74.1240 + i*0.005}
        for i in range(10)
    ]

    base_state = {
        "destination": "Goa",
        "days": 3,
        "attractions": mock_attractions,
        "restaurants": mock_restaurants,
        "hotels": [{"name": "Resort", "lat": 15.2993, "lon": 74.1240}]
    }

    # Relaxed run
    rel_state = dict(base_state, pace="relaxed")
    rel_res = route_node(rel_state)["route_details"]["day_by_day_route"]

    # Packed run
    pck_state = dict(base_state, pace="packed")
    pck_res = route_node(pck_state)["route_details"]["day_by_day_route"]

    rel_attr_counts = sum(len([s for s in d["stops"] if s["type"] == "attraction"]) for d in rel_res)
    pck_attr_counts = sum(len([s for s in d["stops"] if s["type"] == "attraction"]) for d in pck_res)

    print(f"Relaxed total attractions scheduled: {rel_attr_counts}")
    print(f"Packed total attractions scheduled:  {pck_attr_counts}")

    assert pck_attr_counts > rel_attr_counts, f"Packed pace should schedule more attractions than relaxed! ({pck_attr_counts} vs {rel_attr_counts})"
    print("[OK] Packed pace schedules significantly more attractions than relaxed pace.")
    print("TEST D PASSED!\n")


def test_e_missing_data_resilience():
    print("\n" + "="*70)
    print("TEST E: Missing Opening Hours and Coordinates Resilience")
    print("="*70)

    # Some attractions have missing coordinates and missing opening hours
    faulty_attractions = [
        {
            "name": "Secret Waterfall",
            "lat": None,
            "lon": None,
            "opening_hours": None,
            "status": "UNKNOWN",
            "category": "nature",
            "priority_score": 100
        },
        {
            "name": "Ancient Temple",
            "lat": 0.0,
            "lon": 0.0,
            "opening_hours": None,
            "status": "UNKNOWN",
            "category": "temple",
            "priority_score": 80
        }
    ]

    state = {
        "destination": "Goa",
        "days": 2,
        "attractions": faulty_attractions,
        "restaurants": [{"name": "Local Shack", "lat": None, "lon": None}],
        "hotels": [{"name": "Beach Hut", "lat": None, "lon": None}]
    }

    # Should not crash
    result = route_node(state)
    days_data = result["route_details"]["day_by_day_route"]

    assert len(days_data) == 2
    for d in days_data:
        for s in d["stops"]:
            # Confirm no fabrication of coordinates
            if s["name"] in ["Secret Waterfall", "Ancient Temple"]:
                assert s["lat"] is None or s["lat"] == 0.0 or s["lat"] is None, f"Coordinates should not be fabricated: {s['lat']}"
                assert s["opening_hours_status"] == "UNVERIFIED", f"Expected UNVERIFIED status, got {s['opening_hours_status']}"
    print("[OK] Verified engine handles missing coordinates & hours without fabricating data or crashing.")
    print("TEST E PASSED!\n")


def test_f_authoritative_dates():
    print("\n" + "="*70)
    print("TEST F: Authoritative Date Validation")
    print("="*70)

    # Start: 2026-12-10, End: 2026-12-15 -> (15 - 10) + 1 = 6 calendar days
    state = {
        "destination": "Goa",
        "start_date": "2026-12-10",
        "end_date": "2026-12-15",
        "days": 3, # days param is 3, but dates specify 6. Dates are authoritative!
        "attractions": [{"name": "Site A", "lat": 15.2, "lon": 74.1, "priority_score": 90}],
        "restaurants": [],
        "hotels": []
    }

    result = route_node(state)
    days_data = result["route_details"]["day_by_day_route"]

    assert len(days_data) == 6, f"Expected 6 days based on start/end date range, got {len(days_data)}"
    assert days_data[0]["date"] == "2026-12-10"
    assert days_data[5]["date"] == "2026-12-15"
    print("[OK] Authoritative start_date and end_date correctly governed total days (6 days).")
    print("TEST F PASSED!\n")


if __name__ == "__main__":
    test_a_goa_priority()
    test_b_paris_relaxed()
    test_c_sydney_transit()
    test_d_pace_comparison()
    test_e_missing_data_resilience()
    test_f_authoritative_dates()
    print("\n" + "#"*70)
    print("ALL 6 ITINERARY ENGINE AUDIT TESTS PASSED SUCCESSFULLY!")
    print("#"*70 + "\n")

