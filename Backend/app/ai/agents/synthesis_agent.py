from app.ai.orchestrator.state import TravelState

def synthesis_node(state: TravelState) -> dict:
    destination = state.get("destination", "Destination")
    days = int(state.get("days", 3))
    budget = float(state.get("budget", 50000.0))
    currency = state.get("currency", "INR")
    
    print(f"--- SYNTHESIS AGENT: Generating final concierge summary for {destination} ---")
    
    weather = state.get("weather") or {}
    weather_summary = weather.get("summary") or f"Expected pleasant conditions for exploring {destination}."
    
    budget_breakdown = state.get("budget_breakdown") or {}
    total_cost = budget_breakdown.get("total_trip_cost")
    cost_text = f"Estimated total cost is approximately {total_cost:,.0f} {currency}." if total_cost else f"Target budget allocated: {budget:,.0f} {currency}."
    
    routes = state.get("route_details", {})
    daily_routes = routes.get("day_by_day_route", []) if isinstance(routes, dict) else (routes if isinstance(routes, list) else [])
    total_stops = sum(len(d.get("stops", [])) for d in daily_routes) if daily_routes else 0
    
    # Deterministic concierge synthesis: preserves complete itinerary without consuming LLM OTPM budget
    summary = (
        f"Welcome to your bespoke {days}-day expedition to **{destination}**!\n\n"
        f"We've crafted a seamless day-by-day route featuring {total_stops} curated stops, "
        f"balancing famous must-see landmarks with hidden local gems according to your preferences. "
        f"{cost_text}\n\n"
        f"**Local Forecast:** {weather_summary}\n\n"
        f"Review your complete schedule below and switch to **Companion Mode** when you're ready to start exploring!"
    )
    
    return {
        "final_itinerary": summary,
        "completed_steps": state.get("completed_steps", []) + ["synthesis"]
    }
