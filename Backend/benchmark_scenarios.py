import os
import sys
import time
import json
from dotenv import load_dotenv

# Ensure utf-8 encoding for stdout on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Ensure Backend directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from app.ai.orchestrator.langgraph_graph import graph
from app.ai.llm import coordinator, llm, GroqRateLimitError
import langchain_groq

def evaluate_itinerary(final_state, scenario_name, duration_sec):
    route_details = final_state.get("route_details") or {}
    days_data = []
    if isinstance(route_details, list):
        days_data = route_details
    elif isinstance(route_details, dict):
        days_data = route_details.get("day_by_day_route", route_details.get("days", []))

    total_stops = 0
    generic_desc_count = 0
    picsum_img_count = 0
    valid_coords_count = 0

    print(f"\n==========================================")
    print(f"RESULTS FOR: {scenario_name}")
    print(f"Wall-clock duration: {duration_sec:.2f} seconds")
    print(f"Target (<= 40s): {'[PASSED]' if duration_sec <= 40 else '[EXCEEDED]'}")
    print(f"Days generated: {len(days_data)}")
    print(f"OTPM rolling token usage: {coordinator.get_used_tokens()} / {coordinator.otpm_limit}")
    print(f"Concierge summary: {final_state.get('concierge_summary', '')[:120]}...")
    print(f"------------------------------------------")

    for i, d in enumerate(days_data):
        stops = d.get("stops", [])
        total_stops += len(stops)
        print(f"Day {i+1} ({d.get('title', 'Day')}): {len(stops)} stops")
        for s in stops:
            name = s.get("name") or s.get("title")
            desc = str(s.get("description") or "")
            img = s.get("image_url") or s.get("thumbnail")
            lat = s.get("lat")
            lon = s.get("lon")

            if "Explore this destination highlight" in desc:
                generic_desc_count += 1
            if img and "picsum" in str(img):
                picsum_img_count += 1
            if lat is not None and lon is not None:
                valid_coords_count += 1

            img_preview = (img[:45] + "...") if img else "None (neutral icon placeholder)"
            print(f"  * [{s.get('type', 'stop')}] {name}")
            print(f"    - Desc: {desc[:60]}...")
            print(f"    - Image: {img_preview}")

    print(f"------------------------------------------")
    print(f"Total stops: {total_stops}")
    print(f"Valid coordinates: {valid_coords_count}/{total_stops}")
    print(f"Generic 'Explore this destination highlight' count: {generic_desc_count} (must be 0)")
    print(f"Picsum image count: {picsum_img_count} (must be 0)")
    print(f"==========================================\n")

    return {
        "scenario": scenario_name,
        "duration_sec": round(duration_sec, 2),
        "target_met": duration_sec <= 40,
        "days": len(days_data),
        "total_stops": total_stops,
        "generic_descriptions": generic_desc_count,
        "picsum_images": picsum_img_count,
        "otpm_used": coordinator.get_used_tokens()
    }


def run_scenario_d_429():
    """Scenario D: Groq 429 Simulation with Fallback Verification"""
    print("\n>>> RUNNING SCENARIO D: Groq 429 Simulation <<<")
    original_invoke = langchain_groq.ChatGroq.invoke

    def mock_429_invoke(self, *args, **kwargs):
        raise Exception("429 Too Many Requests: Output tokens per minute (OTPM): Limit 1000, Used 950. Please try again in 20.0s")

    langchain_groq.ChatGroq.invoke = mock_429_invoke
    try:
        state = {
            "user_message": "Trip to Rome",
            "origin": None,
            "destination": "Rome, Italy",
            "days": 3,
            "budget": 1500.0,
            "preferences": "Ancient architecture, Colosseum, Italian cuisine",
            "completed_steps": [],
            "is_approved": False,
            "error_logs": []
        }
        t0 = time.time()
        final_state = graph.invoke(state)
        duration = time.time() - t0
        res = evaluate_itinerary(final_state, "Scenario D: Groq 429 Simulation", duration)
        res["429_gracefully_handled"] = True
        return res
    finally:
        langchain_groq.ChatGroq.invoke = original_invoke


def run_scenario_a():
    """Scenario A: 4-day Kerala trip"""
    print("\n>>> RUNNING SCENARIO A: 4-Day Kerala Trip <<<")
    state = {
        "user_message": "Plan a 4-day trip to Kerala",
        "origin": None,
        "destination": "Kerala, India",
        "days": 4,
        "budget": 40000.0,
        "preferences": "Backwaters, nature, relaxation",
        "completed_steps": [],
        "is_approved": False,
        "error_logs": []
    }
    t0 = time.time()
    final_state = graph.invoke(state)
    duration = time.time() - t0
    return evaluate_itinerary(final_state, "Scenario A: 4-Day Kerala Trip", duration)


def run_scenario_b():
    """Scenario B: 5-day Paris trip (History + Food)"""
    print("\n>>> RUNNING SCENARIO B: 5-Day Paris Trip (History + Food) <<<")
    state = {
        "user_message": "5 days in Paris for history and food",
        "origin": None,
        "destination": "Paris, France",
        "days": 5,
        "budget": 2000.0,
        "preferences": "History, food, museums, French cuisine",
        "completed_steps": [],
        "is_approved": False,
        "error_logs": []
    }
    t0 = time.time()
    final_state = graph.invoke(state)
    duration = time.time() - t0
    return evaluate_itinerary(final_state, "Scenario B: 5-Day Paris Trip", duration)


def run_scenario_c():
    """Scenario C: 5-day Hyderabad -> Sydney trip"""
    print("\n>>> RUNNING SCENARIO C: 5-Day Hyderabad -> Sydney Trip <<<")
    state = {
        "user_message": "Trip from Hyderabad to Sydney for 5 days",
        "origin": "Hyderabad, India",
        "destination": "Sydney, Australia",
        "days": 5,
        "budget": 3500.0,
        "preferences": "Beaches, opera house, harbor, seafood",
        "completed_steps": [],
        "is_approved": False,
        "error_logs": []
    }
    t0 = time.time()
    final_state = graph.invoke(state)
    duration = time.time() - t0
    return evaluate_itinerary(final_state, "Scenario C: Hyderabad to Sydney", duration)


if __name__ == "__main__":
    results = []

    # Scenario D: 429 Resilience Simulation
    res_d = run_scenario_d_429()
    results.append(res_d)

    # Allow token coordinator sliding window cooldown before live Groq calls
    time.sleep(3)

    # Scenario A: Kerala
    res_a = run_scenario_a()
    results.append(res_a)

    print("\n[COOLDOWN] Waiting 20s for Groq OTPM window...")
    time.sleep(20)

    # Scenario B: Paris
    res_b = run_scenario_b()
    results.append(res_b)

    print("\n[COOLDOWN] Waiting 20s for Groq OTPM window...")
    time.sleep(20)

    # Scenario C: Sydney
    res_c = run_scenario_c()
    results.append(res_c)

    print("\n================ FINAL BENCHMARK SUMMARY ================")
    for r in results:
        print(f"| {r['scenario']} | Duration: {r['duration_sec']}s | Target Met: {r['target_met']} | Generic Descs: {r['generic_descriptions']} | Picsum Imgs: {r['picsum_images']} | Groq OTPM: {r['otpm_used']} |")
    print("=========================================================\n")
