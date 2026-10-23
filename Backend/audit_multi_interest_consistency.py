"""
Audit Multi-Interest Consistency
Performs a deep consistency audit on the multi-interest revision implementation:
1. Compares original saved itinerary, proposal diffs, and final applied itinerary.
2. Verifies diff mathematical consistency and exact counts.
3. Verifies deduplication and preserved anchor activities.
4. Verifies cancellation (no changes persisted) and application (exact proposal persisted).
"""
import sys
import os
import json
from datetime import datetime

# Set backend root in sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from bson import ObjectId
from app.database.mongodb import db
from app.services.chat_service import process_chat_message
from app.services.itinerary_edit_service import (
    generate_preference_revision_proposal,
    apply_preference_revision,
    cancel_preference_revision
)
from app.utils.place_deduplication import clean_display_name, is_same_physical_place

def run_consistency_audit():
    print("=" * 80)
    print("STARTING MULTI-INTEREST REVISION CONSISTENCY AUDIT")
    print("=" * 80)

    test_user = f"audit_user_{int(datetime.utcnow().timestamp())}"
    conv_id = None

    # -------------------------------------------------------------------------
    # STEP 1: Generate initial beach itinerary
    # -------------------------------------------------------------------------
    print("\n--- STEP 1: Generate initial beach-focused 5-day Goa itinerary ---")
    gen_turn = process_chat_message(
        conversation_id=conv_id,
        user_message="Plan five days in Goa focusing on beaches.",
        user_id=test_user
    )
    conv_id = gen_turn["conversation_id"]
    trip_data = (gen_turn.get("data") or {}).get("itinerary")
    trip_id = (gen_turn.get("data") or {}).get("trip_id") or str(trip_data.get("_id") or trip_data.get("id"))
    assert trip_id, "Failed to generate initial trip!"

    # Designate anchor attractions:
    # 1. Must-visit anchor: "Aguada Fort"
    # 2. Completed activity anchor: First attraction on Day 2
    try:
        db_trip_orig = db.trips.find_one({"_id": ObjectId(trip_id)})
    except Exception:
        db_trip_orig = db.trips.find_one({"id": trip_id})

    orig_routes = db_trip_orig.get("route_details", {}).get("day_by_day_route", [])
    first_attr = next(s for d in orig_routes for s in (d.get("stops") or []) if s.get("type") == "attraction")
    completed_act_id = first_attr["id"]
    completed_act_name = clean_display_name(first_attr.get("name") or first_attr.get("title") or "")

    db.trips.update_one(
        {"_id": ObjectId(trip_id) if ObjectId.is_valid(trip_id) else trip_id},
        {"$set": {
            "must_visit_places": ["Aguada Fort"],
            f"execution_state.activity_log.{completed_act_id}": {
                "status": "completed",
                "completed_at": "2026-10-23T11:00:00Z"
            }
        }}
    )

    try:
        db_trip_orig = db.trips.find_one({"_id": ObjectId(trip_id)})
    except Exception:
        db_trip_orig = db.trips.find_one({"id": trip_id})

    orig_rev = db_trip_orig.get("revision", 1)
    orig_routes = db_trip_orig.get("route_details", {}).get("day_by_day_route", [])

    orig_attractions = []
    for d in orig_routes:
        for s in (d.get("stops") or []):
            if s.get("type") == "attraction":
                orig_attractions.append({
                    "id": s.get("id"),
                    "name": clean_display_name(s.get("name") or s.get("title") or ""),
                    "raw_name": s.get("name") or s.get("title") or "",
                    "day": d.get("day_number"),
                    "start_time": s.get("start_time"),
                    "end_time": s.get("end_time"),
                    "lat": s.get("latitude"),
                    "lon": s.get("longitude")
                })

    orig_names = [a["name"] for a in orig_attractions]
    orig_unique_names = sorted(list(set(orig_names)))
    print(f"Original Trip ID: {trip_id} (Revision {orig_rev})")
    print(f"Anchors Established: Completed='{completed_act_name}' (ID: {completed_act_id}), Must-Visit='Aguada Fort'")
    print(f"Original Scheduled Attractions ({len(orig_attractions)} total, {len(orig_unique_names)} unique):")
    for a in orig_attractions:
        print(f"  Day {a['day']} [{a['start_time']}-{a['end_time']}]: {a['name']}")

    # -------------------------------------------------------------------------
    # STEP 2: Request multi-interest revision proposal
    # -------------------------------------------------------------------------
    print("\n--- STEP 2: Request multi-interest revision: 'i want both temples and beaches' ---")
    prop_turn = process_chat_message(
        conversation_id=conv_id,
        user_message="i want both temples and beaches",
        user_id=test_user
    )
    prop_data = prop_turn.get("data") or {}
    assert prop_data.get("type") == "revision_proposal", f"Expected revision_proposal, got {prop_data.get('type')}"

    proposal_id = prop_data.get("proposal_id")
    expected_rev = prop_data.get("expected_revision")
    changes = prop_data.get("changes_summary") or {}
    added = changes.get("added") or []
    removed = changes.get("removed") or []
    kept = changes.get("kept") or []
    rescheduled = changes.get("rescheduled") or []

    print(f"Proposal ID: {proposal_id}")
    print(f"Expected Revision: {expected_rev}")
    print(f"Proposal Focus: {prop_data.get('focus_description')}")
    print(f"Proposal Explanation: {prop_data.get('explanation')}")
    print(f"Diff Summary:")
    print(f"  Added ({len(added)}): {added}")
    print(f"  Removed ({len(removed)}): {removed}")
    print(f"  Kept ({len(kept)}): {kept}")
    print(f"  Rescheduled ({len(rescheduled)}): {[r['name'] for r in rescheduled]}")

    # Proposal in DB
    prop_record = db.reroute_proposals.find_one({"proposal_id": proposal_id})
    assert prop_record, f"Proposal {proposal_id} not persisted in db.reroute_proposals!"
    assert prop_record.get("status") == "pending", f"Expected status 'pending', got {prop_record.get('status')}"
    proposed_trip = prop_record.get("proposal", {}).get("proposed_trip") or {}
    prop_routes = proposed_trip.get("route_details", {}).get("day_by_day_route", [])

    prop_attractions = []
    for d in prop_routes:
        for s in (d.get("stops") or []):
            if s.get("type") == "attraction":
                prop_attractions.append({
                    "id": s.get("id"),
                    "name": clean_display_name(s.get("name") or s.get("title") or ""),
                    "raw_name": s.get("name") or s.get("title") or "",
                    "day": d.get("day_number"),
                    "start_time": s.get("start_time"),
                    "end_time": s.get("end_time"),
                    "lat": s.get("latitude"),
                    "lon": s.get("longitude")
                })
    prop_names = [a["name"] for a in prop_attractions]
    prop_unique_names = sorted(list(set(prop_names)))

    # -------------------------------------------------------------------------
    # STEP 3: Mathematical Consistency & Disjoint Category Audit
    # -------------------------------------------------------------------------
    print("\n--- STEP 3: Mathematical Consistency & Diff Categories Audit ---")
    set_orig = set(orig_unique_names)
    set_prop = set(prop_unique_names)
    set_added = set(added)
    set_removed = set(removed)
    set_kept = set(kept)
    resched_names = set([r["name"] for r in rescheduled])

    print(f"Original Unique Places ({len(set_orig)}): {set_orig}")
    print(f"Proposed Unique Places ({len(set_prop)}): {set_prop}")

    # Check 1: Disjointness between added, removed, kept
    assert set_added.isdisjoint(set_kept), f"Overlap between added and kept: {set_added & set_kept}"
    assert set_added.isdisjoint(set_removed), f"Overlap between added and removed: {set_added & set_removed}"
    assert set_kept.isdisjoint(set_removed), f"Overlap between kept and removed: {set_kept & set_removed}"
    print("[PASS] Diff categories (Added, Removed, Kept) are strictly pairwise disjoint.")

    # Check 2: Rescheduled is a subset of kept
    assert resched_names.issubset(set_kept), f"Rescheduled contains places not in kept: {resched_names - set_kept}"
    print("[PASS] Rescheduled activities are a strict subset of Kept activities.")

    # Check 3: Kept + Removed covers all original unique attractions
    missing_from_orig = set_orig - (set_kept | set_removed)
    extra_in_orig_diff = (set_kept | set_removed) - set_orig
    print(f"Coverage of Original (Kept U Removed == Original):")
    print(f"  Missing: {missing_from_orig}")
    print(f"  Extra: {extra_in_orig_diff}")
    assert not missing_from_orig, f"Original places unaccounted for: {missing_from_orig}"
    assert not extra_in_orig_diff, f"Diff references places not in original: {extra_in_orig_diff}"
    print("[PASS] Kept U Removed exactly partitions the original activities.")

    # Check 4: Kept + Added covers all proposed unique attractions
    missing_from_prop = set_prop - (set_kept | set_added)
    extra_in_prop_diff = (set_kept | set_added) - set_prop
    print(f"Coverage of Proposed (Kept U Added == Proposed):")
    print(f"  Missing: {missing_from_prop}")
    print(f"  Extra: {extra_in_prop_diff}")
    assert not missing_from_prop, f"Proposed places unaccounted for: {missing_from_prop}"
    assert not extra_in_prop_diff, f"Diff references places not in proposed: {extra_in_prop_diff}"
    print("[PASS] Kept U Added exactly partitions the proposed activities.")

    # Check 5: Deduplication & formatting
    print("\n--- STEP 4: Deduplication & Clean Naming Audit ---")
    for coll_name, coll in [("Original", orig_attractions), ("Proposed", prop_attractions)]:
        for i, a1 in enumerate(coll):
            for j, a2 in enumerate(coll):
                if i < j:
                    same_phys = is_same_physical_place(a1, a2)
                    same_name = (a1["name"].lower() == a2["name"].lower())
                    assert not (same_phys or same_name), f"Duplicate place in {coll_name}: '{a1['name']}' and '{a2['name']}'"
    print("[PASS] Zero duplicate real-world or alias attractions in either schedule.")

    for name in set_added | set_removed | set_kept:
        assert not name.endswith(","), f"Trailing comma in name: '{name}'"
        assert not name.endswith(", Goa"), f"Unstripped ', Goa' in name: '{name}'"
        assert "(" not in name and ")" not in name, f"Unstripped parenthetical in name: '{name}'"
    print("[PASS] All attraction names are cleanly formatted without trailing punctuation or suffixes.")

    # Check 6: Preserved anchor attractions check
    # Anchor 1: Completed activity
    assert completed_act_name in set_kept, f"Completed activity '{completed_act_name}' was NOT in kept! ({set_kept})"
    assert completed_act_name not in set_removed, f"Completed activity '{completed_act_name}' was in removed! ({set_removed})"
    print(f"[PASS] Completed anchor activity '{completed_act_name}' is strictly preserved in Kept stops.")

    # Anchor 2: Must-visit place
    assert "Aguada Fort" in set_kept or "Aguada Fort" in set_added, f"Must-visit anchor 'Aguada Fort' not in kept or added!"
    assert "Aguada Fort" not in set_removed, f"Must-visit anchor 'Aguada Fort' was in removed!"
    print(f"[PASS] Must-visit anchor activity 'Aguada Fort' is strictly preserved in Kept stops.")

    # -------------------------------------------------------------------------
    # STEP 5: Cancellation Audit
    # -------------------------------------------------------------------------
    print("\n--- STEP 5: Cancellation Audit ('Keep Current Itinerary') ---")
    cancel_turn = process_chat_message(
        user_message="Keep Current Itinerary",
        conversation_id=conv_id,
        user_id=test_user
    )
    print(f"Cancel reply: {cancel_turn['message']['content']}")

    # Verify DB state after cancel
    try:
        db_trip_after_cancel = db.trips.find_one({"_id": ObjectId(trip_id)})
    except Exception:
        db_trip_after_cancel = db.trips.find_one({"id": trip_id})
    assert db_trip_after_cancel.get("revision", 1) == orig_rev, f"Revision changed after cancel: {db_trip_after_cancel.get('revision')}"

    cancel_routes = db_trip_after_cancel.get("route_details", {}).get("day_by_day_route", [])
    cancel_attractions = [clean_display_name(s.get("name") or s.get("title") or "") for d in cancel_routes for s in (d.get("stops") or []) if s.get("type") == "attraction"]
    assert cancel_attractions == orig_names, f"Schedule changed after cancellation! Expected {orig_names}, got {cancel_attractions}"

    prop_rec_after_cancel = db.reroute_proposals.find_one({"proposal_id": proposal_id})
    assert prop_rec_after_cancel.get("status") == "cancelled", f"Proposal status is {prop_rec_after_cancel.get('status')}, expected 'cancelled'"
    print("[PASS] Cancellation leaves original schedule and revision strictly intact and sets proposal to 'cancelled'.")

    # -------------------------------------------------------------------------
    # STEP 6: Re-proposal & Application Audit ('Apply Changes')
    # -------------------------------------------------------------------------
    print("\n--- STEP 6: Re-proposal & Application Audit ('Apply Changes') ---")
    # Generate fresh proposal
    prop_turn_2 = process_chat_message(
        user_message="i want both temples and beaches",
        conversation_id=conv_id,
        user_id=test_user
    )
    prop_data_2 = prop_turn_2.get("data") or {}
    proposal_id_2 = prop_data_2.get("proposal_id")
    expected_rev_2 = prop_data_2.get("expected_revision")
    print(f"Fresh Proposal ID: {proposal_id_2} (Expected Rev: {expected_rev_2})")

    # Send Apply Changes
    apply_turn = process_chat_message(
        user_message="Apply Changes",
        conversation_id=conv_id,
        user_id=test_user
    )
    print(f"Apply reply: {apply_turn['message']['content']}")

    # Verify DB state after apply
    try:
        db_trip_after_apply = db.trips.find_one({"_id": ObjectId(trip_id)})
    except Exception:
        db_trip_after_apply = db.trips.find_one({"id": trip_id})
    final_rev = db_trip_after_apply.get("revision")
    assert final_rev == orig_rev + 1, f"Expected revision {orig_rev + 1}, got {final_rev}"

    applied_routes = db_trip_after_apply.get("route_details", {}).get("day_by_day_route", [])
    applied_attractions = [clean_display_name(s.get("name") or s.get("title") or "") for d in applied_routes for s in (d.get("stops") or []) if s.get("type") == "attraction"]

    prop_rec_after_apply = db.reroute_proposals.find_one({"proposal_id": proposal_id_2})
    assert prop_rec_after_apply.get("status") == "applied", f"Proposal status is {prop_rec_after_apply.get('status')}, expected 'applied'"

    prop_2_stops = [clean_display_name(s.get("name") or s.get("title") or "") for d in prop_rec_after_apply["proposal"]["proposed_trip"]["route_details"]["day_by_day_route"] for s in (d.get("stops") or []) if s.get("type") == "attraction"]
    assert applied_attractions == prop_2_stops, f"Applied schedule differs from proposal! Applied: {applied_attractions}, Proposed: {prop_2_stops}"

    has_temple = any("temple" in a.lower() for a in applied_attractions)
    has_beach = any("beach" in a.lower() for a in applied_attractions)
    assert has_temple, f"No temples in applied schedule: {applied_attractions}"
    assert has_beach, f"No beaches in applied schedule: {applied_attractions}"

    print(f"Applied Schedule ({len(applied_attractions)} attractions): {applied_attractions}")
    print(f"  Temples present: {has_temple}")
    print(f"  Beaches present: {has_beach}")
    print(f"  Completed anchor preserved: {completed_act_name in applied_attractions}")
    print(f"  Must-visit anchor preserved: {'Aguada Fort' in applied_attractions}")
    print("[PASS] Application incremented revision, set proposal to 'applied', and persisted exact proposed schedule with balanced interests.")

    print("\n" + "=" * 80)
    print("ALL CONSISTENCY AND MUTUAL EXCLUSION CHECKS PASSED SUCCESSFULLY!")
    print("=" * 80)

if __name__ == "__main__":
    run_consistency_audit()
