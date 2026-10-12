from datetime import datetime, timedelta
from app.ai.orchestrator.state import TravelState

def determine_status_from_hours(opening_hours, target_date: datetime) -> tuple[str, str]:
    if not opening_hours:
        return "UNKNOWN", "No verified operating hours available."
        
    target_day_name = target_date.strftime("%A").lower()
    
    hours_str = ""
    if isinstance(opening_hours, list):
        for h in opening_hours:
            if target_day_name in str(h).lower():
                hours_str = str(h)
                break
        if not hours_str and opening_hours:
            hours_str = str(opening_hours[0])
    elif isinstance(opening_hours, dict):
        hours_str = str(opening_hours.get(target_day_name, ""))
    elif isinstance(opening_hours, str):
        hours_str = opening_hours

    if not hours_str:
        return "OPEN", "Regular operational status expected."
        
    if "closed" in hours_str.lower():
        return "CLOSED", f"Scheduled day ({target_day_name.title()}) is listed as closed."
        
    return "OPEN", f"Open: {hours_str}"


def opening_hours_node(state: TravelState) -> dict:
    destination = state.get("destination", "")
    attractions = state.get("attractions") or []
    days = int(state.get("days") or 3)
    
    print(f"--- OPENING HOURS AGENT: Evaluating operating schedules for {len(attractions)} attractions in {destination} ---")
    
    start_date = datetime.now() + timedelta(days=30)
    validated_attractions = []
    
    for i, attr in enumerate(attractions):
        target_date = start_date + timedelta(days=i % days)
        hours = attr.get("opening_hours")
        status, reason = determine_status_from_hours(hours, target_date)
        
        attr["status"] = status
        attr["reason"] = reason
        attr["source"] = attr.get("source") or "serpapi_google_maps"
        attr["scheduled_date"] = target_date.strftime("%Y-%m-%d")
        attr["day_of_week"] = target_date.strftime("%A")
        
        validated_attractions.append(attr)
        
    return {
        "attractions": validated_attractions,
        "completed_steps": state.get("completed_steps", []) + ["opening_hours"]
    }
