from app.ai.orchestrator.state import TravelState

def planner_node(state: TravelState) -> dict:
    destination = state.get("destination", "Destination")
    days = state.get("days", 3)
    budget = state.get("budget", 50000.0)
    currency = state.get("currency", "INR")
    preferences = state.get("preferences") or "General sightseeing and cultural exploration"
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    from dateutil.parser import parse
    from app.ai.agents.route_agent import resolve_destination_timezone
    timezone = resolve_destination_timezone(destination)
    start = parse(state["start_date"]).date() if state.get("start_date") else (datetime.now(ZoneInfo(timezone)) + timedelta(days=7)).date()
    end = parse(state["end_date"]).date() if state.get("end_date") else start + timedelta(days=int(days or 3) - 1)
    days = (end - start).days + 1
    if not destination or destination.lower() in {"unknown", "none"} or not 1 <= days <= 30:
        raise ValueError("A valid destination and a duration between 1 and 30 days are required.")
    
    print(f"--- PLANNER AGENT: Assembling itinerary outline for {destination} ({days} days) ---")
    
    # Deterministic outline generation: fast, zero Groq OTPM consumption, preserves token budget for attraction discovery
    outline = (
        f"# Curated {days}-Day Itinerary for {destination}\n\n"
        f"A bespoke expedition to {destination} planned for {days} days with a target budget of "
        f"{budget:,.0f} {currency}. Curated specifically for: {preferences}.\n\n"
        f"Specialist agents will now retrieve real-time flights, verified hotels, live weather, "
        f"and top-rated attractions."
    )
    
    return {
        "days": days,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "destination_timezone": timezone,
        "planner_draft": outline,
        "completed_steps": state.get("completed_steps", []) + ["planner"]
    }
