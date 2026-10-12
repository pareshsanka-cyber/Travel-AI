import os
import sys
import time
import json
from dotenv import load_dotenv

# Ensure utf-8 encoding for Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Ensure Backend directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from app.ai.llm import coordinator, llm, GroqRateLimitError
from app.ai.agents.restaurant_agent import restaurant_node, discover_restaurants_serpapi, fetch_real_restaurants_overpass
from app.ai.agents.attraction_agent import attraction_node
from app.ai.orchestrator.langgraph_graph import graph
import langchain_groq


def print_section(title):
    print("\n" + "=" * 60)
    print(f" {title}")
    print("=" * 60)


# =====================================================================
# TEST A: Mocked Groq 429 Simulation
# =====================================================================
def run_test_a():
    print_section("TEST A: Mocked Groq 429 Recovery")
    original_invoke = langchain_groq.ChatGroq.invoke
    call_attempts = 0

    def mock_429(self, *args, **kwargs):
        nonlocal call_attempts
        call_attempts += 1
        print(f"  [Mock Groq Client] Simulating HTTP 429 response (attempt #{call_attempts})...")
        raise Exception("429 Too Many Requests: Output tokens per minute (OTPM): Limit 1000, Used 980. Please try again in 5.0s")

    langchain_groq.ChatGroq.invoke = mock_429
    start_t = time.time()
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
        final_state = graph.invoke(state)
        duration = time.time() - start_t

        attractions = final_state.get("attractions", [])
        route_details = final_state.get("route_details") or {}
        days_count = len(route_details) if isinstance(route_details, list) else len(route_details.get("day_by_day_route", []))

        print(f"  * Total call attempts to Groq: {call_attempts}")
        print(f"  * Bounded retries verified: {'YES' if call_attempts <= 2 else 'NO (Loop detected)'}")
        print(f"  * Duration: {duration:.2f}s")
        print(f"  * Attractions recovered via factual fallback: {len(attractions)}")
        print(f"  * Itinerary days generated: {days_count}")
        print(f"  * Target met (<= 40s): {'YES' if duration <= 40 else 'NO'}")
        
        passed = (call_attempts <= 2) and (len(attractions) >= 6) and (days_count == 3) and (duration <= 40)
        print(f"  --> TEST A RESULT: {'PASSED [OK]' if passed else 'FAILED'}")
        return {"name": "Test A: Mocked Groq 429", "passed": passed, "duration": round(duration, 2), "attempts": call_attempts}
    finally:
        langchain_groq.ChatGroq.invoke = original_invoke


# =====================================================================
# TEST B: Exhausted Local Token Budget
# =====================================================================
def run_test_b():
    print_section("TEST B: Exhausted Local Token Budget Simulation")
    
    # Artificially fill coordinator token history so only 50 tokens remain
    now = time.time()
    with coordinator.lock:
        coordinator.token_history = [
            {"time": now - 10.0, "tokens": 950, "is_reservation": False, "id": "fake_prior_usage"}
        ]
    
    used_before = coordinator.get_used_tokens()
    avail_before = coordinator.get_available_tokens()
    print(f"  * Local coordinator status: used={used_before}/1000, available={avail_before}")
    
    start_t = time.time()
    # Attempt attraction node discovery which requires min 220 tokens
    state = {
        "destination": "Paris, France",
        "days": 4,
        "budget": 2000.0,
        "preferences": "Art, museums, gastronomy",
        "completed_steps": []
    }
    
    result = attraction_node(state)
    duration = time.time() - start_t
    
    attractions = result.get("attractions", [])
    print(f"  * Execution duration: {duration:.2f}s")
    print(f"  * Attractions recovered via factual layer without LLM call: {len(attractions)}")
    print(f"  * Sources used: {[a.get('source') for a in attractions[:3]]}")
    
    passed = len(attractions) >= 6 and duration < 15.0 and (attractions[0].get("source") in ["serpapi_discovery", "osm_fallback"])
    print(f"  --> TEST B RESULT: {'PASSED [OK]' if passed else 'FAILED'}")
    
    # Clean up artificial token history
    with coordinator.lock:
        coordinator.token_history = []
        
    return {"name": "Test B: Exhausted Token Budget", "passed": passed, "duration": round(duration, 2), "attractions": len(attractions)}


# =====================================================================
# TEST C: Restaurant Coordinate Provenance Across Multiple Destinations
# =====================================================================
def run_test_c():
    print_section("TEST C: Restaurant Coordinate Provenance Verification")
    
    destinations = [
        ("Sydney, Australia", (-33.8688, 151.2093)),
        ("Paris, France", (48.8566, 2.3522)),
        ("Mumbai, India", (19.0760, 72.8777))
    ]
    
    results = []
    delhi_coords = (28.6139, 77.2090)
    
    for dest, expected_approx in destinations:
        print(f"\n  Checking destination: {dest}")
        state = {"destination": dest}
        res = restaurant_node(state)
        restaurants = res.get("restaurants", [])
        print(f"  * Found {len(restaurants)} restaurants")
        
        dest_passed = True
        coord_set = set()
        
        for r in restaurants:
            name = r.get("name")
            lat = r.get("lat")
            lon = r.get("lon")
            source = r.get("source")
            
            print(f"    - {name}: lat={lat}, lon={lon} (source: {source})")
            
            # Check 1: Must not be Delhi coords unless destination IS Delhi
            if lat is not None and lon is not None:
                if (round(lat, 3), round(lon, 3)) == (round(delhi_coords[0], 3), round(delhi_coords[1], 3)):
                    print(f"      [FAIL] Universal Delhi coordinates detected for {name} in {dest}!")
                    dest_passed = False
                
                # Check 2: Coordinates must be in realistic proximity to destination region
                lat_diff = abs(lat - expected_approx[0])
                lon_diff = abs(lon - expected_approx[1])
                if lat_diff > 1.5 or lon_diff > 1.5:
                    print(f"      [FAIL] Coordinate ({lat}, {lon}) is too far from {dest} ({expected_approx})!")
                    dest_passed = False
                    
                coord_set.add((round(lat, 4), round(lon, 4)))
            else:
                # If unlocated, lat and lon must both be None
                if lat is not None or lon is not None:
                    print(f"      [FAIL] Asymmetric coordinate on unlocated venue!")
                    dest_passed = False

        # Check 3: Verified venues should have distinct coordinates (not all stacked at 1 exact point)
        if len(coord_set) <= 1 and len(restaurants) > 1:
            print(f"      [WARN] All restaurants share identical coordinate pair!")
            dest_passed = False
            
        results.append(dest_passed)
        
    # Check 4: Test unlocated fallback venue returns lat=None, lon=None
    unlocated_test = {
        "destination": "Unknown Remote Atoll"
    }
    unlocated_res = restaurant_node(unlocated_test)
    unlocated_rests = unlocated_res.get("restaurants", [])
    if unlocated_rests:
        u_lat = unlocated_rests[0].get("lat")
        u_lon = unlocated_rests[0].get("lon")
        print(f"\n  Checking unknown location fallback: lat={u_lat}, lon={u_lon}")
        if u_lat is not None or u_lon is not None:
            print("  [FAIL] Unknown location produced non-null coordinates!")
            results.append(False)
        else:
            print("  [OK] Unknown location correctly returned lat=None, lon=None (no invented coords).")
            results.append(True)
            
    passed = all(results)
    print(f"\n  --> TEST C RESULT: {'PASSED [OK]' if passed else 'FAILED'}")
    return {"name": "Test C: Restaurant Coordinates", "passed": passed}


# =====================================================================
# TEST D: Live Groq Provider Verification
# =====================================================================
def run_test_d():
    print_section("TEST D: Live Groq Provider Verification")
    
    # Controlled, minimal token request: max_tokens=35
    prompt = "Return a 1-sentence warm travel greeting for a traveler visiting Tokyo."
    start_t = time.time()
    try:
        print("  Issuing controlled live call to Groq (qwen/qwen3.8-27b)...")
        response = llm.invoke(prompt, agent_name="test_live_audit", max_tokens=35, min_tokens=15, timeout=10.0)
        duration = time.time() - start_t
        content = response.content.strip()
        
        tokens_out = None
        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            tokens_out = response.usage_metadata.get('output_tokens')
        elif hasattr(response, 'response_metadata') and 'token_usage' in response.response_metadata:
            tokens_out = response.response_metadata['token_usage'].get('completion_tokens')
            
        used_tokens = coordinator.get_used_tokens()
        avail_tokens = coordinator.get_available_tokens()
        
        print(f"  * Response: \"{content}\"")
        print(f"  * Duration: {duration:.2f}s")
        print(f"  * Output tokens: {tokens_out}")
        print(f"  * Local OTPM tracked: {used_tokens}/{coordinator.otpm_limit} (available: {avail_tokens})")
        
        passed = (len(content) > 10) and (duration < 10.0) and (tokens_out is not None and tokens_out > 0)
        print(f"  --> TEST D RESULT: {'PASSED [OK]' if passed else 'FAILED'}")
        return {"name": "Test D: Live Groq Call", "passed": passed, "duration": round(duration, 2), "tokens": tokens_out}
    except Exception as e:
        print(f"  [ERROR] Live Groq call failed: {e}")
        return {"name": "Test D: Live Groq Call", "passed": False, "error": str(e)}


# =====================================================================
# TEST E: End-to-End Itinerary Verification
# =====================================================================
def run_test_e():
    print_section("TEST E: End-to-End Itinerary Benchmarks")
    
    # 1. Kerala 4-Day
    print("\n--- Generating Scenario 1: Kerala (4 Days) ---")
    state_kerala = {
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
    kerala_final = graph.invoke(state_kerala)
    dur_kerala = time.time() - t0
    
    # Inspect Kerala stops
    k_days = kerala_final.get("route_details", [])
    if isinstance(k_days, dict):
        k_days = k_days.get("day_by_day_route", [])
        
    k_stops_total = sum(len(d.get("stops", [])) for d in k_days)
    k_generic_desc = sum(1 for d in k_days for s in d.get("stops", []) if "Explore this destination highlight" in str(s.get("description", "")))
    k_picsum_count = sum(1 for d in k_days for s in d.get("stops", []) if "picsum" in str(s.get("image_url", "")))
    
    print(f"  * Kerala Wall-Clock Duration: {dur_kerala:.2f}s (Target <= 40s: {'YES' if dur_kerala <= 40 else 'NO'})")
    print(f"  * Days generated: {len(k_days)} | Total stops: {k_stops_total}")
    print(f"  * Generic descriptions: {k_generic_desc} | Picsum images: {k_picsum_count}")

    # Cooldown for Groq sliding window
    print("  Waiting 10s cooldown...")
    time.sleep(10)

    # 2. Hyderabad -> Sydney 5-Day
    print("\n--- Generating Scenario 2: Hyderabad -> Sydney (5 Days) ---")
    state_sydney = {
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
    t1 = time.time()
    sydney_final = graph.invoke(state_sydney)
    dur_sydney = time.time() - t1
    
    s_days = sydney_final.get("route_details", [])
    if isinstance(s_days, dict):
        s_days = s_days.get("day_by_day_route", [])
        
    s_stops_total = sum(len(d.get("stops", [])) for d in s_days)
    s_generic_desc = sum(1 for d in s_days for s in d.get("stops", []) if "Explore this destination highlight" in str(s.get("description", "")))
    s_picsum_count = sum(1 for d in s_days for s in d.get("stops", []) if "picsum" in str(s.get("image_url", "")))
    
    # Check stop categories & airport images
    s_airports_have_null_img = True
    s_hotels_have_valid_img = True
    for d in s_days:
        for s in d.get("stops", []):
            stype = s.get("type")
            simg = s.get("image_url")
            if stype == "airport" and simg is not None:
                s_airports_have_null_img = False
            if stype == "hotel" and (not simg or "picsum" in str(simg)):
                s_hotels_have_valid_img = False

    print(f"  * Sydney Wall-Clock Duration: {dur_sydney:.2f}s (Target <= 40s: {'YES' if dur_sydney <= 40 else 'NO'})")
    print(f"  * Days generated: {len(s_days)} | Total stops: {s_stops_total}")
    print(f"  * Generic descriptions: {s_generic_desc} | Picsum images: {s_picsum_count}")
    print(f"  * Airports have null image_url (neutral icon): {'YES' if s_airports_have_null_img else 'NO'}")
    print(f"  * Hotels have verified photo: {'YES' if s_hotels_have_valid_img else 'NO'}")
    
    passed = (dur_kerala <= 40) and (dur_sydney <= 40) and (k_generic_desc == 0) and (s_generic_desc == 0) and (k_picsum_count == 0) and (s_picsum_count == 0) and s_airports_have_null_img and s_hotels_have_valid_img
    print(f"\n  --> TEST E RESULT: {'PASSED [OK]' if passed else 'FAILED'}")
    return {
        "name": "Test E: End-to-End Itinerary",
        "passed": passed,
        "kerala_duration": round(dur_kerala, 2),
        "sydney_duration": round(dur_sydney, 2),
        "kerala_stops": k_stops_total,
        "sydney_stops": s_stops_total
    }


if __name__ == "__main__":
    suite_start = time.time()
    results = []
    
    # Run all 5 targeted tests
    results.append(run_test_a())
    results.append(run_test_b())
    results.append(run_test_c())
    results.append(run_test_d())
    results.append(run_test_e())
    
    print("\n" + "=" * 60)
    print(" AUDIT TEST SUITE SUMMARY")
    print("=" * 60)
    for r in results:
        status = "PASSED [OK]" if r.get("passed") else "FAILED [X]"
        print(f"• {r['name']:<35} : {status}")
    print(f"Total Suite Duration: {time.time() - suite_start:.2f}s")
    print("=" * 60 + "\n")
