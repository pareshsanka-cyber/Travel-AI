import os
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

# Ensure environment variables from .env are loaded first
load_dotenv()

# Initialize the shared Groq LLM instance
llm = ChatGroq(
    model="qwen/qwen3.8-27b",
    temperature=0.0,
    max_tokens=900
)

print(f"--- LLM MANAGER: Initialized with Groq (qwen/qwen3.8-27b) ---")

# Initialize xAI (Grok) LLM instance for discovery tasks
xai_api_key = os.getenv("XAI_API_KEY")
xai_model = os.getenv("XAI_MODEL", "grok-2")

grok_llm = None
if xai_api_key:
    grok_llm = ChatOpenAI(
        api_key=xai_api_key,
        base_url="https://api.x.ai/v1",
        model=xai_model,
        temperature=0.3,
        max_tokens=1500,
        model_kwargs={"response_format": {"type": "json_object"}}
    )
    print(f"--- LLM MANAGER: Initialized with xAI ({xai_model}) ---")
else:
    print(f"--- LLM MANAGER: XAI_API_KEY not found. Grok discovery will fallback to Groq/Qwen or fail. ---")
