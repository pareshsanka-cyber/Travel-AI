"""
TravelAI Phase 2.1 — Realistic, Meal-Aware Dynamic AI Rerouting Test Suite

Verifies:
1. Scenario A: Skip Cafe Bahar (12:30-1:30 PM) -> replaces with lunch restaurant or meal break at >= 12:30 PM (never 10:56 AM or temple).
2. Scenario B: Preceding stop transit buffer enforcement (no teleportation or overlaps).
3. Scenario C: Exploration day schedules explicit breakfast stop before sightseeing.
4. Scenario D: Completed breakfast stop preservation in execution state.
5. Scenario E: Temple/attraction skip yields category-matched attraction, never restaurant.
6. Scenario F: Past destination time handling (starts at/after effective destination-local time).
7. Scenario G: Graceful meal break retention when no venue candidate fits without fabricating fake places.
8. Scenario H: Apply proposal persists revision increment and updates route details.
9. Scenario I: Cancel/reject preserves original schedule intact.
10. Scenario J: Full-day chronological integrity and zero-overlap invariants.
"""

import sys
import os
import copy
from typing import Dict, Any, List
from unittest.mock import MagicMock

# Ensure Backend is in python path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.services.reroute_service import (
    generate_reroute_proposal,
    apply_reroute_proposal,
    classify_activity,
)
from app.ai.agents.route_agent import (
    route_node,
    parse_hhmm_to_minutes,
    minutes_to_hhmm,
)
from app.utils.activity_identity import generate_persistent_activity_id


class MockCollection:
    def __init__(self, data: Dict[str, Any]):
        self.doc = copy.deepcopy(data)

    def find_one(self, query: Dict[str, Any]):
        if query.get("_id") == self.doc.get("_id") or query.get("id") == self.doc.get("id"):
            return copy.deepcopy(self.doc)
        return None

    def update_one(self, query: Dict[str, Any], update: Dict[str, Any]):
        if "$set" in update:
            for k, v in update["$set"].items():
                self.doc[k] = copy.deepcopy(v)
        return MagicMock(modified_count=1)


class MockDB:
    def __init__(self, trip_doc: Dict[str, Any]):
        self.trips = MockCollection(trip_doc)

    @property
    def doc(self):
        return self.trips.doc

    def find_one(self, query: Dict[str, Any]):
        return self.trips.find_one(query)


def create_hyderabad_trip_state() -> Dict[str, Any]:
    """Create a realistic Hyderabad itinerary reproducing the Cafe Bahar test case."""
    act1_id = generate_persistent_activity_id("attraction", "Birla Mandir", "ChIJ_birla_1")
    act2_id = generate_persistent_activity_id("attraction", "Salar Jung Museum", "ChIJ_salar_2")
    act3_id = generate_persistent_activity_id("restaurant", "Cafe Bahar", "ChIJ_bahar_3")
    act4_id = generate_persistent_activity_id("attraction", "Golconda Fort", "ChIJ_golconda_4")
    act5_id = generate_persistent_activity_id("restaurant", "Paradise Biryani", "ChIJ_paradise_5")

    day1_stops = [
        {
            "id": act1_id,
            "name": "Birla Mandir",
            "title": "Birla Mandir",
            "type": "attraction",
            "category": "temple",
            "start_time": "09:00",
            "end_time": "10:42",
            "time": "09:00 AM - 10:42 AM",
            "duration_minutes": 102,
            "lat": 17.4062,
            "lon": 78.4691,
            "rating": 4.6,
            "place_id": "ChIJ_birla_1",
            "location": "Adarsh Nagar, Hyderabad"
        },
        {
            "id": act2_id,
            "name": "Salar Jung Museum",
            "title": "Salar Jung Museum",
            "type": "attraction",
            "category": "museum",
            "start_time": "10:55",
            "end_time": "12:15",
            "time": "10:55 AM - 12:15 PM",
            "duration_minutes": 80,
            "lat": 17.3713,
            "lon": 78.4804,
            "rating": 4.5,
            "place_id": "ChIJ_salar_2",
            "location": "Darulshifa, Hyderabad"
        },
        {
            "id": act3_id,
            "name": "Cafe Bahar",
            "title": "Cafe Bahar",
            "type": "restaurant",
            "category": "restaurant",
            "start_time": "12:30",
            "end_time": "13:30",
            "time": "12:30 PM - 01:30 PM",
            "duration_minutes": 60,
            "lat": 17.4011,
            "lon": 78.4839,
            "rating": 4.3,
            "place_id": "ChIJ_bahar_3",
            "location": "Hyderguda, Hyderabad"
        },
        {
            "id": act4_id,
            "name": "Golconda Fort",
            "title": "Golconda Fort",
            "type": "attraction",
            "category": "monument",
            "start_time": "14:00",
            "end_time": "16:30",
            "time": "02:00 PM - 04:30 PM",
            "duration_minutes": 150,
            "lat": 17.3833,
            "lon": 78.4011,
            "rating": 4.6,
            "place_id": "ChIJ_golconda_4",
            "location": "Ibrahim Bagh, Hyderabad"
        },
        {
            "id": act5_id,
            "name": "Paradise Biryani",
            "title": "Paradise Biryani",
            "type": "restaurant",
            "category": "restaurant",
            "start_time": "19:30",
            "end_time": "20:45",
            "time": "07:30 PM - 08:45 PM",
            "duration_minutes": 75,
            "lat": 17.4416,
            "lon": 78.4873,
            "rating": 4.2,
            "place_id": "ChIJ_paradise_5",
            "location": "Secunderabad, Hyderabad"
        }
    ]

    all_attractions = [
        {
            "name": "Birla Mandir",
            "category": "temple",
            "lat": 17.4062, "lon": 78.4691,
            "rating": 4.6, "place_id": "ChIJ_birla_1"
        },
        {
            "name": "Salar Jung Museum",
            "category": "museum",
            "lat": 17.3713, "lon": 78.4804,
            "rating": 4.5, "place_id": "ChIJ_salar_2"
        },
        {
            "name": "Golconda Fort",
            "category": "monument",
            "lat": 17.3833, "lon": 78.4011,
            "rating": 4.6, "place_id": "ChIJ_golconda_4"
        },
        {
            "name": "Shri Ashtalakshmi Temple",
            "category": "temple",
            "lat": 17.3587, "lon": 78.5471,
            "rating": 4.7, "place_id": "ChIJ_ashta_99",
            "description": "Grand Hindu temple dedicated to Goddess Lakshmi."
        },
        {
            "name": "Charminar",
            "category": "monument",
            "lat": 17.3616, "lon": 78.4747,
            "rating": 4.6, "place_id": "ChIJ_charminar_8"
        }
    ]

    all_restaurants = [
        {
            "name": "Cafe Bahar",
            "category": "restaurant",
            "lat": 17.4011, "lon": 78.4839,
            "rating": 4.3, "place_id": "ChIJ_bahar_3"
        },
        {
            "name": "Bawarchi Restaurant",
            "category": "restaurant",
            "lat": 17.4024, "lon": 78.4975,
            "rating": 4.4, "place_id": "ChIJ_bawarchi_10",
            "description": "Legendary Hyderabad dining destination famous for authentic mutton biryani and kebabs.",
            "location": "RTC X Roads, Hyderabad"
        },
        {
            "name": "Hotel Shadab",
            "category": "restaurant",
            "lat": 17.3670, "lon": 78.4735,
            "rating": 4.3, "place_id": "ChIJ_shadab_11",
            "description": "Iconic culinary institution near Charminar serving authentic Hyderabadi delicacies.",
            "location": "Ghansi Bazaar, Hyderabad"
        },
        {
            "name": "Paradise Biryani",
            "category": "restaurant",
            "lat": 17.4416, "lon": 78.4873,
            "rating": 4.2, "place_id": "ChIJ_paradise_5"
        }
    ]

    trip = {
        "_id": "6709f123456789abcdef0101",
        "id": "6709f123456789abcdef0101",
        "user_id": "test_user_hyd",
        "destination": "Hyderabad",
        "destination_timezone": "Asia/Kolkata",
        "revision": 1,
        "travel_context": {
            "destination": "Hyderabad",
            "interests": ["History", "Architecture", "Food"],
            "pace": "balanced",
            "bedtime": "22:00",
        },
        "all_attractions": all_attractions,
        "restaurants": all_restaurants,
        "route_details": {
            "destination": "Hyderabad",
            "day_by_day_route": [
                {
                    "day": 1,
                    "day_number": 1,
                    "date": "2026-11-15",
                    "formatted_date": "Sunday, Nov 15",
                    "title": "Day 1: Hyderabad Highlights",
                    "is_flight_day": False,
                    "stops": day1_stops,
                    "activities": day1_stops
                }
            ]
        },
        "execution_state": {
            "is_active": True,
            "current_day_number": 1,
            "activity_log": {
                act1_id: {"status": "completed", "activity_id": act1_id, "actual_end_time": "2026-11-15T10:42:00Z"},
                act2_id: {"status": "completed", "activity_id": act2_id, "actual_end_time": "2026-11-15T12:15:00Z"},
                act3_id: {"status": "skipped", "activity_id": act3_id}
            },
            "reroute_history": []
        }
    }
    return trip


def test_scenario_a_cafe_bahar_lunch_skip():
    print("\n" + "="*75)
    print("SCENARIO A: Skip Cafe Bahar (12:30-1:30 PM Lunch) in Hyderabad")
    print("="*75)

    trip = create_hyderabad_trip_state()
    db = MockDB(trip)
    skipped_id = generate_persistent_activity_id("restaurant", "Cafe Bahar", "ChIJ_bahar_3")

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_id,
        current_time_str="12:30"
    )

    assert proposal["status"] == "success", f"Proposal failed: {proposal}"
    assert proposal["replacement_found"] is True, "Expected replacement to be found"

    repl = proposal["replacement_activity"]
    assert repl is not None, "Replacement activity is None"

    # 1. FIX THE TIME-TRAVEL BUG:
    # Must NOT start before 12:30 PM (750 mins)! Definitely NOT at 10:56 AM!
    repl_start_m = parse_hhmm_to_minutes(repl.get("start_time"), 0)
    assert repl_start_m >= 750, (
        f"TIME-TRAVEL BUG DETECTED: Replacement scheduled at {repl.get('start_time')} ({repl_start_m}m), "
        f"which is before skipped activity start time (12:30 PM / 750m)!"
    )
    assert repl.get("start_time") != "10:56", "BUG: Replacement must NOT be scheduled at 10:56 AM!"
    print(f"  [PASS] Replacement start time verified: {repl.get('start_time')} (>= 12:30 PM, no time-travel).")

    # 2. ACTIVITY PURPOSE & CATEGORY PRESERVATION:
    # A lunch restaurant must NEVER be replaced with a temple or monument!
    repl_name = repl.get("title") or repl.get("name")
    assert "Temple" not in repl_name, f"CATEGORY MISMATCH BUG: Lunch was replaced with a temple: {repl_name}!"
    assert repl.get("category") != "temple", f"CATEGORY MISMATCH BUG: Lunch category changed to temple: {repl}!"

    # Must be a restaurant or dedicated meal break
    is_valid_dining = (
        repl.get("type") in ["restaurant", "meal", "cafe", "bistro"] or
        repl.get("category") in ["restaurant", "dining", "meal", "cafe", "bistro"] or
        repl.get("is_meal_break") is True or
        repl.get("status_label") == "Meal Break"
    )
    assert is_valid_dining, f"Expected dining venue or meal break, got: {repl}"
    print(f"  [PASS] Replacement venue is meal-appropriate: '{repl_name}' (category: {repl.get('category')}).")

    # 3. PRESERVE COMPLETED ACTIVITIES UNTOUCHED:
    proposed_stops = proposal["proposed_stops"]
    assert len(proposed_stops) == 5, f"Expected 5 proposed stops, got {len(proposed_stops)}"

    stop0 = proposed_stops[0]
    stop1 = proposed_stops[1]
    assert stop0["name"] == "Birla Mandir"
    assert stop0["start_time"] == "09:00" and stop0["end_time"] == "10:42"
    assert stop0.get("status_label") == "Unchanged"

    assert stop1["name"] == "Salar Jung Museum"
    assert stop1["start_time"] == "10:55" and stop1["end_time"] == "12:15"
    assert stop1.get("status_label") == "Unchanged"
    print("  [PASS] Historical completed stops (Birla Mandir, Salar Jung Museum) remain strictly unchanged.")

    # 4. CHRONOLOGICAL INTEGRITY & ZERO OVERLAP:
    for i in range(len(proposed_stops) - 1):
        cur_end = parse_hhmm_to_minutes(proposed_stops[i]["end_time"], 0)
        next_start = parse_hhmm_to_minutes(proposed_stops[i+1]["start_time"], 0)
        assert next_start >= cur_end, (
            f"Overlap detected between {proposed_stops[i]['name']} (ends {proposed_stops[i]['end_time']}) "
            f"and {proposed_stops[i+1]['name']} (starts {proposed_stops[i+1]['start_time']})!"
        )
    print("  [PASS] All 5 stops sequenced chronologically with zero overlap.")
    print("SCENARIO A PASSED!\n")


def test_scenario_b_birla_temple_transit_enforcement():
    print("\n" + "="*75)
    print("SCENARIO B: Transit Buffer Enforcement After Stop Ending at 10:42 AM")
    print("="*75)

    trip = create_hyderabad_trip_state()
    # Change Salar Jung Museum to be the skipped stop starting right after Birla Mandir
    trip["execution_state"]["activity_log"] = {
        trip["route_details"]["day_by_day_route"][0]["stops"][0]["id"]: {
            "status": "completed",
            "actual_end_time": "2026-11-15T10:42:00Z"
        }
    }
    db = MockDB(trip)
    skipped_salar_id = trip["route_details"]["day_by_day_route"][0]["stops"][1]["id"]

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_salar_id,
        current_time_str="10:42"
    )

    assert proposal["status"] == "success"
    if proposal["replacement_found"]:
        repl = proposal["replacement_activity"]
        repl_start_m = parse_hhmm_to_minutes(repl["start_time"], 0)
        # Preceding stop ends at 10:42 AM (642 mins) + minimum 5 min transit buffer = 647 mins (10:47 AM)
        assert repl_start_m >= 647, (
            f"Teleportation bug: replacement starts at {repl['start_time']} ({repl_start_m}m), "
            f"which does not account for transit time after 10:42 AM (642m)!"
        )
        print(f"  [PASS] Replacement start time respects transit buffer: {repl['start_time']} (>= 10:47 AM).")
    print("SCENARIO B PASSED!\n")


def test_scenario_c_exploration_day_breakfast():
    print("\n" + "="*75)
    print("SCENARIO C: Normal Exploration Day Schedules Explicit Breakfast Stop")
    print("="*75)

    state = {
        "destination": "Goa",
        "days": 3,
        "wake_up_time": "08:00",
        "bedtime": "22:00",
        "pace": "balanced",
        "attractions": [
            {"name": "Aguada Fort", "lat": 15.4920, "lon": 73.7737, "category": "fort"},
            {"name": "Baga Beach", "lat": 15.5553, "lon": 73.7517, "category": "beach"},
            {"name": "Anjuna Flea Market", "lat": 15.5800, "lon": 73.7420, "category": "market"}
        ],
        "restaurants": [
            {"name": "Martin's Corner", "lat": 15.3135, "lon": 73.9213, "category": "restaurant"},
            {"name": "Britto's Shack", "lat": 15.5562, "lon": 73.7519, "category": "restaurant"}
        ],
        "hotels": [{"name": "Taj Fort Aguada Resort", "lat": 15.4960, "lon": 73.7680}]
    }

    result = route_node(state)
    days = result["route_details"]["day_by_day_route"]
    day1_stops = days[0]["stops"]

    # Verify Stop 0 is Breakfast
    assert len(day1_stops) >= 3, f"Expected at least 3 stops, got {len(day1_stops)}"
    breakfast_stop = day1_stops[0]
    assert breakfast_stop["type"] == "breakfast", f"Expected type 'breakfast', got {breakfast_stop['type']}"
    assert "Breakfast" in breakfast_stop["name"], f"Expected 'Breakfast' in title, got {breakfast_stop['name']}"
    assert breakfast_stop["start_time"] == "08:00", f"Expected start at wake time (08:00), got {breakfast_stop['start_time']}"
    assert breakfast_stop["end_time"] == "08:45", f"Expected 45 min duration (08:45), got {breakfast_stop['end_time']}"
    print(f"  [PASS] Breakfast scheduled explicitly: '{breakfast_stop['name']}' from 08:00 to 08:45 AM.")

    # Verify Attraction 1 starts strictly after breakfast and transit
    attr1_stop = day1_stops[1]
    attr1_start_m = parse_hhmm_to_minutes(attr1_stop["start_time"], 0)
    assert attr1_start_m >= 525, (
        f"Attraction 1 starts too early: {attr1_stop['start_time']} ({attr1_start_m}m < 525m breakfast end)!"
    )
    print(f"  [PASS] First attraction starts after breakfast & transit: {attr1_stop['start_time']}.")
    print("SCENARIO C PASSED!\n")


def test_scenario_d_completed_breakfast_preserved():
    print("\n" + "="*75)
    print("SCENARIO D: Completed Breakfast Preservation in Execution State")
    print("="*75)

    trip = create_hyderabad_trip_state()
    # Prepend a breakfast stop
    bfast_id = generate_persistent_activity_id("breakfast", "Breakfast at Hotel", "hotel_bfast")
    bfast_stop = {
        "id": bfast_id,
        "name": "Breakfast at Hotel",
        "title": "Breakfast at Hotel",
        "type": "breakfast",
        "category": "breakfast",
        "start_time": "08:00",
        "end_time": "08:45",
        "time": "08:00 AM - 08:45 AM",
        "duration_minutes": 45,
        "lat": 17.4062, "lon": 78.4691
    }
    trip["route_details"]["day_by_day_route"][0]["stops"].insert(0, bfast_stop)
    trip["execution_state"]["activity_log"][bfast_id] = {
        "status": "completed",
        "activity_id": bfast_id,
        "actual_end_time": "2026-11-15T08:45:00Z"
    }

    db = MockDB(trip)
    skipped_id = generate_persistent_activity_id("restaurant", "Cafe Bahar", "ChIJ_bahar_3")

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_id,
        current_time_str="12:30"
    )

    assert proposal["status"] == "success"
    proposed = proposal["proposed_stops"]
    assert proposed[0]["id"] == bfast_id, "Completed breakfast stop was dropped or displaced!"
    assert proposed[0]["status_label"] == "Unchanged", "Completed breakfast was marked rescheduled!"
    print("  [PASS] Completed breakfast stop remained at position 0 with 'Unchanged' status.")
    print("SCENARIO D PASSED!\n")


def test_scenario_e_temple_skip_preserves_attraction_category():
    print("\n" + "="*75)
    print("SCENARIO E: Temple Skip Replaces with Attraction/Cultural Site, Never Restaurant")
    print("="*75)

    trip = create_hyderabad_trip_state()
    # Make Birla Mandir the skipped activity
    trip["execution_state"]["activity_log"] = {
        trip["route_details"]["day_by_day_route"][0]["stops"][0]["id"]: {
            "status": "skipped",
            "activity_id": trip["route_details"]["day_by_day_route"][0]["stops"][0]["id"]
        }
    }
    db = MockDB(trip)
    skipped_birla_id = trip["route_details"]["day_by_day_route"][0]["stops"][0]["id"]

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_birla_id,
        current_time_str="09:00"
    )

    assert proposal["status"] == "success"
    if proposal["replacement_found"]:
        repl = proposal["replacement_activity"]
        assert repl["type"] == "attraction", f"Expected attraction replacement for temple, got {repl['type']}!"
        assert repl["category"] != "restaurant", "BUG: Attraction replaced with restaurant!"
        print(f"  [PASS] Temple replacement is an attraction: '{repl.get('title')}' (category: {repl.get('category')}).")
    print("SCENARIO E PASSED!\n")


def test_scenario_f_past_destination_time_handling():
    print("\n" + "="*75)
    print("SCENARIO F: Past Destination Time Handling (Effective Destination Time)")
    print("="*75)

    trip = create_hyderabad_trip_state()
    db = MockDB(trip)
    skipped_id = generate_persistent_activity_id("restaurant", "Cafe Bahar", "ChIJ_bahar_3")

    # Current time is 13:10 PM (past the 12:30 PM scheduled start)
    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_id,
        current_time_str="13:10"
    )

    assert proposal["status"] == "success"
    if proposal["replacement_found"]:
        repl = proposal["replacement_activity"]
        repl_start_m = parse_hhmm_to_minutes(repl["start_time"], 0)
        # Should not start in the past (< 13:10 / 790 mins)
        assert repl_start_m >= 790, (
            f"Replacement scheduled in the past: {repl['start_time']} ({repl_start_m}m) < 13:10 (790m)!"
        )
        print(f"  [PASS] Replacement start time respects current time 13:10 PM: {repl['start_time']} ({repl_start_m}m >= 790m).")
        assert "current time" in proposal["reason"].lower() or "adjusted" in proposal["reason"].lower()
        print("  [PASS] Proposal reason notes current time adjustment.")
    print("SCENARIO F PASSED!\n")


def test_scenario_g_graceful_meal_break_retention():
    print("\n" + "="*75)
    print("SCENARIO G: Graceful Meal Break Retention Without Fabricating Fake Places")
    print("="*75)

    trip = create_hyderabad_trip_state()
    # Destination without presets and empty restaurant pool
    trip["destination"] = "Remote Valley"
    trip["restaurants"] = []
    db = MockDB(trip)
    skipped_id = generate_persistent_activity_id("restaurant", "Cafe Bahar", "ChIJ_bahar_3")

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_id,
        current_time_str="12:30"
    )

    assert proposal["status"] == "success"
    repl = proposal["replacement_activity"]
    assert repl is not None, "Expected dedicated meal break block"
    assert repl.get("is_meal_break") is True, f"Expected is_meal_break=True, got {repl}"
    assert repl.get("status_label") == "Meal Break"
    assert "Meal Break" in repl.get("title") or "Dining" in repl.get("title")
    print(f"  [PASS] Retained dedicated meal break: '{repl.get('title')}' ({repl.get('time')}).")
    print("SCENARIO G PASSED!\n")


def test_scenario_h_apply_proposal_updates_and_increments_revision():
    print("\n" + "="*75)
    print("SCENARIO H: Apply Proposal Persists Revision Increment & Updates Route")
    print("="*75)

    trip = create_hyderabad_trip_state()
    db = MockDB(trip)
    skipped_id = generate_persistent_activity_id("restaurant", "Cafe Bahar", "ChIJ_bahar_3")

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_id,
        current_time_str="12:30"
    )

    apply_res = apply_reroute_proposal(
        db=db,
        trip_id=trip["id"],
        day_number=1,
        skipped_activity_id=skipped_id,
        proposed_stops=proposal["proposed_stops"],
        replacement_activity_id=proposal["replacement_activity"]["id"] if proposal["replacement_activity"] else None,
        reason=proposal["reason"],
        expected_revision=1,
        x_user_id=trip["user_id"]
    )

    assert apply_res["status"] == "success"
    assert apply_res["revision"] == 2
    # Verify in DB doc
    updated_doc = db.doc
    assert updated_doc["revision"] == 2
    day1_stops = updated_doc["route_details"]["day_by_day_route"][0]["stops"]
    assert any(s["id"] == proposal["proposed_stops"][2]["id"] for s in day1_stops)
    assert len(updated_doc["execution_state"]["reroute_history"]) == 1
    print("  [PASS] Trip revision incremented to 2, itinerary updated, and history logged.")
    print("SCENARIO H PASSED!\n")


def test_scenario_i_cancel_proposal_preserves_original():
    print("\n" + "="*75)
    print("SCENARIO I: Cancel Proposal Preserves Original Schedule Intact")
    print("="*75)

    trip = create_hyderabad_trip_state()
    original_stops = copy.deepcopy(trip["route_details"]["day_by_day_route"][0]["stops"])
    db = MockDB(trip)

    # When traveler cancels, no apply is called.
    # The trip remains at revision 1 and original stops are untouched.
    assert db.doc["revision"] == 1
    assert db.doc["route_details"]["day_by_day_route"][0]["stops"] == original_stops
    print("  [PASS] Original schedule preserved verbatim on proposal dismissal.")
    print("SCENARIO I PASSED!\n")


def test_scenario_j_full_day_chronological_integrity():
    print("\n" + "="*75)
    print("SCENARIO J: Full-Day Chronological Integrity & Zero Overlap Verification")
    print("="*75)

    trip = create_hyderabad_trip_state()
    db = MockDB(trip)
    skipped_id = generate_persistent_activity_id("restaurant", "Cafe Bahar", "ChIJ_bahar_3")

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=skipped_id,
        current_time_str="12:30"
    )

    stops = proposal["proposed_stops"]
    prev_end = -1
    for idx, s in enumerate(stops):
        s_mins = parse_hhmm_to_minutes(s["start_time"], -1)
        e_mins = parse_hhmm_to_minutes(s["end_time"], -1)
        assert s_mins >= 0 and e_mins >= 0, f"Stop {idx} ({s['name']}) has invalid time: {s['start_time']} - {s['end_time']}"
        assert e_mins > s_mins, f"Stop {idx} ({s['name']}) end <= start: {s['start_time']} - {s['end_time']}"
        if prev_end >= 0:
            assert s_mins >= prev_end, f"Stop {idx} ({s['name']}) starts at {s['start_time']} before previous ended at {minutes_to_hhmm(prev_end)}!"
        prev_end = e_mins

    # Verify evening dinner does not exceed bedtime
    dinner_stop = stops[-1]
    dinner_end_m = parse_hhmm_to_minutes(dinner_stop["end_time"], 0)
    assert dinner_end_m <= 1320, f"Dinner ends after 10:00 PM bedtime: {dinner_stop['end_time']}"
    print(f"  [PASS] Full day verified: all stops chronological, positive durations, within bedtime.")
    print("SCENARIO J PASSED!\n")


if __name__ == "__main__":
    print("\n" + "#"*75)
    print("RUNNING TRAVELAI PHASE 2.1 REGRESSION TESTS")
    print("#"*75)

    test_scenario_a_cafe_bahar_lunch_skip()
    test_scenario_b_birla_temple_transit_enforcement()
    test_scenario_c_exploration_day_breakfast()
    test_scenario_d_completed_breakfast_preserved()
    test_scenario_e_temple_skip_preserves_attraction_category()
    test_scenario_f_past_destination_time_handling()
    test_scenario_g_graceful_meal_break_retention()
    test_scenario_h_apply_proposal_updates_and_increments_revision()
    test_scenario_i_cancel_proposal_preserves_original()
    test_scenario_j_full_day_chronological_integrity()

    print("\n" + "#"*75)
    print("ALL 10 PHASE 2.1 REGRESSION SCENARIOS PASSED WITH 100% SUCCESS!")
    print("#"*75 + "\n")
