import sys
import copy
from pathlib import Path

# Add Backend to sys.path
backend_root = Path(__file__).resolve().parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from bson import ObjectId
from app.database.mongodb import db
from app.services.chat_service import process_chat_message
from app.services.itinerary_edit_service import (
    generate_preference_revision_proposal,
    apply_preference_revision,
    cancel_preference_revision
)

def run_tests():
    print("=" * 80)
    print("STARTING ACTIVE ITINERARY PREFERENCE REVISION REGRESSION SUITE")
    print("=" * 80)

    test_user_id = "test_user_rev_1"

    # =========================================================================
    # TEST 1: Generate a beach-focused Goa itinerary
    # =========================================================================
    print("\n--- TEST 1: Generate a beach-focused Goa itinerary ---")
    res1 = process_chat_message(
        conversation_id=None,
        user_message="Plan five days in Goa focusing on beaches.",
        user_id=test_user_id
    )
    conv_id = res1["conversation_id"]
    assert res1["intent"] == "GENERATE_ITINERARY", f"Expected GENERATE_ITINERARY, got {res1['intent']}"
    assert res1["data"] is not None and "itinerary" in res1["data"], "Expected itinerary data"
    initial_trip = res1["data"]["itinerary"]
    trip_id = res1["data"]["trip_id"]
    initial_rev = initial_trip.get("revision", 1)
    assert initial_rev == 1, f"Expected initial revision 1, got {initial_rev}"

    beach_attractions = [
        s.get("name")
        for d in initial_trip.get("route_details", {}).get("day_by_day_route", [])
        for s in d.get("stops", [])
        if s.get("type") == "attraction"
    ]
    print(f"[OK] Generated Trip '{trip_id}' (Revision {initial_rev})")
    print(f"Scheduled Attractions ({len(beach_attractions)}): {', '.join(beach_attractions)}")
    assert any("beach" in a.lower() for a in beach_attractions), "Expected coastal/beach attractions"
    print("TEST 1 PASSED!")

    # =========================================================================
    # TEST 2: Ask to change the current itinerary to temples and history
    # =========================================================================
    print("\n--- TEST 2: Ask to change current itinerary to temples and history ---")
    res2 = process_chat_message(
        conversation_id=conv_id,
        user_message="Now change it to temples and history.",
        user_id=test_user_id
    )
    assert res2["intent"] == "MODIFY_ITINERARY", f"Expected MODIFY_ITINERARY, got {res2['intent']}"
    assert res2["data"] is not None, "Expected data payload in proposal"
    assert res2["data"].get("type") == "revision_proposal", f"Expected revision_proposal, got {res2['data'].get('type')}"
    
    proposal_id = res2["data"]["proposal_id"]
    changes = res2["data"]["changes_summary"]
    added = changes.get("added", [])
    removed = changes.get("removed", [])
    kept = changes.get("kept", [])
    
    print(f"[OK] Revision Proposal Generated: {proposal_id}")
    print(f"Added Attractions ({len(added)}): {', '.join(added)}")
    print(f"Removed Attractions ({len(removed)}): {', '.join(removed)}")
    print(f"Preserved Stops ({len(kept)}): {', '.join(kept)}")

    # Verify material difference: added activities should be temples/heritage, removed should be beaches
    assert len(added) > 0, "Expected added attractions in proposal"
    assert any(any(kw in a.lower() for kw in ("temple", "cathedral", "basilica", "church")) for a in added), \
        f"Expected temple/heritage sites in added attractions, got: {added}"
    assert len(removed) > 0, "Expected removed beach attractions"

    # Verify suggested actions
    actions = res2["data"].get("suggested_actions", [])
    action_labels = [a.get("label") for a in actions]
    assert "Apply Changes" in action_labels, f"Expected 'Apply Changes' action, got {action_labels}"
    assert "Keep Current Itinerary" in action_labels, f"Expected 'Keep Current Itinerary' action, got {action_labels}"
    print("TEST 2 PASSED!")

    # =========================================================================
    # TEST 3: Accept the proposal and verify that the revised trip is persisted
    # =========================================================================
    print("\n--- TEST 3: Accept proposal ('Apply Changes') and verify persistence ---")
    res3 = process_chat_message(
        conversation_id=conv_id,
        user_message="Apply Changes",
        user_id=test_user_id
    )
    assert res3["intent"] == "MODIFY_ITINERARY", f"Expected MODIFY_ITINERARY, got {res3['intent']}"
    assert res3["data"] is not None and "itinerary" in res3["data"], "Expected updated itinerary in data"
    applied_trip = res3["data"]["itinerary"]
    assert applied_trip.get("revision") == 2, f"Expected revision 2, got {applied_trip.get('revision')}"

    # Verify directly in MongoDB
    saved_trip = db.trips.find_one({"_id": ObjectId(trip_id)})
    assert saved_trip is not None, "Trip document must exist in MongoDB"
    assert saved_trip.get("revision") == 2, f"MongoDB trip revision must be 2, got {saved_trip.get('revision')}"
    
    saved_attractions = [
        s.get("name")
        for d in saved_trip.get("route_details", {}).get("day_by_day_route", [])
        for s in d.get("stops", [])
        if s.get("type") == "attraction"
    ]
    print(f"[OK] Revised Trip Persisted in MongoDB (Revision {saved_trip.get('revision')})")
    print(f"Updated Scheduled Attractions: {', '.join(saved_attractions)}")
    assert any(any(kw in a.lower() for kw in ("temple", "cathedral", "basilica", "church")) for a in saved_attractions), \
        "Expected temple/heritage sites in persisted trip"
    print("TEST 3 PASSED!")

    # =========================================================================
    # TEST 4: Repeat and cancel the proposal; verify existing trip unchanged
    # =========================================================================
    print("\n--- TEST 4: Request new change and Cancel ('Keep Current Itinerary') ---")
    res4_prop = process_chat_message(
        conversation_id=conv_id,
        user_message="Change this trip to nature and waterfalls.",
        user_id=test_user_id
    )
    assert res4_prop["intent"] == "MODIFY_ITINERARY", f"Expected MODIFY_ITINERARY, got {res4_prop['intent']}"
    assert res4_prop["data"].get("type") == "revision_proposal", "Expected revision_proposal"

    # User cancels
    res4_cancel = process_chat_message(
        conversation_id=conv_id,
        user_message="Keep Current Itinerary",
        user_id=test_user_id
    )
    assert res4_cancel["intent"] == "MODIFY_ITINERARY"
    
    # Verify trip in DB is unchanged and remains revision 2
    trip_after_cancel = db.trips.find_one({"_id": ObjectId(trip_id)})
    assert trip_after_cancel.get("revision") == 2, f"Revision must remain 2 after cancel, got {trip_after_cancel.get('revision')}"
    attractions_after_cancel = [
        s.get("name")
        for d in trip_after_cancel.get("route_details", {}).get("day_by_day_route", [])
        for s in d.get("stops", [])
        if s.get("type") == "attraction"
    ]
    assert attractions_after_cancel == saved_attractions, "Attractions must remain identical after cancel"
    print(f"[OK] Proposal cancelled. Trip remains at Revision 2 with identical schedule.")
    print("TEST 4 PASSED!")

    # =========================================================================
    # TEST 5: Verify that completed activities and active stops are preserved
    # =========================================================================
    print("\n--- TEST 5: Preservation of completed activities and active stops ---")
    # Mark the first scheduled attraction across the days as completed
    first_attr = next(
        s for d in saved_trip["route_details"]["day_by_day_route"]
        for s in d.get("stops", [])
        if s.get("type") == "attraction"
    )
    completed_act_id = first_attr["id"]
    completed_act_name = first_attr["name"]
    target_day_idx = next(
        idx for idx, d in enumerate(saved_trip["route_details"]["day_by_day_route"])
        if any(s.get("id") == completed_act_id for s in d.get("stops", []))
    )

    db.trips.update_one(
        {"_id": ObjectId(trip_id)},
        {"$set": {
            f"execution_state.activity_log.{completed_act_id}": {
                "status": "completed",
                "completed_at": "2026-10-23T11:00:00Z"
            }
        }}
    )
    trip_with_completed = db.trips.find_one({"_id": ObjectId(trip_id)})

    # Request revision proposal
    proposal_obj = generate_preference_revision_proposal(
        trip_doc=trip_with_completed,
        new_interests=["beaches"],
        active_segment_id=None
    )
    
    changes = proposal_obj["changes_summary"]
    print(f"Completed Activity: '{completed_act_name}' (ID: {completed_act_id}, Day {target_day_idx + 1})")
    print(f"Proposal Kept Attractions: {changes.get('kept')}")
    print(f"Proposal Removed Attractions: {changes.get('removed')}")

    # The completed activity MUST be preserved in 'kept' and MUST NOT be in 'removed'
    assert completed_act_name in changes.get("kept", []), f"Completed activity '{completed_act_name}' must be kept!"
    assert completed_act_name not in changes.get("removed", []), f"Completed activity '{completed_act_name}' must NOT be removed!"

    # Verify in the proposed day schedule that the completed stop exists with exact ID
    prop_day_stops = proposal_obj["proposed_trip"]["route_details"]["day_by_day_route"][target_day_idx]["stops"]
    assert any(s.get("id") == completed_act_id for s in prop_day_stops), \
        f"Completed stop must be present in proposed Day {target_day_idx + 1} schedule"
    print(f"[OK] Completed activity '{completed_act_name}' strictly preserved in proposed schedule.")
    print("TEST 5 PASSED!")

    # =========================================================================
    # TEST 6: Verify that revision conflicts are rejected safely
    # =========================================================================
    print("\n--- TEST 6: Revision conflict rejection (Optimistic Locking) ---")
    # Create proposal with expected_revision = 2
    stale_proposal_id = proposal_obj["proposal_id"]
    db.reroute_proposals.insert_one({
        "proposal_id": stale_proposal_id,
        "trip_id": trip_id,
        "user_id": test_user_id,
        "version": 1,
        "revision": 2,
        "expected_revision": 2,
        "proposal": proposal_obj,
        "status": "pending",
        "expires_at": proposal_obj["expires_at"]
    })

    # Simulate concurrent modification by bumping trip revision in MongoDB to 3
    db.trips.update_one({"_id": ObjectId(trip_id)}, {"$set": {"revision": 3}})

    # Attempt to apply stale proposal with expected_revision=2
    conflict_caught = False
    try:
        apply_preference_revision(db, trip_id, stale_proposal_id, expected_revision=2)
    except Exception as e:
        conflict_caught = True
        print(f"[OK] Expected conflict caught: {e}")
        assert "Concurrent modification detected" in str(e) or "409" in str(e), f"Unexpected error detail: {e}"

    assert conflict_caught, "Expected HTTPException 409 on revision conflict"
    
    # Confirm trip revision is still 3 and was NOT overwritten
    unmodified_trip = db.trips.find_one({"_id": ObjectId(trip_id)})
    assert unmodified_trip.get("revision") == 3, "Trip must remain at revision 3 without overwrite"
    print("TEST 6 PASSED!")

    # =========================================================================
    # TEST 7: Ordinary preference statements use UPDATE_CONTEXT without modifying trip
    # =========================================================================
    print("\n--- TEST 7: Ordinary preference statements use UPDATE_CONTEXT ---")
    res7 = process_chat_message(
        conversation_id=conv_id,
        user_message="I like temples and luxury travel.",
        user_id=test_user_id
    )
    assert res7["intent"] == "UPDATE_CONTEXT", f"Expected UPDATE_CONTEXT, got {res7['intent']}"
    assert res7["data"] is None or res7["data"].get("type") != "revision_proposal", \
        "Ordinary preference statement must NOT trigger a revision proposal"
    
    # Trip revision and schedule must remain untouched
    trip7 = db.trips.find_one({"_id": ObjectId(trip_id)})
    assert trip7.get("revision") == 3, f"Trip revision must remain 3, got {trip7.get('revision')}"
    print(f"[OK] Intent is UPDATE_CONTEXT. Trip remains at Revision 3 without unexpected modifications.")
    print("TEST 7 PASSED!")

    # =========================================================================
    # TEST 8: Modify command when NO active trip exists
    # =========================================================================
    print("\n--- TEST 8: Preference change request when NO active trip exists ---")
    fresh_user_id = "fresh_user_no_trips"
    res8 = process_chat_message(
        conversation_id=None,
        user_message="Change this trip to temples and history.",
        user_id=fresh_user_id
    )
    # When no trip exists, it updates context and asks whether user wants an itinerary generated
    assert res8["intent"] == "UPDATE_CONTEXT", f"Expected UPDATE_CONTEXT, got {res8['intent']}"
    reply8 = res8["message"]["content"]
    assert "haven't created an itinerary" in reply8 or "haven't generated" in reply8 or "build" in reply8, \
        f"Expected prompt to build itinerary, got: {reply8}"
    assert "temples" in str(res8["travel_context"].get("interests")), "Preferences must be saved in context"
    print(f"[OK] Correctly handled absence of active trip. Saved preferences in context and offered to build trip.")
    print("TEST 8 PASSED!")

    print("\n" + "=" * 80)
    print("ALL 8 ACTIVE ITINERARY PREFERENCE REVISION TESTS PASSED SUCCESSFULLY!")
    print("=" * 80)

if __name__ == "__main__":
    run_tests()
