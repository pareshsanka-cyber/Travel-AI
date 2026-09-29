import os
import time
from dotenv import load_dotenv
from langchain_groq import ChatGroq

# Ensure environment variables from .env are loaded first
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

DEPRECATED_MODELS = [
    "llama-3.1-8b-instant",
    "llama3-8b-8192",
    "llama-3.3-70b-versatile",
    "qwen-2.5-32b",
    "qwen-2.5-coder-32b",
    "mixtral-8x7b-32768",
    "gemma2-9b-it"
]

if GROQ_MODEL in DEPRECATED_MODELS:
    raise ValueError(f"CRITICAL CONFIG ERROR: The model '{GROQ_MODEL}' is decommissioned or invalid on Groq. Please use a supported model like qwen/qwen3.8-27b.")

print("==================================================")
print("[LLM CONFIG]")
print("Provider: Groq")
print(f"Model: {GROQ_MODEL}")
print(f"API key configured: {'YES' if GROQ_API_KEY else 'NO'}")
print("==================================================")

base_llm = ChatGroq(
    model=GROQ_MODEL,
    temperature=0.0,
    max_tokens=2000,
    max_retries=0
)

class LoggedLLM:
    """Wrapper to log LLM execution and prevent silent failures."""
    def __init__(self, llm_instance):
        self._llm = llm_instance

    def invoke(self, prompt, **kwargs):
        import inspect
        agent_name = "unknown_agent"
        try:
            stack = inspect.stack()
            for frame in stack:
                if 'agent.py' in frame.filename or 'service.py' in frame.filename:
                    agent_name = os.path.basename(frame.filename).replace('.py', '')
                    break
        except Exception:
            pass

        start_time = time.time()
        try:
            response = self._llm.invoke(prompt, **kwargs)
            duration = time.time() - start_time
            print(f"\n[LLM]")
            print(f"Provider: Groq")
            print(f"Model: {GROQ_MODEL}")
            print(f"Agent: {agent_name}")
            print(f"Status: SUCCESS")
            print(f"Duration: {duration:.2f}s")
            return response
        except Exception as e:
            duration = time.time() - start_time
            print(f"\n[LLM ERROR]")
            print(f"Provider: Groq")
            print(f"Model: {GROQ_MODEL}")
            print(f"Agent: {agent_name}")
            print(f"Error: {str(e)}")
            print(f"Status: FAILED")
            print(f"Duration: {duration:.2f}s")
            raise

llm = LoggedLLM(base_llm)
