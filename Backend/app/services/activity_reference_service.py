"""
Activity Reference & Intent Resolution Service for Conversational Itinerary Editing.
Handles:
- Natural-language referencing (by name, ordinal, relative position, time-of-day slot, context).
- Disambiguation and clarification prompting when targets are ambiguous.
- Distinguishing casual questions / preferences from explicit itinerary modification instructions.
"""
import re
from typing import Dict, Any, List, Optional, Tuple
from app.utils.place_deduplication import clean_place_name, is_same_physical_place, clean_display_name

ORDINAL_MAP = {
    "first": 0, "1st": 0, "number 1": 0, "place 1": 0, "option 1": 0,
    "second": 1, "2nd": 1, "number 2": 1, "place 2": 1, "option 2": 1,
    "third": 2, "3rd": 2, "number 3": 2, "place 3": 2, "option 3": 2,
    "fourth": 3, "4th": 3, "number 4": 3, "place 4": 3, "option 4": 3,
    "fifth": 4, "5th": 4, "number 5": 4, "place 5": 4, "option 5": 4,
    "last": -1, "final": -1
}

WORD_TO_DAY = {
    "first": 1, "1st": 1, "one": 1,
    "second": 2, "2nd": 2, "two": 2,
    "third": 3, "3rd": 3, "three": 3,
    "fourth": 4, "4th": 4, "four": 4,
    "fifth": 5, "5th": 5, "five": 5,
    "sixth": 6, "6th": 6, "six": 6,
    "seventh": 7, "7th": 7, "seven": 7
}

CATEGORY_SYNONYMS = {
    "beach": ["beach", "coast", "coastal", "cove", "bay", "sea", "ocean", "shore"],
    "temple": ["temple", "church", "cathedral", "shrine", "monastery", "basilica", "mandir", "spiritual", "mosque"],
    "history": ["fort", "palace", "monument", "historic", "historical", "heritage", "unesco", "history", "ruins"],
    "museum": ["museum", "gallery", "exhibit"],
    "nature": ["nature", "waterfall", "park", "garden", "wildlife", "sanctuary", "scenic", "lake", "viewpoint"],
    "restaurant": ["restaurant", "food", "dining", "cafe", "bistro", "shack", "seafood", "eatery", "cuisine", "lunch", "dinner"],
    "adventure": ["adventure", "trek", "trekking", "watersports", "dive", "diving", "snorkeling", "kayaking", "parasailing"],
    "shopping": ["shopping", "market", "bazaar", "flea market", "mall"]
}

def extract_day_number(text: str, current_day: int = 1) -> Optional[int]:
    """Extract explicit day number from text e.g. 'Day 2', 'second day', 'tomorrow'."""
    lower = text.lower()
    
    # "day 2", "day 3"
    m = re.search(r'\bday\s*(\d+)\b', lower)
    if m:
        return int(m.group(1))
        
    # "day two", "day three"
    m_word = re.search(r'\bday\s*(one|two|three|four|five|six|seven)\b', lower)
    if m_word:
        return WORD_TO_DAY.get(m_word.group(1))

    # "2nd day", "second day", "3rd day"
    m_ord = re.search(r'\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\s+day\b', lower)
    if m_ord:
        return WORD_TO_DAY.get(m_ord.group(1))

    # "tomorrow"
    if "tomorrow" in lower:
        return current_day + 1

    return None

def extract_ordinal(text: str) -> Optional[int]:
    """Extract 0-based ordinal index from text e.g. 'the second beach' -> 1."""
    lower = text.lower()
    for pattern, idx in ORDINAL_MAP.items():
        if re.search(r'\b' + re.escape(pattern) + r'\b', lower):
            return idx
    return None

def extract_time_slot(text: str) -> Optional[str]:
    """Extract time of day slot reference."""
    lower = text.lower()
    if re.search(r'\b(?:before\s+lunch|pre[- ]lunch)\b', lower):
        return "before_lunch"
    if re.search(r'\b(?:after\s+lunch|post[- ]lunch)\b', lower):
        return "after_lunch"
    if re.search(r'\b(?:in\s+the\s+)?morning\b', lower):
        return "morning"
    if re.search(r'\b(?:in\s+the\s+)?afternoon\b', lower):
        return "afternoon"
    if re.search(r'\b(?:in\s+the\s+)?(?:evening|sunset|night)\b', lower):
        return "evening"
    return None

def detect_category_hint(text: str) -> Optional[str]:
    """Detect if the user is referring to a category like 'beach', 'temple', 'restaurant', etc."""
    lower = text.lower()
    for cat, syns in CATEGORY_SYNONYMS.items():
        for syn in syns:
            if re.search(r'\b' + re.escape(syn) + r'(?:es|s)?\b', lower):
                return cat
    return None

def stop_matches_category(stop: Dict[str, Any], category: str) -> bool:
    """Check if a stop belongs to the given category."""
    if not category:
        return True
    syns = CATEGORY_SYNONYMS.get(category, [category])
    fields = [
        str(stop.get("name", "")),
        str(stop.get("title", "")),
        str(stop.get("category", "")),
        str(stop.get("type", "")),
        str(stop.get("description", ""))
    ]
    haystack = " ".join(fields).lower()
    return any(syn in haystack for syn in syns)

def stop_matches_time_slot(stop: Dict[str, Any], slot: str, day_stops: List[Dict[str, Any]]) -> bool:
    """Check if a stop matches a time-of-day or relative position slot."""
    start_time = stop.get("start_time", "12:00")
    try:
        from app.ai.agents.route_agent import parse_hhmm_to_minutes
        start_min = parse_hhmm_to_minutes(start_time, 720)
    except Exception:
        start_min = 720

    if slot == "morning":
        return start_min < 720  # before 12:00 PM
    elif slot == "afternoon":
        return 720 <= start_min < 1020  # 12:00 PM to 5:00 PM
    elif slot == "evening":
        return start_min >= 1020  # 5:00 PM onwards
    elif slot == "before_lunch":
        # Find lunch restaurant on the day
        lunch_idx = next(
            (i for i, s in enumerate(day_stops) if s.get("type") == "restaurant" and 700 <= parse_hhmm_to_minutes(s.get("start_time", "12:00"), 780) <= 900),
            None
        )
        if lunch_idx is not None and lunch_idx > 0:
            stop_idx = next((i for i, s in enumerate(day_stops) if s.get("id") == stop.get("id")), None)
            return stop_idx is not None and stop_idx == lunch_idx - 1
        return start_min < 780
    elif slot == "after_lunch":
        lunch_idx = next(
            (i for i, s in enumerate(day_stops) if s.get("type") == "restaurant" and 700 <= parse_hhmm_to_minutes(s.get("start_time", "12:00"), 780) <= 900),
            None
        )
        if lunch_idx is not None and lunch_idx < len(day_stops) - 1:
            stop_idx = next((i for i, s in enumerate(day_stops) if s.get("id") == stop.get("id")), None)
            return stop_idx is not None and stop_idx == lunch_idx + 1
        return start_min >= 840
    return True

def resolve_target_in_itinerary(
    trip_doc: Dict[str, Any],
    user_message: str,
    previous_assistant_message: Optional[str] = None,
    last_recommendations: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Analyzes user message in the context of active itinerary stops.
    Identifies action type (replace, add, remove, move, focus), target stop, day number,
    replacement specification, or ambiguity requiring clarification.
    """
    clean_msg = user_message.strip().lower()

    # 1. Distinguish casual inquiry / question
    # e.g. "Are there good temples nearby?", "What can we do in Old Goa?", "Tell me more about Fort Aguada."
    is_question = bool(
        clean_msg.endswith("?")
        or re.search(r'^(?:are\s+there|is\s+there|can\s+you\s+tell\s+me|tell\s+me\s+more|what\s+(?:can|is|are)|how\s+(?:is|far)|why\s+is|where\s+is)\b', clean_msg)
    ) and not re.search(r'\b(replace|swap|remove|delete|add|move|shift|reschedule)\b', clean_msg)

    if is_question:
        return {
            "action": "question",
            "is_casual_question": True,
            "target_stop": None,
            "day_number": None,
            "is_ambiguous": False
        }

    # 2. Check for explicit proposal approval / cancellation
    if re.search(r'^\s*(apply\s*(changes|proposal|revision|itinerary)?|confirm\s*(changes)?|accept\s*(changes)?|yes,\s*apply)\s*$', clean_msg) or clean_msg in {'apply', 'confirm', 'accept'}:
        return {"action": "apply", "is_ambiguous": False}
    if re.search(r'^\s*(keep\s*(current|existing)?\s*(itinerary|trip)?|cancel\s*(changes|proposal)?|discard\s*(changes|proposal)?|no,\s*keep)\s*$', clean_msg) or clean_msg in {'keep', 'cancel', 'discard'}:
        return {"action": "cancel", "is_ambiguous": False}

    # 3. Detect Action Type
    action = None
    # Check for overall focus changes (e.g. "both temples and beaches", "make it more focused on beaches")
    multi_focus_pattern = bool(re.search(
        r'\b(?:'
        r'(?:i\s+)?want\s+both|'
        r'both\s+[a-z\s]+\s+and\s+[a-z\s]+|'
        r'mix\s+[a-z\s]+\s+(?:with|and)|'
        r'combine\s+[a-z\s]+\s+(?:with|and)|'
        r'as\s+well\s+as|'
        r'change\s+(?:this|the|my|our|current)?\s*(?:trip|itinerary|focus|schedule)\s+to|'
        r'now\s+change\s+it\s+to|'
        r'change\s+it\s+to|'
        r'make\s+(?:this|the|my|our|current)?\s*(?:trip|itinerary)\s+(?:more|a\s+mixture)|'
        r'replace\s+(?:the\s+)?(?:sightseeing|activities|stops|attractions)?\s+with'
        r')\b',
        clean_msg
    ))
    if multi_focus_pattern:
        action = "focus"
    elif not action:
        if re.search(r'\b(replace|swap|substitute)\b', clean_msg) or re.search(r'\bchange\s+.+?\s+to\b', clean_msg):
            action = "replace"
        elif re.search(r'\b(add|put|insert|include|schedule)\b', clean_msg):
            action = "add"
        elif re.search(r'\b(remove|delete|drop|take\s+out|take\s+away|don\'t\s+want|do\s+not\s+want)\b', clean_msg):
            action = "remove"
        elif re.search(r'\b(move|shift|reschedule)\b', clean_msg) or re.search(r'\bkeep\s+.+?\s+but\s+shift\b', clean_msg) or re.search(r'\bvisit\s+.+?\s+before\s+lunch\b', clean_msg):
            action = "move"

    days_route = trip_doc.get("route_details", {}).get("day_by_day_route", [])
    exec_state = trip_doc.get("execution_state") or {}
    current_day = exec_state.get("current_day_number", 1)

    # 4. Check if resolving a previous clarification turn!
    # If previous assistant message asked "Which one would you like to replace/remove: Place A or Place B?"
    if previous_assistant_message and ("which one would you like to" in previous_assistant_message.lower() or "which beach" in previous_assistant_message.lower() or "which attraction" in previous_assistant_message.lower()):
        # Check if user message names one of the candidates or gives an ordinal like "the first one"
        all_stops = [s for d in days_route for s in (d.get("stops") or []) if s.get("type") in {"attraction", "restaurant"}]
        # Check name match
        for s in all_stops:
            s_name = clean_place_name(s.get("name") or s.get("title") or "")
            if s_name and (s_name in clean_msg or clean_msg in s_name):
                # Target resolved from clarification response!
                prev_action = "replace" if "replace" in previous_assistant_message.lower() else "remove"
                return {
                    "action": prev_action,
                    "target_stop": s,
                    "day_number": next((int(d.get("day") or d.get("day_number") or i+1) for i, d in enumerate(days_route) if any(x.get("id") == s.get("id") for x in (d.get("stops") or []))), 1),
                    "is_ambiguous": False,
                    "replacement_name": None,
                    "replacement_category": None
                }

    # Extract target day and ordinal/time slot references
    day_num = extract_day_number(clean_msg, current_day)
    ordinal_idx = extract_ordinal(clean_msg)
    time_slot = extract_time_slot(clean_msg)
    category_hint = detect_category_hint(clean_msg)

    # If action is still unknown but an explicit day or edit verb is present
    if not action:
        if re.search(r'\b(remove|delete|replace|swap|add|move)\b', clean_msg):
            action = "replace" if "replace" in clean_msg else "remove"
        elif category_hint and re.search(r'\b(instead|prefer|change)\b', clean_msg):
            action = "replace"
        else:
            action = "unknown"

    # Destination day for move actions: "move X to Day 3"
    dest_day_num = None
    if action == "move":
        m_to_day = re.search(r'(?:to|on|into)\s+day\s*(\d+)', clean_msg)
        if m_to_day:
            dest_day_num = int(m_to_day.group(1))
        elif "tomorrow" in clean_msg:
            dest_day_num = current_day + 1
        elif day_num:
            dest_day_num = day_num

    # Collect stops to search through
    # Filter by specified day if day_num is explicitly given (unless it's an "add to day X" or "move to day X")
    candidate_stops_pool = []
    for i, d in enumerate(days_route):
        d_num = int(d.get("day") or d.get("day_number") or i + 1)
        stops = d.get("stops") or d.get("activities") or []
        for s in stops:
            if s.get("type") in {"attraction", "restaurant"}:
                candidate_stops_pool.append((d_num, s, stops))

    # Identify Target Stop
    target_stop = None
    target_day = None

    # Step A: Check for Exact / Substring Place Name Match in User Message
    # Sort by descending name length to match longer names first
    named_matches = []
    for d_num, s, day_stops in candidate_stops_pool:
        raw_name = s.get("name") or s.get("title") or ""
        c_name = clean_place_name(raw_name)
        if c_name and len(c_name) > 3:
            # Check if place name is in user message
            if c_name in clean_msg or (raw_name.lower() in clean_msg):
                named_matches.append((d_num, s, day_stops, len(c_name)))

    if named_matches:
        named_matches.sort(key=lambda x: x[3], reverse=True)
        # If user specified day_num, prefer the match on that day
        if day_num:
            matched_on_day = next((m for m in named_matches if m[0] == day_num), None)
            if matched_on_day:
                target_day, target_stop, _ = matched_on_day[0], matched_on_day[1], matched_on_day[2]
            else:
                target_day, target_stop, _ = named_matches[0][0], named_matches[0][1], named_matches[0][2]
        else:
            target_day, target_stop, _ = named_matches[0][0], named_matches[0][1], named_matches[0][2]

    # Step B: Check for Ordinal Reference (e.g. "the second attraction", "the first beach", "the second beach")
    if not target_stop and ordinal_idx is not None:
        # Determine scope: day-specific or trip-wide
        pool = [(d_num, s, d_stops) for d_num, s, d_stops in candidate_stops_pool if not day_num or d_num == day_num]
        
        # Filter pool by category if hint provided (e.g. "the second beach")
        if category_hint:
            pool = [item for item in pool if stop_matches_category(item[1], category_hint)]
        elif re.search(r'\b(restaurant|food|lunch|dinner)\b', clean_msg):
            pool = [item for item in pool if item[1].get("type") == "restaurant"]
        else:
            # "the second attraction" / "the second stop"
            pool = [item for item in pool if item[1].get("type") == "attraction"]

        if 0 <= ordinal_idx < len(pool):
            target_day, target_stop, _ = pool[ordinal_idx]
        elif ordinal_idx == -1 and len(pool) > 0:
            target_day, target_stop, _ = pool[-1]

    # Step C: Check for Time-of-Day / Relative Position Reference (e.g. "Day 2 afternoon activity", "morning stop")
    if not target_stop and time_slot:
        pool = [(d_num, s, d_stops) for d_num, s, d_stops in candidate_stops_pool if not day_num or d_num == day_num]

        # If user explicitly said "activity" or "attraction" or "sightseeing", filter to attraction stops
        if re.search(r'\b(activity|attraction|sightseeing|spot|visit)\b', clean_msg):
            pool = [item for item in pool if item[1].get("type") == "attraction"]
        elif re.search(r'\b(restaurant|food|lunch|dinner|cafe)\b', clean_msg):
            pool = [item for item in pool if item[1].get("type") == "restaurant"]

        matching_time_stops = [
            (d_num, s, d_stops)
            for d_num, s, d_stops in pool
            if stop_matches_time_slot(s, time_slot, d_stops)
        ]
        if len(matching_time_stops) == 1:
            target_day, target_stop, _ = matching_time_stops[0]
        elif len(matching_time_stops) > 1:
            # Check if filtered by category hint
            if category_hint:
                cat_time_stops = [m for m in matching_time_stops if stop_matches_category(m[1], category_hint)]
                if len(cat_time_stops) == 1:
                    target_day, target_stop, _ = cat_time_stops[0]
                elif len(cat_time_stops) > 1:
                    matching_time_stops = cat_time_stops

            if not target_stop and len(matching_time_stops) > 1:
                # Ambiguous time-of-day stops!
                day_label = f"Day {day_num}" if day_num else "your schedule"
                cand_names = [clean_display_name(m[1].get("name") or m[1].get("title")) for m in matching_time_stops]
                prompt = f"{day_label} has multiple {time_slot} activities: {', '.join(cand_names)}. Which one would you like to {action}?"
                return {
                    "action": action,
                    "target_stop": None,
                    "day_number": day_num,
                    "is_ambiguous": True,
                    "ambiguity_candidates": [m[1] for m in matching_time_stops],
                    "clarification_prompt": prompt
                }

    # Step D: Contextual reference from last recommendations (e.g. "replace that one", "add that temple")
    if not target_stop and last_recommendations and re.search(r'\b(that\s+one|that\s+place|that\s+temple|that\s+beach|the\s+one\s+you\s+(?:mentioned|recommended))\b', clean_msg):
        # Look in last_recommendations
        matched_rec = last_recommendations[0] if last_recommendations else None
        if matched_rec:
            # Check if this rec matches an existing stop (for remove/replace)
            for d_num, s, d_stops in candidate_stops_pool:
                if is_same_physical_place(s, matched_rec):
                    target_stop = s
                    target_day = d_num
                    break

    # Step E: Ambiguity Detection when target is ambiguous
    # If user says e.g. "replace the beach" or "remove the temple" without specifying which one
    if not target_stop and action in {"replace", "remove", "move"} and category_hint:
        pool = [(d_num, s, d_stops) for d_num, s, d_stops in candidate_stops_pool if not day_num or d_num == day_num]
        matching_cat_stops = [item for item in pool if stop_matches_category(item[1], category_hint)]
        
        if len(matching_cat_stops) > 1:
            # Ambiguity detected!
            day_label = f"Day {day_num}" if day_num else "Your itinerary"
            cand_names = [clean_display_name(m[1].get("name") or m[1].get("title")) for m in matching_cat_stops]
            if len(cand_names) == 2:
                names_str = f"{cand_names[0]} and {cand_names[1]}"
            else:
                names_str = f"{', '.join(cand_names[:-1])}, and {cand_names[-1]}"
            
            clarification = f"{day_label} includes both {names_str}. Which one would you like to {action}?"
            return {
                "action": action,
                "target_stop": None,
                "day_number": day_num,
                "is_ambiguous": True,
                "ambiguity_candidates": [m[1] for m in matching_cat_stops],
                "clarification_prompt": clarification
            }
        elif len(matching_cat_stops) == 1:
            target_day, target_stop, _ = matching_cat_stops[0]

    # Extract Replacement Place or Category
    replacement_name = None
    replacement_cat = None

    if action in {"replace", "add"}:
        # Check if user specified "with <place/category>" or "add <place/category>"
        with_match = re.search(r'\b(?:with|for|by|to)\s+(?:a\s+|an\s+|the\s+)?(.+)', clean_msg)
        add_match = re.search(r'\b(?:add|include|put|insert)\s+(?:a\s+|an\s+|the\s+)?(.+?)(?:\s+(?:to|on|into)\s+day\s*\d+|\s+on\s+day\s*\d+|$)', clean_msg)
        
        raw_repl = None
        if action == "replace" and with_match:
            raw_repl = with_match.group(1).strip()
        elif action == "add" and add_match:
            raw_repl = add_match.group(1).strip()
            
        if raw_repl:
            # Clean trailing punctuation and modifiers
            raw_repl = re.sub(r'[\?\.\!\,\;]+$', '', raw_repl).strip()
            raw_repl = re.sub(r'\s+(?:on|to|into)\s+day\s*\d+.*$', '', raw_repl, flags=re.IGNORECASE).strip()
            raw_repl = re.sub(r'\b(?:at|on|for|in)\s+(?:day\s*\d+|evening|morning|afternoon|night)\b.*$', '', raw_repl, flags=re.IGNORECASE).strip()
            raw_repl = re.sub(r'\s+instead.*$', '', raw_repl, flags=re.IGNORECASE).strip()
            raw_repl = re.sub(r'^(?:another|a|an|the|some|good|famous|local|any)\s+', '', raw_repl, flags=re.IGNORECASE).strip()
            
            repl_cat_hint = detect_category_hint(raw_repl)
            if repl_cat_hint:
                replacement_cat = repl_cat_hint

            # If it's more than pure generic words, treat as specific replacement name
            words = [re.sub(r'[^\w]', '', w) for w in raw_repl.split() if w]
            generic_words = {
                "any", "some", "a", "an", "the", "one", "new", "another",
                "temple", "temples", "beach", "beaches", "fort", "museum", "restaurant", "church",
                "nature", "waterfall", "waterfalls", "historical", "historic", "heritage", "place",
                "spot", "activity", "attraction", "attractions", "seafood", "food", "dining", "culture", "monument",
                "good", "famous", "local", "dinner", "lunch", "breakfast", "cafe", "meal", "sightseeing",
                "visit", "something", "things", "to", "do", "see", "at", "in", "for", "or", "and"
            }
            if words and not all(w.lower() in generic_words for w in words):
                replacement_name = raw_repl.title()

    return {
        "action": action,
        "target_stop": target_stop,
        "day_number": target_day or day_num or 1,
        "dest_day_number": dest_day_num,
        "target_slot": time_slot,
        "replacement_name": replacement_name,
        "replacement_category": replacement_cat,
        "is_ambiguous": False,
        "ambiguity_candidates": [],
        "clarification_prompt": None,
        "is_casual_question": False,
        "is_casual_preference": False
    }
