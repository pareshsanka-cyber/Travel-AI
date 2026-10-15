from app.ai.orchestrator.state import TravelState

def reviewer_node(state: TravelState) -> dict:
    destination = state.get("destination") or "Unknown"
    currency = state.get("currency") or "INR"
    days = int(state.get("days") or 3)
    budget = float(state.get("budget") or 50000.0)
    
    print(f"--- REVIEWER AGENT: Deterministic audit of trip plan for {destination} ({currency}) ---")
    
    # 1. Verify destination is valid
    if not destination or destination.lower() in ["unknown", "none"]:
        return {
            "is_approved": False,
            "reviewer_feedback": "Destination is missing or invalid.",
            "completed_steps": state.get("completed_steps", []) + ["reviewer"]
        }
        
    # 2. Verify days constraint
    if days < 1:
        return {
            "is_approved": False,
            "reviewer_feedback": "Duration must be at least 1 day.",
            "completed_steps": state.get("completed_steps", []) + ["reviewer"]
        }
        
    # Validate the actual structured schedule, which drives maps and companion mode.
    from app.services.trip_consistency import clock_minutes
    routes = (state.get("route_details") or {}).get("day_by_day_route", [])
    try:
        if len(routes) != days:
            raise ValueError("Schedule does not cover the requested duration.")
        identities = set()
        from datetime import datetime, timedelta, timezone
        from zoneinfo import ZoneInfo
        for day in routes:
            previous_end = None
            for stop in day.get("stops", []):
                start, end = clock_minutes(stop["start_time"]), clock_minutes(stop["end_time"])
                local_midnight = datetime.fromisoformat(day.get('date') or state.get('start_date') or '2000-01-01').replace(tzinfo=ZoneInfo(stop.get('timezone') or state.get('destination_timezone') or 'Asia/Kolkata'))
                start_instant = (local_midnight + timedelta(minutes=start)).astimezone(timezone.utc)
                end_instant = (local_midnight + timedelta(minutes=end)).astimezone(timezone.utc)
                if not stop.get("id") or stop["id"] in identities or (previous_end is not None and start_instant < previous_end) or end <= start:
                    raise ValueError("Schedule contains duplicate activities, overlaps, or invalid durations.")
                if stop.get("status") == "CLOSED":
                    raise ValueError("Schedule contains a venue closed during the visit.")
                identities.add(stop["id"])
                previous_end = end_instant
    except (ValueError, KeyError) as error:
        return {"is_approved": False, "reviewer_feedback": str(error), "completed_steps": ["reviewer"]}

    # 3. Check budget breakdown
    budget_breakdown = state.get("budget_breakdown") or {}
    total_cost = float(budget_breakdown.get("total_trip_cost", 0.0))
    is_under_budget = total_cost <= budget
    if not is_under_budget and state.get('budget_mode') == 'FIXED':
        return {'is_approved': False, 'reviewer_feedback': 'Known costs exceed your fixed budget. Increase it or adjust the trip.', 'completed_steps': ['reviewer']}
    
    feedback = "Schedule validated. Budget is a known-cost subtotal; unknown prices require confirmation."
    if not is_under_budget and budget > 0:
        feedback = f"Approved with budget note: Total estimated expenditure ({total_cost:,.0f} {currency}) exceeds target budget ({budget:,.0f} {currency})."
        
    print(f"--- REVIEWER AGENT: {feedback} ---")
    
    return {
        "is_approved": True,
        "reviewer_feedback": feedback,
        "completed_steps": state.get("completed_steps", []) + ["reviewer"]
    }
