"""Offline request ownership, recovery and real graph progress contracts."""
import copy
import threading
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from langgraph.graph import StateGraph, END
from typing import TypedDict
from app.services import planning_progress as progress
from app.ai.orchestrator.langgraph_graph import log_node_execution
from app.services.failure_recovery import recovery_for


def matches(doc, query):
    for key, value in query.items():
        if isinstance(value, dict):
            if '$in' in value and doc.get(key) not in value['$in']: return False
            if '$lt' in value and doc.get(key, datetime.max) >= value['$lt']: return False
        elif doc.get(key) != value: return False
    return True


class Collection:
    def __init__(self): self.docs = []; self.lock = threading.RLock(); self.indexes = []
    def create_index(self, *args, **kwargs): self.indexes.append((args, kwargs))
    def find_one(self, query, projection=None):
        with self.lock: return next((copy.deepcopy(doc) for doc in self.docs if matches(doc, query)), None)
    def insert_one(self, doc):
        with self.lock:
            if any(item['_id'] == doc['_id'] or (doc.get('active_owner') and item.get('active_owner') == doc['active_owner']) for item in self.docs): raise DuplicateKeyError('duplicate')
            self.docs.append(copy.deepcopy(doc))
    def find_one_and_update(self, query, update, **kwargs):
        with self.lock:
            for doc in self.docs:
                if not matches(doc, query): continue
                new_owner = update.get('$set', {}).get('active_owner')
                if new_owner and any(other['_id'] != doc['_id'] and other.get('active_owner') == new_owner for other in self.docs): raise DuplicateKeyError('active owner')
                for key, value in update.get('$set', {}).items():
                    if '.' in key:
                        parent, child = key.split('.', 1); doc.setdefault(parent, {})[child] = copy.deepcopy(value)
                    else: doc[key] = copy.deepcopy(value)
                for key in update.get('$unset', {}): doc.pop(key, None)
                return copy.deepcopy(doc)
        return None
    def update_one(self, query, update):
        doc = self.find_one_and_update(query, update)
        return SimpleNamespace(matched_count=int(doc is not None))
    def update_many(self, query, update):
        for doc in list(self.docs):
            if matches(doc, query): self.update_one({'_id': doc['_id']}, update)


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.db = SimpleNamespace(planning_requests=Collection(), trips=Collection(), conversations=Collection())
        self.pool = Mock()
        for field, value in [('db', self.db), ('executor', self.pool), ('slots', threading.BoundedSemaphore(8))]:
            patcher = patch.object(progress, field, value); patcher.start(); self.addCleanup(patcher.stop)
        self.id = 'request-1234567890'

    def create(self, owner='owner', message='Plan Goa', conversation=None):
        return progress.create_request(owner, self.id, message, conversation)

    def test_duplicate_request_starts_only_one_worker(self):
        self.create(); self.create()
        self.assertEqual(len(self.db.planning_requests.docs), 1)
        self.pool.submit.assert_called_once_with(progress.run_request, 'owner:' + self.id)

    def test_request_id_cannot_be_reused_for_different_input(self):
        self.create()
        with self.assertRaises(HTTPException) as error: self.create(message='Plan Sydney')
        self.assertEqual(error.exception.status_code, 409)

    def test_ownership_and_conversation_checks(self):
        self.create()
        with self.assertRaises(HTTPException) as error: progress.get_request('stranger', self.id)
        self.assertEqual(error.exception.status_code, 404)
        self.db.conversations.insert_one({'_id': 'c', 'conversation_id': 'c', 'user_id': 'stranger'})
        with self.assertRaises(HTTPException): progress.create_request('owner', 'another-request-123', 'Hello', 'c')
        self.create(owner='stranger')
        self.assertEqual(len(self.db.planning_requests.docs), 2)

    def test_account_has_only_one_active_request(self):
        self.create()
        with self.assertRaises(HTTPException) as error: progress.create_request('owner', 'another-request-123', 'Hello')
        self.assertEqual(error.exception.status_code, 409)

    def test_real_graph_passes_progress_callback_to_parallel_nodes(self):
        class State(TypedDict): first: str; second: str
        graph = StateGraph(State)
        graph.add_node('parser', log_node_execution('parser', lambda state: {}))
        graph.add_node('flights', log_node_execution('flights', lambda state: {'first': 'ok'}))
        graph.add_node('hotels', log_node_execution('hotels', lambda state: {'second': 'ok'}))
        graph.set_entry_point('parser')
        for node in ['flights', 'hotels']: graph.add_edge('parser', node); graph.add_edge(node, END)
        events = []; graph.compile().invoke({}, config={'configurable': {'planning_progress': lambda *args: events.append(args)}})
        for stage in ['parser', 'flights', 'hotels']:
            self.assertEqual([item[1] for item in events if item[0] == stage], ['running', 'warning' if stage != 'parser' else 'done'])

    def test_stage_updates_do_not_overwrite_parallel_results(self):
        self.create(); self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': {'status': 'running'}})
        report = progress.report_for('owner:' + self.id)
        report('flights', 'done'); report('hotels', 'running'); report('weather', 'warning', 'Outside forecast window')
        data = progress.get_request('owner', self.id)
        self.assertEqual(data['stages']['flights']['status'], 'done')
        self.assertEqual(data['stages']['hotels']['status'], 'running')
        self.assertEqual(data['stages']['weather']['note'], 'Outside forecast window')

    def test_restart_interrupts_without_replaying_or_deleting_trips(self):
        self.create(); self.db.trips.insert_one({'_id': 'saved', 'user_id': 'owner', 'planning_request_key': 'owner:' + self.id})
        progress.setup_indexes()
        data = progress.get_request('owner', self.id)
        self.assertEqual(data['status'], 'interrupted'); self.assertEqual(data['trip_id'], 'saved')
        with self.assertRaises(RuntimeError): progress.report_for('owner:' + self.id)('saving')
        self.assertEqual(len(self.db.trips.docs), 1)

    def test_stale_request_stops_and_preserves_saved_trip_link(self):
        self.create()
        self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': {'updated_at': datetime.utcnow() - timedelta(minutes=16)}})
        self.assertEqual(progress.get_request('owner', self.id)['status'], 'interrupted')
        self.assertNotIn('active_owner', self.db.planning_requests.docs[0])

    def test_success_result_is_persisted_and_reused(self):
        self.create()
        result = dict(conversation_id='c', intent='GENERAL_CHAT', message={'role': 'assistant', 'content': 'Hello'}, travel_context={}, data=None)
        with patch('app.services.chat_service.process_chat_message', return_value=result) as chat:
            progress.run_request('owner:' + self.id)
            self.assertEqual(chat.call_count, 1)
        data = self.create()
        self.assertEqual(data['status'], 'succeeded'); self.assertEqual(data['result'], result)
        self.assertNotIn('active_owner', self.db.planning_requests.docs[0])

    def test_pipeline_error_is_terminal_and_sanitized(self):
        self.create()
        with patch('app.services.chat_service.process_chat_message', side_effect=ValueError('secret provider error')):
            progress.run_request('owner:' + self.id)
        data = progress.get_request('owner', self.id)
        self.assertEqual(data['status'], 'failed'); self.assertNotIn('secret', data['error'])

    def test_saved_trip_blocks_replay_after_request_expiry(self):
        self.db.trips.insert_one({'_id': 'saved', 'user_id': 'owner', 'planning_request_key': 'owner:' + self.id})
        with self.assertRaises(HTTPException) as error: self.create()
        self.assertEqual(error.exception.status_code, 409); self.pool.submit.assert_not_called()

    def test_unavailable_checks_are_not_reported_as_verified(self):
        report = Mock(); config = {'configurable': {'planning_progress': report}}
        progress.node_progress(config, 'weather', 'done', {'weather': {'data_status': 'unavailable'}})
        self.assertEqual(report.call_args.args[:2], ('weather', 'warning'))
        progress.node_progress(config, 'reviewer', 'done', {'is_approved': False})
        self.assertEqual(report.call_args.args[:2], ('reviewer', 'failed'))

    def failed_request(self, **updates):
        self.create()
        self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': dict(status='failed', kind='planning',
            recovery=recovery_for(ConnectionError('private endpoint')), **updates), '$unset': {'active_owner': ''}})

    def test_retry_is_idempotent_and_preserves_original_request_key(self):
        self.failed_request()
        first = progress.retry_request('owner', self.id, 'retry-attempt-123456')
        again = progress.retry_request('owner', self.id, 'retry-attempt-123456')
        self.assertEqual(first['status'], 'queued'); self.assertEqual(again['status'], 'queued')
        self.assertEqual(first['request_id'], self.id); self.assertEqual(self.pool.submit.call_count, 2)
        self.assertEqual(len(self.db.planning_requests.docs[0]['failure_history']), 1)

    def test_duplicate_parallel_retry_clicks_start_one_attempt(self):
        from concurrent.futures import ThreadPoolExecutor
        self.failed_request()
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _: progress.retry_request('owner', self.id, 'retry-attempt-123456'), range(4)))
        self.assertTrue(all(item['status'] == 'queued' for item in results)); self.assertEqual(self.pool.submit.call_count, 2)

    def test_saved_trip_prevents_retry_even_after_partial_save(self):
        self.failed_request()
        self.db.trips.insert_one({'_id': 'saved', 'user_id': 'owner', 'planning_request_key': 'owner:' + self.id})
        result = progress.retry_request('owner', self.id, 'retry-attempt-123456')
        self.assertEqual(result['trip_id'], 'saved'); self.assertFalse(result['recovery']['retryable'])
        self.assertEqual(self.pool.submit.call_count, 1)

    def test_validation_and_configuration_failures_require_review(self):
        self.failed_request()
        for recovery in [recovery_for(ValueError('Budget exceeds limit'), planning=True), {'code': 'provider_configuration', 'retryable': False}]:
            self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': {'recovery': recovery}})
            with self.assertRaises(HTTPException) as error: progress.retry_request('owner', self.id, 'retry-attempt-123456')
            self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.pool.submit.call_count, 1)

    def test_retry_rechecks_ownership_and_never_replays_active_or_interrupted_work(self):
        self.failed_request()
        with self.assertRaises(HTTPException) as error: progress.retry_request('stranger', self.id, 'retry-attempt-123456')
        self.assertEqual(error.exception.status_code, 404)
        for state in ['running', 'queued', 'interrupted', 'succeeded']:
            self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': {'status': state}})
            with self.assertRaises(HTTPException): progress.retry_request('owner', self.id, 'retry-attempt-123456')
        self.assertEqual(self.pool.submit.call_count, 1)

    def test_retries_are_bounded_and_cooldown_is_enforced_by_server(self):
        self.failed_request()
        self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': {'recovery': dict(retryable=True, retry_at=(datetime.utcnow() + timedelta(minutes=1)).isoformat() + 'Z')}})
        with self.assertRaises(HTTPException) as error: progress.retry_request('owner', self.id, 'retry-attempt-123456')
        self.assertEqual(error.exception.status_code, 429)
        self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': {'recovery': {'retryable': True}, 'retry_attempt_ids': ['a','b','c']}})
        with self.assertRaises(HTTPException): progress.retry_request('owner', self.id, 'retry-attempt-123456')

    def test_retry_preserves_conversation_and_does_not_reinsert_user_message(self):
        self.failed_request(conversation_id='c')
        self.db.conversations.insert_one({'_id': 'c', 'conversation_id': 'c', 'user_id': 'owner'})
        progress.retry_request('owner', self.id, 'retry-attempt-123456')
        result = dict(conversation_id='c', intent='GENERAL_CHAT', message={'role': 'assistant', 'content': 'Recovered'}, travel_context={}, data=None)
        with patch('app.services.chat_service.process_chat_message', return_value=result) as chat:
            progress.run_request('owner:' + self.id)
        self.assertEqual(chat.call_args.args[0], 'c'); self.assertTrue(chat.call_args.kwargs['reuse_user_message'])
        self.assertEqual(progress.get_request('owner', self.id)['stages']['response']['status'], 'done')

    def test_failure_after_an_unknown_edit_is_not_directly_replayable(self):
        self.failed_request()
        self.db.planning_requests.update_one({'_id': 'owner:' + self.id}, {'$set': {'kind': 'request', 'stages': {'analysis': {'status': 'done'}}}})
        self.assertFalse(progress.get_request('owner', self.id)['recovery']['retryable'])

    def test_recovery_guidance_does_not_expose_provider_exception(self):
        recovery = recovery_for(ConnectionError('secret-key https://private-provider'))
        self.assertEqual(recovery['code'], 'provider_unavailable'); self.assertNotIn('secret-key', str(recovery))

    def test_retry_route_rejects_tampered_payloads(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.utils.auth_utils import require_user_id
        app.dependency_overrides[require_user_id] = lambda: 'owner'
        try:
            response = TestClient(app).post('/api/chat/requests/' + self.id + '/retry', json={'attempt_id':'retry-attempt-123456', 'message':'tampered', 'trip_id':'another-trip'})
            self.assertEqual(response.status_code, 422)
        finally: app.dependency_overrides.pop(require_user_id, None)


if __name__ == '__main__': unittest.main()
