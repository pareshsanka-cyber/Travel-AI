from app.ai.llm import llm
from app.ai.orchestrator.state import TravelState
from langchain_core.prompts import ChatPromptTemplate
import json

def budget_node(state: TravelState) -> dict:
    currency = state.get("currency", "INR")
    user_budget = float(state.get("budget") or (70000.0 if currency == "INR" else 1000.0))
    travelers = int(state.get("travelers") or 2)
    
    print(f"--- BUDGET AGENT: Calculating expenses for {state.get('destination')} ({travelers} travelers, budget {user_budget} {currency}) ---")
    
    flights = state.get("flights") or []
    if state.get('selections'):
        from app.services.trip_service import planning_options
        selected = dict(planning_options(state, 'flight')).get(state['selections'].get('flight_id'))
        flights = [selected] if selected else flights
    flight_cost = float(flights[0].get("total_price", float(flights[0].get("price", 0)) * travelers)) if flights else 0.0
    
    hotels = state.get("hotels") or []
    if state.get('selections'):
        from app.services.trip_service import planning_options
        selected = dict(planning_options(state, 'hotel')).get(state['selections'].get('hotel_id'))
        hotels = [selected] if selected else hotels
    hotel_cost = float(hotels[0].get("total_cost", 0)) if hotels else 0.0
    
    attractions = state.get("attractions") or []
    scheduled = {s.get("name") for d in (state.get("route_details") or {}).get("day_by_day_route", []) for s in d.get("stops", []) if s.get("type") == "attraction"}
    activities_cost = sum(float(a.get("entrance_fee", 0)) for a in attractions if "entrance_fee" in a and (not state.get("route_details") or a.get("name") in scheduled)) * travelers
    
    gastronomy_cost = 0.0
    
    missing = ["food", "local transport"]
    if not flights:
        missing.append("flights")
    elif not (state.get("flight_metadata") or {}).get("return_date"):
        missing.append("return flight, if required")
    if not hotels or not hotels[0].get("total_cost"):
        missing.append("accommodation")
    if any("entrance_fee" not in a for a in attractions if not scheduled or a.get("name") in scheduled):
        missing.append("some attraction fees")
    total_exp = flight_cost + hotel_cost + activities_cost + gastronomy_cost
    unallocated_buffer = max(0.0, round(user_budget - total_exp, 2))
    
    return {
        "budget_breakdown": {
            "flight_cost": flight_cost,
            "hotel_cost": hotel_cost,
            "gastronomy_cost": gastronomy_cost,
            "activities_cost": activities_cost,
            "unallocated_buffer": unallocated_buffer,
            "total_trip_cost": total_exp,
            "remaining_budget": unallocated_buffer,
            "is_under_budget": total_exp <= user_budget,
            "travelers": travelers,
            "currency": currency,
            "totalBudget": user_budget,
            "is_complete": False,
            "missing_categories": missing,
            "notes": "Known-cost subtotal only. Excludes " + ", ".join(missing) + ". Confirm prices with providers."
        },
        "completed_steps": state.get("completed_steps", []) + ["flights", "hotels", "weather", "attractions", "restaurants", "budget"]
    }
