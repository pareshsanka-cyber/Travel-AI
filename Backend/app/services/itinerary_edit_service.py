"""Constrained edits to the structured schedule, shared by maps and itinerary text."""
import copy
import json
import re
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
from app.ai.agents.attraction_agent import attraction_node, verify_and_enrich_place
from app.ai.agents.budget_agent import budget_node
from app.ai.agents.synthesis_agent import synthesis_node
from app.utils.activity_identity import generate_persistent_activity_id
from app.utils.place_deduplication import is_same_physical_place, is_place_already_scheduled, clean_display_name, clean_place_name, deduplicate_place_list
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
            # Place after preceding daytime stops, before end-of-day hotel, dinner, or late departure
            if place_type == 'attraction':
                insert_idx = len(stops)
                for i, s in enumerate(stops):
                    st = parse_hhmm_to_minutes(s.get('start_time', '12:00'), 720)
                    stype = s.get('type')
                    if i > 0 and (
                        (stype in {'hotel', 'hotel_checkout'} and st >= 960)
                        or (stype == 'airport' and i == len(stops) - 1)
                        or (stype == 'restaurant' and st >= 1020)
                    ):
                        insert_idx = i
                        break
                if insert_idx > 0:
                    prev = stops[insert_idx - 1]
                    prev_end = parse_hhmm_to_minutes(prev.get('end_time', '12:00'), 720)
                    init_start = max(600, prev_end + 20)
                else:
                    init_start = 600
            else:
                insert_idx = len(stops)
                if stops and stops[-1].get('type') in {'hotel', 'airport'} and len(stops) > 1:
                    insert_idx = len(stops) - 1
                if insert_idx > 0:
                    prev = stops[insert_idx - 1]
                    prev_end = parse_hhmm_to_minutes(prev.get('end_time', '10:00'), 600)
                    init_start = prev_end + 30
                else:
                    init_start = 600
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

    must_visits = [str(mv).strip() for mv in (trip_doc.get("must_visit_places") or []) if str(mv).strip()]
    mv_names = [m.lower() for m in must_visits]

    combined_candidates = []
    for ea in existing_attractions:
        ea_name = (ea.get("name") or ea.get("title") or "").lower().strip()
        is_anchor = (
            ea.get("id") in completed_ids
            or ea.get("is_must_visit")
            or ea.get("must_visit")
            or ea.get("priority_rank") == 0
            or any(is_same_physical_place(ea, {"name": mvn}) or mvn in ea_name or ea_name in mvn for mvn in mv_names)
        )
        if is_anchor:
            ea_copy = copy.deepcopy(ea)
            ea_copy["priority_rank"] = 0
            ea_copy["priority_score"] = 1000
            ea_copy["is_must_visit"] = True
            ea_copy["match_type"] = "must_visit" 
            if not any(is_same_physical_place(ea_copy, c) for c in combined_candidates):
                combined_candidates.append(ea_copy)

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
        "must_visit_places": must_visits,
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
        # First, purge any misplaced duplicates of completed stops from other days in rev_days
        for idx, orig_day in enumerate(orig_days):
            orig_stops = orig_day.get("stops") or []
            for ost in orig_stops:
                if ost.get("id") in completed_ids:
                    for r_idx, r_day in enumerate(rev_days):
                        if r_idx != idx:
                            r_day["stops"] = [
                                s for s in (r_day.get("stops") or [])
                                if not (s.get("id") == ost.get("id") or is_same_physical_place(s, ost))
                            ]
                            r_day["activities"] = r_day["stops"]

        # Second, ensure completed stops are preserved on their exact original day
        for idx, orig_day in enumerate(orig_days):
            if idx < len(rev_days):
                rev_day = rev_days[idx]
                rev_stops = rev_day.get("stops") or []
                orig_stops = orig_day.get("stops") or []

                for ost in orig_stops:
                    if ost.get("id") in completed_ids:
                        existing_in_rev = next(
                            (s for s in rev_stops if s.get("id") == ost.get("id") or is_same_physical_place(s, ost)),
                            None
                        )
                        if not existing_in_rev:
                            replaced = False
                            # Prefer replacing a non-anchor attraction
                            for s_idx, s in enumerate(rev_stops):
                                is_s_anchor = bool(
                                    s.get("is_must_visit")
                                    or s.get("priority_rank") == 0
                                    or any(is_same_physical_place(s, {"name": mvn}) for mvn in mv_names)
                                )
                                if s.get("type") == "attraction" and s.get("id") not in completed_ids and not is_s_anchor:
                                    rev_stops[s_idx] = copy.deepcopy(ost)
                                    replaced = True
                                    break
                            if not replaced:
                                for s_idx, s in enumerate(rev_stops):
                                    if s.get("type") == "attraction" and s.get("id") not in completed_ids:
                                        displaced = rev_stops[s_idx]
                                        rev_stops[s_idx] = copy.deepcopy(ost)
                                        for other_day in rev_days:
                                            other_stops = other_day.get("stops") or []
                                            if other_day != rev_day and not any(is_same_physical_place(displaced, os) for os in other_stops):
                                                other_stops.append(displaced)
                                                other_day["stops"] = other_stops
                                                other_day["activities"] = other_stops
                                                break
                                        replaced = True
                                        break
                            if not replaced:
                                rev_stops.append(copy.deepcopy(ost))
                        else:
                            existing_in_rev.update(copy.deepcopy(ost))
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
    if revised_trip.get("restaurants"):
        changes["restaurants"] = revised_trip["restaurants"]

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


KNOWN_DESTINATION_CANDIDATES = {
    "goa": {
        "temple": [
            {"name": "Mangueshi Temple", "category": "temple", "lat": 15.4419, "lon": 73.9688, "opening_hours": "06:00-22:00", "description": "Historic Hindu temple dedicated to Lord Shiva in Priol.", "duration_minutes": 75},
            {"name": "Shanta Durga Temple", "category": "temple", "lat": 15.3686, "lon": 73.9856, "opening_hours": "07:00-21:30", "description": "Famous temple dedicated to goddess Shanta Durga in Kavlem.", "duration_minutes": 60},
            {"name": "Mahadev Temple Tambdi Surla", "category": "temple", "lat": 15.4398, "lon": 74.2544, "opening_hours": "08:30-17:30", "description": "12th-century Kadamba style basalt rock temple nestled in dense forest.", "duration_minutes": 90},
            {"name": "Basilica of Bom Jesus", "category": "temple", "lat": 15.5009, "lon": 73.9116, "opening_hours": "09:00-18:30", "description": "UNESCO World Heritage site holding the mortal remains of St. Francis Xavier.", "duration_minutes": 90},
            {"name": "Se Cathedral", "category": "temple", "lat": 15.5034, "lon": 73.9126, "opening_hours": "07:30-18:00", "description": "Grand 16th-century Portuguese church known for the Golden Bell.", "duration_minutes": 60}
        ],
        "beach": [
            {"name": "Vagator Beach", "category": "beach", "lat": 15.6030, "lon": 73.7336, "opening_hours": "06:00-23:00", "description": "Dramatic red cliffs overlooking crescent-shaped shoreline.", "duration_minutes": 120},
            {"name": "Anjuna Beach", "category": "beach", "lat": 15.5828, "lon": 73.7425, "opening_hours": "06:00-23:00", "description": "Iconic beach famous for vibrant flea markets and rocky shores.", "duration_minutes": 120},
            {"name": "Baga Beach", "category": "beach", "lat": 15.5553, "lon": 73.7517, "opening_hours": "06:00-23:00", "description": "Popular North Goa beach with beach shacks, lively atmosphere, and watersports.", "duration_minutes": 120},
            {"name": "Calangute Beach", "category": "beach", "lat": 15.5439, "lon": 73.7554, "opening_hours": "06:00-23:00", "description": "Expansive golden shoreline known as the Queen of Beaches.", "duration_minutes": 120},
            {"name": "Palolem Beach", "category": "beach", "lat": 15.0100, "lon": 74.0232, "opening_hours": "06:00-23:00", "description": "Scenic crescent bay with calm waters and palm-fringed sands in South Goa.", "duration_minutes": 120},
            {"name": "Morjim Beach", "category": "beach", "lat": 15.6175, "lon": 73.7368, "opening_hours": "06:00-22:00", "description": "Tranquil nesting beach for Olive Ridley sea turtles.", "duration_minutes": 90}
        ],
        "history": [
            {"name": "Aguada Fort", "category": "monument", "lat": 15.4920, "lon": 73.7737, "opening_hours": "09:30-17:30", "description": "17th-century Portuguese fort and lighthouse overlooking the Arabian Sea.", "duration_minutes": 90},
            {"name": "Chapora Fort", "category": "monument", "lat": 15.6056, "lon": 73.7386, "opening_hours": "09:00-18:00", "description": "Hilltop fort offering panoramic views of Chapora River and Vagator.", "duration_minutes": 75},
            {"name": "Reis Magos Fort", "category": "monument", "lat": 15.4975, "lon": 73.8092, "opening_hours": "09:30-17:30", "description": "Restored coastal fortress with cultural exhibitions and river views.", "duration_minutes": 75}
        ],
        "nature": [
            {"name": "Dudhsagar Falls", "category": "nature", "lat": 15.3144, "lon": 74.3143, "opening_hours": "09:00-17:30", "description": "Four-tiered majestic waterfall cascading down the Western Ghats.", "duration_minutes": 180},
            {"name": "Salim Ali Bird Sanctuary", "category": "nature", "lat": 15.5147, "lon": 73.8686, "opening_hours": "06:00-18:00", "description": "Estuarine mangrove sanctuary along the Mandovi River.", "duration_minutes": 90}
        ],
        "restaurant": [
            {"name": "Fisherman's Wharf", "category": "restaurant", "lat": 15.1764, "lon": 73.9482, "opening_hours": "12:00-23:00", "description": "Riverside dining serving authentic Goan seafood curries.", "duration_minutes": 75},
            {"name": "Martin's Corner", "category": "restaurant", "lat": 15.3052, "lon": 73.9161, "opening_hours": "12:00-23:30", "description": "Celebrated local restaurant renowned for Goan crab and kingfish masala.", "duration_minutes": 75},
            {"name": "Gunpowder", "category": "restaurant", "lat": 15.5898, "lon": 73.7842, "opening_hours": "12:00-23:00", "description": "Coastal South Indian fare in a heritage garden setting.", "duration_minutes": 75},
            {"name": "Britto's", "category": "restaurant", "lat": 15.5562, "lon": 73.7523, "opening_hours": "08:30-23:30", "description": "Legendary beachfront shack serving fresh seafood and desserts in Baga.", "duration_minutes": 75}
        ]
    },
    "jaipur": {
        "history": [
            {"name": "Amber Fort", "category": "monument", "lat": 26.9855, "lon": 75.8513, "opening_hours": "09:00-18:00", "description": "Majestic hilltop fort known for artistic Hindu style elements.", "duration_minutes": 120},
            {"name": "Hawa Mahal", "category": "monument", "lat": 26.9239, "lon": 75.8267, "opening_hours": "09:00-17:00", "description": "Iconic Palace of Winds with 953 honeycomb windows.", "duration_minutes": 60},
            {"name": "City Palace Jaipur", "category": "monument", "lat": 26.9258, "lon": 75.8237, "opening_hours": "09:30-17:00", "description": "Royal residence blending Rajput, Mughal, and European architecture.", "duration_minutes": 90}
        ],
        "temple": [
            {"name": "Birla Mandir Jaipur", "category": "temple", "lat": 26.8920, "lon": 75.8155, "opening_hours": "06:00-21:00", "description": "Stunning white marble Hindu temple dedicated to Lord Vishnu and Goddess Lakshmi.", "duration_minutes": 60},
            {"name": "Govind Dev Ji Temple", "category": "temple", "lat": 26.9290, "lon": 75.8248, "opening_hours": "05:00-21:00", "description": "Historic Krishna temple located within the City Palace complex.", "duration_minutes": 45}
        ]
    },
    "hyderabad": {
        "history": [
            {"name": "Golconda Fort", "category": "monument", "lat": 17.3833, "lon": 78.4011, "opening_hours": "09:00-17:30", "description": "Historic fortified citadel and early capital of the Qutb Shahi dynasty.", "duration_minutes": 120},
            {"name": "Charminar", "category": "monument", "lat": 17.3616, "lon": 78.4747, "opening_hours": "09:30-17:30", "description": "16th-century mosque with four grand minarets, a symbol of Hyderabad.", "duration_minutes": 60},
            {"name": "Chowmahalla Palace", "category": "monument", "lat": 17.3578, "lon": 78.4717, "opening_hours": "10:00-17:00", "description": "Opulent 18th-century palace of the Nizams of Hyderabad.", "duration_minutes": 90},
            {"name": "Qutb Shahi Tombs", "category": "monument", "lat": 17.3917, "lon": 78.3961, "opening_hours": "09:30-16:30", "description": "Grand domed mausoleums of the seven Qutb Shahi rulers in Ibrahim Bagh.", "duration_minutes": 75},
            {"name": "Salar Jung Museum", "category": "museum", "lat": 17.3713, "lon": 78.4804, "opening_hours": "10:00-17:00", "description": "Major art museum with one of the largest one-man collections in the world.", "duration_minutes": 120},
            {"name": "Mecca Masjid", "category": "monument", "lat": 17.3606, "lon": 78.4735, "opening_hours": "04:00-21:30", "description": "One of the oldest and largest mosques in India commissioned by Muhammad Quli Qutb Shah.", "duration_minutes": 45}
        ],
        "attraction": [
            {"name": "Hussain Sagar Lake & Buddha Statue", "category": "nature", "lat": 17.4239, "lon": 78.4738, "opening_hours": "08:00-22:00", "description": "Scenic heart-shaped lake featuring the giant monolithic Buddha statue in the center.", "duration_minutes": 90},
            {"name": "Birla Mandir Hyderabad", "category": "temple", "lat": 17.4062, "lon": 78.4691, "opening_hours": "07:00-21:00", "description": "Spectacular white Rajasthani marble temple built atop the Naubat Pahad hill.", "duration_minutes": 60},
            {"name": "Lumbini Park", "category": "nature", "lat": 17.4156, "lon": 78.4750, "opening_hours": "09:00-21:00", "description": "Waterfront urban park adjacent to Hussain Sagar with laser shows and boat rides.", "duration_minutes": 60},
            {"name": "Ramoji Film City", "category": "entertainment", "lat": 17.2543, "lon": 78.6808, "opening_hours": "09:00-17:30", "description": "World's largest integrated film studio complex and thematic amusement park.", "duration_minutes": 180},
            {"name": "Nehru Zoological Park", "category": "nature", "lat": 17.3512, "lon": 78.4503, "opening_hours": "08:30-17:00", "description": "Expansive 380-acre wildlife sanctuary housing rare species and safari park.", "duration_minutes": 120},
            {"name": "Shilparamam", "category": "culture", "lat": 17.4526, "lon": 78.3776, "opening_hours": "10:30-20:00", "description": "Traditional arts, crafts, and cultural village showcasing Indian heritage and performances.", "duration_minutes": 90}
        ],
        "restaurant": [
            {"name": "Bawarchi Restaurant", "category": "restaurant", "lat": 17.4024, "lon": 78.4988, "opening_hours": "11:30-23:30", "description": "Iconic culinary institution at RTC X Roads renowned for authentic Dum Biryani.", "duration_minutes": 75},
            {"name": "Paradise Biryani", "category": "restaurant", "lat": 17.4416, "lon": 78.4872, "opening_hours": "11:00-23:00", "description": "Historic dining brand in Secunderabad serving traditional Hyderabadi cuisine.", "duration_minutes": 75},
            {"name": "Jewel of Nizam - The Minar", "category": "restaurant", "lat": 17.3484, "lon": 78.3683, "opening_hours": "12:30-23:30", "description": "Fine-dining tower restaurant serving royal Nizami cuisine with Osman Sagar views.", "duration_minutes": 90},
            {"name": "The Water Front", "category": "restaurant", "lat": 17.4267, "lon": 78.4683, "opening_hours": "12:00-23:30", "description": "Lakeside dining pavilion overlooking Hussain Sagar with North Indian and Mughlai dishes.", "duration_minutes": 75}
        ]
    }
}


def resolve_candidate_places(
    destination: str,
    replacement_name: Optional[str],
    replacement_category: Optional[str],
    current_stops: List[Dict[str, Any]],
    trip_catalog: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """Resolves or discovers realistic candidate attractions or restaurants for itinerary replacement/addition, ensuring multi-day uniqueness."""
    dest_clean = destination.lower().split(',')[0].strip()
    catalog = trip_catalog or []

    # Check if replacement_name is a generic placeholder rather than a specific venue
    if replacement_name:
        clean_repl = re.sub(r'[^\w\s]', '', replacement_name.lower().strip())
        generic_placeholders = {
            "any attraction", "an attraction", "attraction", "attractions", "something",
            "a place", "any place", "sightseeing", "dinner", "an attraction or dinner",
            "attraction or dinner", "a restaurant", "restaurant", "food", "dinner spot",
            "lunch", "meal", "somewhere", "any spot", "a spot", "another attraction",
            "new attraction", "some attraction", "another place", "some place"
        }
        if clean_repl in generic_placeholders:
            if any(w in clean_repl for w in ("dinner", "restaurant", "lunch", "food", "meal")):
                replacement_category = "restaurant"
            else:
                replacement_category = "attraction"
            replacement_name = None

    # 1. If explicit replacement name is provided:
    if replacement_name:
        # Check if already in current multi-day itinerary
        if is_place_already_scheduled({"name": replacement_name}, current_stops):
            raise ValueError(f"'{replacement_name}' is already included in this itinerary.")

        # Check trip catalog
        for item in catalog:
            if clean_place_name(item.get("name") or "") == clean_place_name(replacement_name):
                return [copy.deepcopy(item)]

        # Check known destination candidates
        dest_dict = KNOWN_DESTINATION_CANDIDATES.get(dest_clean, {})
        for cat_list in dest_dict.values():
            for c in cat_list:
                if clean_place_name(c.get("name") or "") == clean_place_name(replacement_name):
                    return [copy.deepcopy(c)]

        # Live / Nominatim enrichment
        enriched = verify_and_enrich_place(replacement_name, destination)
        if enriched and enriched.get("lat") and enriched.get("lon"):
            return [{
                "name": replacement_name,
                "title": replacement_name,
                "category": replacement_category or "attraction",
                "lat": enriched["lat"],
                "lon": enriched["lon"],
                "address": enriched.get("address"),
                "description": f"Visit {replacement_name}.",
                "image_url": enriched.get("image_url"),
                "opening_hours": enriched.get("opening_hours") or "09:00-18:00",
                "duration_minutes": 90
            }]

        # Fallback with destination anchor coordinates if enrichment was network-restricted
        dest_coords = {
            "goa": (15.4989, 73.8278),
            "jaipur": (26.9124, 75.7873),
            "hyderabad": (17.3850, 78.4867)
        }
        fallback_coord = dest_coords.get(dest_clean, (15.4989, 73.8278))
        return [{
            "name": replacement_name,
            "title": replacement_name,
            "category": replacement_category or "attraction",
            "lat": fallback_coord[0],
            "lon": fallback_coord[1],
            "description": f"Visit {replacement_name}.",
            "opening_hours": "09:00-18:00",
            "duration_minutes": 90
        }]

    # 2. If replacement category is provided (or generic):
    cat = (replacement_category or "attraction").lower()
    is_restaurant = any(w in cat for w in ("restaurant", "food", "dining", "dinner", "lunch", "cafe", "meal"))

    candidates = []
    dest_dict = KNOWN_DESTINATION_CANDIDATES.get(dest_clean, {})

    if is_restaurant:
        cat_candidates = dest_dict.get("restaurant") or []
        for cand in cat_candidates:
            if not is_place_already_scheduled(cand, current_stops):
                candidates.append(cand)
    elif cat in dest_dict:
        # User specified a specific known category like "temple", "beach", "history"
        for cand in dest_dict[cat]:
            if not is_place_already_scheduled(cand, current_stops):
                candidates.append(cand)
        # Also include other attraction categories as fallbacks
        for k, v in dest_dict.items():
            if k != cat and k not in {"restaurant", "cafe", "food", "dining"}:
                for cand in v:
                    if not is_place_already_scheduled(cand, current_stops):
                        candidates.append(cand)
    else:
        # Generic attraction request ("attraction", "sightseeing", "nature", etc.)
        # Check matching keys first
        for k, v in dest_dict.items():
            if k not in {"restaurant", "cafe", "food", "dining"} and (k in cat or cat in k):
                for cand in v:
                    if not is_place_already_scheduled(cand, current_stops):
                        candidates.append(cand)
        # Then all other non-restaurant categories
        for k, v in dest_dict.items():
            if k not in {"restaurant", "cafe", "food", "dining"} and not (k in cat or cat in k):
                for cand in v:
                    if not is_place_already_scheduled(cand, current_stops):
                        candidates.append(cand)

    # Check trip catalog matching category
    for item in catalog:
        item_cat = (item.get("category") or "").lower()
        item_type = (item.get("type") or "").lower()
        if is_restaurant:
            if any(w in item_cat or w in item_type for w in ("restaurant", "food", "dining", "dinner", "lunch", "cafe")):
                if not is_place_already_scheduled(item, current_stops):
                    candidates.append(item)
        else:
            if not any(w in item_cat or w in item_type for w in ("restaurant", "food", "dining", "cafe")):
                if not is_place_already_scheduled(item, current_stops):
                    candidates.append(item)

    # Deduplicate candidates by physical place
    unique_candidates = deduplicate_place_list(candidates)
    if unique_candidates:
        return [copy.deepcopy(c) for c in unique_candidates]

    # Fallback to attraction discovery node
    try:
        discovery_out = attraction_node({
            "destination": destination,
            "interests": [cat],
            "preferences": [cat],
            "travel_style": "STANDARD",
            "pace": "balanced",
            "candidate_count": 6
        })
        disc_candidates = []
        for disc in (discovery_out.get("attractions") or []):
            if not is_place_already_scheduled(disc, current_stops):
                disc_candidates.append(copy.deepcopy(disc))
        if disc_candidates:
            return disc_candidates
    except Exception:
        pass

    return []


def resolve_candidate_place(
    destination: str,
    replacement_name: Optional[str],
    replacement_category: Optional[str],
    current_stops: List[Dict[str, Any]],
    trip_catalog: Optional[List[Dict[str, Any]]] = None
) -> Optional[Dict[str, Any]]:
    """Resolves a single realistic candidate attraction or restaurant for itinerary replacement/addition."""
    places = resolve_candidate_places(destination, replacement_name, replacement_category, current_stops, trip_catalog)
    return places[0] if places else None


def generate_single_activity_revision_proposal(
    trip_doc: Dict[str, Any],
    resolution: Dict[str, Any],
    active_segment_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generates an optimistically locked revision proposal for single-activity edits (replace, add, remove, move).
    Verifies constraints:
    - Protects completed and in-progress activities
    - Protects travel and hotel commitments
    - Enforces physical deduplication and opening hours
    - Computes diff summary (added, removed, kept, rescheduled)
    """
    action = resolution["action"]
    target_stop = resolution.get("target_stop")
    day_number = resolution.get("day_number", 1)
    dest_day_number = resolution.get("dest_day_number")
    target_slot = resolution.get("target_slot")
    replacement_name = resolution.get("replacement_name")
    replacement_cat = resolution.get("replacement_category")

    dest = trip_doc.get("destination", "Destination")
    curr_rev = int(trip_doc.get("revision", 1))
    proposal_id = f"prop_{secrets.token_urlsafe(16)}"
    expires_at = datetime.utcnow() + timedelta(minutes=15)

    execution_state = trip_doc.get("execution_state") or {}
    activity_log = execution_state.get("activity_log") or {}
    completed_ids = {aid for aid, entry in activity_log.items() if entry.get("status") in {"completed", "in_progress"}}
    if active_segment_id:
        completed_ids.add(active_segment_id)

    # Protection Guard for target stop
    if target_stop:
        if target_stop.get("id") in completed_ids:
            raise ValueError(f"'{target_stop.get('name')}' is already completed or in-progress and cannot be modified.")
        if target_stop.get("type") in {"airport", "hotel", "hotel_checkout", "breakfast"}:
            raise ValueError("Travel and accommodation commitments are protected and cannot be modified.")

    revised_trip = copy.deepcopy(trip_doc)
    days = revised_trip.get("route_details", {}).get("day_by_day_route", [])
    if not days:
        raise ValueError("Trip does not contain valid day routes.")

    all_current_stops = [s for d in days for s in (d.get("stops") or d.get("activities") or [])]
    trip_catalog = (revised_trip.get("attractions") or []) + (revised_trip.get("restaurants") or [])

    new_place = None
    old_place_name = target_stop.get("name") if target_stop else None

    # --- ACTION: REPLACE ---
    if action == "replace":
        if not target_stop:
            raise ValueError("Could not identify which activity you want to replace.")

        target_day = next((d for i, d in enumerate(days) if int(d.get("day") or d.get("day_number") or i + 1) == int(day_number)), None)
        if not target_day:
            raise ValueError(f"Day {day_number} does not exist in this itinerary.")

        stops = target_day.get("stops") or target_day.get("activities") or []
        stop_idx = next((i for i, s in enumerate(stops) if s.get("id") == target_stop.get("id")), None)
        if stop_idx is None:
            raise ValueError(f"'{target_stop.get('name')}' was not found on Day {day_number}.")

        other_stops = [s for s in all_current_stops if s.get("id") != target_stop.get("id")]
        candidate_places = resolve_candidate_places(dest, replacement_name, replacement_cat, other_stops, trip_catalog)
        if target_stop:
            candidate_places = [c for c in candidate_places if not is_same_physical_place(c, target_stop)]
        if not candidate_places:
            raise ValueError(f"Could not find a suitable replacement {replacement_name or replacement_cat or 'place'}.")

        best_stops = None
        best_new_stop = None
        best_place_name = None
        best_place_type = None
        best_error = None

        for new_place in candidate_places:
            cat = str(new_place.get("category") or "").lower()
            place_type = new_place.get("type") or ("restaurant" if any(w in cat for w in ("restaurant", "food", "cafe", "dining")) else "attraction")
            duration = int(new_place.get("duration_minutes") or target_stop.get("duration_minutes") or 90)

            start_time_val = target_stop.get("start_time", "10:00")
            start_min = parse_hhmm_to_minutes(start_time_val, 600)
            end_min = start_min + duration

            trial_stops = [dict(s) for s in stops]
            new_stop = {
                "id": generate_persistent_activity_id(place_type, new_place["name"], new_place.get("place_id")),
                "title": new_place["name"],
                "name": new_place["name"],
                "type": place_type,
                "category": new_place.get("category") or place_type,
                "lat": new_place.get("lat") if new_place.get("lat") is not None else new_place.get("latitude"),
                "lon": new_place.get("lon") if new_place.get("lon") is not None else new_place.get("longitude"),
                "address": new_place.get("address"),
                "description": new_place.get("description") or f"Visit {new_place['name']}.",
                "image_url": new_place.get("image_url"),
                "opening_hours": new_place.get("opening_hours") or "09:00-18:00",
                "duration_minutes": duration,
                "start_time": minutes_to_hhmm(start_min),
                "end_time": minutes_to_hhmm(end_min),
                "time": format_time_range(start_min, end_min),
                "travel_mode": "driving"
            }
            trial_stops[stop_idx] = new_stop
            try:
                reflow_day(revised_trip, target_day, trial_stops, allow_hotel_shift=True)
                best_stops = trial_stops
                best_new_stop = new_stop
                best_place_name = new_stop["name"]
                best_place_type = place_type
                break
            except Exception as e:
                best_error = e

        if not best_stops:
            raise best_error or ValueError(f"Could not fit a suitable replacement into Day {day_number}.")

        stops = best_stops
        new_stop = best_new_stop
        target_day["stops"] = stops
        target_day["activities"] = stops

        # Update catalog
        catalog_key = "restaurants" if best_place_type == "restaurant" else "attractions"
        cat_list = revised_trip.setdefault(catalog_key, [])
        if not any(c.get("name") == best_place_name for c in cat_list):
            cat_list.append(new_stop)

        explanation = f"Replaced {old_place_name} with {new_stop['name']} on Day {day_number}."

    # --- ACTION: ADD ---
    elif action == "add":
        target_day_num = dest_day_number or day_number or 1
        target_day = next((d for i, d in enumerate(days) if int(d.get("day") or d.get("day_number") or i + 1) == int(target_day_num)), None)
        if not target_day:
            raise ValueError(f"Day {target_day_num} does not exist in this itinerary.")

        candidate_places = resolve_candidate_places(dest, replacement_name, replacement_cat, all_current_stops, trip_catalog)
        if not candidate_places:
            raise ValueError(f"Could not find a suitable attraction or restaurant to add to Day {target_day_num}.")

        stops = target_day.get("stops") or target_day.get("activities") or []
        best_stops = None
        best_new_stop = None
        best_place_name = None
        best_place_type = None
        best_error = None

        for new_place in candidate_places:
            place_name = new_place.get("name") or replacement_name or "Sightseeing Spot"
            if is_place_already_scheduled({"name": place_name, **new_place}, all_current_stops):
                continue

            cat = str(new_place.get("category") or "").lower()
            place_type = new_place.get("type") or ("restaurant" if any(w in cat for w in ("restaurant", "food", "cafe", "dining")) else "attraction")
            duration = int(new_place.get("duration_minutes") or 90)

            candidate_indices = []
            if target_slot == "morning":
                m_idx = 0 if not stops or stops[0].get("type") != "breakfast" else 1
                candidate_indices.append((m_idx, 570))
            elif target_slot == "before_lunch":
                lunch_idx = next((i for i, s in enumerate(stops) if s.get("type") == "restaurant"), len(stops))
                candidate_indices.append((max(0, lunch_idx), 660))
            elif target_slot == "evening":
                ins_idx = len(stops)
                for i, s in enumerate(stops):
                    st = parse_hhmm_to_minutes(s.get('start_time', '12:00'), 720)
                    stype = s.get('type')
                    if i > 0 and (
                        (stype in {'hotel', 'hotel_checkout'} and st >= 1140)
                        or (stype == 'airport' and i == len(stops) - 1 and st >= 1140)
                    ):
                        ins_idx = i
                        break
                init_s = 1080
                if ins_idx > 0:
                    prev_e = parse_hhmm_to_minutes(stops[ins_idx - 1].get("end_time", "17:00"), 1020)
                    init_s = max(1020, prev_e + 20)
                candidate_indices.append((ins_idx, init_s))
            elif place_type == "attraction":
                ins_idx = len(stops)
                for i, s in enumerate(stops):
                    st = parse_hhmm_to_minutes(s.get('start_time', '12:00'), 720)
                    stype = s.get('type')
                    if i > 0 and (
                        (stype in {'hotel', 'hotel_checkout'} and st >= 960)
                        or (stype == 'airport' and i == len(stops) - 1 and st >= 960)
                        or (stype == 'restaurant' and st >= 1020)
                    ):
                        ins_idx = i
                        break
                init_s = 600
                if ins_idx > 0:
                    prev_e = parse_hhmm_to_minutes(stops[ins_idx - 1].get("end_time", "12:00"), 720)
                    init_s = max(600, prev_e + 20)
                candidate_indices.append((ins_idx, init_s))
                m_idx = 0 if not stops or stops[0].get("type") != "breakfast" else 1
                if m_idx != ins_idx:
                    candidate_indices.append((m_idx, 570))
                l_idx = next((i for i, s in enumerate(stops) if s.get("type") == "restaurant"), len(stops))
                if l_idx not in {ins_idx, m_idx}:
                    candidate_indices.append((l_idx, 660))
            else:
                ins_idx = len(stops)
                if stops and stops[-1].get("type") in {"hotel", "airport"} and len(stops) > 1:
                    ins_idx = len(stops) - 1
                init_s = 600
                if ins_idx > 0:
                    prev_e = parse_hhmm_to_minutes(stops[ins_idx - 1].get("end_time", "10:00"), 600)
                    init_s = prev_e + 30
                candidate_indices.append((ins_idx, init_s))

            for c_idx, c_start in candidate_indices:
                trial_stops = [dict(s) for s in stops]
                new_stop = {
                    "id": generate_persistent_activity_id(place_type, place_name, new_place.get("place_id")),
                    "title": place_name,
                    "name": place_name,
                    "type": place_type,
                    "category": new_place.get("category") or place_type,
                    "lat": new_place.get("lat") if new_place.get("lat") is not None else new_place.get("latitude"),
                    "lon": new_place.get("lon") if new_place.get("lon") is not None else new_place.get("longitude"),
                    "address": new_place.get("address"),
                    "description": new_place.get("description") or f"Visit {place_name}.",
                    "image_url": new_place.get("image_url"),
                    "opening_hours": new_place.get("opening_hours") or "09:00-18:00",
                    "duration_minutes": duration,
                    "start_time": minutes_to_hhmm(c_start),
                    "end_time": minutes_to_hhmm(c_start + duration),
                    "time": format_time_range(c_start, c_start + duration),
                    "travel_mode": "driving"
                }
                trial_stops.insert(c_idx, new_stop)
                try:
                    reflow_day(revised_trip, target_day, trial_stops, allow_hotel_shift=True)
                    best_stops = trial_stops
                    best_new_stop = new_stop
                    best_place_name = place_name
                    best_place_type = place_type
                    break
                except Exception as e:
                    best_error = e

            if best_stops:
                break

        if not best_stops:
            raise best_error or ValueError(f"Could not fit a suitable new attraction into Day {target_day_num} opening hours.")

        stops = best_stops
        new_stop = best_new_stop
        target_day["stops"] = stops
        target_day["activities"] = stops

        catalog_key = "restaurants" if best_place_type == "restaurant" else "attractions"
        cat_list = revised_trip.setdefault(catalog_key, [])
        if not any(c.get("name") == best_place_name for c in cat_list):
            cat_list.append(new_stop)

        explanation = f"Added {best_place_name} to Day {target_day_num}."

    # --- ACTION: REMOVE ---
    elif action == "remove":
        if not target_stop:
            raise ValueError("Could not identify which activity you want to remove.")

        target_day = next((d for i, d in enumerate(days) if int(d.get("day") or d.get("day_number") or i + 1) == int(day_number)), None)
        if not target_day:
            raise ValueError(f"Day {day_number} does not exist.")

        stops = target_day.get("stops") or target_day.get("activities") or []
        stop_to_remove = next((s for s in stops if s.get("id") == target_stop.get("id")), None)
        if not stop_to_remove:
            raise ValueError(f"'{target_stop.get('name')}' was not found on Day {day_number}.")

        stops.remove(stop_to_remove)
        reflow_day(revised_trip, target_day, stops, allow_hotel_shift=True)
        target_day["stops"] = stops
        target_day["activities"] = stops

        explanation = f"Removed {old_place_name} from Day {day_number}."

    # --- ACTION: MOVE ---
    elif action == "move":
        if not target_stop:
            raise ValueError("Could not identify which activity you want to move.")

        src_day = next((d for i, d in enumerate(days) if int(d.get("day") or d.get("day_number") or i + 1) == int(day_number)), None)
        if not src_day:
            raise ValueError(f"Source Day {day_number} does not exist.")

        dest_day_num = dest_day_number or day_number
        dest_day = next((d for i, d in enumerate(days) if int(d.get("day") or d.get("day_number") or i + 1) == int(dest_day_num)), None)
        if not dest_day:
            raise ValueError(f"Destination Day {dest_day_num} does not exist.")

        src_stops = src_day.get("stops") or src_day.get("activities") or []
        stop_to_move = next((s for s in src_stops if s.get("id") == target_stop.get("id")), None)
        if not stop_to_move:
            raise ValueError(f"'{target_stop.get('name')}' was not found on Day {day_number}.")

        src_stops.remove(stop_to_move)
        reflow_day(revised_trip, src_day, src_stops, allow_hotel_shift=True)
        src_day["stops"] = src_stops
        src_day["activities"] = src_stops

        dest_stops = dest_day.get("stops") or dest_day.get("activities") or []
        
        # Position according to target_slot
        if target_slot == "morning":
            dest_stops.insert(0 if not dest_stops or dest_stops[0].get("type") != "breakfast" else 1, stop_to_move)
        elif target_slot == "before_lunch":
            lunch_idx = next((i for i, s in enumerate(dest_stops) if s.get("type") == "restaurant"), len(dest_stops) - 1)
            dest_stops.insert(max(0, lunch_idx), stop_to_move)
        elif target_slot == "evening":
            ins_idx = len(dest_stops) - 1 if dest_stops and dest_stops[-1].get("type") in {"hotel", "airport"} else len(dest_stops)
            dest_stops.insert(ins_idx, stop_to_move)
        else:
            ins_idx = len(dest_stops) - 1 if dest_stops and dest_stops[-1].get("type") in {"hotel", "airport"} else len(dest_stops)
            dest_stops.insert(ins_idx, stop_to_move)

        reflow_day(revised_trip, dest_day, dest_stops, allow_hotel_shift=True)
        dest_day["stops"] = dest_stops
        dest_day["activities"] = dest_stops

        explanation = f"Moved {old_place_name} to Day {dest_day_num}."

    else:
        raise ValueError(f"Unsupported action: '{action}'.")

    # Verify the edited / added place does not duplicate any other venue
    if action in {"replace", "add"} and new_stop:
        other_stops = [
            s for d in days for s in (d.get("stops") or [])
            if s.get("type") in {"attraction", "restaurant"} and s.get("id") != new_stop.get("id")
        ]
        if any(is_same_physical_place(new_stop, o) for o in other_stops):
            raise ValueError(f"Duplicate venue detected: '{new_stop['name']}'. Each physical place can only be visited once unless explicitly requested.")

    # Re-render schedule outline and update budget & synthesis
    revised_trip["planner_draft"] = render_schedule(revised_trip["route_details"])
    revised_trip.update(budget_node(revised_trip))
    revised_trip.update(synthesis_node(revised_trip))

    # Calculate diff categories
    orig_stops = [s for d in trip_doc.get("route_details", {}).get("day_by_day_route", []) for s in (d.get("stops") or []) if s.get("type") in {"attraction", "restaurant"}]
    prop_stops = [s for d in days for s in (d.get("stops") or []) if s.get("type") in {"attraction", "restaurant"}]

    added = []
    for p in prop_stops:
        if not any(is_same_physical_place(p, o) for o in orig_stops):
            p_name = clean_display_name(p.get("name") or p.get("title") or "")
            if p_name and p_name not in added:
                added.append(p_name)

    removed = []
    if action in {"remove", "replace"} and old_place_name:
        clean_old = clean_display_name(old_place_name)
        if clean_old:
            removed.append(clean_old)

    for o in orig_stops:
        if not any(is_same_physical_place(o, p) for p in prop_stops):
            o_name = clean_display_name(o.get("name") or o.get("title") or "")
            if o_name and o_name not in removed:
                removed.append(o_name)

    kept = []
    for p in prop_stops:
        if any(is_same_physical_place(p, o) for o in orig_stops):
            p_name = clean_display_name(p.get("name") or p.get("title") or "")
            if p_name and p_name not in kept and p_name not in added and p_name not in removed:
                kept.append(p_name)

    rescheduled = []
    for p in prop_stops:
        matching = next((o for o in orig_stops if is_same_physical_place(p, o)), None)
        if matching and matching.get("start_time") != p.get("start_time"):
            rescheduled.append({
                "name": clean_display_name(p.get("name") or p.get("title") or ""),
                "old_time": matching.get("start_time"),
                "new_time": p.get("start_time")
            })

    trip_id = str(trip_doc.get("_id") or trip_doc.get("id"))
    clean_dest = dest.split(',')[0].strip()

    return {
        "proposal_id": proposal_id,
        "trip_id": trip_id,
        "expected_revision": curr_rev,
        "destination": clean_dest,
        "days": trip_doc.get("days", 3),
        "focus_description": explanation,
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
