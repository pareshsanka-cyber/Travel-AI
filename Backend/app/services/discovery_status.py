"""Safe, shared SerpApi health checks. Account requests do not consume searches."""
import hashlib
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
import httpx

MESSAGES = {
    'quota_exhausted': ('Live-search credits exhausted', 'Live results can return when the provider has available credits.'),
    'missing_credentials': ('Live search is not configured', 'The server needs search-provider credentials. External search and demo checkout remain available.'),
    'invalid_credentials': ('Live-search credentials rejected', 'The server search credentials need to be updated.'),
    'rate_limited': ('Live search is temporarily rate limited', 'Please wait a minute before checking again.'),
    'connection_failure': ('Cannot reach live search', 'Please try again when the search provider is reachable.'),
    'provider_unavailable': ('Live search is temporarily unavailable', 'Please try again later or search directly with the provider.'),
    'invalid_request': ('The provider could not search these travel details', 'Check the saved route and dates, or search directly.'),
    'empty_results': ('No matching live results returned', 'Try an external search for the saved route and dates.'),
    'available': ('Live search is available', 'Check live availability to retrieve current choices.'),
}
_lock = threading.RLock()
_cache = {}


class _CredentialFilter(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        key = os.getenv('SERPAPI_API_KEY', '').strip()
        if key:
            message = message.replace(key, '[redacted]')
        record.msg = re.sub(r'(?i)(api_key=)[^&\s"\']+', r'\1[redacted]', message)
        record.args = ()
        return True


logging.getLogger('httpx').addFilter(_CredentialFilter())


def status(reason, **extra):
    reason = reason if reason in MESSAGES else 'provider_unavailable'
    title, message = MESSAGES.get(reason, MESSAGES['provider_unavailable'])
    return dict(failure_reason=None if reason == 'available' else reason, title=title,
                message=message, checked_at=datetime.now(timezone.utc).isoformat(), **extra)


def classify_response(response):
    """Interpret provider errors without returning their potentially sensitive text."""
    code = response.status_code
    try:
        error = str(response.json().get('error') or '').lower()
    except (ValueError, AttributeError):
        error = ''
    if any(word in error for word in ('run out', 'exceeded your searches', 'no searches left', 'searches exhausted', 'monthly limit')):
        return 'quota_exhausted'
    if code in (401, 403) or 'invalid api key' in error:
        return 'invalid_credentials'
    if code == 429:
        return 'rate_limited'
    if code >= 500:
        return 'provider_unavailable'
    if code >= 400 or error:
        return 'invalid_request'
    return None


def account_status():
    key = os.getenv('SERPAPI_API_KEY', '').strip()
    if not key:
        return status('missing_credentials')
    identity = hashlib.sha256(key.encode()).hexdigest()
    # Holding this lock deliberately coalesces simultaneous flight/hotel checks.
    with _lock:
        cached = _cache.get(identity)
        if cached and time.monotonic() < cached[0]:
            return dict(cached[1])
        try:
            with httpx.Client(timeout=3.0) as client:
                response = client.get('https://serpapi.com/account.json', params={'api_key': key})
            reason = classify_response(response)
            data = response.json() if not reason else {}
            left = data.get('total_searches_left', data.get('plan_searches_left'))
            result = status(reason or ('quota_exhausted' if left is not None and float(left) <= 0 else 'available'))
        except (httpx.RequestError, ValueError, TypeError):
            result = status('connection_failure')
        _cache.clear()  # bounded; credential changes invalidate the preceding account
        _cache[identity] = (time.monotonic() + 60, result)
        return dict(result)


def search_guard():
    result = account_status()
    # An unreachable account endpoint alone does not prove that search is down.
    return result if result['failure_reason'] in {'missing_credentials', 'invalid_credentials', 'quota_exhausted', 'rate_limited'} else None


def remember_failure(reason):
    if reason not in {'quota_exhausted', 'invalid_credentials', 'rate_limited'}:
        return
    key = os.getenv('SERPAPI_API_KEY', '').strip()
    with _lock:
        _cache[hashlib.sha256(key.encode()).hexdigest()] = (time.monotonic() + 60, status(reason))


def safe_metadata(metadata):
    """Do not echo exception strings saved by older versions of the application."""
    result = dict(metadata or {})
    result.pop('error', None)
    if result.get('data_status') in {'no_results', 'no_flights_found'}:
        safe = status('empty_results')
        result.setdefault('failure_reason', safe['failure_reason'])
        result.setdefault('title', safe['title'])
    if result.get('data_status') == 'error':
        reason = result.get('failure_reason') or 'provider_unavailable'
        safe = status(reason)
        result.update({key: safe[key] for key in ('failure_reason', 'title', 'message')})
    return result
