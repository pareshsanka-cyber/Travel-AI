"""Constrained edits to the structured schedule, shared by maps and itinerary text."""
import copy
import json
import secrets
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from bson import ObjectId
from fastapi import HTTPException
from app.ai.llm import llm
from app.ai.agents.route_agent import (
    route_node,
    parse_hhmm_to_minutes,
    minutes_to_hhmm,
    format_time_range,
    estimate_transit
)
from app.ai.agents.attraction_agent import attraction_node
from app.ai.agents.budget_agent import budget_node
from app.ai.agents.synthesis_agent import synthesis_node
from app.utils.activity_identity import generate_persistent_activity_id
from app.utils.place_deduplication import is_same_physical_place, is_place_already_scheduled, clean_display_name, deduplicate_place_list
from app.services.trip_consistency import revision_filter


def render_schedule(routes):
    return '\n\n'.join(
        f"Day {day.get('day', day.get('day_number'))}: {day.get('date', '')}\n" +
        '\n'.join(f"{s.get('start_time', '')}–{s.get('end_time', '')}: {s.get('title') or s.get('name')}" for s in (day.get('stops') or day.get('activities') or []))
        for day in routes['day_by_day_route']
    )


def reflow_day(trip, day, stops, allow_hotel_shift=False):
    log = (trip.get('execution_state') or {}).get('activity_log') or {}
    cursor = None
    previous = None
    for item in stops:
        start = parse_hhmm_to_minutes(item['start_time'], -1)
        duration = int(item.get('duration_minutes') or (parse_hhmm_to_minutes(item['end_time'], -1) - start))
        transit = (item.get('travel_time_from_prev_minutes') or 0) if item.get('travel_mode') == 'flight' else estimate_transit(previous.get('lat'), previous.get('lon'), item.get('lat'), item.get('lon'))[0] if previous else 0
        proposed_start = max(start, cursor + transit) if cursor is not None else start
        protected = item.get('type') == 'airport' or (not allow_hotel_shift and item.get('type') in {'hotel', 'hotel_checkout'}) or log.get(item['id'], {}).get('status') in {'completed', 'in_progress'}
        if protected and proposed_start != start:
            raise ValueError('This edit would move a protected travel or completed activity.')
        end = proposed_start + duration
        deadline = 1439 if item.get('type') == 'airport' else parse_hhmm_to_minutes(trip.get('bedtime'), 1439)
        if end > deadline:
            raise ValueError('This edit would extend the schedule beyond the end of the day.')
        item.update(start_time=minutes_to_hhmm(proposed_start), end_time=minutes_to_hhmm(end),
                    time=format_time_range(proposed_start, end), duration_minutes=duration,
                    travel_time_from_prev_minutes=transit)
        if item.get('type') in {'attraction', 'restaurant'}:
            from datetime import datetime
            from app.ai.agents.opening_hours_agent import determine_status_from_hours
            status, reason = determine_status_from_hours(item.get('opening_hours'), datetime.fromisoformat(day['date']), item['start_time'], item['end_time'])
            if status == 'CLOSED':
                raise ValueError('This edit falls outside the venue opening hours.')
            item.update(status=status, status_reason=reason, opening_hours_status='VERIFIED_OPEN' if status == 'OPEN' else 'UNVERIFIED')
        cursor, previous = end, item


def apply_schedule_edits(trip, edits):
    result = copy.deepcopy(trip)
    days = result['route_details']['day_by_day_route']
    if not edits or len(edits) > 20:
        raise ValueError('No supported schedule changes were identified.')
    log = (trip.get('execution_state') or {}).get('activity_log') or {}
    for edit in edits:
        day = next((d for i, d in enumerate(days) if int(d.get('day') or d.get('day_number') or i + 1) == int(edit['day_number'])), None)
        if not day:
            raise ValueError('Requested day does not exist.')
        stops = day.get('stops') or day.get('activities') or []

        if edit.get('action') == 'add':
            new_place = edit.get('place') or {}
            place_name = new_place.get('name') or edit.get('place_name') or 'Sightseeing Spot'
            all_current_stops = [s for d in days for s in (d.get('stops') or d.get('activities') or [])]
            if not edit.get('allow_repeat') and is_place_already_scheduled({'name': place_name, **new_place}, all_current_stops):
                raise ValueError(f"'{place_name}' is already included in this itinerary.")
            cat = str(new_place.get('category') or '').lower()
            place_type = new_place.get('type') or ('restaurant' if any(w in cat for w in ('restaurant', 'food', 'cafe', 'dining', 'catering')) else 'attraction')
            duration = int(edit.get('duration_minutes') or 90)
            if not 15 <= duration <= 240:
                raise ValueError('Activity duration must be between 15 and 240 minutes.')

            # Calculate appropriate slot for the added activity:
            # Place after preceding daytime stops, before end-of-day hotel or late departure
            insert_idx = len(stops)
            if stops and stops[-1].get('type') in {'hotel', 'airport'} and len(stops) > 1:
                insert_idx = len(stops) - 1

            if insert_idx > 0:
                prev = stops[insert_idx - 1]
                prev_end = parse_hhmm_to_minutes(prev.get('end_time', '10:00'), 600)
                init_start = prev_end + 30
            else:
                init_start = 600  # 10:00 AM default
            init_end = init_start + duration

            new_stop = {
                'id': generate_persistent_activity_id(place_type, place_name, new_place.get('place_id')),
                'title': place_name,
                'name': place_name,
                'type': place_type,
                'category': new_place.get('category') or place_type,
                'lat': new_place.get('lat') if new_place.get('lat') is not None else new_place.get('latitude'),
                'lon': new_place.get('lon') if new_place.get('lon') is not None else new_place.get('longitude'),
                'address': new_place.get('address'),
                'description': new_place.get('description') or f"Visit {place_name}.",
                'image_url': new_place.get('image_url'),
                'opening_hours': new_place.get('opening_hours'),
                'duration_minutes': duration,
                'start_time': minutes_to_hhmm(init_start),
                'end_time': minutes_to_hhmm(init_end),
                'time': format_time_range(init_start, init_end),
                'travel_mode': 'driving'
            }
            stops.insert(insert_idx, new_stop)
            catalog_key = 'restaurants' if place_type == 'restaurant' else 'attractions'
            catalog = result.setdefault(catalog_key, [])
            if not any(c.get('name') == place_name for c in catalog):
                catalog.append(new_stop)
        else:
            stop = next((s for s in stops if s['id'] == edit.get('activity_id')), None)
            if not stop or stop.get('type') in {'airport', 'hotel', 'hotel_checkout', 'breakfast'}:
                raise ValueError('Choose an attraction or restaurant to edit; travel and accommodation stops are protected.')
            if log.get(stop['id'], {}).get('status') in {'completed', 'in_progress'}:
                raise ValueError('Completed and in-progress activities cannot be edited.')
            if edit['action'] == 'remove':
                stops.remove(stop)
            elif edit['action'] == 'replace':
                catalog = result.get('restaurants' if stop.get('type') == 'restaurant' else 'attractions') or []
                candidate = next((c for c in catalog if c.get('name') == edit.get('replacement_name')), None)
                if not candidate:
                    raise ValueError('Replacement must be a discovered place from this trip.')
                stop.update({k: candidate.get(k) for k in {'name', 'lat', 'lon', 'address', 'description', 'image_url', 'opening_hours', 'place_id', 'category'}})
                stop['title'] = candidate['name']
                stop['id'] = generate_persistent_activity_id(stop['type'], candidate['name'], candidate.get('place_id'))
            elif edit['action'] == 'duration':
                duration = int(edit['duration_minutes'])
                if not 15 <= duration <= 240:
                    raise ValueError('Activity duration must be between 15 and 240 minutes.')
                stop['duration_minutes'] = duration
            else:
                raise ValueError('Unsupported schedule edit.')
        reflow_day(trip, day, stops, allow_hotel_shift=(edit.get('action') == 'add'))
        day['stops'] = stops
        day['activities'] = stops
    ids = [s['id'] for d in days for s in d['stops']]
    if len(ids) != len(set(ids)):
        raise ValueError('The edit would introduce a duplicate activity.')
    seen_venues = []
    for d in days:
        for s in (d.get('stops') or d.get('activities') or []):
            if s.get('type') in {'attraction', 'restaurant'}:
                if any(is_same_physical_place(s, v) for v in seen_venues):
                    raise ValueError(f"Duplicate venue detected: '{s.get('name')}'. Each physical place can only be visited once unless explicitly requested.")
                seen_venues.append(s)
    result['planner_draft'] = render_schedule(result['route_details'])
    result.update(budget_node(result))
    result.update(synthesis_node(result))
    return result


def add_activity_to_day(trip: dict, place: dict, day_number: int, duration_minutes: int = 90) -> dict:
    """Helper to add a discovered place to a given day in the itinerary."""
    return apply_schedule_edits(trip, [{
        'action': 'add',
        'day_number': day_number,
        'place': place,
        'duration_minutes': duration_minutes
    }])


def modify_itinerary(trip, instruction):
    schedule = [{'day_number': d.get('day') or d.get('day_number') or i + 1,
                 'stops': [{k: s.get(k) for k in ('id', 'title', 'name', 'type', 'duration_minutes')} for s in d.get('stops', [])]}
                for i, d in enumerate(trip['route_details']['day_by_day_route'])]
    prompt = ('Return JSON only: {"edits": [{"action": "remove|replace|duration", "day_number": 2, '
              '"activity_id": "existing id", "replacement_name": "catalog name", "duration_minutes": 90}]}. '
              'Use only existing activity IDs and replacement catalog names. Protect airport, hotel, breakfast stops. '
              'Do not invent venues or claim unsupported edits. Return an empty edits list if the request cannot be represented.\n'
              f'Schedule:\n{json.dumps(schedule, ensure_ascii=False)}\nRequest: {instruction}')
    try:
        response = llm.invoke(prompt).content
        data = json.loads(response[response.find('{'):response.rfind('}') + 1])
        edits = data.get('edits') or []
    except Exception as error:
        raise ValueError('Unable to parse schedule edits.') from error
    return apply_schedule_edits(trip, edits)


def generate_preference_revision_proposal(
    trip_doc: Dict[str, Any],
    new_interests: List[str],
    new_travel_style: Optional[str] = None,
    active_segment_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generates a proposed revision for an existing trip based on updated preferences or travel style.
    Preserves:
    - Destination, origin, days, start_date, end_date, budget, currency
    - Completed activities, active stops, and protected travel commitments (airport, hotel, breakfast)
    - Stable activity identities wherever applicable
    Produces a diff comparing current vs proposed activities and creates an optimistically locked proposal.
    """
    dest = trip_doc.get("destination", "Goa")
    days = int(trip_doc.get("days", 3))
    origin = trip_doc.get("origin", "Hyderabad")
    start_date = trip_doc.get("start_date")
    end_date = trip_doc.get("end_date")
    hotels = trip_doc.get("hotels", [])
    flights = trip_doc.get("flights", [])
    restaurants = trip_doc.get("restaurants", [])
    weather = trip_doc.get("weather", {})
    travelers = int(trip_doc.get("travelers", 2))
    budget = float(trip_doc.get("budget", 50000.0))
    currency = trip_doc.get("currency", "INR")
    travel_style = new_travel_style or trip_doc.get("travel_style", "STANDARD")
    pace = trip_doc.get("pace", "balanced")
    bedtime = trip_doc.get("bedtime", "22:00")
    wake_up_time = trip_doc.get("wake_up_time", "08:00")

    execution_state = copy.deepcopy(trip_doc.get("execution_state") or {
        "is_active": False,
        "current_day_number": 1,
        "activity_log": {},
        "reroute_history": []
    })
    activity_log = execution_state.get("activity_log") or {}

    # 1. Identify completed and in-progress activity IDs that MUST be preserved
    completed_ids = {aid for aid, entry in activity_log.items() if entry.get("status") in {"completed", "in_progress"}}
    if active_segment_id:
        completed_ids.add(active_segment_id)

    # 2. Retain suitable existing activities matching updated preferences and discover new candidates
    orig_days = trip_doc.get("route_details", {}).get("day_by_day_route", [])
    existing_attractions = list(trip_doc.get("attractions") or [])
    for d in orig_days:
        for s in (d.get("stops") or []):
            if s.get("type") == "attraction" and not any(is_same_physical_place(s, ea) for ea in existing_attractions):
                existing_attractions.append(s)

    def _matches_any_interest(place: Dict[str, Any], interests: List[str]) -> bool:
        if not interests:
            return True
        text = f"{place.get('name', '')} {place.get('category', '')} {place.get('matched_interest', '')} {place.get('description', '')}".lower()
        for i in interests:
            t = i.lower().strip()
            syns = [t]
            if "beach" in t or "coast" in t:
                syns += ["beach", "coast", "coastal", "cove", "bay", "sea", "ocean"]
            if "temple" in t or "spiritual" in t:
                syns += ["temple", "church", "cathedral", "shrine", "monastery", "basilica", "mandir"]
            if "history" in t or "heritage" in t:
                syns += ["fort", "palace", "monument", "historic", "heritage", "unesco"]
            if "nature" in t or "waterfall" in t or "wildlife" in t:
                syns += ["nature", "waterfall", "park", "garden", "wildlife", "scenic"]
            if "food" in t or "culinary" in t:
                syns += ["food", "culinary", "restaurant", "cafe", "bistro", "market", "dining", "seafood"]
            if "luxury" in t:
                syns += ["luxury", "resort", "exclusive", "premium"]
            if "adventure" in t:
                syns += ["adventure", "trek", "watersports", "dive"]
            if any(s in text for s in syns):
                return True
        return False

    suitable_existing = [ea for ea in existing_attractions if _matches_any_interest(ea, new_interests)]

    discovery_state = {
        "destination": dest,
        "interests": new_interests,
        "preferences": new_interests,
        "travel_style": travel_style,
        "pace": pace,
        "candidate_count": max(15, days * 3)
    }
    try:
        attr_out = attraction_node(discovery_state)
        discovered_attractions = attr_out.get("attractions") or []
    except Exception as e:
        print(f"Warning: Discovery in proposal failed ({e}), falling back to existing attractions")
        discovered_attractions = []

    combined_candidates = []
    for ea in existing_attractions:
        if ea.get("id") in completed_ids:
            combined_candidates.append(ea)
    for ea in suitable_existing:
        if not any(is_same_physical_place(ea, c) for c in combined_candidates):
            combined_candidates.append(ea)
    for na in discovered_attractions:
        if not any(is_same_physical_place(na, c) for c in combined_candidates):
            combined_candidates.append(na)

    new_attractions = deduplicate_place_list(combined_candidates)

    # 3. Schedule revised itinerary using route_node
    route_state = {
        "destination": dest,
        "origin": origin,
        "days": days,
        "start_date": start_date,
        "end_date": end_date,
        "travelers": travelers,
        "budget": budget,
        "currency": currency,
        "travel_style": travel_style,
        "interests": new_interests,
        "preferences": new_interests,
        "pace": pace,
        "bedtime": bedtime,
        "wake_up_time": wake_up_time,
        "hotels": hotels,
        "flights": flights,
        "attractions": new_attractions,
        "restaurants": restaurants,
        "weather": weather,
        "execution_state": execution_state
    }
    route_out = route_node(route_state)
    revised_routes = route_out.get("route_details") or {}

    # 4. Strict preservation of completed stops from original schedule
    orig_days = trip_doc.get("route_details", {}).get("day_by_day_route", [])
    rev_days = revised_routes.get("day_by_day_route", [])

    if completed_ids:
        for idx, orig_day in enumerate(orig_days):
            if idx < len(rev_days):
                rev_day = rev_days[idx]
                rev_stops = rev_day.get("stops") or []
                orig_stops = orig_day.get("stops") or []

                for ost in orig_stops:
                    if ost.get("id") in completed_ids:
                        existing_in_rev = next((s for s in rev_stops if s.get("id") == ost.get("id")), None)
                        if not existing_in_rev:
                            replaced = False
                            for s_idx, s in enumerate(rev_stops):
                                if s.get("type") == "attraction" and s.get("id") not in completed_ids:
                                    rev_stops[s_idx] = copy.deepcopy(ost)
                                    replaced = True
                                    break
                            if not replaced:
                                rev_stops.append(copy.deepcopy(ost))
                        else:
                            existing_in_rev.update(ost)
                rev_day["stops"] = rev_stops
                rev_day["activities"] = rev_stops

    # 5. Build revised trip structure
    revised_trip = copy.deepcopy(trip_doc)
    revised_trip["route_details"] = revised_routes
    revised_trip["attractions"] = new_attractions
    revised_trip["interests"] = new_interests
    revised_trip["preferences"] = new_interests
    revised_trip["travel_style"] = travel_style
    revised_trip["planner_draft"] = render_schedule(revised_routes)
    revised_trip.update(budget_node(revised_trip))
    revised_trip.update(synthesis_node(revised_trip))

    # 6. Diff comparison between original and proposed attractions
    curr_stops = [s for d in orig_days for s in (d.get("stops") or []) if s.get("type") == "attraction"]
    prop_stops = [s for d in rev_days for s in (d.get("stops") or []) if s.get("type") == "attraction"]

    added = []
    for p in prop_stops:
        if not any(is_same_physical_place(p, c) for c in curr_stops):
            raw_p_name = p.get("name") or p.get("title") or ""
            p_name = clean_display_name(raw_p_name)
            if p_name and p_name not in added:
                added.append(p_name)

    removed = []
    for c in curr_stops:
        if c.get("id") in completed_ids:
            continue
        if not any(is_same_physical_place(c, p) for p in prop_stops):
            raw_c_name = c.get("name") or c.get("title") or ""
            c_name = clean_display_name(raw_c_name)
            if c_name and c_name not in removed:
                removed.append(c_name)

    kept = []
    for p in prop_stops:
        if any(is_same_physical_place(p, c) for c in curr_stops):
            raw_p_name = p.get("name") or p.get("title") or ""
            p_name = clean_display_name(raw_p_name)
            if p_name and p_name not in kept:
                kept.append(p_name)

    rescheduled = []
    for p in prop_stops:
        matching = next((c for c in curr_stops if is_same_physical_place(p, c)), None)
        if matching and matching.get("start_time") != p.get("start_time"):
            rescheduled.append({
                "name": clean_display_name(p.get("name") or p.get("title") or ""),
                "old_time": matching.get("start_time"),
                "new_time": p.get("start_time")
            })

    focus_desc = " and ".join(new_interests) if new_interests else (new_travel_style or "your requested focus")
    explanation = f"Balanced schedule reflecting your updated interest in {focus_desc}."

    proposal_id = f"prop_{secrets.token_urlsafe(16)}"
    trip_id = str(trip_doc.get("_id") or trip_doc.get("id"))
    curr_rev = int(trip_doc.get("revision", 1))
    expires_at = datetime.utcnow() + timedelta(minutes=15)

    return {
        "proposal_id": proposal_id,
        "trip_id": trip_id,
        "expected_revision": curr_rev,
        "new_preferences": new_interests,
        "new_travel_style": new_travel_style,
        "focus_description": focus_desc,
        "explanation": explanation,
        "changes_summary": {
            "added": added,
            "removed": removed,
            "kept": kept,
            "rescheduled": rescheduled
        },
        "proposed_trip": revised_trip,
        "expires_at": expires_at
    }


def apply_preference_revision(
    db,
    trip_id: str,
    proposal_id: str,
    expected_revision: Optional[int] = None,
    x_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Applies an approved preference revision proposal to the trip.
    Verifies optimistic concurrency revision.
    Increments revision counter and saves updated schedule.
    """
    query: Dict[str, Any] = {"proposal_id": proposal_id, "status": "pending"}
    try:
        saved = db.reroute_proposals.find_one(query)
    except Exception:
        saved = None

    if not saved:
        raise HTTPException(
            status_code=409,
            detail="Revision proposal expired or already applied. Please generate a fresh proposal."
        )

    # Expiry check
    if saved.get("expires_at") and saved["expires_at"] < datetime.utcnow():
        raise HTTPException(
            status_code=409,
            detail="Revision proposal expired. Please generate a fresh proposal."
        )

    # Concurrency Revision Check
    try:
        trip = db.trips.find_one({"_id": ObjectId(trip_id)})
    except Exception:
        trip = db.trips.find_one({"id": trip_id})

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    current_rev = int(trip.get("revision", 1))
    exp_rev = expected_revision if expected_revision is not None else saved.get("expected_revision")
    if exp_rev is not None and int(exp_rev) != current_rev:
        raise HTTPException(
            status_code=409,
            detail=f"Concurrent modification detected. Current revision is {current_rev}, expected {exp_rev}. Refresh and try again."
        )

    proposal_data = saved.get("proposal", {})
    revised_trip = proposal_data.get("proposed_trip")
    if not revised_trip:
        raise HTTPException(status_code=422, detail="Proposal does not contain valid revised trip data.")

    new_rev = current_rev + 1
    changes = {
        "route_details": revised_trip.get("route_details") or {},
        "planner_draft": revised_trip.get("planner_draft") or "",
        "budget_breakdown": revised_trip.get("budget_breakdown") or {},
        "final_itinerary": revised_trip.get("final_itinerary"),
        "attractions": revised_trip.get("attractions") or [],
        "revision": new_rev,
        "updated_at": datetime.utcnow().isoformat()
    }
    if proposal_data.get("new_preferences"):
        changes["interests"] = proposal_data["new_preferences"]
        changes["preferences"] = proposal_data["new_preferences"]
    if proposal_data.get("new_travel_style"):
        changes["travel_style"] = proposal_data["new_travel_style"]

    write = db.trips.update_one(revision_filter({"_id": trip["_id"]}, trip), {"$set": changes})
    if write.matched_count != 1:
        raise HTTPException(status_code=409, detail="The itinerary changed while editing. Refresh and try again.")

    db.reroute_proposals.update_one(
        {"_id": saved["_id"]},
        {"$set": {"status": "applied", "applied_at": datetime.utcnow().isoformat()}}
    )

    trip.update(changes)
    trip["id"] = str(trip.pop("_id"))
    from app.services.payment_service import plus_source
    trip["plus_access_source"] = plus_source(db, trip["id"], x_user_id)
    trip["plus_access"] = trip["plus_access_source"] is not None

    return trip


def cancel_preference_revision(
    db,
    trip_id: str,
    proposal_id: str
) -> None:
    """Marks a pending preference revision proposal as cancelled."""
    db.reroute_proposals.update_one(
        {"proposal_id": proposal_id},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.utcnow().isoformat()}}
    )
