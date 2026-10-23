import re
import json
import copy
from datetime import datetime
from typing import Dict, Any, Optional
from bson import ObjectId
from fastapi import HTTPException
from app.database.mongodb import db
from app.ai.orchestrator.langgraph_graph import graph
from app.ai.llm import llm, public_llm_error
from app.services.failure_recovery import recovery_for
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
from app.services.travel_guide_agent import handle_travel_guide_query, resolve_place_from_reference
from app.services.itinerary_edit_service import (
    modify_itinerary,
    add_activity_to_day,
    generate_preference_revision_proposal,
    generate_single_activity_revision_proposal,
    apply_preference_revision,
    cancel_preference_revision
)
from app.services.activity_reference_service import resolve_target_in_itinerary
from app.services.trip_consistency import revision_filter

GENERAL_CHAT_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are TravelAI, an intelligent, versatile, and friendly conversational assistant. "
        "Answer the user's question, greeting, or statement directly, warmly, and naturally. "
        "If the user asks an ordinary question (such as science, technology, history, everyday questions, or chit-chat), "
        "provide an accurate, helpful, and articulate answer without forcing them into a travel funnel. "
        "You may politely mention that you are also ready to assist with destination recommendations or trip planning whenever they like."
    ),
    ("human", "{user_message}")
])

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
        "interests": context.get("interests") or context.get("preferences"),
        "must_visit_places": context.get("must_visit_places"),
        "pace": context.get("pace") or "balanced",
        "wake_up_time": context.get("wake_up_time"),
        "bedtime": context.get("bedtime"),
        "completed_steps": [],
        "is_approved": False,
        "error_logs": []
    }

def process_chat_message(
    conversation_id: Optional[str],
    user_message: str,
    user_id: Optional[str] = None,
    progress=None,
    planning_request_key=None,
    reuse_user_message=False,
    current_lat: Optional[float] = None,
    current_lon: Optional[float] = None,
    current_day: Optional[int] = None,
    active_segment_id: Optional[str] = None,
    destination: Optional[str] = None
) -> Dict[str, Any]:
    print(f"\n--- CHAT SERVICE: Processing chat turn for conversation: '{conversation_id}' (User: {user_id}) ---")
    
    # 1. Fetch or create conversation with user_id
    conv = get_or_create_conversation(conversation_id, user_id=user_id)
    conv_id = conv.conversation_id
    if progress:
        progress('conversation', conversation_id=conv_id)
    current_context = conv.travel_context.model_dump()

    # Determine active trip
    current_trip_id = conv.current_trip_id or current_context.get("current_trip_id")
    if not current_trip_id and user_id:
        try:
            recent = db.trips.find_one({"user_id": user_id}, sort=[("updated_at", -1)])
            if recent:
                current_trip_id = str(recent["_id"])
                conv.current_trip_id = current_trip_id
                current_context["current_trip_id"] = current_trip_id
                update_travel_context(conv_id, current_context, current_trip_id=current_trip_id)
        except Exception:
            pass

    has_trip = bool(current_trip_id)
    active_trip_doc = None
    if has_trip:
        try:
            active_trip_doc = db.trips.find_one({"_id": ObjectId(current_trip_id)})
        except Exception:
            try:
                active_trip_doc = db.trips.find_one({"id": current_trip_id})
            except Exception:
                active_trip_doc = None

    # 2. Get message history to identify previous assistant message
    messages = get_conversation_messages(conv_id, limit=10)
    prev_assistant_msg = None
    for msg in reversed(messages):
        if msg.get("role") == "assistant":
            prev_assistant_msg = msg.get("content")
            break

    # 3. Add incoming user message to database
    if not reuse_user_message:
        add_message(conv_id, "user", user_message)

    # 4. Single Conversational Analysis Step (1 LLM call)
    try:
        if progress:
            progress('analysis')
        analysis = analyze_user_message(
            user_message=user_message,
            current_context=current_context,
            previous_assistant_message=prev_assistant_msg,
            has_current_trip=has_trip
        )
    except Exception as e:
        if progress:
            progress('analysis', 'failed')
        err_msg = public_llm_error(e)
        add_message(conv_id, "assistant", err_msg)
        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": err_msg},
            "intent": "ERROR",
            "recovery": recovery_for(e),
            "travel_context": current_context,
            "data": None
        }

    intent = analysis.get("intent", "UPDATE_CONTEXT")
    if progress:
        progress('analysis', 'done')
        progress('response')
    slots = analysis.get("slots", {})
    qa_category = analysis.get("qa_category")
    
    print(f"--- CHAT SERVICE: Resolved Intent: {intent} (Slots: {slots}) ---")

    # Always merge extracted slots into travel_context regardless of intent
    if slots:
        current_context = merge_travel_context(current_context, slots)
        update_travel_context(conv_id, current_context)

    # 5. Execute Intent Logic
    if intent == "GENERAL_CHAT":
        try:
            prompt_val = GENERAL_CHAT_PROMPT.format_messages(user_message=user_message)
            chat_reply = llm.invoke(prompt_val).content.strip()
        except Exception:
            chat_reply = "Hello! I am TravelAI, your personal AI travel concierge. Feel free to ask me anything—whether it's about travel destinations, trip ideas, or general topics!"

        add_message(conv_id, "assistant", chat_reply, intent="GENERAL_CHAT")

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": chat_reply},
            "intent": "GENERAL_CHAT",
            "travel_context": current_context,
            "data": None
        }

    elif intent == "UPDATE_CONTEXT":
        updated_context = current_context

        # Check if user mentioned an interest/preference without modifying active trip
        pref_str = ", ".join(updated_context.get("interests") or updated_context.get("preferences") or [])
        if pref_str and has_trip:
            ack_resp = f"I've saved your preference for {pref_str}. Your active itinerary has not been changed. If you would like to revise your itinerary to focus on {pref_str}, simply say 'Change this trip to {pref_str}'!"
        elif pref_str and not has_trip:
            ack_resp = f"I've saved your travel preferences ({pref_str}). You haven't created an itinerary yet—would you like me to build one for you?"
        else:
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
                ack_resp = "I've saved your travel preferences. Let me know when you're ready to create an itinerary!"

        add_message(conv_id, "assistant", ack_resp, intent="UPDATE_CONTEXT", structured_data={"slots": slots})

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": ack_resp},
            "intent": "UPDATE_CONTEXT",
            "travel_context": updated_context,
            "data": None
        }

    elif intent == "TRAVEL_QA":
        guide_res = handle_travel_guide_query(
            user_message=user_message,
            travel_context=current_context,
            qa_category=qa_category,
            current_lat=current_lat,
            current_lon=current_lon,
            current_day=current_day,
            active_segment_id=active_segment_id,
            destination=destination,
            user_id=user_id,
            conversation_id=conv_id,
            has_current_trip=bool(active_trip_doc),
            active_trip=active_trip_doc
        )
        
        # Save last recommendations in travel_context for follow-up resolution
        if guide_res.get("places"):
            current_context["last_recommendations"] = guide_res["places"]
            update_travel_context(conv_id, current_context)

        reply_text = guide_res.get("reply_text") or guide_res.get("answer") or "Here is what I found for your journey."

        add_message(
            conv_id,
            "assistant",
            reply_text,
            intent="TRAVEL_QA",
            structured_data={
                "places": guide_res.get("places"),
                "rag_meta": guide_res.get("rag_meta")
            }
        )

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": reply_text},
            "intent": "TRAVEL_QA",
            "travel_context": current_context,
            "data": {
                "type": "place_recommendations",
                "places": guide_res.get("places"),
                "suggested_actions": guide_res.get("suggested_actions"),
                "rag_meta": guide_res.get("rag_meta")
            }
        }

    elif intent == "GENERATE_ITINERARY":
        dest = current_context.get("destination")
        days = current_context.get("days")

        # Conversational fallback for missing essentials
        if not dest or not days:
            missing = []
            if not dest:
                missing.append("your destination (where you want to go)")
            if not days:
                missing.append("how many days you want to travel")
            
            prompt_msg = f"I'd love to generate your itinerary! Please let me know {' and '.join(missing)}."
            add_message(conv_id, "assistant", prompt_msg)
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": prompt_msg},
                "intent": "UPDATE_CONTEXT",
                "travel_context": current_context,
                "data": None
            }

        # Context-to-State Bridge
        initial_state = build_travel_state_from_context(current_context)
        
        print(f"\n==================================================")
        print(f"[TRAVEL REQUEST]")
        print(f"Destination: {dest}")
        print(f"Duration: {days} days")
        print(f"Travelers: {current_context.get('travelers') or current_context.get('adults') or 2}")
        print(f"Budget: {current_context.get('budget') or 50000.0} {current_context.get('currency', 'INR')}")
        print(f"Preferences: {current_context.get('preferences')}")
        print(f"==================================================\n")
        
        import time
        start_time = time.time()
        req_id = f"req_{int(start_time)}"
        print(f"\n[ITINERARY START] request_id={req_id} destination={dest} days={days}")

        try:
            from app.services.planning_dates import validate_planning_dates
            validate_planning_dates(initial_state.get('start_date'), initial_state.get('end_date'))
            final_state = graph.invoke(initial_state, config={'configurable': {'planning_progress': progress}}) if progress else graph.invoke(initial_state)
            duration_ms = int((time.time() - start_time) * 1000)
            print(f"[ITINERARY END] request_id={req_id} duration_ms={duration_ms} status=success\n")
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            print(f"[ITINERARY ERROR] request_id={req_id} duration_ms={duration_ms} status=failed error={e}\n")
            recovery = recovery_for(e, planning=True)
            err_msg = f"Unable to create this itinerary: {e}" if recovery['code'] == 'trip_constraints' else recovery['message']
            add_message(conv_id, "assistant", err_msg)
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": err_msg},
                "intent": "GENERATE_ITINERARY",
                "recovery": recovery,
                "travel_context": current_context,
                "data": None
            }

        # Prepare trip data structure
        resolved_budget = float(final_state.get("budget") or current_context.get("budget") or 50000.0)
        resolved_travelers = int(final_state.get("travelers") or current_context.get("travelers") or current_context.get("adults") or 2)
        trip_data = {
            "revision": 1,
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
            "interests": final_state.get("interests"),
            "must_visit_places": final_state.get("must_visit_places"),
            "pace": final_state.get("pace"),
            "bedtime": final_state.get("bedtime"),
            "wake_up_time": final_state.get("wake_up_time"),
            "final_itinerary": final_state.get("final_itinerary"),
            "planner_draft": final_state.get("planner_draft") or "Itinerary created",
            "flights": final_state.get("flights") or [],
            "flight_metadata": final_state.get("flight_metadata") or {},
            "hotel_metadata": final_state.get("hotel_metadata") or {},
            "destination_timezone": final_state.get("destination_timezone"),
            "hotels": final_state.get("hotels") or [],
            "nearby_hotels": final_state.get("nearby_hotels") or [],
            "weather": final_state.get("weather") or {},
            "attractions": final_state.get("attractions") or [],
            "restaurants": final_state.get("restaurants") or [],
            "route_details": final_state.get("route_details") or {},
            "budget_breakdown": final_state.get("budget_breakdown") or {},
            "execution_state": final_state.get("execution_state") or {
                "is_active": False,
                "current_day_number": 1,
                "activity_log": {},
                "reroute_history": []
            },
            "travelContext": current_context,
            "created_at": datetime.utcnow().isoformat()
        }
        if user_id:
            trip_data["user_id"] = user_id

        # Save to MongoDB 'trips'
        try:
            if progress:
                progress('saving')
            if planning_request_key:
                from pymongo import ReturnDocument
                trip_data['planning_request_key'] = planning_request_key
                saved = db.trips.find_one_and_update({'planning_request_key': planning_request_key, 'user_id': user_id},
                    {'$setOnInsert': trip_data}, upsert=True, return_document=ReturnDocument.AFTER)
                trip_data = dict(saved)
                trip_id = str(trip_data['_id'])
            else:
                res = db.trips.insert_one(trip_data)
                trip_id = str(res.inserted_id)
            trip_data["id"] = trip_id
            if "_id" in trip_data:
                del trip_data["_id"]
        except Exception as e:
            raise HTTPException(status_code=503, detail="Unable to save itinerary. Please try again.") from e

        # Update current_trip_id in conversation
        current_context["current_trip_id"] = trip_id
        update_travel_context(conv_id, current_context, current_trip_id=trip_id)

        assistant_msg = f"I've created your complete {days}-day itinerary to {dest}!"
        schedule_notes = (trip_data.get('route_details') or {}).get('schedule_notes', [])
        if schedule_notes:
            assistant_msg += '\n\nSome stops could not fit safely within your day:\n' + '\n'.join('- ' + note for note in schedule_notes)
        add_message(
            conv_id,
            "assistant",
            assistant_msg,
            intent="GENERATE_ITINERARY",
            structured_data={"trip_id": trip_id}
        )

        if progress:
            progress('saving', 'done', trip_id=trip_id)

        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": assistant_msg},
            "intent": "GENERATE_ITINERARY",
            "travel_context": current_context,
            "data": {
                "type": "itinerary",
                "trip_id": trip_id,
                "itinerary": dict(trip_data, plus_access=False)
            }
        }

    elif intent == "MODIFY_ITINERARY":
        clean_msg = user_message.strip().lower()
        action = slots.get("action")
        if not action:
            if re.search(r'^\s*(apply\s*(changes|proposal|revision|itinerary)?|confirm\s*(changes)?|accept\s*(changes)?|yes,\s*apply)\s*$', clean_msg) or clean_msg in {'apply', 'confirm', 'accept'}:
                action = "apply"
            elif re.search(r'^\s*(keep\s*(current|existing)?\s*(itinerary|trip)?|cancel\s*(changes|proposal)?|discard\s*(changes|proposal)?|no,\s*keep)\s*$', clean_msg) or clean_msg in {'keep', 'cancel', 'discard'}:
                action = "cancel"

        pending_proposal_id = current_context.get("pending_proposal")
        if not pending_proposal_id and current_trip_id:
            pending_rec = db.reroute_proposals.find_one({
                "trip_id": current_trip_id,
                "status": "pending",
                "expires_at": {"$gt": datetime.utcnow()}
            })
            if pending_rec:
                pending_proposal_id = pending_rec.get("proposal_id")

        # 1. Action: Apply Proposal
        if action == "apply":
            if not current_trip_id:
                reply = "You haven't generated an itinerary yet! Let's build one first."
                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
                return {"conversation_id": conv_id, "message": {"role": "assistant", "content": reply},
                        "intent": "MODIFY_ITINERARY", "travel_context": current_context, "data": None}

            if not pending_proposal_id:
                reply = "There is no active revision proposal waiting for approval. You can request changes to your itinerary anytime!"
                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
                return {"conversation_id": conv_id, "message": {"role": "assistant", "content": reply},
                        "intent": "MODIFY_ITINERARY", "travel_context": current_context, "data": None}

            try:
                updated_trip = apply_preference_revision(db, current_trip_id, pending_proposal_id, x_user_id=user_id)
                current_context["pending_proposal"] = None
                update_travel_context(conv_id, current_context)
                new_rev = updated_trip.get("revision", 1)
                reply = f"I've applied the changes to your itinerary! Your schedule has been updated with the new focus (Revision {new_rev})."
                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
                return {
                    "conversation_id": conv_id,
                    "message": {"role": "assistant", "content": reply},
                    "intent": "MODIFY_ITINERARY",
                    "travel_context": current_context,
                    "data": {
                        "type": "itinerary",
                        "trip_id": current_trip_id,
                        "itinerary": updated_trip
                    }
                }
            except HTTPException as he:
                if he.status_code == 409:
                    current_context["pending_proposal"] = None
                    update_travel_context(conv_id, current_context)
                    reply = f"Could not apply changes: {he.detail}"
                    add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
                    return {"conversation_id": conv_id, "message": {"role": "assistant", "content": reply},
                            "intent": "MODIFY_ITINERARY", "travel_context": current_context, "data": None}
                raise he
            except Exception as e:
                reply = f"Could not apply the revision: {str(e)}"
                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
                return {"conversation_id": conv_id, "message": {"role": "assistant", "content": reply},
                        "intent": "MODIFY_ITINERARY", "travel_context": current_context, "data": None}

        # 2. Action: Cancel Proposal
        elif action == "cancel":
            if pending_proposal_id:
                cancel_preference_revision(db, current_trip_id, pending_proposal_id)
                current_context["pending_proposal"] = None
                update_travel_context(conv_id, current_context)
            curr_rev = (active_trip_doc or {}).get("revision", 1)
            reply = f"Your existing itinerary remains unchanged (Revision {curr_rev}). Let me know if you would like any other adjustments!"
            add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
            clean_trip = copy.deepcopy(active_trip_doc) if active_trip_doc else None
            if clean_trip and "_id" in clean_trip:
                clean_trip["id"] = str(clean_trip.pop("_id"))
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": reply},
                "intent": "MODIFY_ITINERARY",
                "travel_context": current_context,
                "data": {
                    "type": "itinerary",
                    "trip_id": current_trip_id,
                    "itinerary": clean_trip
                } if clean_trip else None
            }

        # 3. No active trip guard
        if not current_trip_id or not active_trip_doc:
            new_prefs = slots.get("interests") or slots.get("preferences") or []
            if new_prefs:
                current_context["interests"] = new_prefs
                current_context["preferences"] = new_prefs
                update_travel_context(conv_id, current_context)
                pref_str = ", ".join(new_prefs)
                reply = f"I've saved your travel preferences ({pref_str}). You haven't created an itinerary yet—would you like me to generate a trip for you?"
                add_message(conv_id, "assistant", reply, intent="UPDATE_CONTEXT")
                return {
                    "conversation_id": conv_id,
                    "message": {"role": "assistant", "content": reply},
                    "intent": "UPDATE_CONTEXT",
                    "travel_context": current_context,
                    "data": None
                }
            reply = "You haven't generated an itinerary yet! Let's build one first."
            add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": reply},
                "intent": "MODIFY_ITINERARY",
                "travel_context": current_context,
                "data": None
            }

        trip_doc = active_trip_doc
        dest = trip_doc.get("destination", "Destination")

        # 4. Resolve Itinerary Modification Target & Action
        last_recs = current_context.get("last_recommendations") or []
        resolution = resolve_target_in_itinerary(
            trip_doc=trip_doc,
            user_message=user_message,
            previous_assistant_message=prev_assistant_msg,
            last_recommendations=last_recs
        )

        # 4A. If Ambiguity Detected: Ask Focused Clarification
        if resolution.get("is_ambiguous"):
            clarification = resolution.get("clarification_prompt") or f"Could you please clarify which activity in your {dest} itinerary you'd like to update?"
            add_message(conv_id, "assistant", clarification, intent="MODIFY_ITINERARY")
            return {
                "conversation_id": conv_id,
                "message": {"role": "assistant", "content": clarification},
                "intent": "MODIFY_ITINERARY",
                "travel_context": current_context,
                "data": None
            }

        # 4B. Check if Trip-Wide Focus Change
        has_day_spec = bool(re.search(r'\bday\s*\d+\b', user_message, re.IGNORECASE))
        has_edit_verbs = bool(re.search(r'\b(remove|delete|drop|swap|replace)\b', clean_msg))
        is_add_request = bool(re.search(r'\b(add|put|insert|schedule)\b', user_message, re.IGNORECASE))
        has_named_stop = bool(resolution.get("target_stop"))

        multi_interest_pattern = bool(re.search(
            r'\b(?:'
            r'(?:i\s+)?want\s+both|'
            r'both\s+[a-z\s]+\s+and\s+[a-z\s]+|'
            r'mix\s+[a-z\s]+\s+(?:with|and)|'
            r'combine\s+[a-z\s]+\s+(?:with|and)|'
            r'as\s+well\s+as|'
            r'include\s+[a-z\s]+(?:\s+and\s+[a-z\s]+)?\s*(?:too|also|as\s+well)|'
            r'include\s+both|'
            r'change\s+(?:this|the|my|our|current)?\s*(?:trip|itinerary|focus|schedule)|'
            r'now\s+change\s+it\s+to|'
            r'change\s+it\s+to|'
            r'make\s+(?:this|the|my|our|current)?\s*(?:trip|itinerary)|'
            r'replace\s+(?:the\s+)?(?:sightseeing|activities|stops|attractions)?\s+with|'
            r'revise\s+(?:this|the|my|our|current)?\s*(?:trip|itinerary)|'
            r'update\s+(?:this|the|my|our|current)?\s*(?:trip|itinerary)'
            r')\b',
            clean_msg
        ))

        extracted_interests = slots.get("interests") or slots.get("preferences") or []
        if not extracted_interests:
            kws = [kw for kw in ("temples", "history", "heritage", "beaches", "nature", "waterfalls", "luxury", "food", "adventure") if kw in clean_msg]
            if kws:
                extracted_interests = kws

        is_pref_revision = (
            resolution.get("action") == "focus"
            or multi_interest_pattern
            or (extracted_interests and not has_named_stop and not has_day_spec and not (has_edit_verbs and has_named_stop))
            or ("luxury" in clean_msg and "more" in clean_msg)
        )

        if is_pref_revision and not has_day_spec:
            new_interests = extracted_interests
            new_travel_style = slots.get("travel_style")

            try:
                proposal = generate_preference_revision_proposal(
                    trip_doc=trip_doc,
                    new_interests=new_interests,
                    new_travel_style=new_travel_style,
                    active_segment_id=active_segment_id
                )

                # Persist proposal to db.reroute_proposals
                db.reroute_proposals.insert_one({
                    "proposal_id": proposal["proposal_id"],
                    "trip_id": current_trip_id,
                    "user_id": user_id,
                    "version": 1,
                    "revision": trip_doc.get("revision", 1),
                    "expected_revision": proposal["expected_revision"],
                    "proposal": proposal,
                    "status": "pending",
                    "expires_at": proposal["expires_at"]
                })

                current_context["pending_proposal"] = proposal["proposal_id"]
                if new_interests:
                    current_context["interests"] = new_interests
                    current_context["preferences"] = new_interests
                if new_travel_style:
                    current_context["travel_style"] = new_travel_style
                update_travel_context(conv_id, current_context)

                changes = proposal["changes_summary"]
                clean_dest = dest.split(',')[0].strip()
                focus_desc = proposal.get("focus_description") or (" and ".join(new_interests) if new_interests else (new_travel_style or "your requested focus"))
                explanation = proposal.get("explanation") or f"Balanced schedule reflecting your updated interest in {focus_desc}."

                reply = f"I've prepared a revision proposal for your {trip_doc.get('days', 3)}-day {clean_dest} itinerary to focus on {focus_desc}. Please review the proposed changes below."

                suggested_actions = [
                    {"label": "Apply Changes", "action": "apply"},
                    {"label": "Keep Current Itinerary", "action": "cancel"}
                ]

                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY", structured_data={
                    "proposal_id": proposal["proposal_id"],
                    "changes_summary": changes
                })

                return {
                    "conversation_id": conv_id,
                    "message": {"role": "assistant", "content": reply},
                    "intent": "MODIFY_ITINERARY",
                    "travel_context": current_context,
                    "data": {
                        "type": "revision_proposal",
                        "proposal_id": proposal["proposal_id"],
                        "trip_id": current_trip_id,
                        "destination": clean_dest,
                        "days": trip_doc.get("days", 3),
                        "expected_revision": proposal["expected_revision"],
                        "focus_description": focus_desc,
                        "explanation": explanation,
                        "changes_summary": changes,
                        "suggested_actions": suggested_actions
                    }
                }
            except Exception as e:
                reply = f"I could not safely generate a revision proposal: {e}. Your schedule is unchanged."
                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
                return {"conversation_id": conv_id, "message": {"role": "assistant", "content": reply},
                        "intent": "MODIFY_ITINERARY", "travel_context": current_context, "data": None}

        # 4C. Single-Activity Edits (replace, add, remove, move)
        action_type = resolution.get("action")
        if action_type in {"replace", "add", "remove", "move"}:
            try:
                proposal = generate_single_activity_revision_proposal(
                    trip_doc=trip_doc,
                    resolution=resolution,
                    active_segment_id=active_segment_id
                )

                # Persist proposal to db.reroute_proposals
                db.reroute_proposals.insert_one({
                    "proposal_id": proposal["proposal_id"],
                    "trip_id": current_trip_id,
                    "user_id": user_id,
                    "version": 1,
                    "revision": trip_doc.get("revision", 1),
                    "expected_revision": proposal["expected_revision"],
                    "proposal": proposal,
                    "status": "pending",
                    "expires_at": proposal["expires_at"]
                })

                current_context["pending_proposal"] = proposal["proposal_id"]
                update_travel_context(conv_id, current_context)

                changes = proposal["changes_summary"]
                clean_dest = dest.split(',')[0].strip()
                explanation = proposal.get("explanation") or f"Proposed adjustment to your {clean_dest} itinerary."
                reply = f"I've prepared a revision proposal for your {trip_doc.get('days', 3)}-day {clean_dest} itinerary: {explanation} Please review the proposed changes below."

                suggested_actions = [
                    {"label": "Apply Changes", "action": "apply"},
                    {"label": "Keep Current Itinerary", "action": "cancel"}
                ]

                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY", structured_data={
                    "proposal_id": proposal["proposal_id"],
                    "changes_summary": changes
                })

                return {
                    "conversation_id": conv_id,
                    "message": {"role": "assistant", "content": reply},
                    "intent": "MODIFY_ITINERARY",
                    "travel_context": current_context,
                    "data": {
                        "type": "revision_proposal",
                        "proposal_id": proposal["proposal_id"],
                        "trip_id": current_trip_id,
                        "destination": clean_dest,
                        "days": trip_doc.get("days", 3),
                        "expected_revision": proposal["expected_revision"],
                        "focus_description": proposal.get("focus_description", explanation),
                        "explanation": explanation,
                        "changes_summary": changes,
                        "suggested_actions": suggested_actions
                    }
                }
            except Exception as e:
                reply = f"I could not safely generate a revision proposal: {e}. Your schedule is unchanged."
                add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
                return {"conversation_id": conv_id, "message": {"role": "assistant", "content": reply},
                        "intent": "MODIFY_ITINERARY", "travel_context": current_context, "data": None}

        # 4D. Fallback for unrecognized or unsupported schedule changes
        reply = f"I'd be glad to adjust your {dest} itinerary! Could you please let me know which attraction, restaurant, or day you'd like to update, or what new interests you want to include?"
        add_message(conv_id, "assistant", reply, intent="MODIFY_ITINERARY")
        return {
            "conversation_id": conv_id,
            "message": {"role": "assistant", "content": reply},
            "intent": "MODIFY_ITINERARY",
            "travel_context": current_context,
            "data": None
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
