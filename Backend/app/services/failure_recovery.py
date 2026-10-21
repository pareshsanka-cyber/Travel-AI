"""Public recovery guidance; never return provider exception bodies."""
import math
from datetime import datetime, timedelta
from fastapi import HTTPException
from groq import APIConnectionError, AuthenticationError, PermissionDeniedError
from pymongo.errors import PyMongoError


def recovery_for(error, *, planning=False):
    from app.ai.llm import GroqRateLimitError
    status = getattr(error, 'status_code', None)
    retry_at = None
    if isinstance(error, (AuthenticationError, PermissionDeniedError)) or status in {401, 403}:
        code, retryable = 'provider_configuration', False
        message = 'The AI service configuration needs attention. Contact the project administrator; retrying the same details will not fix this.'
    elif isinstance(error, GroqRateLimitError) or status == 429:
        code, retryable = 'provider_busy', True
        delay = getattr(error, 'retry_after', 30) or 30
        delay = min(300, max(1, float(delay))) if isinstance(delay, (float, int)) and math.isfinite(delay) else 30
        retry_at = (datetime.utcnow() + timedelta(seconds=delay)).isoformat() + 'Z'
        message = 'The AI service is temporarily busy. Wait briefly, then retry the saved request.'
    elif isinstance(error, (APIConnectionError, ConnectionError, TimeoutError)):
        code, retryable = 'provider_unavailable', True
        message = 'The AI service could not be reached. Your request details are saved; you can retry when the service is available.'
    elif isinstance(error, PyMongoError) or isinstance(error, HTTPException) and status == 503:
        code, retryable = 'storage_unavailable', True
        message = 'Saving or reading this request was interrupted. Check for a saved itinerary before retrying.'
    elif planning and isinstance(error, ValueError):
        code, retryable = 'trip_constraints', False
        message = 'Review the trip dates, budget or schedule before sending a revised request.'
    else:
        code, retryable = 'service_error', True
        message = 'The request could not finish. Your details are preserved; check its status before retrying.'
    return dict(code=code, retryable=retryable, message=message, retry_at=retry_at)
