from langgraph.graph import StateGraph, END
from app.ai.orchestrator.state import TravelState

# Import all agent nodes
from app.ai.orchestrator.parser_agent import parser_node
from app.ai.orchestrator.planner_agent import planner_node
from app.ai.agents.weather_agent import weather_node
from app.ai.agents.flight_agent import flight_node
from app.ai.agents.hotel_agent import hotel_node
from app.ai.agents.attraction_agent import attraction_node
from app.ai.agents.opening_hours_agent import opening_hours_node
from app.ai.agents.restaurant_agent import restaurant_node
from app.ai.agents.budget_agent import budget_node
from app.ai.agents.route_agent import route_node
from app.ai.reviewer.reviewer_agent import reviewer_node
from app.ai.agents.synthesis_agent import synthesis_node

import time

def log_node_execution(name, func):
    def wrapper(state: TravelState):
        print(f"\n[GRAPH NODE START] {name}")
        start_t = time.time()
        try:
            result = func(state)
            duration = time.time() - start_t
            print(f"[GRAPH NODE END] {name} (Duration: {duration:.2f}s)")
            return result
        except Exception as e:
            duration = time.time() - start_t
            print(f"[GRAPH NODE ERROR] {name} (Duration: {duration:.2f}s) - {e}")
            raise
    return wrapper

# Initialize the StateGraph with our TravelState schema
workflow = StateGraph(TravelState)

# 1. Add all agents as graph nodes (wrapped for logging)
workflow.add_node("parser", log_node_execution("parser", parser_node))
workflow.add_node("planner", log_node_execution("planner", planner_node))
workflow.add_node("weather", log_node_execution("weather", weather_node))
workflow.add_node("flights", log_node_execution("flights", flight_node))
workflow.add_node("hotels", log_node_execution("hotels", hotel_node))
workflow.add_node("attractions", log_node_execution("attractions", attraction_node))
workflow.add_node("opening_hours", log_node_execution("opening_hours", opening_hours_node))
workflow.add_node("restaurants", log_node_execution("restaurants", restaurant_node))
workflow.add_node("budget", log_node_execution("budget", budget_node))
workflow.add_node("route", log_node_execution("route", route_node))
workflow.add_node("reviewer", log_node_execution("reviewer", reviewer_node))
workflow.add_node("synthesis", log_node_execution("synthesis", synthesis_node))

# 2. Define the execution edges
workflow.set_entry_point("parser")

# Parser runs first, then handoff to Planner
workflow.add_edge("parser", "planner")

# Planner kicks off the 5 parallel specialist nodes
workflow.add_edge("planner", "flights")
workflow.add_edge("planner", "hotels")
workflow.add_edge("planner", "weather")
workflow.add_edge("planner", "attractions")
workflow.add_edge("planner", "restaurants")

# All parallel agents join back at the Budget Auditor node
workflow.add_edge("flights", "budget")
workflow.add_edge("hotels", "budget")
workflow.add_edge("weather", "budget")
workflow.add_edge("restaurants", "budget")

# Attractions goes to Opening Hours validation, which then goes to Budget
workflow.add_edge("attractions", "opening_hours")
workflow.add_edge("opening_hours", "budget")

# Budget Node connects to Route Node, then to Reviewer Node
workflow.add_edge("budget", "route")
workflow.add_edge("route", "reviewer")

# 3. Define the conditional routing edge from the Reviewer
def should_continue(state: TravelState):
    loops = state.get("completed_steps", []).count("planner")
    if state.get("is_approved") is True or loops >= 1:
        print(f"--- GRAPH ORCHESTRATION: Itinerary APPROVED! Ending workflow. (Loops: {loops}) ---")
        return "approved"
    else:
        print(f"--- GRAPH ORCHESTRATION: Re-routing to Planner. (Loop {loops}) ---")
        return "rejected"

# Setup the routing logic: approved goes to synthesis, rejected goes back to planner
workflow.add_conditional_edges(
    "reviewer",
    should_continue,
    {
        "approved": "synthesis",
        "rejected": "planner"
    }
)

# Synthesis goes to END
workflow.add_edge("synthesis", END)

# Compile the graph
graph = workflow.compile()
