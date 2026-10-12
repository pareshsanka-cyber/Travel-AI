from app.ai.orchestrator.state import TravelState

def planner_node(state: TravelState) -> dict:
    destination = state.get("destination", "Destination")
    days = state.get("days", 3)
    budget = state.get("budget", 50000.0)
    currency = state.get("currency", "INR")
    preferences = state.get("preferences") or "General sightseeing and cultural exploration"
    
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
        "planner_draft": outline,
        "completed_steps": state.get("completed_steps", []) + ["planner"]
    }
