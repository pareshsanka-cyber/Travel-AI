import json
import re
from typing import Dict, Any, List, Optional
from app.ai.llm import llm
from langchain_core.prompts import ChatPromptTemplate
from app.ai.rag.retriever import LANDMARK_DESTINATIONS, resolve_destination_from_query

ANALYZER_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert travel assistant conversational analyzer. "
        "Your task is to analyze the user's message in the context of an ongoing travel planning conversation "
        "and determine the user's intent, extract travel preference variables (slots), and identify Q&A needs.\n\n"
        "Input context:\n"
        "- Current Travel Context: {current_context}\n"
        "- Previous Assistant Message: {previous_assistant_message}\n"
        "- Has Generated Itinerary: {has_current_trip}\n\n"
        "Supported Intents:\n"
        "1. UPDATE_CONTEXT: User is sharing, updating, or specifying preferences, interests, budget, or trip parameters (e.g. 'I love beaches and temples', 'My budget is 50k', 'We are 4 people', 'I prefer luxury travel') WITHOUT explicitly commanding you to plan or generate an itinerary right now.\n"
        "2. TRAVEL_QA: User is asking informational, factual, or recommendation questions about a destination, landmark, monument, weather, food, attractions, or travel tips (e.g. 'What is famous in Jaipur?', 'Why is Hawa Mahal famous?', 'Best food in Goa', 'How is the weather in Munnar?', 'What about places near the second attraction you suggested?').\n"
        "3. GENERATE_ITINERARY: User explicitly commands you to plan, create, generate, or build the trip or itinerary (e.g. 'Plan a five-day trip to Goa', 'Generate my itinerary', 'Build the trip for 3 days'). This SUPERSEDES UPDATE_CONTEXT if both apply!\n"
        "4. MODIFY_ITINERARY: When Has Generated Itinerary is True and the user asks to change, edit, or adjust the existing trip or a day (e.g. 'Change day 2 to focus on watersports', 'Make day 2 more relaxed', 'Remove that restaurant'), intent MUST be MODIFY_ITINERARY.\n"
        "5. GENERAL_CHAT: User is greeting ('Hi', 'Hello'), engaging in small talk ('How are you?'), asking general knowledge or non-travel questions ('Can you explain something unrelated to travel?', 'What is quantum computing?', 'Who are you?', 'Tell me a joke'), or seeking conversational assistance.\n\n"
        "Q&A Categories (only for TRAVEL_QA):\n"
        "- 'WEATHER': Questions about climate, temperature, weather.\n"
        "- 'ATTRACTION': Questions about places to see, landmarks, activities, monuments, heritage, history.\n"
        "- 'RESTAURANT': Questions about food, dining, dishes, restaurants.\n"
        "- 'GENERAL': General travel advice or destination tips.\n\n"
        "Slot Extraction Rules:\n"
        "- destination: string (e.g. 'Goa', 'Jaipur', 'Hyderabad')\n"
        "- days: integer (e.g. 4)\n"
        "- budget: float numeric amount if explicit (e.g. 20000.0 for ₹20,000, 100000.0 for ₹1 lakh, 500.0 for $500)\n"
        "- currency: string code (e.g. 'INR', 'USD')\n"
        "- budget_mode: string ('FIXED', 'FLEXIBLE', 'ECONOMY', 'PREMIUM', 'LUXURY', 'NO_LIMIT')\n"
        "  - 'My budget is ₹20,000' -> budget: 20000, currency: 'INR', budget_mode: 'FIXED'\n"
        "  - 'Budget is your choice' / 'I don't have a fixed budget' -> budget: null, budget_mode: 'FLEXIBLE'\n"
        "  - 'Money doesn't matter' -> budget: null, budget_mode: 'NO_LIMIT', travel_style: 'LUXURY'\n"
        "  - 'Keep it cheap' -> budget_mode: 'ECONOMY', travel_style: 'BUDGET'\n"
        "  - 'Give me the rich one' / 'Luxury trip' -> budget_mode: 'LUXURY', travel_style: 'LUXURY'\n"
        "- travel_style: string ('BUDGET', 'STANDARD', 'PREMIUM', 'LUXURY')\n"
        "- transport_preferences: list of strings (e.g. ['business_class'], ['economy_flight'], ['private_cab'])\n"
        "- accommodation_preferences: list of strings (e.g. ['5_star'], ['standard_hotel'], ['resort'], ['homestay'])\n"
        "- interests: list of strings (e.g. ['beaches', 'temples', 'history', 'adventure', 'luxury'])\n"
        "- preferences: list of strings (e.g. ['beaches', 'local food'])\n"
        "- must_visit_places: list of strings (e.g. ['Aguada Fort', 'Hawa Mahal'])\n"
        "- constraints: list of strings (e.g. ['avoid crowded places'])\n\n"
        "Return ONLY a raw JSON object with keys: intent, slots, qa_category, confidence, needs_clarification, clarification_prompt.\n"
        "Do not include markdown wrappers or extra text."
    ),
    ("human", "{user_message}")
])

def calculate_days_from_dates(start_str: str, end_str: str) -> Optional[int]:
    if not start_str or not end_str:
        return None
    try:
        from dateutil import parser
        d1 = parser.parse(start_str, fuzzy=True)
        d2 = parser.parse(end_str, fuzzy=True)
        delta = (d2 - d1).days
        if delta > 0:
            return delta + 1
        elif delta == 0:
            return 1
    except Exception:
        pass
    return None

def extract_context_tags(text: str) -> Dict[str, Any]:
    """
    Extracts structured slot values from [Context: ...] metadata tags and explicit text patterns.
    """
    result = {}
    
    # 1. Parse [Context: ...] tags
    context_match = re.search(r'\[Context:\s*(.*?)\]', text, re.IGNORECASE)
    if context_match:
        tag_str = context_match.group(1)
        for part in tag_str.split('|'):
            if ':' in part:
                k, v = part.split(':', 1)
                k = k.strip().lower()
                v = v.strip()
                if 'origin' in k:
                    if v and v.lower() != 'not set':
                        result['origin'] = v
                elif 'destination' in k or 'where' in k:
                    if v and v.lower() != 'not set':
                        dest_val = v
                        if '->' in dest_val:
                            parts = dest_val.split('->')
                            if len(parts) >= 2:
                                if not result.get('origin') and parts[0].strip():
                                    result['origin'] = parts[0].strip()
                                dest_val = parts[1].strip()
                        dest_val = re.sub(r'[\.\s]+$', '', dest_val)
                        if dest_val:
                            result['destination'] = dest_val
                elif 'duration' in k or 'days' in k:
                    dm = re.search(r'(\d+)', v)
                    if dm:
                        result['days'] = int(dm.group(1))
                elif 'dates' in k or 'when' in k:
                    # Check if duration in days is in dates string, e.g. "(5 days)"
                    days_m = re.search(r'(\d+)\s*days?', v, re.IGNORECASE)
                    if days_m:
                        result['days'] = int(days_m.group(1))
                    
                    # Split range e.g. "28 Sep 2026 to 3 Oct 2026 (5 days)" or "28 Sep 2026 - 3 Oct 2026"
                    clean_dates = re.sub(r'\(.*?\)', '', v).strip()
                    # Hyphens inside ISO dates are not range separators.
                    dates_m = re.search(r'(.+?)\s+(?:to|–|—|-)\s+(.+)', clean_dates, re.IGNORECASE)
                    if not dates_m:
                        dates_m = re.fullmatch(r'(\d{4}-\d{2}-\d{2})\s*(?:to|–|—|-)\s*(\d{4}-\d{2}-\d{2})', clean_dates, re.IGNORECASE)
                    if dates_m:
                        result['start_date'] = dates_m.group(1).strip()
                        result['end_date'] = dates_m.group(2).strip()
                        if 'days' not in result:
                            computed_days = calculate_days_from_dates(result['start_date'], result['end_date'])
                            if computed_days:
                                result['days'] = computed_days
                elif 'budget' in k:
                    bm = re.search(r'([\d\.]+)', v)
                    if bm:
                        result['budget'] = float(bm.group(1))
                    if 'inr' in v.lower() or '₹' in v:
                        result['currency'] = 'INR'
                    elif 'usd' in v.lower() or '$' in v:
                        result['currency'] = 'USD'
                elif 'travelers' in k or 'pax' in k or 'adults' in k:
                    tm = re.search(r'(\d+)', v)
                    if tm:
                        result['travelers'] = int(tm.group(1))
                elif 'interests' in k or 'preferences' in k:
                    if v and v.lower() != 'none':
                        parsed_list = [p.strip() for p in v.split(',') if p.strip()]
                        result['preferences'] = parsed_list
                        result['interests'] = parsed_list

    # 2. Parse date ranges in text (e.g. "sept-26 to sept -30 2026", "2026-09-26 to 2026-09-30", "12 Jan to 21 Jan")
    lower = text.lower()
    date_range_match = re.search(r'(?:when|dates?|from)?\s*([a-z]{3,9}[\s\-]*\d{1,2}(?:[\s,]*\d{4})?|\d{4}-\d{2}-\d{2})\s*(?:to|–|-)\s*([a-z]{3,9}[\s\-]*\d{1,2}(?:[\s,]*\d{4})?|\d{4}-\d{2}-\d{2})', lower)
    if date_range_match and "start_date" not in result:
        result["start_date"] = date_range_match.group(1).strip()
        result["end_date"] = date_range_match.group(2).strip()
        if "days" not in result:
            computed_days = calculate_days_from_dates(result["start_date"], result["end_date"])
            if computed_days:
                result["days"] = computed_days

    # 3. Parse explicit duration e.g. "5 days", "3-day trip"
    days_text_match = re.search(r'(\d+)\s*(?:days?|day)\b', lower)
    if days_text_match and "days" not in result:
        result["days"] = int(days_text_match.group(1))

    # 4. Parse explicit travelers
    pax_m = re.search(r'(\d+)\s*(?:adults?|travelers?|travellers?|members?|people|pax)', lower)
    if pax_m and "travelers" not in result:
        result["travelers"] = int(pax_m.group(1))

    return result

def normalize_currency_and_numbers(text: str) -> Dict[str, Any]:
    """
    Python fallback parser to extract explicit currency patterns if LLM misses them.
    Handles INR (₹, lakh, k, rupees) and USD ($).
    """
    result = extract_context_tags(text)
    lower = text.lower()
    
    # 1 Lakh = 100,000
    lakh_match = re.search(r'([₹\d\.]+)\s*(?:lakh|lac)', lower)
    if lakh_match and "budget" not in result:
        val_str = lakh_match.group(1).replace('₹', '').strip()
        try:
            val = float(val_str) * 100000
            result["budget"] = val
            result["currency"] = "INR"
            result["budget_mode"] = "FIXED"
        except ValueError:
            pass
            
    # 20k / 20,000
    k_match = re.search(r'[₹]?\s*(\d+)\s*k\b', lower)
    if k_match and "budget" not in result:
        try:
            result["budget"] = float(k_match.group(1)) * 1000
            result["currency"] = "INR"
            result["budget_mode"] = "FIXED"
        except ValueError:
            pass

    # ₹20,000 or INR 20000
    inr_match = re.search(r'(?:₹|inr|rs\.?|rupees)\s*([\d,]+)', lower)
    if inr_match and "budget" not in result:
        try:
            val = float(inr_match.group(1).replace(',', ''))
            result["budget"] = val
            result["currency"] = "INR"
            result["budget_mode"] = "FIXED"
        except ValueError:
            pass

    # $500 or 500 USD
    usd_match = re.search(r'(?:\$|usd)\s*([\d,]+)|([\d,]+)\s*(?:usd|dollars)', lower)
    if usd_match and "budget" not in result:
        raw_val = usd_match.group(1) or usd_match.group(2)
        try:
            result["budget"] = float(raw_val.replace(',', ''))
            result["currency"] = "USD"
            result["budget_mode"] = "FIXED"
        except ValueError:
            pass

    return result

def merge_travel_context(existing_context: Dict[str, Any], extracted_slots: Dict[str, Any]) -> Dict[str, Any]:
    """
    Performs a non-destructive merge of newly extracted slots into existing TravelContext.
    Scalars are updated only if provided. List fields append unique items.
    """
    updated = dict(existing_context)
    
    # List fields that should be merged as lists
    list_fields = ["preferences", "interests", "constraints", "accommodation_preferences", "transport_preferences", "must_visit_places"]
    
    # Ensure interests and preferences are kept in sync
    incoming_slots = dict(extracted_slots)
    if "preferences" in incoming_slots and "interests" not in incoming_slots:
        incoming_slots["interests"] = incoming_slots["preferences"]
    elif "interests" in incoming_slots and "preferences" not in incoming_slots:
        incoming_slots["preferences"] = incoming_slots["interests"]

    for key, value in incoming_slots.items():
        if value is None:
            continue
            
        if key in list_fields:
            existing_list = updated.get(key) or []
            if isinstance(value, list):
                for item in value:
                    if item and item not in existing_list:
                        existing_list.append(item)
            elif isinstance(value, str) and value not in existing_list:
                existing_list.append(value)
            updated[key] = existing_list
        else:
            # Overwrite scalar only if new value is non-empty/valid
            updated[key] = value
            
    if updated.get('start_date') and updated.get('end_date'):
        computed_days = calculate_days_from_dates(updated['start_date'], updated['end_date'])
        if computed_days:
            updated['days'] = computed_days
    return updated

def deterministic_fallback_analysis(
    user_message: str,
    current_context: Dict[str, Any],
    has_current_trip: bool = False
) -> Dict[str, Any]:
    """
    Deterministic rule-based fallback analyzer when LLM is unavailable or OTPM budget is exceeded.
    """
    clean_msg = user_message.strip().lower()
    slots: Dict[str, Any] = {}
    
    intent = "GENERAL_CHAT"
    qa_category = None
    
    # 1. GENERATE_ITINERARY
    if re.search(r'\b(plan|create|generate|build|make)\b.*\b(trip|itinerary|holiday|vacation|days?)\b', clean_msg):
        intent = "GENERATE_ITINERARY"
    # 2. MODIFY_ITINERARY
    elif has_current_trip and re.search(r'\b(?:day\s*\d+|change|modify|replace|remove|swap|adjust|update day|instead of)\b', clean_msg):
        intent = "MODIFY_ITINERARY"
    # 3. UPDATE_CONTEXT
    elif re.search(r'\b(change it to|prefer|interests?|focus on|switch to|update to|i want|love|like)\b', clean_msg):
        intent = "UPDATE_CONTEXT"
    # 4. TRAVEL_QA
    elif (
        any(w in clean_msg for w in (
            "nearby", "near me", "close to me", "closest", "around here",
            "near my current stop", "near current stop", "near the hotel", "near my hotel", "within"
        ))
        or re.search(r'\b(why|what|how|where|which|famous|best|places|attractions|visit|recommend)\b', clean_msg)
        or clean_msg.endswith("?")
    ):
        intent = "TRAVEL_QA"
        if any(w in clean_msg for w in ("weather", "temperature", "rain", "climate")):
            qa_category = "WEATHER"
        elif any(w in clean_msg for w in ("food", "restaurant", "cafe", "dishes", "eat")):
            qa_category = "RESTAURANT"
        elif any(w in clean_msg for w in ("nearby", "near me", "close", "stop")):
            qa_category = "NEARBY"
        else:
            qa_category = "ATTRACTION"

    # Extract slots from message using regex/numeric extractor
    python_slots = normalize_currency_and_numbers(user_message)
    if python_slots:
        slots.update(python_slots)

    # Extract interests keywords
    found_interests = []
    interest_keywords = [
        "beaches", "beach", "temples", "temple", "history", "heritage", "luxury",
        "food", "cuisine", "adventure", "nature", "nightlife", "wildlife", "shopping", "culture"
    ]
    for kw in interest_keywords:
        if re.search(r'\b' + kw + r'\b', clean_msg):
            norm_kw = kw + "s" if kw in {"beach", "temple"} else kw
            if norm_kw not in found_interests:
                found_interests.append(norm_kw)
    if found_interests:
        slots["interests"] = found_interests
        slots["preferences"] = found_interests
        if intent == "GENERAL_CHAT":
            intent = "UPDATE_CONTEXT"

    return {
        "intent": intent,
        "slots": slots,
        "qa_category": qa_category,
        "confidence": 0.8,
        "needs_clarification": False,
        "clarification_prompt": None
    }

def analyze_user_message(
    user_message: str,
    current_context: Dict[str, Any],
    previous_assistant_message: Optional[str] = None,
    has_current_trip: bool = False
) -> Dict[str, Any]:
    """
    Single Conversational Analysis Step using LLM.
    Returns structured analysis containing intent, extracted slots, qa_category, and clarification flags.
    """
    print(f"--- ANALYZER: Analyzing message: '{user_message}' ---")
    
    prompt_val = ANALYZER_PROMPT.format_messages(
        user_message=user_message,
        current_context=json.dumps(current_context),
        previous_assistant_message=previous_assistant_message or "None",
        has_current_trip=has_current_trip
    )
    
    try:
        response = llm.invoke(prompt_val)
        content = response.content.strip()
        if content.startswith("```"):
            content = "\n".join(content.split("\n")[1:])
        if content.endswith("```"):
            content = "\n".join(content.split("\n")[:-1])
        content = content.strip()
        
        analysis = json.loads(content)
    except Exception as e:
        print(f"Warning: Analyzer LLM parsing failed: {e}. Attempting deterministic extraction fallback.")
        try:
            analysis = deterministic_fallback_analysis(user_message, current_context, has_current_trip)
        except Exception:
            raise e

    if "slots" not in analysis or not isinstance(analysis["slots"], dict):
        analysis["slots"] = {}

    # Apply Python currency regex fallback if slots budget is missing but numeric pattern exists
    python_currency = normalize_currency_and_numbers(user_message)
    if python_currency:
        for k, v in python_currency.items():
            if k in {'start_date', 'end_date', 'days', 'origin', 'destination', 'travelers'} or k not in analysis["slots"] or analysis["slots"][k] is None:
                analysis["slots"][k] = v

    # Intent refinement and overrides
    clean_msg = user_message.strip().lower()

    # 1. Deterministic detection for explicit itinerary creation commands
    if re.search(r'\b(plan|create|generate|build|make)\b.*\b(trip|itinerary|holiday|vacation)\b', clean_msg):
        analysis['intent'] = 'GENERATE_ITINERARY'

    # 2. Deterministic override for itinerary modifications when trip exists
    if has_current_trip:
        mod_pattern = r'\b(?:day\s*\d+|change|modify|replace|remove|swap|adjust|update day|instead of)\b'
        if re.search(mod_pattern, clean_msg):
            analysis["intent"] = "MODIFY_ITINERARY"

    # 3. Known landmark recognition: Map to destination and route to TRAVEL_QA
    for landmark, dest_name in LANDMARK_DESTINATIONS.items():
        if re.search(r'\b' + re.escape(landmark) + r'\b', clean_msg):
            if analysis.get('intent') != 'GENERATE_ITINERARY':
                analysis['intent'] = 'TRAVEL_QA'
                if not analysis.get('qa_category'):
                    analysis['qa_category'] = 'ATTRACTION'
                if not analysis['slots'].get('destination'):
                    analysis['slots']['destination'] = dest_name
            break

    # 4. General conversational chat detection
    # Common greetings, philosophical or non-travel inquiries without planning commands
    general_greetings = r'^(hi|hello|hey|good\s*(?:morning|afternoon|evening)|howdy|hola|greetings)\b'
    general_non_travel = r'\b(can you explain something unrelated|unrelated to travel|who are you|what is your name|tell me a joke|what can you do|how are you|quantum computing|artificial intelligence)\b'
    has_planning_terms = bool(re.search(r'\b(trip|itinerary|destination|budget|flight|hotel|visiting|travel|places|attraction)\b', clean_msg))

    if (re.search(general_greetings, clean_msg) or re.search(general_non_travel, clean_msg)) and not has_planning_terms:
        if analysis.get('intent') not in {'GENERATE_ITINERARY', 'MODIFY_ITINERARY'}:
            analysis['intent'] = 'GENERAL_CHAT'

    return analysis
