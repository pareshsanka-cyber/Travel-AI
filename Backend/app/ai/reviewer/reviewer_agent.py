from app.ai.orchestrator.state import TravelState

def reviewer_node(state: TravelState) -> dict:
    destination = state.get("destination") or "Destination"
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
        
    # 3. Check budget breakdown
    budget_breakdown = state.get("budget_breakdown") or {}
    total_cost = float(budget_breakdown.get("total_trip_cost", 0.0))
    is_under_budget = total_cost <= (budget * 1.5)  # Allow reasonable flexibility
    
    feedback = "Approved: Itinerary verified against duration, destination, and budget constraints."
    if not is_under_budget and budget > 0:
        feedback = f"Approved with budget note: Total estimated expenditure ({total_cost:,.0f} {currency}) exceeds target budget ({budget:,.0f} {currency})."
        
    print(f"--- REVIEWER AGENT: {feedback} ---")
    
    return {
        "is_approved": True,
        "reviewer_feedback": feedback,
        "completed_steps": state.get("completed_steps", []) + ["reviewer"]
    }
