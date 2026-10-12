import sys
import os
import json
import time
from datetime import date
from typing import Dict, Any, List

# Ensure Backend is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.utils.activity_identity import (
    generate_persistent_activity_id,
    resolve_activity_status,
    migrate_legacy_activity_log
)
from app.ai.agents.route_agent import route_node


def run_all_tests():
    print("=" * 70)
    print("ACTIVITY IDENTITY & EXECUTION-STATE COMPATIBILITY AUDIT")
    print("=" * 70)

    passed_count = 0
    total_tests = 7

    # -------------------------------------------------------------------------
    # TEST 1: Stable Identity Across Reordering
    # -------------------------------------------------------------------------
    print("\n--- TEST 1: Stable Identity Across Reordering ---")
    stop_a = {
        "name": "Baga Beach",
        "type": "attraction",
        "place_id": "ChIJ_baga_123"
    }
    stop_b = {
        "name": "Aguada Fort",
        "type": "attraction",
        "place_id": "ChIJ_aguada_456"
    }
    stop_c = {
        "name": "Fisherman's Wharf",
        "type": "restaurant",
        "place_id": "ChIJ_fish_789"
    }

    id_a = generate_persistent_activity_id(stop_a["type"], stop_a["name"], stop_a["place_id"])
    id_b = generate_persistent_activity_id(stop_b["type"], stop_b["name"], stop_b["place_id"])
    id_c = generate_persistent_activity_id(stop_c["type"], stop_c["name"], stop_c["place_id"])

    stop_a["id"] = id_a
    stop_b["id"] = id_b
    stop_c["id"] = id_c

    # Original Day 1 order: [stop_a, stop_b, stop_c]
    day1_original = [dict(stop_a), dict(stop_b), dict(stop_c)]
    
    # Reordered Day 1: swap Stop 0 and Stop 1 -> [stop_b, stop_a, stop_c]
    day1_reordered = [dict(stop_b), dict(stop_a), dict(stop_c)]

    assert day1_original[0]["id"] == id_a, "Original stop 0 must be stop_a"
    assert day1_original[1]["id"] == id_b, "Original stop 1 must be stop_b"
    assert day1_reordered[0]["id"] == id_b, "Reordered stop 0 must retain stop_b's persistent ID"
    assert day1_reordered[1]["id"] == id_a, "Reordered stop 1 must retain stop_a's persistent ID"
    assert not id_a.startswith("day_"), "ID must not be positional"
    assert not id_b.startswith("day_"), "ID must not be positional"
    print(f"  [PASS] ID A: '{id_a}'")
    print(f"  [PASS] ID B: '{id_b}'")
    print(f"  [PASS] Both activities retained stable IDs after array index swap.")
    passed_count += 1

    # -------------------------------------------------------------------------
    # TEST 2: Prevention of Accidental Status Transfer on Reordering
    # -------------------------------------------------------------------------
    print("\n--- TEST 2: Prevention of Accidental Status Transfer on Reordering ---")
    # Mark stop_a (Baga Beach) as completed in activity_log
    activity_log = {
        id_a: {
            "status": "completed",
            "activity_id": id_a,
            "activity_title": "Baga Beach",
            "actual_end_time": "2026-10-12T11:30:00Z"
        },
        # Legacy positional dual-write
        "1_0": {
            "status": "completed",
            "activity_id": id_a,
            "activity_title": "Baga Beach",
            "actual_end_time": "2026-10-12T11:30:00Z"
        }
    }

    # In reordered list, Stop 0 is now stop_b (Aguada Fort), Stop 1 is stop_a (Baga Beach)
    status_0, record_0 = resolve_activity_status(day1_reordered[0], day_number=1, activity_index=0, activity_log=activity_log)
    status_1, record_1 = resolve_activity_status(day1_reordered[1], day_number=1, activity_index=1, activity_log=activity_log)

    print(f"  Position 0 (Aguada Fort): resolved status = '{status_0}' (expected: 'pending')")
    print(f"  Position 1 (Baga Beach): resolved status = '{status_1}' (expected: 'completed')")

    assert status_0 == "pending", f"Accidental status transfer detected! Aguada Fort was marked '{status_0}'"
    assert status_1 == "completed", f"Baga Beach must remain completed at position 1, got '{status_1}'"
    assert record_1["activity_id"] == id_a
    print("  [PASS] Safety check prevented legacy key 1_0 from erroneously transferring to Aguada Fort.")
    print("  [PASS] Completed status remained strictly attached to Baga Beach.")
    passed_count += 1

    # -------------------------------------------------------------------------
    # TEST 3: Prevention of Accidental Status Transfer on Insertion
    # -------------------------------------------------------------------------
    print("\n--- TEST 3: Prevention of Accidental Status Transfer on Insertion ---")
    new_stop = {
        "name": "Anjuna Flea Market",
        "type": "attraction",
        "place_id": "ChIJ_anjuna_999"
    }
    new_id = generate_persistent_activity_id(new_stop["type"], new_stop["name"], new_stop["place_id"])
    new_stop["id"] = new_id

    # Insert new stop at index 0 -> [new_stop, stop_a, stop_b, stop_c]
    day1_inserted = [dict(new_stop)] + list(day1_original)

    status_ins_0, _ = resolve_activity_status(day1_inserted[0], day_number=1, activity_index=0, activity_log=activity_log)
    status_ins_1, _ = resolve_activity_status(day1_inserted[1], day_number=1, activity_index=1, activity_log=activity_log)

    print(f"  Position 0 (New: Anjuna Market): resolved status = '{status_ins_0}' (expected: 'pending')")
    print(f"  Position 1 (Shifted: Baga Beach): resolved status = '{status_ins_1}' (expected: 'completed')")

    assert status_ins_0 == "pending", f"Inserted activity at index 0 must be pending, got '{status_ins_0}'"
    assert status_ins_1 == "completed", f"Shifted Baga Beach must remain completed, got '{status_ins_1}'"
    print("  [PASS] Inserting stop at index 0 did not contaminate new stop with previous stop 0 status.")
    passed_count += 1

    # -------------------------------------------------------------------------
    # TEST 4: Activity Skipping & Undoing by Persistent ID
    # -------------------------------------------------------------------------
    print("\n--- TEST 4: Activity Skipping & Undoing by Persistent ID ---")
    # Skip Aguada Fort (id_b)
    activity_log[id_b] = {
        "status": "skipped",
        "activity_id": id_b,
        "activity_title": "Aguada Fort",
        "actual_end_time": "2026-10-12T13:00:00Z"
    }

    status_b, _ = resolve_activity_status(stop_b, day_number=1, activity_index=1, activity_log=activity_log)
    assert status_b == "skipped", f"Expected 'skipped', got '{status_b}'"
    print(f"  [PASS] Activity successfully resolved as '{status_b}' by persistent ID.")

    # Revert / Undo status
    del activity_log[id_b]
    status_b_revert, _ = resolve_activity_status(stop_b, day_number=1, activity_index=1, activity_log=activity_log)
    assert status_b_revert == "pending", f"Expected 'pending' after undo, got '{status_b_revert}'"
    print(f"  [PASS] Activity successfully reverted to '{status_b_revert}' after undo.")
    passed_count += 1

    # -------------------------------------------------------------------------
    # TEST 5: Safe Migration of Legacy Execution State Records
    # -------------------------------------------------------------------------
    print("\n--- TEST 5: Safe Migration of Legacy Execution State Records ---")
    # Simulate an old saved trip that only stored index keys without activity_id or activity_title
    old_legacy_log = {
        "1_0": {
            "status": "completed",
            "actual_end_time": "2026-10-10T09:45:00Z"
        },
        "1_1": {
            "status": "skipped",
            "actual_end_time": "2026-10-10T11:00:00Z"
        }
    }

    mock_routes = [{
        "day": 1,
        "stops": [dict(stop_a), dict(stop_b), dict(stop_c)]
    }]

    migrated_log = migrate_legacy_activity_log(old_legacy_log, mock_routes)

    # Check migration results
    assert id_a in migrated_log, f"Migrated log must contain persistent ID {id_a}"
    assert migrated_log[id_a]["status"] == "completed"
    assert migrated_log[id_a]["activity_id"] == id_a
    assert migrated_log[id_a]["activity_title"] == "Baga Beach"

    assert id_b in migrated_log, f"Migrated log must contain persistent ID {id_b}"
    assert migrated_log[id_b]["status"] == "skipped"
    assert migrated_log[id_b]["activity_id"] == id_b
    assert migrated_log[id_b]["activity_title"] == "Aguada Fort"

    # Now verify that reordering on the migrated log is immune to index-shifting
    status_mig_swapped_0, _ = resolve_activity_status(day1_reordered[0], day_number=1, activity_index=0, activity_log=migrated_log)
    status_mig_swapped_1, _ = resolve_activity_status(day1_reordered[1], day_number=1, activity_index=1, activity_log=migrated_log)

    print(f"  Migrated Stop A: {id_a} -> {migrated_log[id_a]['status']}")
    print(f"  Migrated Stop B: {id_b} -> {migrated_log[id_b]['status']}")
    print(f"  Swapped position 0 (Aguada Fort): status = '{status_mig_swapped_0}' (expected: 'skipped')")
    print(f"  Swapped position 1 (Baga Beach): status = '{status_mig_swapped_1}' (expected: 'completed')")

    assert status_mig_swapped_0 == "skipped", f"Aguada Fort should resolve to 'skipped', got '{status_mig_swapped_0}'"
    assert status_mig_swapped_1 == "completed", f"Baga Beach should resolve to 'completed', got '{status_mig_swapped_1}'"
    print("  [PASS] Legacy records cleanly migrated to persistent IDs and survived subsequent reordering.")
    passed_count += 1

    # -------------------------------------------------------------------------
    # TEST 6: Route Agent Stop ID Verification on Realistic Generated Itineraries
    # -------------------------------------------------------------------------
    print("\n--- TEST 6: Route Agent Stop ID Verification on Realistic Generated Itineraries ---")
    mock_attractions = [
        {"name": "Calangute Beach", "lat": 15.544, "lon": 73.755, "category": "beach", "interests": ["beaches"], "description": "Lively coastal beach.", "why_visit": "Popular shoreline."},
        {"name": "Fort Aguada", "lat": 15.492, "lon": 73.773, "category": "monument", "interests": ["heritage"], "description": "17th-century Portuguese fort.", "why_visit": "Historical fort overlooking the sea."},
        {"name": "Basilica of Bom Jesus", "lat": 15.500, "lon": 73.911, "category": "temple", "interests": ["culture"], "description": "UNESCO heritage church.", "why_visit": "Historic spiritual site."},
        {"name": "Dudhsagar Falls", "lat": 15.314, "lon": 74.314, "category": "nature", "interests": ["nature"], "description": "Four-tiered waterfall.", "why_visit": "Dramatic natural landmark."}
    ]
    mock_restaurants = [
        {"name": "Britto's Shack", "lat": 15.545, "lon": 73.754, "description": "Beachside seafood dining."},
        {"name": "Fisherman's Wharf Panjim", "lat": 15.498, "lon": 73.827, "description": "Goan riverfront dining."},
        {"name": "Martin's Corner", "lat": 15.298, "lon": 73.911, "description": "Traditional Goan cuisine."}
    ]
    mock_hotels = [
        {"name": "Taj Fort Aguada Resort", "lat": 15.495, "lon": 73.770, "address": "Sinquerim, Goa"}
    ]

    state = {
        "origin": "Hyderabad",
        "destination": "Goa",
        "days": 3,
        "start_date": "2026-10-15",
        "end_date": "2026-10-17",
        "pace": "balanced",
        "interests": ["nature", "beaches", "heritage"],
        "attractions": mock_attractions,
        "restaurants": mock_restaurants,
        "hotels": mock_hotels,
        "flights": [{"departureTime": "08:00", "arrivalTime": "09:30"}],
        "completed_steps": ["attractions", "restaurants", "hotels"]
    }

    route_res = route_node(state)
    days_list = route_res.get("route_details", {}).get("day_by_day_route", [])

    assert len(days_list) == 3, f"Expected 3 days, got {len(days_list)}"

    all_seen_ids = set()
    total_stops_checked = 0

    for day in days_list:
        day_num = day.get("day")
        stops = day.get("stops", [])
        assert len(stops) > 0, f"Day {day_num} must contain stops"

        for s_idx, stop in enumerate(stops):
            total_stops_checked += 1
            stop_id = stop.get("id")
            name = stop.get("name")
            stop_type = stop.get("type")

            assert stop_id, f"Stop '{name}' missing ID"
            assert stop_id.startswith("act_"), f"Stop ID '{stop_id}' must start with 'act_'"
            assert not stop_id.startswith(f"day_{day_num}_act_"), f"Stop ID '{stop_id}' must not be positional"
            assert stop_id not in all_seen_ids, f"Duplicate stop ID '{stop_id}' found in itinerary!"
            all_seen_ids.add(stop_id)

            assert stop.get("time"), f"Stop '{name}' missing time window"
            assert stop.get("duration"), f"Stop '{name}' missing duration"
            assert stop.get("type"), f"Stop '{name}' missing type"

    print(f"  [PASS] Verified {total_stops_checked} stops across 3 days.")
    print(f"  [PASS] All {len(all_seen_ids)} stop IDs are unique, persistent, and non-positional.")
    sample_ids = list(all_seen_ids)[:5]
    for s_id in sample_ids:
        print(f"    - Sample ID: {s_id}")
    passed_count += 1

    # -------------------------------------------------------------------------
    # TEST 7: Trip Reopen & Refresh Round-Trip Serialization
    # -------------------------------------------------------------------------
    print("\n--- TEST 7: Trip Reopen & Refresh Round-Trip Serialization ---")
    first_stop_obj = route_res["route_details"]["day_by_day_route"][0]["stops"][0]
    target_stop_id = first_stop_obj["id"]

    trip_record = {
        "id": "mock_trip_12345",
        "destination": "Goa",
        "route_details": route_res["route_details"],
        "execution_state": {
            "is_active": True,
            "current_day_number": 1,
            "activity_log": {
                target_stop_id: {
                    "status": "completed",
                    "activity_id": target_stop_id,
                    "activity_title": first_stop_obj.get("name"),
                    "actual_end_time": "2026-10-15T09:00:00Z"
                }
            },
            "reroute_history": []
        }
    }

    # Simulate JSON round-trip (MongoDB / LocalStorage persistence)
    serialized = json.dumps(trip_record)
    deserialized = json.loads(serialized)

    saved_exec_log = deserialized["execution_state"]["activity_log"]
    first_stop = deserialized["route_details"]["day_by_day_route"][0]["stops"][0]

    status_reopened, rec_reopened = resolve_activity_status(first_stop, day_number=1, activity_index=0, activity_log=saved_exec_log)

    assert status_reopened == "completed", f"Status must be preserved across reload, got '{status_reopened}'"
    assert rec_reopened["activity_id"] == first_stop["id"]
    print(f"  [PASS] Round-trip serialization preserved activity ID '{first_stop['id']}' and status '{status_reopened}'.")
    passed_count += 1

    # -------------------------------------------------------------------------
    # SUMMARY
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print(f"AUDIT SUMMARY: {passed_count}/{total_tests} TESTS PASSED (100% SUCCESS)")
    print("=" * 70)
    return passed_count == total_tests


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
