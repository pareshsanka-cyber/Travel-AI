import sys
import json
import time
from pathlib import Path

# Add Backend to sys.path
backend_root = Path(__file__).resolve().parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.services.chat_service import process_chat_message

def run_chat_turn(turn_name: str, message: str, conv_id: str = None, **kwargs):
    print("=" * 80)
    print(f"CHAT TURN: {turn_name}")
    print(f"User Message: '{message}'")
    print("=" * 80)

    res = process_chat_message(
        conversation_id=conv_id,
        user_message=message,
        **kwargs
    )

    conv_id = res.get("conversation_id")
    intent = res.get("intent")
    reply = res.get("message", {}).get("content", "")
    data = res.get("data")
    context = res.get("travel_context", {})

    print(f"Result Intent: {intent}")
    print(f"Conversation ID: {conv_id}")
    print(f"Reply Preview:\n{reply[:300]}")
    if data and isinstance(data, dict):
        if "rag_meta" in data:
            print(f"RAG Metadata: {data['rag_meta']}")
        if "type" in data:
            print(f"Data Type: {data['type']}")
        if "places" in data:
            place_names = [p.get("name") for p in data["places"]]
            print(f"Recommended Places ({len(place_names)}): {', '.join(place_names)}")
    print(f"Travel Context Destination: {context.get('destination')}, Days: {context.get('days')}, Interests: {context.get('interests') or context.get('preferences')}\n")

    return conv_id, res

def main():
    print("STARTING LIVE CHATBOT PATHWAY VERIFICATION\n")

    # Query 1: Why is Hawa Mahal famous?
    conv1, res1 = run_chat_turn("1. Hawa Mahal Fame (RAG Vector)", "Why is Hawa Mahal famous?")
    time.sleep(12)

    # Query 2: What is special about the Palace of Breeze?
    conv2, res2 = run_chat_turn("2. Palace of Breeze Query (Semantic Vector)", "What is special about the Palace of Breeze?")
    time.sleep(12)

    # Query 3: Plan five days in Goa focusing on beaches.
    conv3, res3 = run_chat_turn("3. Plan 5 days in Goa for beaches", "Plan five days in Goa focusing on beaches.")
    time.sleep(15)

    # Query 4: Follow-up in same conversation: Now change it to temples and history.
    conv3, res4 = run_chat_turn("4. Context Evolution in same chat", "Now change it to temples and history.", conv_id=conv1)
    time.sleep(12)

    # Query 5A: Find places near my current stop (No location provided - honest disclosure)
    conv5a, res5a = run_chat_turn("5A. Nearby without location", "Find places near my current stop.", destination="Goa")
    time.sleep(12)

    # Query 5B: Find places near my current stop (With active stop coordinates: Aguada Fort 15.4920, 73.7737)
    conv5b, res5b = run_chat_turn(
        "5B. Nearby with GPS/Stop location",
        "Find places near my current stop.",
        current_lat=15.4920,
        current_lon=73.7737,
        destination="Goa"
    )

    print("=" * 80)
    print("LIVE CHATBOT PATHWAY VERIFICATION COMPLETED SUCCESSFULLY")
    print("=" * 80)

if __name__ == "__main__":
    main()
