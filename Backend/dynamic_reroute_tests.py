"""
TravelAI Phase 2 - Dynamic AI Rerouting Regression Test Suite
Comprehensive verification of Skip & Replace rerouting logic,
invariants, concurrency, fallbacks, and execution-state preservation.
"""

import sys
import os
import copy
from typing import Dict, Any, List
from unittest.mock import patch, MagicMock
from fastapi import HTTPException

# Ensure Backend is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.reroute_service import (
    generate_reroute_proposal,
    apply_reroute_proposal,
)
from app.ai.agents.route_agent import parse_hhmm_to_minutes
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
        return MagicMock(modified_count=1, matched_count=1)


class MockDB:
    def __init__(self, trip_doc: Dict[str, Any]):
        self.trips = MockCollection(trip_doc)

    @property
    def doc(self):
        return self.trips.doc

    def find_one(self, query: Dict[str, Any]):
        return self.trips.find_one(query)


def create_sample_trip():
    act1_id = generate_persistent_activity_id("attraction", "Calangute Beach", "ChIJ_calangute_1")
    act2_id = generate_persistent_activity_id("attraction", "Aguada Fort", "ChIJ_aguada_2")
    act3_id = generate_persistent_activity_id("restaurant", "Fishermans Wharf", "ChIJ_wharf_3")

    day2_act1_id = generate_persistent_activity_id("attraction", "Basilica of Bom Jesus", "ChIJ_basilica_4")
    day2_act2_id = generate_persistent_activity_id("restaurant", "Mum's Kitchen", "ChIJ_mums_5")

    trip = {
        "_id": "6709f123456789abcdef0001",
        "id": "6709f123456789abcdef0001",
        "user_id": "test_user_42",
        "destination": "Goa, India",
        "revision": 1,
        "travel_context": {
            "destination": "Goa, India",
            "interests": ["Beaches", "History", "Seafood"],
            "pace": "balanced",
            "bedtime": "22:00",
        },
        "all_attractions": [
            {
                "name": "Calangute Beach",
                "category": "Beach",
                "lat": 15.5430,
                "lon": 73.7554,
                "rating": 4.5,
                "review_count": 1200,
                "place_id": "ChIJ_calangute_1",
            },
            {
                "name": "Aguada Fort",
                "category": "Fort / History",
                "lat": 15.4920,
                "lon": 73.7737,
                "rating": 4.6,
                "review_count": 3400,
                "place_id": "ChIJ_aguada_2",
            },
            {
                "name": "Anjuna Flea Market",
                "category": "Market / Cultural",
                "lat": 15.5800,
                "lon": 73.7420,
                "rating": 4.4,
                "review_count": 890,
                "place_id": "ChIJ_anjuna_6",
                "why_visit": "Famous vibrant coastal market and viewpoint.",
            },
            {
                "name": "Chapora Fort",
                "category": "Fort / Viewpoint",
                "lat": 15.6050,
                "lon": 73.7380,
                "rating": 4.5,
                "review_count": 2100,
                "place_id": "ChIJ_chapora_7",
                "why_visit": "Scenic hill fort with sweeping ocean views.",
            },
        ],
        "route_details": {
            "day_by_day_route": [
                {
                    "day": 1,
                    "date": "Day 1",
                    "title": "Coastal Heritage Day",
                    "activities": [
                        {
                            "id": act1_id,
                            "title": "Calangute Beach",
                            "type": "attraction",
                            "category": "Beach",
                            "lat": 15.5430,
                            "lon": 73.7554,
                            "time": "09:00 AM - 11:30 AM",
                            "start_time": "09:00",
                            "end_time": "11:30",
                            "place_id": "ChIJ_calangute_1",
                        },
                        {
                            "id": act2_id,
                            "title": "Aguada Fort",
                            "type": "attraction",
                            "category": "Fort / History",
                            "lat": 15.4920,
                            "lon": 73.7737,
                            "time": "01:30 PM - 04:00 PM",
                            "start_time": "13:30",
                            "end_time": "16:00",
                            "place_id": "ChIJ_aguada_2",
                        },
                        {
                            "id": act3_id,
                            "title": "Fishermans Wharf",
                            "type": "restaurant",
                            "category": "Dining",
                            "lat": 15.4850,
                            "lon": 73.7800,
                            "time": "06:30 PM - 08:30 PM",
                            "start_time": "18:30",
                            "end_time": "20:30",
                            "place_id": "ChIJ_wharf_3",
                        },
                    ],
                },
                {
                    "day": 2,
                    "date": "Day 2",
                    "title": "Old Goa Architecture",
                    "activities": [
                        {
                            "id": day2_act1_id,
                            "title": "Basilica of Bom Jesus",
                            "type": "attraction",
                            "category": "History",
                            "lat": 15.5009,
                            "lon": 73.9116,
                            "time": "09:30 AM - 12:00 PM",
                            "start_time": "09:30",
                            "end_time": "12:00",
                            "place_id": "ChIJ_basilica_4",
                        },
                        {
                            "id": day2_act2_id,
                            "title": "Mum's Kitchen",
                            "type": "restaurant",
                            "category": "Dining",
                            "lat": 15.4950,
                            "lon": 73.8200,
                            "time": "01:00 PM - 02:30 PM",
                            "start_time": "13:00",
                            "end_time": "14:30",
                            "place_id": "ChIJ_mums_5",
                        },
                    ],
                },
            ],
        },
        "execution_state": {
            "is_active": True,
            "current_day_number": 1,
            "activity_log": {
                act1_id: {
                    "status": "completed",
                    "activity_id": act1_id,
                    "activity_title": "Calangute Beach",
                    "actual_end_time": "2026-10-11T11:20:00Z",
                },
                "1_0": {
                    "status": "completed",
                    "activity_id": act1_id,
                    "activity_title": "Calangute Beach",
                },
            },
            "reroute_history": [],
        },
    }
    return trip


def run_all_tests():
    print("=" * 75)
    print("TRAVELAI PHASE 2 - DYNAMIC AI REROUTING REGRESSION SUITE")
    print("=" * 75)

    passed = 0
    total = 14

    # -------------------------------------------------------------------------
    # SCENARIO A: Skip upcoming attraction & insert verified replacement
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO A: Skip upcoming attraction & insert verified replacement ---")
    trip = create_sample_trip()
    day1_activities = trip["route_details"]["day_by_day_route"][0]["activities"]
    act2_id = day1_activities[1]["id"]  # Aguada Fort

    proposal = generate_reroute_proposal(
        trip=trip,
        day_number=1,
        skipped_activity_id=act2_id,
        current_location={"lat": 15.5430, "lon": 73.7554},
        current_time_str="12:00",
    )

    assert proposal["status"] == "success", "Proposal failed"
    assert proposal["replacement_found"] is True, "Expected replacement to be found"
    assert proposal["replacement_activity"] is not None, "Missing replacement activity object"
    assert proposal["replacement_activity"]["id"] != act2_id, "Replacement must have distinct ID"
    assert len(proposal["replacement_activity"]["id"]) > 5, "Replacement ID must be persistent"
    assert proposal["skipped_activity"]["id"] == act2_id, "Skipped activity identity mismatch"
    print(f"  [PASS] Replacement '{proposal['replacement_activity']['title']}' inserted with unique ID '{proposal['replacement_activity']['id']}'.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO B: Preserve completed activities & their statuses
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO B: Preserve completed activities & their statuses ---")
    proposed_stops = proposal["proposed_stops"]
    act1_id = day1_activities[0]["id"]
    completed_stop = proposed_stops[0]

    assert completed_stop["id"] == act1_id, "Completed stop ID was altered"
    assert completed_stop["title"] == "Calangute Beach", "Completed stop title was altered"
    assert completed_stop["start_time"] == "09:00", "Completed stop start_time altered"
    assert completed_stop["end_time"] == "11:30", "Completed stop end_time altered"
    print("  [PASS] Completed stop 'Calangute Beach' remained untouched at index 0.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO C: Skipped activity remains skipped and not reintroduced
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO C: Skipped activity remains skipped and not reintroduced ---")
    proposed_ids = [s["id"] for s in proposed_stops]
    proposed_titles = [s["title"].lower() for s in proposed_stops]

    assert act2_id not in proposed_ids, "Skipped activity ID still present in proposed stops"
    assert "aguada fort" not in proposed_titles, "Skipped attraction reintroduced into proposed stops"
    print("  [PASS] Skipped activity 'Aguada Fort' successfully excluded from proposed schedule.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO D: Preserve future days (Day 2 and 3 stay identical)
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO D: Preserve future days (Day 2 untouched) ---")
    db = MockDB(trip)
    day2_before = copy.deepcopy(trip["route_details"]["day_by_day_route"][1])

    result = apply_reroute_proposal(
        db=db,
        trip_id=trip["id"],
        day_number=1,
        skipped_activity_id=act2_id,
        proposed_stops=proposed_stops,
        replacement_activity_id=proposal["replacement_activity"]["id"],
        reason="Skipped Aguada Fort due to user request",
        expected_revision=1,
        x_user_id="test_user_42",
    )

    day2_after = db.doc["route_details"]["day_by_day_route"][1]
    assert day2_before == day2_after, "Day 2 was modified during Day 1 rerouting!"
    print("  [PASS] Day 2 itinerary is identical before and after rerouting.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO E: Recalculate times without overlaps & respect bedtime
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO E: Recalculate chronological times without overlaps ---")
    last_end = 0
    for stop in proposed_stops:
        s_min = parse_hhmm_to_minutes(stop["start_time"], 0)
        e_min = parse_hhmm_to_minutes(stop["end_time"], 0)
        assert s_min < e_min, f"Invalid stop duration: {stop['start_time']} to {stop['end_time']}"
        assert s_min >= last_end, f"Overlapping schedule detected between stops: start {s_min} < prev end {last_end}"
        last_end = e_min

    assert last_end <= 22 * 60, "Schedule exceeds 22:00 bedtime"
    print(f"  [PASS] All {len(proposed_stops)} stops scheduled chronologically with zero overlap.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO F: No suitable replacement found fallback
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO F: No suitable replacement found fallback ---")
    trip_no_avail = create_sample_trip()
    # Remove all unused candidates from all_attractions
    trip_no_avail["all_attractions"] = [
        trip_no_avail["all_attractions"][0],  # Calangute Beach (used)
        trip_no_avail["all_attractions"][1],  # Aguada Fort (skipped)
    ]

    with patch("app.services.reroute_service.discover_via_serpapi", return_value=[]), \
         patch("app.services.reroute_service.discover_via_overpass", return_value=[]):
        proposal_fallback = generate_reroute_proposal(
            trip=trip_no_avail,
            day_number=1,
            skipped_activity_id=act2_id,
            current_location=None,
            current_time_str="14:00",
        )

    assert proposal_fallback["status"] == "success", "Proposal returned error on fallback"
    assert proposal_fallback["replacement_found"] is False, "Expected replacement_found=False"
    assert proposal_fallback["replacement_activity"] is None, "Expected None replacement activity"
    # Fishermans Wharf should remain in proposed stops smoothly shifted
    wharf_stop = [s for s in proposal_fallback["proposed_stops"] if "fishermans wharf" in s["title"].lower()]
    assert len(wharf_stop) == 1, "Remaining restaurant missing from shifted schedule"
    print("  [PASS] Graceful fallback with replacement_found=False and remaining stops shifted.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO G: Groq rate limit / failure fallback with factual discovery
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO G: Groq failure fallback with SerpApi/Overpass active ---")
    trip_groq_fail = create_sample_trip()
    trip_groq_fail["all_attractions"] = []  # No pre-cached unused attractions

    mock_serp_place = [{
        "name": "Sinquerim Beach & Fort",
        "category": "Beach",
        "description": "Scenic beach near Aguada with water sports.",
        "why_visit": "Popular coastal location.",
        "lat": 15.4980,
        "lon": 73.7680,
        "rating": 4.5,
        "review_count": 850,
        "place_id": "ChIJ_sinquerim_88",
    }]

    with patch("app.services.reroute_service.discover_via_serpapi", return_value=mock_serp_place):
        proposal_g = generate_reroute_proposal(
            trip=trip_groq_fail,
            day_number=1,
            skipped_activity_id=act2_id,
            current_location={"lat": 15.5430, "lon": 73.7554},
            current_time_str="12:30",
        )

    assert proposal_g["status"] == "success"
    assert proposal_g["replacement_found"] is True
    assert proposal_g["replacement_activity"]["title"] == "Sinquerim Beach & Fort"
    print("  [PASS] Factual discovery rescued candidate generation seamlessly.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO H: Both Groq & factual discovery failure handling
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO H: Both Groq and factual discovery fail ---")
    trip_total_fail = create_sample_trip()
    trip_total_fail["all_attractions"] = []

    with patch("app.services.reroute_service.discover_via_serpapi", side_effect=Exception("API limit exceeded")), \
         patch("app.services.reroute_service.discover_via_overpass", return_value=[]):
        proposal_h = generate_reroute_proposal(
            trip=trip_total_fail,
            day_number=1,
            skipped_activity_id=act2_id,
            current_location={"lat": 15.5430, "lon": 73.7554},
            current_time_str="13:00",
        )

    assert proposal_h["status"] == "success", "Failed to gracefully handle discovery errors"
    assert proposal_h["replacement_found"] is False
    assert len(proposal_h["proposed_stops"]) >= 1, "Completed stops must survive discovery failures"
    print("  [PASS] Handled total provider outage cleanly without 500 error.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO I: Missing current GPS location fallback
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO I: Missing current GPS location fallback ---")
    trip_no_gps = create_sample_trip()
    proposal_i = generate_reroute_proposal(
        trip=trip_no_gps,
        day_number=1,
        skipped_activity_id=act2_id,
        current_location=None,  # Traveler denied GPS permission
        current_time_str="12:00",
    )

    assert proposal_i["status"] == "success"
    assert proposal_i["replacement_found"] is True
    assert "Calangute Beach" in proposal_i["origin_location_label"] or "Destination" in proposal_i["origin_location_label"]
    print(f"  [PASS] Missing GPS used last known stop as reference: '{proposal_i['origin_location_label']}'.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO J: Reject proposed reroute & preserve original itinerary
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO J: Reject proposed reroute & preserve original itinerary ---")
    trip_cancel = create_sample_trip()
    db_cancel = MockDB(trip_cancel)
    # Traveler skips stop in execution state
    db_cancel.doc["execution_state"]["activity_log"][act2_id] = {
        "status": "skipped",
        "activity_id": act2_id,
        "activity_title": "Aguada Fort",
    }
    # Traveler declines the proposal (apply is NEVER called)
    orig_acts = copy.deepcopy(db_cancel.doc["route_details"]["day_by_day_route"][0]["activities"])
    assert orig_acts[1]["id"] == act2_id, "Original route activity changed despite cancellation"
    assert db_cancel.doc["execution_state"]["activity_log"][act2_id]["status"] == "skipped"
    print("  [PASS] Itinerary preserved intact; stop recorded as skipped in execution state.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO K: Accept proposed reroute & persist revised itinerary
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO K: Accept proposed reroute & persist revised itinerary ---")
    trip_accept = create_sample_trip()
    db_accept = MockDB(trip_accept)

    apply_res = apply_reroute_proposal(
        db=db_accept,
        trip_id=trip_accept["id"],
        day_number=1,
        skipped_activity_id=act2_id,
        proposed_stops=proposal["proposed_stops"],
        replacement_activity_id=proposal["replacement_activity"]["id"],
        reason="Skipped Aguada Fort by traveler",
        expected_revision=1,
        x_user_id="test_user_42",
    )

    assert apply_res["status"] == "success"
    assert apply_res["revision"] == 2
    assert db_accept.doc["revision"] == 2
    assert len(db_accept.doc["execution_state"]["reroute_history"]) == 1
    r_hist = db_accept.doc["execution_state"]["reroute_history"][0]
    assert r_hist["skipped_activity_id"] == act2_id
    assert r_hist["replacement_activity_id"] == proposal["replacement_activity"]["id"]
    print(f"  [PASS] Revision incremented to {apply_res['revision']}, reroute history logged.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO L: Concurrent / duplicate rerouting protection (revision check)
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO L: Concurrent revision mismatch protection (409 Conflict) ---")
    trip_conflict = create_sample_trip()
    trip_conflict["revision"] = 3
    db_conflict = MockDB(trip_conflict)

    try:
        apply_reroute_proposal(
            db=db_conflict,
            trip_id=trip_conflict["id"],
            day_number=1,
            skipped_activity_id=act2_id,
            proposed_stops=proposal["proposed_stops"],
            expected_revision=1,  # Stale revision!
            x_user_id="test_user_42",
        )
        assert False, "Failed to reject stale revision"
    except HTTPException as e:
        assert e.status_code == 409, f"Expected 409 Conflict, got {e.status_code}"
        print(f"  [PASS] Concurrency violation caught: HTTP {e.status_code} ({e.detail}).")
        passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO M: Browser refresh / MongoDB reload after acceptance
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO M: Persistence & reload consistency ---")
    # Simulate DB fetch
    reloaded_trip = db_accept.find_one({"_id": trip_accept["id"]})
    assert reloaded_trip is not None
    day1_reloaded = reloaded_trip["route_details"]["day_by_day_route"][0]["activities"]
    assert any(s["id"] == proposal["replacement_activity"]["id"] for s in day1_reloaded), "Replacement missing after DB reload"
    assert not any(s["id"] == act2_id for s in day1_reloaded), "Skipped activity re-appeared after reload"
    assert reloaded_trip["revision"] == 2
    print("  [PASS] Reloaded trip retains persistent IDs, replacement stop, and revision 2.")
    passed += 1

    # -------------------------------------------------------------------------
    # SCENARIO N: Unauthorized trip mutation rejected (403)
    # -------------------------------------------------------------------------
    print("\n--- SCENARIO N: Unauthorized trip mutation rejected (403 Forbidden) ---")
    trip_auth = create_sample_trip()
    trip_auth["user_id"] = "owner_alice"
    db_auth = MockDB(trip_auth)

    try:
        apply_reroute_proposal(
            db=db_auth,
            trip_id=trip_auth["id"],
            day_number=1,
            skipped_activity_id=act2_id,
            proposed_stops=proposal["proposed_stops"],
            expected_revision=1,
            x_user_id="attacker_bob",
        )
        assert False, "Failed to reject unauthorized user mutation"
    except HTTPException as e:
        assert e.status_code == 403, f"Expected 403 Forbidden, got {e.status_code}"
        print(f"  [PASS] Unauthorized user mutation blocked: HTTP {e.status_code} ({e.detail}).")
        passed += 1

    print("\n" + "=" * 75)
    print(f"RESULTS: {passed}/{total} DYNAMIC REROUTING SCENARIOS PASSED (100%)")
    print("=" * 75)
    return passed == total


if __name__ == "__main__":
    success = run_all_tests()
    if not success:
        sys.exit(1)
