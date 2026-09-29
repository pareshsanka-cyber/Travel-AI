import json
from app.ai.llm import llm
from app.ai.orchestrator.state import TravelState
from langchain_core.prompts import ChatPromptTemplate
from app.services.slot_extraction_service import normalize_currency_and_numbers

PARSER_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an AI assistant that extracts travel planning variables from raw text. "
        "Your task is to extract the origin (source city), destination, number of days, budget, and other preferences. "
        "If a variable is not mentioned, use these default values:\n"
        "- origin: null\n"
        "- days: 3\n"
        "- budget: 500.0\n"
        "Return ONLY a raw JSON object with these keys: origin, destination, days, budget, preferences. "
        "Do not include markdown wrapper, explanation, or notes. Example output:\n"
        '{{"origin": "Hyderabad", "destination": "Goa", "days": 3, "budget": 500.0, "preferences": "2 people"}}'
    ),
    ("human", "Extract from this request: {user_message}")
])

def parser_node(state: TravelState) -> dict:
    # If we already have the variables (Form/Bridge path), skip parsing
    if state.get("destination") and state.get("days") and state.get("budget"):
        print("--- PARSER AGENT: Skip (Input already structured) ---")
        return {"completed_steps": state.get("completed_steps", []) + ["parser"]}
        
    print(f"--- PARSER AGENT: Extracting from message: '{state.get('user_message')}' ---")
    
    user_msg = state.get("user_message", "")
    prompt_val = PARSER_PROMPT.format_messages(user_message=user_msg)
    response = llm.invoke(prompt_val)
    
    # Parse the JSON response
    try:
        data = json.loads(response.content.strip())
        
        # Apply currency regex helper
        currency_data = normalize_currency_and_numbers(user_msg)
        budget = currency_data.get("budget") or float(data.get("budget", 500.0))

        return {
            "origin": data.get("origin"),
            "destination": data.get("destination"),
            "days": int(data.get("days", 3)),
            "budget": float(budget),
            "preferences": data.get("preferences"),
            "completed_steps": state.get("completed_steps", []) + ["parser"]
        }
    except Exception as e:
        print(f"Error parsing Qwen response: {e}")
        return {
            "destination": "Unknown",
            "days": 3,
            "budget": 500.0,
            "error_logs": state.get("error_logs", []) + [f"Parser error: {str(e)}"],
            "completed_steps": state.get("completed_steps", []) + ["parser"]
        }
