import os
import time
import re
import uuid
import threading
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from groq import APIConnectionError, AuthenticationError, PermissionDeniedError

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

# Model availability belongs to the provider; avoid a stale local blacklist.

print("==================================================")
print("[LLM CONFIG]")
print("Provider: Groq")
print(f"Model: {GROQ_MODEL}")
print(f"API key configured: {'YES' if GROQ_API_KEY else 'NO'}")
OUTPUT_TOKEN_BUDGET = int(os.getenv("GROQ_OUTPUT_TOKENS_PER_MINUTE", "1000"))
print(f"Rate Coordinator: Active (local output budget: {OUTPUT_TOKEN_BUDGET} tokens/min)")
print("==================================================")


class GroqRateLimitError(Exception):
    """Custom exception raised when Groq rate limits are exceeded or local budget is exhausted."""
    def __init__(self, message: str, retry_after: float = 0.0):
        super().__init__(message)
        self.retry_after = retry_after


def public_llm_error(error: Exception) -> str:
    """Explain a failed AI request without leaking provider internals or credentials."""
    if isinstance(error, (APIConnectionError, ConnectionError, TimeoutError)):
        return "TravelAI couldn't connect to its AI provider. Please try again in a moment. Your saved trips have not been changed."
    if isinstance(error, GroqRateLimitError) or getattr(error, 'status_code', None) == 429:
        return 'The AI service is busy right now. Please try again shortly. Your saved trips have not been changed.'
    if isinstance(error, (AuthenticationError, PermissionDeniedError)):
        return 'The AI service credentials need attention. Please contact the project administrator. Your saved trips have not been changed.'
    return "TravelAI couldn't process the AI response safely. Please try again. Your saved trips have not been changed."


class GroqTokenCoordinator:
    """
    Centralized rate-limit-aware coordinator for Groq calls within this application process.
    Tracks rolling 60s output token budget (OTPM limit = 1000 tokens for free/developer tiers).
    
    Key guarantees:
    1. Pre-call token reservation before issuing any Groq request.
    2. Post-call reconciliation against actual provider token usage.
    3. Rejection / graceful degradation when remaining token budget is insufficient for minimum viable output.
    4. Synchronization with provider rate-limit response headers when available.
    5. Robust retry-after parsing from error strings and HTTP headers.
    6. Concurrency bounding via semaphore to eliminate simultaneous quota collisions.
    """
    def __init__(self, model_name: str, otpm_limit: int = 1000):
        self.model_name = model_name
        self.otpm_limit = otpm_limit
        self.lock = threading.RLock()
        self.concurrency_semaphore = threading.BoundedSemaphore(1)  # bound concurrent Groq calls to 1
        self.token_history = []  # list of dict: {"time": float, "tokens": int, "is_reservation": bool, "id": str}
        self.provider_remaining_tokens = None
        self.provider_reset_seconds = None
        self.last_provider_sync = None

    def _cleanup_old_tokens(self, now: float):
        cutoff = now - 60.0
        self.token_history = [e for e in self.token_history if e["time"] > cutoff]

    def get_used_tokens(self) -> int:
        now = time.time()
        with self.lock:
            self._cleanup_old_tokens(now)
            return sum(e["tokens"] for e in self.token_history)

    def get_available_tokens(self) -> int:
        now = time.time()
        with self.lock:
            self._cleanup_old_tokens(now)
            local_used = sum(e["tokens"] for e in self.token_history)
            local_avail = max(0, self.otpm_limit - local_used)
            if self.provider_remaining_tokens is not None and self.last_provider_sync and (now - self.last_provider_sync < 60.0):
                return min(local_avail, self.provider_remaining_tokens)
            return local_avail

    def seconds_until_headroom(self, needed_tokens: int) -> float:
        """Calculate wait time until enough tokens expire from rolling window to satisfy needed_tokens."""
        now = time.time()
        with self.lock:
            self._cleanup_old_tokens(now)
            used = sum(e["tokens"] for e in self.token_history)
            available = self.otpm_limit - used
            if available >= needed_tokens:
                return 0.0
            
            tokens_to_free = needed_tokens - available
            freed = 0
            for e in sorted(self.token_history, key=lambda x: x["time"]):
                freed += e["tokens"]
                if freed >= tokens_to_free:
                    wait = max(0.5, (e["time"] + 60.0) - now)
                    return round(wait, 2)
            return 20.0

    def reserve_budget(self, requested_tokens: int, min_required: int = 150) -> tuple[int, str]:
        """
        Pre-reserve tokens before making an LLM request.
        Raises GroqRateLimitError if insufficient budget is available.
        """
        now = time.time()
        with self.lock:
            self._cleanup_old_tokens(now)
            used = sum(e["tokens"] for e in self.token_history)
            avail = max(0, self.otpm_limit - used)

            if self.provider_remaining_tokens is not None and self.last_provider_sync and (now - self.last_provider_sync < 60.0):
                avail = min(avail, self.provider_remaining_tokens)

            if avail < min_required:
                wait_time = self.seconds_until_headroom(min_required)
                raise GroqRateLimitError(
                    f"Insufficient Groq OTPM budget: {avail} tokens available (requires minimum {min_required} tokens, rolling used: {used}/{self.otpm_limit}).",
                    retry_after=wait_time
                )

            clamped = min(requested_tokens, avail)
            res_id = uuid.uuid4().hex[:8]
            self.token_history.append({
                "time": now,
                "tokens": clamped,
                "is_reservation": True,
                "id": res_id
            })
            return clamped, res_id

    def reconcile_reservation(self, res_id: str, actual_tokens: int | None, provider_headers: dict = None):
        """Reconcile pre-call reservation with actual output tokens consumed."""
        now = time.time()
        with self.lock:
            self._cleanup_old_tokens(now)
            for e in self.token_history:
                if e.get("id") == res_id:
                    if actual_tokens is not None and actual_tokens > 0:
                        e["tokens"] = actual_tokens
                        e["is_reservation"] = False
                        e["time"] = now
                    else:
                        self.token_history.remove(e)
                    break

            if provider_headers:
                self.sync_provider_headers(provider_headers)

    def sync_provider_headers(self, headers: dict):
        """Update provider rate limits from live HTTP response headers."""
        if not headers:
            return
        rem = headers.get("x-ratelimit-remaining-tokens")
        reset_str = headers.get("x-ratelimit-reset-tokens")
        if rem is not None:
            try:
                self.provider_remaining_tokens = int(rem)
                self.last_provider_sync = time.time()
            except (ValueError, TypeError):
                pass
        if reset_str is not None:
            try:
                match = re.search(r'([0-9\.]+)\s*(s|ms)?', str(reset_str))
                if match:
                    val = float(match.group(1))
                    unit = match.group(2)
                    self.provider_reset_seconds = val / 1000.0 if unit == "ms" else val
            except Exception:
                pass

    def parse_retry_after(self, error_obj) -> float:
        """Parse provider retry delay from Groq error message or headers."""
        resp = getattr(error_obj, "response", None)
        if resp and hasattr(resp, "headers"):
            retry_header = resp.headers.get("retry-after")
            if retry_header:
                try:
                    return float(retry_header)
                except ValueError:
                    pass
            reset_header = resp.headers.get("x-ratelimit-reset-tokens")
            if reset_header:
                try:
                    match = re.search(r'([0-9\.]+)', str(reset_header))
                    if match:
                        return float(match.group(1))
                except ValueError:
                    pass

        error_str = str(error_obj)
        match = re.search(r'(?:try again in|approximately|retry after)\s*([0-9\.]+)\s*(?:s|seconds)', error_str, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                pass
        return 5.0


coordinator = GroqTokenCoordinator(GROQ_MODEL, otpm_limit=OUTPUT_TOKEN_BUDGET)


class RateAwareLLM:
    """
    Centralized rate-limit-aware LLM wrapper for Groq:
    1. Pre-call token reservations with atomic concurrency bounding.
    2. Post-call usage reconciliation.
    3. Parsing and waiting for Groq 429 retry delays with bounded retries.
    4. Structured performance logging without exposing secrets.
    """
    def __init__(self, model_name: str):
        self.model_name = model_name

    def invoke(self, prompt, agent_name: str = None, max_tokens: int = 400, min_tokens: int = 150, max_retries: int = 1, timeout: float = 20.0, **kwargs):
        import inspect
        if not agent_name:
            try:
                stack = inspect.stack()
                for frame in stack:
                    if 'agent.py' in frame.filename or 'service.py' in frame.filename:
                        agent_name = os.path.basename(frame.filename).replace('.py', '')
                        break
            except Exception:
                agent_name = "unknown_agent"

        req_id = f"llm_{uuid.uuid4().hex[:6]}"

        # Concurrency gating: only 1 in-flight Groq call at a time to prevent budget collisions
        acquired = coordinator.concurrency_semaphore.acquire(timeout=timeout)
        if not acquired:
            raise GroqRateLimitError(f"Concurrency gate timeout waiting for Groq access (agent: {agent_name})", retry_after=5.0)

        try:
            # Step 1: Pre-reserve budget
            clamped_tokens, res_id = coordinator.reserve_budget(max_tokens, min_required=min_tokens)
            used_tokens = coordinator.get_used_tokens()
            print(f"[LLM START] req_id={req_id} agent={agent_name} model={self.model_name} requested={max_tokens} reserved={clamped_tokens} otpm_used={used_tokens}/{coordinator.otpm_limit}")

            retries_attempted = 0
            deadline = time.monotonic() + timeout
            while retries_attempted <= max_retries:
                start_time = time.time()
                try:
                    client = ChatGroq(
                        model=self.model_name,
                        temperature=0.0,
                        max_tokens=clamped_tokens,
                        max_retries=0,
                        request_timeout=max(0.001, deadline - time.monotonic())
                    )

                    response = client.invoke(prompt, **kwargs)
                    duration = time.time() - start_time

                    tokens_out = clamped_tokens
                    if hasattr(response, 'usage_metadata') and response.usage_metadata:
                        tokens_out = response.usage_metadata.get('output_tokens', clamped_tokens)
                    elif hasattr(response, 'response_metadata') and 'token_usage' in response.response_metadata:
                        tokens_out = response.response_metadata['token_usage'].get('completion_tokens', clamped_tokens)

                    # Reconcile usage with actual token counts
                    coordinator.reconcile_reservation(res_id, tokens_out)
                    print(f"[LLM SUCCESS] req_id={req_id} agent={agent_name} duration={duration:.2f}s tokens_out={tokens_out} status=SUCCESS")
                    return response

                except Exception as e:
                    duration = time.time() - start_time
                    error_str = str(e)
                    is_429 = "429" in error_str or "rate_limit" in error_str.lower() or "too large" in error_str.lower()

                    if isinstance(e, APIConnectionError):
                        # Retry only the completion, not chat writes; reuse its reservation and deadline.
                        if retries_attempted < max_retries and deadline - time.monotonic() > 0.5:
                            retries_attempted += 1
                            print(f"[LLM CONNECTION RETRY] req_id={req_id} agent={agent_name} error_type={type(e).__name__} cause_type={type(e.__cause__).__name__} attempt={retries_attempted + 1}/{max_retries + 1}")
                            time.sleep(0.5)
                            continue

                    if is_429:
                        retry_delay = coordinator.parse_retry_after(e)
                        print(f"[LLM 429] req_id={req_id} agent={agent_name} rate_limit_hit=True retry_delay={retry_delay:.2f}s attempt={retries_attempted + 1}/{max_retries + 1}")

                        if retries_attempted < max_retries and retry_delay <= 20.0 and retry_delay + 0.5 < deadline - time.monotonic():
                            retries_attempted += 1
                            time.sleep(retry_delay + 0.5)
                            continue
                        else:
                            coordinator.reconcile_reservation(res_id, None)
                            print(f"[LLM 429 EXHAUSTED] req_id={req_id} agent={agent_name} Stopping retries to preserve request deadline.")
                            raise GroqRateLimitError(f"Groq 429 rate limit exceeded for {agent_name}: {error_str}", retry_after=retry_delay)
                    else:
                        coordinator.reconcile_reservation(res_id, None)
                        print(f"[LLM ERROR] req_id={req_id} agent={agent_name} error={error_str[:120]} duration={duration:.2f}s status=FAILED")
                        raise

        finally:
            coordinator.concurrency_semaphore.release()


# Global singleton instance
llm = RateAwareLLM(GROQ_MODEL)
