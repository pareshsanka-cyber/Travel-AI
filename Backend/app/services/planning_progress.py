"""Owned, idempotent chat requests and actual planner stage observations.

The demo uses one application worker. Requests survive browser disconnects;
unfinished work is marked interrupted on server restart, never replayed blindly.
"""
import hashlib
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Callable
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from app.database.mongodb import db
from app.schemas.chat import ChatMessageResponse
from app.services.failure_recovery import recovery_for

executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='travelai-planning')
slots = threading.BoundedSemaphore(8)
logger = logging.getLogger('travelai.planning')
STAGES = {'analysis', 'parser', 'planner', 'attractions', 'restaurants', 'flights', 'hotels', 'weather',
          'budget', 'route', 'opening_hours', 'reviewer', 'synthesis', 'saving', 'response'}


def setup_indexes():
    db.planning_requests.create_index('active_owner', unique=True, sparse=True)
    db.planning_requests.create_index('expires_at', expireAfterSeconds=0)
    db.planning_requests.create_index([('user_id', 1), ('created_at', -1)])
    db.trips.create_index('planning_request_key', unique=True, sparse=True)
    # A single-worker restart cannot safely resume a half-finished model/DB call.
    db.planning_requests.update_many({'status': {'$in': ['queued', 'running']}}, {'$set': {
        'status': 'interrupted', 'error': 'The server restarted before this request finished. Check saved trips before trying again.',
        'updated_at': datetime.utcnow(), 'expires_at': datetime.utcnow() + timedelta(days=7)}, '$unset': {'active_owner': ''}})


def key_for(owner: str, request_id: str):
    return f'{owner}:{request_id}'


def snapshot(record):
    trip_id = record.get('trip_id')
    if not trip_id and record['status'] in {'failed', 'interrupted'}:
        saved = db.trips.find_one({'planning_request_key': record['_id'], 'user_id': record['user_id']}, {'_id': 1})
        if saved:
            trip_id = str(saved['_id'])
    recovery = dict(record.get('recovery') or (record.get('result') or {}).get('recovery') or {})
    if record['status'] in {'failed', 'interrupted'}:
        recovery.setdefault('message', record.get('error') or 'Review the saved details before trying again.')
        safe_to_replay = record.get('kind') == 'planning' or (record.get('stages', {}).get('analysis') or {}).get('status') == 'failed'
        recovery['retryable'] = bool(recovery.get('retryable')) and safe_to_replay and not trip_id and record['status'] == 'failed' and len(record.get('retry_attempt_ids', [])) < 3
        recovery['failed_stage'] = next((stage for stage, details in record.get('stages', {}).items() if details.get('status') == 'failed'), None)
    error = record.get('error')
    if record['status'] == 'failed' and not error:
        error = ((record.get('result') or {}).get('message') or {}).get('content')
    return {'request_id': record['request_id'], 'status': record['status'], 'kind': record.get('kind', 'request'),
            'conversation_id': record.get('conversation_id'), 'stages': record.get('stages', {}),
            'result': record.get('result'), 'error': error, 'retry_attempt_id': (record.get('retry_attempt_ids') or [None])[-1],
            'trip_id': trip_id, 'recovery': recovery or None,
            'created_at': record['created_at'].isoformat(), 'updated_at': record['updated_at'].isoformat()}


def get_request(owner: str, request_id: str):
    record = db.planning_requests.find_one({'_id': key_for(owner, request_id), 'user_id': owner})
    if not record:
        raise HTTPException(status_code=404, detail='Planning request not found.')
    cutoff = datetime.utcnow() - timedelta(minutes=15)
    if record['status'] in {'queued', 'running'} and record['updated_at'] < cutoff:
        record = db.planning_requests.find_one_and_update({'_id': record['_id'], 'status': {'$in': ['queued', 'running']}, 'updated_at': {'$lt': cutoff}},
            {'$set': {'status': 'interrupted', 'error': 'No recent progress was recorded. Review saved trips before trying again.',
                      'updated_at': datetime.utcnow(), 'expires_at': datetime.utcnow() + timedelta(days=7)}, '$unset': {'active_owner': ''}},
            return_document=ReturnDocument.AFTER) or record
    return snapshot(record)


def report_for(key: str) -> Callable:
    def report(stage, status='running', note=None, **metadata):
        values = {'updated_at': datetime.utcnow()}
        if stage == 'conversation':
            values['conversation_id'] = metadata['conversation_id']
        elif stage == 'kind':
            values['kind'] = metadata['kind']
        elif stage in STAGES:
            values[f'stages.{stage}'] = {'status': status, 'note': note}
        else:
            return
        if metadata.get('trip_id'):
            values['trip_id'] = metadata['trip_id']
        changed = db.planning_requests.update_one({'_id': key, 'status': 'running'}, {'$set': values})
        if not changed.matched_count:
            raise RuntimeError('This planning request is no longer active.')
    return report


def run_request(key):
    try:
        record = db.planning_requests.find_one_and_update({'_id': key, 'status': 'queued'},
            {'$set': {'status': 'running', 'updated_at': datetime.utcnow()}}, return_document=ReturnDocument.AFTER)
        if not record:
            return
        from app.services.chat_service import process_chat_message
        result = process_chat_message(
            record.get('submitted_conversation_id'),
            record['message'],
            record['user_id'],
            progress=report_for(key),
            planning_request_key=key,
            reuse_user_message=bool(record.get('retry_attempt_ids')),
            current_lat=record.get('current_lat'),
            current_lon=record.get('current_lon'),
            current_day=record.get('current_day'),
            active_segment_id=record.get('active_segment_id'),
            destination=record.get('destination')
        )
        result = ChatMessageResponse.model_validate(result).model_dump(mode='json')
        if result.get('recovery') is None:
            result.pop('recovery', None)
        failed = result['intent'] == 'ERROR' or (result['intent'] == 'GENERATE_ITINERARY' and not result.get('data'))
        db.planning_requests.update_one({'_id': key, 'status': 'running'}, {'$set': {
            'status': 'failed' if failed else 'succeeded', 'result': result, 'conversation_id': result['conversation_id'],
            'recovery': result.get('recovery'), 'stages.response': {'status': 'failed' if failed else 'done', 'note': None},
            'updated_at': datetime.utcnow(), 'expires_at': datetime.utcnow() + timedelta(days=7)}, '$unset': {'active_owner': ''}})
    except Exception as error:
        logger.error('Planning request failed error_type=%s', type(error).__name__)
        db.planning_requests.update_one({'_id': key, 'status': {'$in': ['queued', 'running']}}, {'$set': {
            'status': 'failed', 'error': 'This request could not finish. Check saved trips before trying again.',
            'recovery': recovery_for(error), 'stages.response': {'status': 'failed', 'note': None},
            'updated_at': datetime.utcnow(), 'expires_at': datetime.utcnow() + timedelta(days=7)}, '$unset': {'active_owner': ''}})
    finally:
        slots.release()


def create_request(owner: str, request_id: str, message: str, conversation_id=None,
                   current_lat=None, current_lon=None, current_day=None, active_segment_id=None, destination=None):
    key = key_for(owner, request_id)
    fingerprint = hashlib.sha256(json.dumps([message, conversation_id], ensure_ascii=False).encode()).hexdigest()
    existing = db.planning_requests.find_one({'_id': key, 'user_id': owner})
    if existing:
        if existing['fingerprint'] != fingerprint:
            raise HTTPException(status_code=409, detail='This request reference already belongs to a different message.')
        return snapshot(existing)
    if db.trips.find_one({'planning_request_key': key, 'user_id': owner}, {'_id': 1}):
        raise HTTPException(status_code=409, detail='This request already saved an itinerary. Open My trips to review it.')
    if conversation_id and not db.conversations.find_one({'conversation_id': conversation_id, 'user_id': owner}):
        raise HTTPException(status_code=404, detail='Conversation not found.')
    if not slots.acquire(blocking=False):
        raise HTTPException(status_code=503, detail='Planning is busy. Please try again shortly.')
    now = datetime.utcnow()
    record = {'_id': key, 'request_id': request_id, 'user_id': owner, 'active_owner': owner,
              'fingerprint': fingerprint, 'message': message, 'submitted_conversation_id': conversation_id,
              'conversation_id': conversation_id, 'status': 'queued', 'kind': 'request', 'stages': {},
              'current_lat': current_lat, 'current_lon': current_lon,
              'current_day': current_day, 'active_segment_id': active_segment_id,
              'destination': destination,
              'created_at': now, 'updated_at': now}
    try:
        db.planning_requests.insert_one(record)
    except DuplicateKeyError:
        slots.release()
        existing = db.planning_requests.find_one({'_id': key, 'user_id': owner})
        if existing and existing['fingerprint'] == fingerprint:
            return snapshot(existing)
        raise HTTPException(status_code=409, detail='Another request is already running. Wait for it to finish before sending a new message.')
    except Exception:
        slots.release()
        raise
    try:
        executor.submit(run_request, key)
    except RuntimeError:
        slots.release()
        db.planning_requests.update_one({'_id': key}, {'$set': {'status': 'interrupted', 'error': 'The server is shutting down. Check this request again after reconnecting.', 'expires_at': now + timedelta(days=7)}, '$unset': {'active_owner': ''}})
    return get_request(owner, request_id)


def retry_request(owner: str, request_id: str, attempt_id: str):
    """Explicit, bounded retry of a finished failure; preserve its original request key."""
    current = get_request(owner, request_id)
    key = key_for(owner, request_id)
    record = db.planning_requests.find_one({'_id': key, 'user_id': owner})
    attempts = record.get('retry_attempt_ids', [])
    if attempt_id in attempts:
        return get_request(owner, request_id)  # A lost acknowledgement or refresh cannot replay this retry.
    if current['trip_id']:
        return current  # The caller must open the saved trip, never generate another.
    if current['status'] != 'failed' or not (current.get('recovery') or {}).get('retryable'):
        raise HTTPException(409, 'This request cannot be retried directly. Review its status and saved details first.')
    retry_at = (current.get('recovery') or {}).get('retry_at')
    if retry_at and datetime.fromisoformat(retry_at.rstrip('Z')) > datetime.utcnow():
        raise HTTPException(429, 'The AI service is cooling down. Check status and retry after the displayed wait.')
    conversation_id = record.get('conversation_id')
    if conversation_id and not db.conversations.find_one({'conversation_id': conversation_id, 'user_id': owner}):
        raise HTTPException(409, 'The conversation is no longer available. Return to planning with your saved details.')
    if not slots.acquire(blocking=False):
        raise HTTPException(503, 'Planning is busy. Check status before retrying.')
    now = datetime.utcnow()
    history = record.get('failure_history', []) + [{'updated_at': record['updated_at'], 'recovery': current.get('recovery'), 'stages': record.get('stages', {})}]
    try:
        claimed = db.planning_requests.find_one_and_update({'_id': key, 'user_id': owner, 'status': 'failed', 'updated_at': record['updated_at']},
            {'$set': {'status': 'queued', 'active_owner': owner, 'updated_at': now, 'stages': {}, 'result': None, 'error': None,
                      'recovery': None, 'retry_attempt_ids': attempts + [attempt_id], 'failure_history': history,
                      'submitted_conversation_id': conversation_id}, '$unset': {'expires_at': ''}}, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        slots.release()
        raise HTTPException(409, 'Another request is running. Check its status before retrying.')
    except Exception:
        slots.release()
        raise
    if not claimed:
        slots.release()
        return get_request(owner, request_id)
    try:
        executor.submit(run_request, key)
    except RuntimeError:
        slots.release()
        db.planning_requests.update_one({'_id': key, 'status': 'queued'}, {'$set': {'status': 'interrupted', 'error': 'The server is shutting down. Review this request after reconnecting.', 'updated_at': now, 'expires_at': now + timedelta(days=7)}, '$unset': {'active_owner': ''}})
    return get_request(owner, request_id)


def node_progress(config, stage, status, result=None):
    report = (config or {}).get('configurable', {}).get('planning_progress')
    if not report:
        return
    note = None
    if status == 'done' and result is not None:
        if stage in {'flights', 'hotels', 'attractions', 'restaurants'}:
            results = result.get(stage) or []
            if not results or all(item.get('source') == 'planning_placeholder' for item in results if isinstance(item, dict)):
                status, note = 'warning', 'No verified results available from this check.'
        elif stage == 'weather' and (result.get('weather') or {}).get('data_status') == 'unavailable':
            status, note = 'warning', 'No forecast available for the trip dates.'
        elif stage == 'reviewer' and result.get('is_approved') is not True:
            status, note = 'failed', 'The schedule did not pass validation.'
    report(stage, status, note)
