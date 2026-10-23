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
from app.utils.place_deduplication import is_same_physical_place, deduplicate_place_list

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
            queries.append((r_int, f"{r_int} attractions in {destination}"))
    queries.append(("general", f"top tourist attractions in {destination}"))

    candidates = []
    seen_titles = set()
    for query_tag, query in queries:
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
                        cand_type = r.get("type", "attraction")
                        c_interests = [query_tag] if query_tag != "general" else []
                        if cand_type and cand_type.lower() != "attraction":
                            c_interests.append(cand_type)
                        candidates.append({
                            "name": title,
                            "category": cand_type,
                            "description": r.get("description") or f"A notable landmark in {destination}.",
                            "why_visit": f"Verified attraction in {destination}.",
                            "interests": c_interests,
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
        resp = httpx.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=3.5)
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
    99: General / balanced recommendation
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
        best_score = 0
        best_rank = 99
        best_int = "General"
        match_count = 0

        for rank_idx, r_int in enumerate(ranked_interests):
            r_lower = r_int.lower().strip()
            # Comprehensive category synonyms
            synonyms = [r_lower]
            if "nature" in r_lower or "wildlife" in r_lower or "scenic" in r_lower:
                synonyms += ["park", "garden", "wildlife", "forest", "reserve", "waterfall", "scenic", "hills", "lake", "eco", "sanctuary", "viewpoint"]
            if "beach" in r_lower or "coast" in r_lower or "sea" in r_lower:
                synonyms += ["coast", "coastal", "cove", "bay", "shore", "sea", "ocean", "swimming", "beachfront", "sand", "watersports"]
            if "temple" in r_lower or "spiritual" in r_lower or "pilgrimage" in r_lower:
                synonyms += ["church", "cathedral", "shrine", "monastery", "mosque", "worship", "basilica", "ashram", "deity", "spiritual"]
            if "history" in r_lower or "historic" in r_lower or "heritage" in r_lower:
                synonyms += ["heritage", "fort", "palace", "ruins", "monument", "castle", "ancient", "citadel", "dynasty", "16th-century", "17th-century", "18th-century", "unesco"]
            if "museum" in r_lower or "art" in r_lower or "culture" in r_lower:
                synonyms += ["gallery", "exhibit", "art", "collection", "sculpture", "artifacts", "culture"]
            if "adventure" in r_lower or "outdoor" in r_lower or "trek" in r_lower:
                synonyms += ["trek", "trekking", "hike", "hiking", "safari", "rafting", "watersports", "scuba", "snorkeling", "camping", "climbing"]
            if "food" in r_lower or "culinary" in r_lower or "dining" in r_lower:
                synonyms += ["culinary", "restaurant", "cafe", "bistro", "street food", "market", "tasting", "dining", "seafood"]
            if "shopping" in r_lower or "market" in r_lower:
                synonyms += ["bazaar", "market", "flea market", "souvenir", "handicrafts", "boutique"]
            if "nightlife" in r_lower or "entertainment" in r_lower:
                synonyms += ["pub", "bar", "club", "lounge", "brewery", "party", "music"]
            if "luxury" in r_lower or "premium" in r_lower:
                synonyms += ["royal", "palace", "spa", "resort", "exclusive", "wellness", "yacht", "durbar", "fine dining", "vip"]
            if "peaceful" in r_lower or "relax" in r_lower or "offbeat" in r_lower:
                synonyms += ["peaceful", "calm", "serene", "quiet", "offbeat", "secluded", "scenic"]
            if "family" in r_lower or "kid" in r_lower:
                synonyms += ["family", "kids", "children", "amusement", "park", "aquarium", "zoo"]

            matched = any(syn in all_text for syn in synonyms) or any(syn in x for x in cand_interests for syn in synonyms)
            if matched:
                match_count += 1
                base_score = max(20, 100 - (rank_idx * 20))
                if base_score > best_score:
                    best_score = base_score
                    best_rank = rank_idx + 1
                    best_int = r_int

        if best_score > 0:
            final_score = best_score + (15 if match_count > 1 else 0)
            return final_score, best_rank, best_int, "interest_match"

    # Phase 5: Balanced default distribution when no specific interests are specified
    category_signatures = [
        ("Heritage & Historic Landmark", ["fort", "palace", "monument", "historic", "heritage", "citadel", "ruins", "castle", "unesco"]),
        ("Nature, Scenic & Waterfall", ["nature", "waterfall", "park", "garden", "wildlife", "scenic", "viewpoint", "lake", "sanctuary"]),
        ("Coastal & Beaches", ["beach", "coast", "cove", "bay", "sea", "ocean"]),
        ("Spiritual & Culture", ["temple", "church", "cathedral", "shrine", "mosque", "museum", "gallery", "art"]),
        ("Local Experience & Market", ["market", "bazaar", "food", "flea", "shopping", "promenade"])
    ]
    for cat_idx, (cat_title, keywords) in enumerate(category_signatures):
        if any(kw in all_text for kw in keywords):
            div_score = 45 - (cat_idx * 2)
            return div_score, 10 + cat_idx, cat_title, "balanced_recommendation"

    return 10, 99, "General", "popular_recommendation"


def attraction_node(state: TravelState) -> dict:
    destination = state.get("destination", "Unknown")
    days = int(state.get("days", 3))
    budget = float(state.get("budget", 500.0))
    preferences = state.get("preferences") or ""
    pace = (state.get("pace") or "balanced").lower()
    
    # Extract ranked interests
    raw_interests = state.get("interests")
    ranked_interests = []
    if isinstance(raw_interests, list) and raw_interests:
        ranked_interests = [
            str(x).strip() for x in raw_interests 
            if str(x).strip() and str(x).strip().lower() not in ["general sightseeing", "general", "none", "sightseeing"]
        ]
    elif preferences:
        for sep in [' > ', ' -> ', ',', '|']:
            if sep in preferences:
                ranked_interests = [
                    s.strip() for s in preferences.split(sep) 
                    if s.strip() and s.strip().lower() not in ["general sightseeing", "general", "none", "sightseeing"]
                ]
                break
        if not ranked_interests and preferences.strip() and preferences.strip().lower() not in ["general sightseeing", "general", "none", "sightseeing"]:
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

    # 0. Inject verified authentic destination attractions
    dest_clean = destination.lower().strip()
    try:
        from app.services.travel_guide_agent import AUTHENTIC_DESTINATION_ATTRACTIONS
        if dest_clean in AUTHENTIC_DESTINATION_ATTRACTIONS:
            seen_names = set(c["name"].lower() for c in candidates)
            for auth_cand in AUTHENTIC_DESTINATION_ATTRACTIONS[dest_clean]:
                if auth_cand["name"].lower() not in seen_names:
                    seen_names.add(auth_cand["name"].lower())
                    candidates.append(dict(auth_cand, source="curated_verified", _pre_enriched=True))
    except Exception as e:
        print(f"--- ATTRACTION AGENT: Curated lookup notice: {e} ---")

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
        
        # Canonical deduplication against must-visit and existing candidates
        for cand in llm_cands:
            if cand.get("name") and not any(is_same_physical_place(cand, c) for c in candidates):
                candidates.append(cand)
                
        print(f"--- ATTRACTION AGENT: LLM discovery yielded {len(llm_cands)} candidates ---")
    except GroqRateLimitError as e:
        print(f"--- ATTRACTION AGENT: Groq OTPM rate limit reached ({e}). Using Layer 2 factual fallback. ---")
    except Exception as e:
        print(f"--- ATTRACTION AGENT: LLM discovery fallback triggered ({e}). ---")
        
    # Layer 2: Authentic curated destination knowledge
    try:
        from app.services.travel_guide_agent import AUTHENTIC_DESTINATION_ATTRACTIONS
        dest_clean = destination.lower().strip()
        if dest_clean in AUTHENTIC_DESTINATION_ATTRACTIONS:
            for auth_cand in AUTHENTIC_DESTINATION_ATTRACTIONS[dest_clean]:
                if not any(is_same_physical_place(auth_cand, c) for c in candidates):
                    candidates.append(dict(auth_cand, source="curated_verified", _pre_enriched=True))
    except Exception as e:
        print(f"--- ATTRACTION AGENT: Curated destination lookup note: {type(e).__name__} ---")

    # Layer 3: SerpApi & Overpass if candidates are still insufficient
    if len(candidates) < candidate_count:
        needed = candidate_count - len(candidates)
        serp_cands = discover_via_serpapi(destination, needed + 3, ranked_interests=ranked_interests)
        for sc in serp_cands:
            if not any(is_same_physical_place(sc, c) for c in candidates):
                candidates.append(sc)

    if len(candidates) < candidate_count:
        needed = candidate_count - len(candidates)
        osm_cands = discover_via_overpass(destination, needed + 3)
        for oc in osm_cands:
            if not any(is_same_physical_place(oc, c) for c in candidates):
                candidates.append(oc)

    # Ensure clean canonical deduplication across all candidate layers
    candidates = deduplicate_place_list(candidates)

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

    # Sort candidates by priority_score descending first
    final_attractions.sort(key=lambda x: x.get("priority_score", 0), reverse=True)
    
    # Balance selection across interests or default categories
    selected_attractions = []
    seen_names = set()
    
    # 1. Must-visit places first
    for a in final_attractions:
        if a.get("priority_rank") == 0 or a.get("match_type") == "must_visit":
            if a["name"].lower() not in seen_names:
                seen_names.add(a["name"].lower())
                selected_attractions.append(a)
                
    if ranked_interests:
        # 2. Guarantee representation across each specified interest (e.g. 1-2 per interest)
        for r_int in ranked_interests:
            r_lower = r_int.lower().strip()
            count_for_int = 0
            for a in final_attractions:
                if a["name"].lower() in seen_names:
                    continue
                m_int = (a.get("matched_interest") or "").lower()
                c_ints = [str(x).lower() for x in a.get("interests", [])]
                cat_str = (a.get("category") or "").lower()
                desc_str = (a.get("description") or "").lower()
                all_s = f"{m_int} {' '.join(c_ints)} {cat_str} {desc_str}"
                
                # Check match against this specific interest
                synonyms = [r_lower]
                if "beach" in r_lower or "coast" in r_lower:
                    synonyms += ["beach", "coast", "coastal", "cove", "bay", "sea", "ocean"]
                if "temple" in r_lower or "spiritual" in r_lower:
                    synonyms += ["temple", "church", "cathedral", "shrine", "monastery", "basilica", "mandir"]
                if "food" in r_lower or "culinary" in r_lower:
                    synonyms += ["food", "culinary", "restaurant", "cafe", "bistro", "market", "dining", "seafood"]
                if "history" in r_lower or "heritage" in r_lower:
                    synonyms += ["fort", "palace", "monument", "historic", "heritage", "unesco"]
                if "nature" in r_lower or "wildlife" in r_lower:
                    synonyms += ["nature", "waterfall", "park", "garden", "wildlife", "scenic"]
                    
                if any(syn in all_s for syn in synonyms):
                    seen_names.add(a["name"].lower())
                    selected_attractions.append(a)
                    count_for_int += 1
                    if count_for_int >= 2:
                        break
    else:
        # 2. Balanced default: round-robin across diverse categories
        categories_map = {}
        for a in final_attractions:
            cat_group = a.get("matched_interest") or a.get("category") or "General"
            categories_map.setdefault(cat_group, []).append(a)
        
        while len(selected_attractions) < candidate_count:
            added_any = False
            for cat_group, group_items in list(categories_map.items()):
                while group_items:
                    candidate_item = group_items.pop(0)
                    if candidate_item["name"].lower() not in seen_names:
                        seen_names.add(candidate_item["name"].lower())
                        selected_attractions.append(candidate_item)
                        added_any = True
                        break
                if len(selected_attractions) >= candidate_count:
                    break
            if not added_any:
                break

    # 3. Fill remaining slots with remaining highest priority attractions
    for a in final_attractions:
        if len(selected_attractions) >= candidate_count:
            break
        if a["name"].lower() not in seen_names:
            seen_names.add(a["name"].lower())
            selected_attractions.append(a)
            
    final_attractions = selected_attractions
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
