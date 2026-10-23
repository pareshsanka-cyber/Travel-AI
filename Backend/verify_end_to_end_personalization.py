import sys
import json
from pathlib import Path

# Add Backend to sys.path
backend_root = Path(__file__).resolve().parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.ai.agents.attraction_agent import attraction_node
from app.ai.agents.hotel_agent import hotel_node
from app.ai.agents.restaurant_agent import restaurant_node
from app.ai.agents.route_agent import route_node
from app.services.slot_extraction_service import merge_travel_context

def run_itinerary_scenario(name: str, state_input: dict):
    print("=" * 80)
    print(f"SCENARIO: {name}")
    print(f"Interests: {state_input.get('interests', [])} | Style: {state_input.get('travel_style', 'STANDARD')}")
    print("=" * 80)

    # 1. Discover attractions
    attr_res = attraction_node(state_input)
    attractions = attr_res.get("attractions", [])
    
    # 2. Discover hotels
    hotel_res = hotel_node(state_input)
    hotels = hotel_res.get("hotels", [])

    # 3. Discover restaurants
    rest_res = restaurant_node(state_input)
    restaurants = rest_res.get("restaurants", [])

    # 4. Schedule itinerary via route_node
    planning_state = dict(state_input)
    planning_state["attractions"] = attractions
    planning_state["hotels"] = hotels
    planning_state["restaurants"] = restaurants

    route_res = route_node(planning_state)
    day_routes = route_res.get("route_details", {}).get("day_by_day_route", [])

    print(f"Total Scheduled Days: {len(day_routes)}")
    scheduled_summary = []
    for day in day_routes:
        day_num = day.get("day", 1)
        stops = day.get("stops", [])
        stop_names = [f"{s.get('name')} [{s.get('type')}]" for s in stops]
        scheduled_summary.append((day_num, stop_names))
        print(f"  Day {day_num}: {', '.join(stop_names)}")

    hotel_name = hotels[0].get("name") if hotels else "N/A"
    print(f"Selected Hotel: {hotel_name}")
    print("\n")
    return {
        "scenario": name,
        "interests": state_input.get("interests", []),
        "travel_style": state_input.get("travel_style", "STANDARD"),
        "hotel": hotel_name,
        "scheduled_days": scheduled_summary
    }

def main():
    results = []

    # Scenario 1: Beaches
    s1 = {
        "destination": "Goa",
        "origin": "Hyderabad",
        "days": 5,
        "budget": 60000.0,
        "currency": "INR",
        "interests": ["beaches", "coastal", "relaxation"],
        "preferences": "beaches > coastal > relaxation",
        "pace": "balanced"
    }
    results.append(run_itinerary_scenario("1. Goa 5-Day: Beaches & Coastal", s1))

    # Scenario 2: Temples & Heritage
    s2 = {
        "destination": "Goa",
        "origin": "Hyderabad",
        "days": 5,
        "budget": 60000.0,
        "currency": "INR",
        "interests": ["temples", "churches", "heritage", "history"],
        "preferences": "temples > churches > heritage > history",
        "pace": "balanced"
    }
    results.append(run_itinerary_scenario("2. Goa 5-Day: Temples, Churches & Heritage", s2))

    # Scenario 3: Luxury
    s3 = {
        "destination": "Goa",
        "origin": "Hyderabad",
        "days": 5,
        "budget": 250000.0,
        "currency": "INR",
        "interests": ["luxury", "relaxation", "fine dining"],
        "preferences": "luxury > fine dining",
        "travel_style": "LUXURY",
        "budget_mode": "LUXURY",
        "pace": "relaxed"
    }
    results.append(run_itinerary_scenario("3. Goa 5-Day: Luxury & Fine Dining", s3))

    # Scenario 4: Beaches + Food
    s4 = {
        "destination": "Goa",
        "origin": "Hyderabad",
        "days": 5,
        "budget": 70000.0,
        "currency": "INR",
        "interests": ["beaches", "food", "cafes", "seafood"],
        "preferences": "beaches > food > seafood",
        "pace": "balanced"
    }
    results.append(run_itinerary_scenario("4. Goa 5-Day: Beaches + Local Food", s4))

    # Scenario 5: Balanced Default (No interests specified)
    s5 = {
        "destination": "Goa",
        "origin": "Hyderabad",
        "days": 5,
        "budget": 50000.0,
        "currency": "INR",
        "interests": [],
        "preferences": "",
        "pace": "balanced"
    }
    results.append(run_itinerary_scenario("5. Goa 5-Day: Balanced Default (No Interests Specified)", s5))

    # Scenario 6: Preference Update / Context Evolution
    initial_ctx = {
        "destination": "Goa",
        "days": 5,
        "interests": [],
        "preferences": []
    }
    updated_ctx = merge_travel_context(initial_ctx, {
        "interests": ["beaches", "water sports"],
        "preferences": ["beaches"]
    })
    s6 = {
        "destination": updated_ctx["destination"],
        "origin": "Hyderabad",
        "days": updated_ctx["days"],
        "budget": 50000.0,
        "currency": "INR",
        "interests": updated_ctx["interests"],
        "preferences": ", ".join(updated_ctx.get("preferences", [])),
        "pace": "balanced"
    }
    results.append(run_itinerary_scenario("6. Goa 5-Day: Preference Update (Context Shifted to Beaches)", s6))

    print("=" * 80)
    print("VERIFICATION COMPLETE: ALL 6 SCENARIOS EXECUTED SUCCESSFULLY")
    print("=" * 80)

if __name__ == "__main__":
    main()
