import os
import sys
import json
from dotenv import load_dotenv

# Ensure we're in the right directory
sys.path.insert(0, os.path.abspath('.'))
load_dotenv()

from app.ai.orchestrator.langgraph_graph import graph

initial_state = {
    "user_message": "Plan a 5-day trip from Hyderabad to Sydney",
    "origin": "Hyderabad",
    "destination": "Sydney",
    "days": 5,
    "budget": 2000.0,
    "currency": "USD",
    "preferences": "Standard travel planning preferences",
    "completed_steps": [],
    "is_approved": False,
    "error_logs": []
}

try:
    print("\n--- STARTING TEST: Hyderabad to Sydney ---")
    final_state = graph.invoke(initial_state)
    print("\n--- TEST SUCCESSFUL ---")
    print(f"Generated route for {final_state.get('destination')} with {len(final_state.get('route_details', {}).get('day_by_day_route', []))} days.")
except Exception as e:
    print(f"\n--- TEST FAILED ---")
    print(e)
