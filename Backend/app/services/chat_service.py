import json
from datetime import datetime
from typing import Dict, Any, Optional
from bson import ObjectId
from app.database.mongodb import db
from app.ai.orchestrator.langgraph_graph import graph
from app.ai.llm import llm
from langchain_core.prompts import ChatPromptTemplate
from app.services.conversation_service import (
    get_or_create_conversation,
    update_travel_context,
    add_message,
    get_conversation_messages
)
from app.services.slot_extraction_service import (
    analyze_user_message,
    merge_travel_context,
    calculate_days_from_dates
)
from app.services.qa_service import handle_travel_qa

ACKNOWLEDGEMENT_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are TravelAI's friendly, conversational travel assistant. "
        "The user provided updated travel preferences. "
        "Acknowledge what was updated in a warm, concise, and helpful tone (1-2 sentences). "
        "If mandatory details (like duration or destination) are still missing, ask for them naturally. "
        "Otherwise, ask if they are ready to create the itinerary."
    ),
    ("human", "Destination: {destination}, Days: {days}, Context: {context}, Last Input: {user_message}")
])

MODIFIER_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an itinerary modification assistant. "
        "The user wants to modify an EXISTING itinerary for {destination}.\n\n"
        "Existing Draft Outline:\n{planner_draft}\n\n"
        "User Requested Modification:\n{user_instruction}\n\n"
        "Update the day-by-day outline reflecting ONLY the requested modification. Keep unchanged days identical. "
        "Return the updated planner draft text."
    ),
    ("human", "Modify itinerary.")
])

def build_travel_state_from_context(context: Dict[str, Any]) -> Dict[str, Any]:
    dest = context.get("destination") or "Goa"
    origin = context.get("origin") or "Hyderabad"
    days = int(context.get("days") or 3)
    start_date = context.get("start_date")
    end_date = context.get("end_date")
    budget_val = context.get("budget")
    currency = context.get("currency") or "INR"
    travelers = int(context.get("travelers") or context.get("adults") or 2)
    budget_mode = context.get("budget_mode") or "FLEXIBLE"
    travel_style = context.get("travel_style") or "STANDARD"
    
    pref_parts = []
    if travel_style:
        pref_parts.append(f"Travel Style: {travel_style}")
    if budget_mode:
        pref_parts.append(f"Budget Mode: {budget_mode}")
    if context.get("transport_preferences"):
        pref_parts.append(f"Transport Preference: {', '.join(context['transport_preferences'])}")
    if context.get("accommodation_preferences"):
        pref_parts.append(f"Accommodation Preference: {', '.join(context['accommodation_preferences'])}")
    if context.get("preferences"):
        pref_parts.append(f"Interests: {', '.join(context['preferences'])}")
    if context.get("constraints"):
        pref_parts.append(f"Constraints: {', '.join(context['constraints'])}")
        
    preferences_str = " | ".join(pref_parts) if pref_parts else "Standard travel planning preferences"
    
    # Calculate default working budget if none provided
    if budget_val is None:
        if travel_style == "LUXURY" or budget_mode in ["LUXURY", "NO_LIMIT"]:
            budget_val = 150000.0 if currency == "INR" else 2000.0
        elif travel_style == "BUDGET" or budget_mode == "ECONOMY":
            budget_val = 20000.0 if currency == "INR" else 300.0
        else:
            budget_val = 50000.0 if currency == "INR" else 750.0

    return {
        "user_message": f"Plan a {days}-day trip from {origin} to {dest} for {travelers} travelers. {preferences_str}",
        "destination": dest,
        "origin": origin,
        "days": days,
        "start_date": start_date,
        "end_date": end_date,
        "travelers": travelers,
        "budget": budget_val,
        "currency": currency,
        "budget_mode": budget_mode,
        "travel_style": travel_style,
        "preferences": preferences_str,
        "completed_steps": [],
        "is_approved": False,
        "error_logs": []
    }

def process_chat_message(conversation_id: Optional[str], user_message: str, user_id: Optional[str] = None) -> Dict[str, Any]:
    print(f"\n--- CHAT SERVICE: Processing chat turn for conversation: '{conversation_id}' (User: {user_id}) ---")
    
    # 1. Fetch or create conversation with user_id
    conv = get_or_create_conversation(conversation_id, user_id=user_id)
    conv_id = conv.conversation_id
    current_context = conv.travel_context.model_dump()
    has_trip = bool(conv.current_trip_id or current_context.get("current_trip_id"))

    # 2. Get message history to identify previous assistant message
    messages = get_conversation_messages(conv_id, limit=10)
    prev_assistant_msg = None
    for msg in reversed(messages):
        if msg.get("role") == "assistant":
            prev_assistant_msg = msg.get("content")
            break

    # 3. Add incoming user message to database
    add_message(conv_id, "user", user_message)

    # 4. Single Conversational Analysis Step (1 LLM call)
    try:
        analysis = analyze_user_message(
            user_message=user_message,
            current_context=current_context,
            previous_assistant_message=prev_assistant_msg,
            has_current_trip=has_trip
        )
    except Exception as e:
        err_msg = f"Sorry, I encountered a critical configuration issue and cannot process your message right now (Error: {e})"
        add_message(conv_id, "assistant", err_msg)
        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": err_msg},
            "intent": "ERROR",
            "travel_context": current_context,
            "data": None
        }

    intent = analysis.get("intent", "UPDATE_CONTEXT")
    slots = analysis.get("slots", {})
    qa_category = analysis.get("qa_category")
    
    print(f"--- CHAT SERVICE: Resolved Intent: {intent} (Slots: {slots}) ---")

    # Always merge extracted slots into travel_context regardless of intent
    if slots:
        current_context = merge_travel_context(current_context, slots)
        update_travel_context(conv_id, current_context)

    # 5. Execute Intent Logic
    if intent == "UPDATE_CONTEXT":
        updated_context = current_context

        # Generate conversational acknowledgment
        prompt_val = ACKNOWLEDGEMENT_PROMPT.format_messages(
            destination=updated_context.get("destination") or "Not set",
            days=updated_context.get("days") or "Not set",
            context=json.dumps(updated_context),
            user_message=user_message
        )
        try:
            ack_resp = llm.invoke(prompt_val).content.strip()
        except Exception as e:
            ack_resp = f"Got it! I have updated your travel preferences. (Warning: LLM failed: {e})"

        add_message(conv_id, "assistant", ack_resp, intent="UPDATE_CONTEXT", structured_data={"slots": slots})

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": ack_resp},
            "intent": "UPDATE_CONTEXT",
            "travel_context": updated_context,
            "data": None
        }

    elif intent == "TRAVEL_QA":
        answer = handle_travel_qa(user_message, current_context, qa_category=qa_category)
        add_message(conv_id, "assistant", answer, intent="TRAVEL_QA")

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": answer},
            "intent": "TRAVEL_QA",
            "travel_context": current_context,
            "data": None
        }

    elif intent == "GENERATE_ITINERARY":
        dest = current_context.get("destination")
        days = current_context.get("days")

        # Fallback calculation if days is missing but start_date and end_date are available
        if not days and current_context.get("start_date") and current_context.get("end_date"):
            computed_days = calculate_days_from_dates(current_context["start_date"], current_context["end_date"])
            if computed_days:
                days = computed_days
                current_context["days"] = days
                update_travel_context(conv_id, current_context)

        # Check required slots
        if not dest or not days:
            missing = []
            if not dest: missing.append("destination")
            if not days: missing.append("duration (number of days)")
            prompt_msg = f"I'd love to generate your itinerary! Could you please let me know your {' and '.join(missing)} first?"
            
            add_message(conv_id, "assistant", prompt_msg, intent="UPDATE_CONTEXT")
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": prompt_msg},
                "intent": "UPDATE_CONTEXT",
                "travel_context": current_context,
                "data": None
            }

        # Context-to-State Bridge
        initial_state = build_travel_state_from_context(current_context)
        print(f"--- CHAT SERVICE: Invoking LangGraph for destination '{dest}' ({days} days) ---")

        try:
            final_state = graph.invoke(initial_state)
        except Exception as e:
            err_msg = f"Sorry, I encountered an issue generating your itinerary: {e}"
            add_message(conv_id, "assistant", err_msg)
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": err_msg},
                "intent": "GENERATE_ITINERARY",
                "travel_context": current_context,
                "data": None
            }

        # Prepare trip data structure
        resolved_budget = float(final_state.get("budget") or current_context.get("budget") or 50000.0)
        resolved_travelers = int(final_state.get("travelers") or current_context.get("travelers") or current_context.get("adults") or 2)
        trip_data = {
            "user_message": user_message,
            "destination": final_state.get("destination") or dest,
            "origin": final_state.get("origin") or current_context.get("origin") or "Hyderabad",
            "days": int(final_state.get("days") or days),
            "start_date": final_state.get("start_date") or current_context.get("start_date"),
            "end_date": final_state.get("end_date") or current_context.get("end_date"),
            "travelers": resolved_travelers,
            "travelersCount": resolved_travelers,
            "budget": resolved_budget,
            "currency": current_context.get("currency") or "INR",
            "travel_style": current_context.get("travel_style") or "STANDARD",
            "budget_mode": current_context.get("budget_mode") or "FLEXIBLE",
            "preferences": final_state.get("preferences"),
            "planner_draft": final_state.get("planner_draft") or "Itinerary created",
            "flights": final_state.get("flights") or [],
            "hotels": final_state.get("hotels") or [],
            "weather": final_state.get("weather") or {},
            "attractions": final_state.get("attractions") or [],
            "restaurants": final_state.get("restaurants") or [],
            "route_details": final_state.get("route_details") or {},
            "budget_breakdown": final_state.get("budget_breakdown") or {},
            "travelContext": current_context,
            "created_at": datetime.utcnow()
        }
        if user_id:
            trip_data["user_id"] = user_id

        # Save to MongoDB 'trips'
        try:
            res = db.trips.insert_one(trip_data)
            trip_id = str(res.inserted_id)
            trip_data["id"] = trip_id
            if "_id" in trip_data:
                del trip_data["_id"]
        except Exception as e:
            print(f"Failed saving trip to MongoDB: {e}")
            trip_id = "temp_trip_id"
            trip_data["id"] = trip_id

        # Update current_trip_id in conversation
        current_context["current_trip_id"] = trip_id
        update_travel_context(conv_id, current_context, current_trip_id=trip_id)

        assistant_msg = f"I've created your complete {days}-day itinerary to {dest}!"
        add_message(
            conv_id,
            "assistant",
            assistant_msg,
            intent="GENERATE_ITINERARY",
            structured_data={"trip_id": trip_id}
        )

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": assistant_msg},
            "intent": "GENERATE_ITINERARY",
            "travel_context": current_context,
            "data": {
                "type": "itinerary",
                "trip_id": trip_id,
                "itinerary": trip_data
            }
        }

    elif intent == "MODIFY_ITINERARY":
        current_trip_id = conv.current_trip_id or current_context.get("current_trip_id")
        if not current_trip_id:
            reply = "You haven't generated an itinerary yet! Let's build one first."
            add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": reply},
                "intent": "MODIFY_ITINERARY",
                "travel_context": current_context,
                "data": None
            }

        # Fetch trip from database
        try:
            trip_doc = db.trips.find_one({"_id": ObjectId(current_trip_id)})
        except Exception:
            trip_doc = None

        if not trip_doc:
            reply = "Could not find your existing itinerary to modify. Let's create a new one!"
            add_message(conv_id, "assistant", reply)
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": reply},
                "intent": "MODIFY_ITINERARY",
                "travel_context": current_context,
                "data": None
            }

        dest = trip_doc.get("destination", "Destination")
        existing_draft = trip_doc.get("planner_draft", "")

        prompt_val = MODIFIER_PROMPT.format_messages(
            destination=dest,
            planner_draft=existing_draft,
            user_instruction=user_message
        )
        try:
            updated_draft = llm.invoke(prompt_val).content.strip()
        except Exception:
            updated_draft = existing_draft

        # Update document in DB
        db.trips.update_one(
            {"_id": ObjectId(current_trip_id)},
            {"$set": {"planner_draft": updated_draft, "updated_at": datetime.utcnow()}}
        )
        trip_doc["planner_draft"] = updated_draft
        trip_doc["id"] = str(trip_doc.pop("_id"))

        reply = f"I've updated your itinerary for {dest} according to your request!"
        add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": reply},
            "intent": "MODIFY_ITINERARY",
            "travel_context": current_context,
            "data": {
                "type": "itinerary",
                "trip_id": current_trip_id,
                "itinerary": trip_doc
            }
        }

    # Default fallback
    reply = "I'm here to help you plan your trip! Tell me your destination or travel preferences."
    add_message(conv_id, "assistant", reply)
    return {
        "conversation_id": conv_id,
        "message": {"role": "assistant", "content": reply},
        "intent": "UPDATE_CONTEXT",
        "travel_context": current_context,
        "data": None
    }
