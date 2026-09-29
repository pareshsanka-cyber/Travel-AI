from typing import Dict, Any, Optional
from app.ai.llm import llm
from langchain_core.prompts import ChatPromptTemplate
from app.ai.agents.weather_agent import fetch_realtime_weather_openmeteo
from app.ai.agents.restaurant_agent import fetch_real_restaurants_overpass
from app.ai.rag.retriever import retrieve_travel_knowledge

QA_SYNTHESIS_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are TravelAI's friendly, expert travel assistant. "
        "Answer the user's travel question clearly, accurately, and concisely using the provided context.\n\n"
        "Retrieved Data / Knowledge Context:\n{context}\n\n"
        "Keep your response natural, helpful, and conversational."
    ),
    ("human", "{user_message}")
])

def handle_travel_qa(
    user_message: str,
    travel_context: Dict[str, Any],
    qa_category: Optional[str] = "GENERAL"
) -> str:
    """
    Direct Q&A handler that bypasses the 10-node itinerary pipeline.
    Queries live weather/OSM APIs or ChromaDB vector store based on qa_category.
    """
    destination = travel_context.get("destination") or "the destination"
    context_str = ""

    category = (qa_category or "GENERAL").upper()
    print(f"--- QA SERVICE: Handling TRAVEL_QA for destination '{destination}' (Category: {category}) ---")

    if category == "WEATHER" and travel_context.get("destination"):
        weather_res = fetch_realtime_weather_openmeteo(travel_context["destination"], travel_context.get("days") or 3)
        if weather_res:
            context_str = f"Live Weather Data: {weather_res.get('summary')} | Clothing Recommendation: {weather_res.get('clothing_recommendation')}"
        else:
            context_str = retrieve_travel_knowledge(f"{destination} weather temperature season climate monsoons", k=2)

    elif category == "ATTRACTION" and travel_context.get("destination"):
        context_str = retrieve_travel_knowledge(f"{destination} attractions landmarks places to visit sightseeing", k=4)

    elif category == "RESTAURANT" and travel_context.get("destination"):
        rest_res = fetch_real_restaurants_overpass(travel_context["destination"])
        if rest_res:
            spots = ", ".join([f"{r['name']} ({r['cuisine']}, dish: {r['popular_dish']})" for r in rest_res[:4]])
            context_str = f"Live Restaurant Data for {destination}: {spots}"
        else:
            context_str = retrieve_travel_knowledge(f"{destination} food restaurants dining shacks dishes local food", k=2)

    else:
        # General travel knowledge query via ChromaDB
        search_query = f"{destination} {user_message}"
        context_str = retrieve_travel_knowledge(search_query, k=3)

    if not context_str:
        context_str = f"General travel guide information for {destination}."

    prompt_val = QA_SYNTHESIS_PROMPT.format_messages(
        context=context_str,
        user_message=user_message
    )

    try:
        response = llm.invoke(prompt_val)
        return response.content.strip()
    except Exception as e:
        print(f"QA Synthesis error: {e}")
        return f"Regarding {destination}: {context_str}"
