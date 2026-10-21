from app.services.discovery_status import search_guard
import os
import json
import httpx
import urllib.parse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from app.ai.llm import llm, GroqRateLimitError
from app.ai.orchestrator.state import TravelState
from app.ai.agents.opening_hours_agent import determine_status_from_hours
from langchain_core.prompts import ChatPromptTemplate

SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY")

enrichment_cache = {}

GROK_DISCOVERY_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert travel discovery assistant. Discover real, highly relevant attractions "
        "for the destination, strictly respecting the user's priority order of interests and must-visit requests.\n\n"
        "RULES:\n"
        "- Return ONLY a valid JSON object matching the schema below.\n"
        "- Prioritize attractions that match the user's ranked interests in exact order of priority.\n"
        "- If must-visit places are requested, include them as top candidate attractions.\n"
        "- If user specified specific categories (e.g. Nature, Beaches, Temples), do NOT include unrelated categories like nightlife or shopping unless explicitly requested.\n"
        "- Keep descriptions concise (1-2 sentences max).\n"
        "- Do NOT provide coordinates or image URLs.\n\n"
        "EXPECTED JSON SCHEMA:\n"
        "{{\n"
        '  "attractions": [\n'
        "    {{\n"
        '      "name": "Exact Place Name",\n'
        '      "category": "nature|beach|temple|monument|museum|landmark|scenic",\n'
        '      "description": "Concise 1-2 sentence description covering significance.",\n'
        '      "why_visit": "Why this fits the user preferences.",\n'
        '      "interests": ["nature", "beach"]\n'
        "    }}\n"
        "  ]\n"
        "}}"
    ),
    (
        "human",
        "Destination: {destination}\n"
        "Trip Duration: {days} days\n"
        "Budget: {budget}\n"
        "Ranked Interests (Priority Order): {interests}\n"
        "Must-Visit Places: {must_visit}\n"
        "Pace: {pace}\n"
        "Please discover candidate attractions matching these priorities."
    )
])


def enrich_place_nominatim(name: str, destination: str) -> dict:
    dest_clean = destination.lower().strip()
    query = f"{name}, {dest_clean}"
    try:
        resp = httpx.get(
            f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query)}&format=json&limit=1",
            headers={"User-Agent": "TravelAI_Agent/1.0 (contact: info@travelai.local)"},
            timeout=4.0
        )
        if resp.status_code == 200:
            data = resp.json()
            if data and len(data) > 0:
                return {
                    "lat": float(data[0]["lat"]),
                    "lon": float(data[0]["lon"]),
                    "address": data[0].get("display_name"),
                }
    except Exception:
        pass
    return None


def verify_and_enrich_place(name: str, destination: str) -> dict:
    """Uses SerpApi Google Maps to verify place and grab coordinates/images with cache."""
    cache_key = f"{name}_{destination}".lower().strip()
    if cache_key in enrichment_cache:
        return enrichment_cache[cache_key]

    if not SERPAPI_API_KEY or search_guard():
        nom = enrich_place_nominatim(name, destination)
        enrichment_cache[cache_key] = nom
        return nom

    query = f"{name} {destination}"
    url = f"https://serpapi.com/search.json?engine=google_maps&q={urllib.parse.quote(query)}&api_key={SERPAPI_API_KEY}"
    
    try:
        resp = httpx.get(url, timeout=7.0)
        if resp.status_code == 200:
            data = resp.json()
            local_results = data.get("local_results", [])
            place_results = data.get("place_results", {})
            
            result = place_results if "title" in place_results else (local_results[0] if local_results else None)
            if result:
                coords = result.get("gps_coordinates", {})
                lat = coords.get("latitude")
                lon = coords.get("longitude")
                
                if lat and lon:
                    hours_str = None
                    op_hours = result.get("operating_hours")
                    if isinstance(op_hours, dict):
                        for _, v in op_hours.items():
                            if isinstance(v, str):
                                hours_str = v
                                break
                    elif isinstance(op_hours, list) and op_hours:
                        hours_str = str(op_hours[0])
                            
                    thumbnail = result.get("thumbnail") or result.get("serpapi_thumbnail")
                    enriched = {
                        "lat": float(lat),
                        "lon": float(lon),
                        "place_id": result.get("place_id"),
                        "data_id": result.get("data_id"),
                        "rating": result.get("rating"),
                        "review_count": result.get("reviews"),
                        "address": result.get("address"),
                        "opening_hours": hours_str,
                        "image_url": thumbnail,
                        "image_source": "google_maps" if thumbnail else None,
                        "photos_link": result.get("photos_link")
                    }
                    enrichment_cache[cache_key] = enriched
                    return enriched
    except Exception:
        pass

    # Fast Nominatim fallback if SerpApi missed coords
    nom_result = enrich_place_nominatim(name, destination)
    if nom_result:
        nom_result.update({
            "image_url": None,
            "image_source": None,
            "photos_link": None,
            "rating": None,
            "review_count": None,
            "opening_hours": None,
            "place_id": None,
            "data_id": None
        })
        enrichment_cache[cache_key] = nom_result
        return nom_result
        
    enrichment_cache[cache_key] = None
    return None


def resolve_destination_coordinates(destination: str) -> dict:
    dest_clean = destination.lower().strip()
    cache_key = f"dest_coords_{dest_clean}"
    if cache_key in enrichment_cache and enrichment_cache[cache_key]:
        return enrichment_cache[cache_key]
        
    try:
        resp = httpx.get(
            f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(dest_clean)}&format=json&limit=1",
            headers={"User-Agent": "TravelAI_Agent/1.0 (contact: info@travelai.local)"},
            timeout=4.0
        )
        if resp.status_code == 200:
            data = resp.json()
            if data and len(data) > 0:
                coords = {"lat": float(data[0]["lat"]), "lon": float(data[0]["lon"])}
                enrichment_cache[cache_key] = coords
                return coords
    except Exception:
        pass
        
    coords = {"lat": 28.6139, "lon": 77.2090}
    enrichment_cache[cache_key] = coords
    return coords


def calculate_fame_level(rating, review_count):
    try:
        rating = float(rating) if rating else None
        review_count = int(review_count) if review_count else None
    except (TypeError, ValueError):
        return None
    if review_count is None:
        return None
    if review_count >= 500 or (rating and rating >= 4.5 and review_count >= 100):
        return "widely_known"
    if review_count < 500:
        return "lesser_known"
    return None


def discover_via_serpapi(destination: str, candidate_count: int, ranked_interests: list = None, timeout_seconds: float = 7.0) -> list:
    """Layer 2: SerpApi Google Maps discovery fallback with interest awareness."""
    if not SERPAPI_API_KEY or search_guard():
        return []
    
    queries = []
    if ranked_interests:
        for r_int in ranked_interests[:2]:
            queries.append(f"{r_int} attractions in {destination}")
    queries.append(f"top tourist attractions in {destination}")

    candidates = []
    seen_titles = set()
    for query in queries:
        if len(candidates) >= candidate_count:
            break
        try:
            url = f"https://serpapi.com/search.json?engine=google_maps&q={urllib.parse.quote(query)}&api_key={SERPAPI_API_KEY}"
            resp = httpx.get(url, timeout=timeout_seconds)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("local_results", [])
                for r in results:
                    title = r.get("title")
                    if not title or title in seen_titles:
                        continue
                    coords = r.get("gps_coordinates")
                    if coords and coords.get("latitude"):
                        seen_titles.add(title)
                        candidates.append({
                            "name": title,
                            "category": r.get("type", "attraction"),
                            "description": r.get("description") or f"A notable landmark in {destination}.",
                            "why_visit": f"Verified attraction in {destination}.",
                            "interests": ranked_interests or [],
                            "lat": float(coords["latitude"]),
                            "lon": float(coords["longitude"]),
                            "image_url": r.get("thumbnail"),
                            "rating": r.get("rating"),
                            "review_count": r.get("reviews"),
                            "address": r.get("address"),
                            "place_id": r.get("place_id"),
                            "source": "serpapi_discovery",
                            "_pre_enriched": True
                        })
                        if len(candidates) >= candidate_count:
                            break
        except Exception as e:
            print(f"--- ATTRACTION AGENT: SerpApi discovery fallback error for '{query}': {type(e).__name__} ---")
            
    print(f"--- ATTRACTION AGENT: SerpApi discovery yielded {len(candidates)} candidates ---")
    return candidates


def discover_via_overpass(destination: str, candidate_count: int) -> list:
    """Layer 3: OSM/Overpass factual fallback for geographic POI data."""
    coords = resolve_destination_coordinates(destination)
    lat, lon = coords["lat"], coords["lon"]
    query = f"""
    [out:json][timeout:8];
    (
      node["tourism"="attraction"](around:20000,{lat},{lon});
      node["tourism"="museum"](around:20000,{lat},{lon});
      node["historic"="monument"](around:20000,{lat},{lon});
      node["leisure"="nature_reserve"](around:25000,{lat},{lon});
      node["natural"="beach"](around:25000,{lat},{lon});
      node["amenity"="place_of_worship"](around:15000,{lat},{lon});
    );
    out body {candidate_count};
    """
    try:
        resp = httpx.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=8.0)
        if resp.status_code == 200:
            elements = resp.json().get("elements", [])
            candidates = []
            for el in elements:
                name = el.get("tags", {}).get("name")
                if not name:
                    continue
                cat = (
                    el.get("tags", {}).get("tourism") or 
                    el.get("tags", {}).get("historic") or 
                    el.get("tags", {}).get("natural") or 
                    el.get("tags", {}).get("leisure") or 
                    "attraction"
                )
                candidates.append({
                    "name": name,
                    "category": cat,
                    "description": el.get("tags", {}).get("description") or f"A point of interest in {destination}.",
                    "why_visit": f"Point of interest near {destination}.",
                    "interests": [cat],
                    "lat": float(el["lat"]),
                    "lon": float(el["lon"]),
                    "source": "osm_fallback",
                    "_pre_enriched": True
                })
            print(f"--- ATTRACTION AGENT: OSM/Overpass fallback yielded {len(candidates)} candidates ---")
            return candidates
    except Exception as e:
        print(f"--- ATTRACTION AGENT: OSM/Overpass fallback failed: {type(e).__name__} ---")
    return []


def evaluate_attraction_priority(cand: dict, ranked_interests: list, must_visit_places: list) -> tuple:
    """
    Returns (score, priority_rank, matched_interest, match_type).
    Priority ranks:
    0: Must-visit place (score: 1000)
    1: Matches 1st user interest (score: 100)
    2: Matches 2nd user interest (score: 80)
    3: Matches 3rd user interest (score: 60)
    4+: Matches subsequent interest (score: 40)
    99: General popular recommendation (score: 10)
    """
    name = cand.get("name", "").lower()
    
    # Check Must-Visit match
    for mv in must_visit_places or []:
        mv_clean = mv.lower().strip()
        if mv_clean and (mv_clean in name or name in mv_clean):
            return 1000, 0, mv, "must_visit"

    cat = str(cand.get("category", "")).lower()
    desc = str(cand.get("description", "")).lower()
    why = str(cand.get("why_visit", "")).lower()
    cand_interests = [str(x).lower() for x in cand.get("interests", [])]
    all_text = f"{cat} {desc} {why} {' '.join(cand_interests)} {name}"

    if ranked_interests:
        for rank_idx, r_int in enumerate(ranked_interests):
            r_lower = r_int.lower().strip()
            # Category synonyms check
            synonyms = [r_lower]
            if "nature" in r_lower: synonyms += ["park", "garden", "wildlife", "forest", "reserve", "waterfall", "scenic"]
            if "beach" in r_lower: synonyms += ["coast", "cove", "bay", "shore", "sea"]
            if "temple" in r_lower: synonyms += ["church", "cathedral", "shrine", "monastery", "mosque", "worship"]
            if "history" in r_lower or "historic" in r_lower: synonyms += ["heritage", "fort", "palace", "ruins", "monument", "castle"]
            if "museum" in r_lower: synonyms += ["gallery", "exhibit", "art"]

            matched = any(syn in all_text for syn in synonyms) or any(syn in x for x in cand_interests for syn in synonyms)
            if matched:
                score = max(20, 100 - (rank_idx * 20))
                return score, rank_idx + 1, r_int, "interest_match"

    return 10, 99, "General", "popular_recommendation"


def attraction_node(state: TravelState) -> dict:
    destination = state.get("destination", "Unknown")
    days = int(state.get("days", 3))
    budget = float(state.get("budget", 500.0))
    preferences = state.get("preferences") or "General sightseeing"
    pace = (state.get("pace") or "balanced").lower()
    
    # Extract ranked interests
    raw_interests = state.get("interests")
    ranked_interests = []
    if isinstance(raw_interests, list) and raw_interests:
        ranked_interests = [str(x).strip() for x in raw_interests if str(x).strip()]
    elif preferences:
        for sep in [' > ', ' -> ', ',', '|']:
            if sep in preferences:
                ranked_interests = [s.strip() for s in preferences.split(sep) if s.strip()]
                break
        if not ranked_interests and preferences.strip():
            ranked_interests = [preferences.strip()]

    must_visit_places = [str(x).strip() for x in (state.get("must_visit_places") or []) if str(x).strip()]
    
    transit_days = 2 if (state.get('origin') and days > 1) else 0
    exploration_days = max(1, days - transit_days)
    
    pace_multiplier = 1.5 if pace == "relaxed" else (3.0 if pace == "packed" else 2.0)
    required_attractions = max(2, int(exploration_days * pace_multiplier))
    candidate_count = min(20, max(8, required_attractions + 5))
    
    print(f"--- ATTRACTION AGENT: Starting Discovery for {destination} (target: {candidate_count}, pace: {pace}) ---")
    if ranked_interests:
        print(f"--- ATTRACTION AGENT: Ranked Interests: {' > '.join(ranked_interests)} ---")
    if must_visit_places:
        print(f"--- ATTRACTION AGENT: Must-Visit Places: {', '.join(must_visit_places)} ---")

    candidates = []

    # Inject must-visit places directly as candidate requirements
    for mv in must_visit_places:
        candidates.append({
            "name": mv,
            "category": "must_visit",
            "description": f"Must-visit attraction: {mv} in {destination}.",
            "why_visit": "Explicitly requested by traveler as must-visit destination.",
            "interests": ranked_interests or ["must_visit"],
            "source": "must_visit_request",
            "_pre_enriched": False,
            "_is_must_visit": True
        })

    # 1. LLM Discovery Call (budget-clamped to max 400 tokens)
    interests_display = " > ".join(ranked_interests) if ranked_interests else preferences
    must_visit_display = ", ".join(must_visit_places) if must_visit_places else "None"
    
    prompt_val = GROK_DISCOVERY_PROMPT.format_messages(
        destination=destination,
        days=days,
        budget=budget,
        interests=interests_display,
        must_visit=must_visit_display,
        pace=pace
    )
    
    try:
        response = llm.invoke(prompt_val, agent_name="attraction_agent", max_tokens=380, min_tokens=220, timeout=12.0)
        content = response.content.strip()
        if content.startswith("```"):
            content = "\n".join(content.split("\n")[1:])
        if content.endswith("```"):
            content = "\n".join(content.split("\n")[:-1])
        data = json.loads(content.strip())
        llm_cands = data.get("attractions", [])
        
        # Deduplicate against must-visit
        seen_names = set(c["name"].lower() for c in candidates)
        for cand in llm_cands:
            if cand.get("name") and cand["name"].lower() not in seen_names:
                seen_names.add(cand["name"].lower())
                candidates.append(cand)
                
        print(f"--- ATTRACTION AGENT: LLM discovery yielded {len(llm_cands)} candidates ---")
    except GroqRateLimitError as e:
        print(f"--- ATTRACTION AGENT: Groq OTPM rate limit reached ({e}). Using Layer 2 factual fallback. ---")
    except Exception as e:
        print(f"--- ATTRACTION AGENT: LLM discovery fallback triggered ({e}). ---")
        
    # Layer 2 & 3 Fallbacks if candidates are insufficient
    if len(candidates) < candidate_count:
        needed = candidate_count - len(candidates)
        serp_cands = discover_via_serpapi(destination, needed + 3, ranked_interests=ranked_interests)
        seen_names = set(c["name"].lower() for c in candidates)
        for sc in serp_cands:
            if sc["name"].lower() not in seen_names:
                seen_names.add(sc["name"].lower())
                candidates.append(sc)

    if len(candidates) < candidate_count:
        needed = candidate_count - len(candidates)
        osm_cands = discover_via_overpass(destination, needed + 3)
        seen_names = set(c["name"].lower() for c in candidates)
        for oc in osm_cands:
            if oc["name"].lower() not in seen_names:
                seen_names.add(oc["name"].lower())
                candidates.append(oc)

    final_attractions = []
    
    # 2. Parallel Bounded Place Enrichment
    candidates_to_enrich = []
    for cand in candidates[:candidate_count + 6]:
        if cand.get("_pre_enriched"):
            score, rank, matched_int, m_type = evaluate_attraction_priority(cand, ranked_interests, must_visit_places)
            cand["priority_score"] = score
            cand["priority_rank"] = rank
            cand["matched_interest"] = matched_int
            cand["match_type"] = m_type
            cand["fame_level"] = calculate_fame_level(cand.get("rating"), cand.get("review_count"))
            final_attractions.append(cand)
        else:
            candidates_to_enrich.append(cand)

    if candidates_to_enrich:
        print(f"--- ATTRACTION AGENT: Concurrently enriching {len(candidates_to_enrich)} candidates ---")
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_cand = {
                executor.submit(verify_and_enrich_place, cand.get("name"), destination): cand
                for cand in candidates_to_enrich
            }
            for future in as_completed(future_to_cand):
                cand = future_to_cand[future]
                name = cand.get("name")
                try:
                    enriched = future.result()
                    lat = enriched.get("lat") if enriched else cand.get("lat")
                    lon = enriched.get("lon") if enriched else cand.get("lon")
                    
                    score, rank, matched_int, m_type = evaluate_attraction_priority(cand, ranked_interests, must_visit_places)

                    final_obj = {
                        "name": name,
                        "type": "attraction",
                        "category": cand.get("category", "attraction"),
                        "description": cand.get("description") or f"Explore {name} in {destination}.",
                        "why_visit": cand.get("why_visit") or f"Popular place to visit in {destination}.",
                        "interests": cand.get("interests", []),
                        "matched_interest": matched_int,
                        "priority_rank": rank,
                        "priority_score": score,
                        "match_type": m_type,
                        "lat": lat,
                        "lon": lon,
                        "image_url": enriched.get("image_url") if enriched else cand.get("image_url"),
                        "image_source": enriched.get("image_source") if enriched else None,
                        "photos_link": enriched.get("photos_link") if enriched else None,
                        "rating": enriched.get("rating") if enriched else cand.get("rating"),
                        "review_count": enriched.get("review_count") if enriched else cand.get("review_count"),
                        "address": enriched.get("address") if enriched else cand.get("address"),
                        "opening_hours": enriched.get("opening_hours") if enriched else cand.get("opening_hours"),
                        "place_id": enriched.get("place_id") if enriched else cand.get("place_id"),
                        "data_id": enriched.get("data_id") if enriched else cand.get("data_id"),
                        "source": cand.get("source", "ai_curated"),
                        "fame_level": calculate_fame_level(
                            enriched.get("rating") if enriched else cand.get("rating"), 
                            enriched.get("review_count") if enriched else cand.get("review_count")
                        )
                    }
                    final_attractions.append(final_obj)
                except Exception as e:
                    print(f"⚠️ Error enriching {name}: {e}")

    # Sort strictly by priority_score descending (Must-visits first, then Rank 1, Rank 2, etc.)
    final_attractions.sort(key=lambda x: x.get("priority_score", 0), reverse=True)
    
    # Cap to candidate count
    final_attractions = final_attractions[:candidate_count]
    print(f"--- ATTRACTION AGENT: Finalized {len(final_attractions)} verified attractions for {destination} ---")

    # Evaluate operating hours directly against trip date
    start_dt = None
    if state.get("start_date"):
        try:
            from dateutil import parser
            start_dt = parser.parse(state["start_date"])
        except Exception:
            pass
    if not start_dt:
        start_dt = datetime.now() + timedelta(days=7)

    for i, attr in enumerate(final_attractions):
        target_date = start_dt + timedelta(days=i % max(1, days))
        hours = attr.get("opening_hours")
        status, reason = determine_status_from_hours(hours, target_date)
        attr["status"] = status
        attr["reason"] = reason
        attr["opening_hours_status"] = "VERIFIED_OPEN" if (status == "OPEN" and hours) else ("VERIFIED_CLOSED" if status == "CLOSED" else "UNVERIFIED")
        attr["scheduled_date"] = target_date.strftime("%Y-%m-%d")
        attr["day_of_week"] = target_date.strftime("%A")
    
    return {
        "attractions": final_attractions,
        "completed_steps": state.get("completed_steps", []) + ["attractions", "opening_hours"]
    }
