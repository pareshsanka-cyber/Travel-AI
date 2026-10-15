"""Offline payment API/state-machine regressions using an explicit test clock."""
import copy
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError
from app.main import app
from app.api import payments, auth, trips
from app.utils import auth_utils
from app.services import payment_service as service
from security_consistency_tests import Collection, sample_trip


class UniquePayments(Collection):
    def insert_one(self, doc):
        if self.find_one({key: doc[key] for key in ('user_id', 'trip_id', 'product')}):
            raise DuplicateKeyError('canonical order')
        return super().insert_one(doc)


class PaymentTests(unittest.TestCase):
    def setUp(self):
        self.owner = str(ObjectId())
        self.trip = sample_trip(); self.trip['user_id'] = self.owner
        self.trip_id = str(self.trip['_id'])
        self.db = SimpleNamespace(users=Collection([{'_id': ObjectId(self.owner)}]),
            sessions=Collection(), trips=Collection([self.trip]), payments=UniquePayments(), reroute_proposals=Collection())
        for module in (payments, auth, trips, auth_utils):
            p = patch.object(module, 'db', self.db); p.start(); self.addCleanup(p.stop)
        self.time = datetime(2026, 10, 14, 12)
        p = patch.object(service, 'now', lambda: self.time); p.start(); self.addCleanup(p.stop)
        self.headers = {'Authorization': 'Bearer ' + auth_utils.generate_token('owner@example.com', self.owner)}
        self.client = TestClient(app)

    def create(self, **extra):
        return self.client.post('/api/payments/orders', headers=self.headers, json=dict(trip_id=self.trip_id, **extra))

    def attempt(self, order, outcome='success', **extra):
        return self.client.post('/api/payments/orders/' + order['id'] + '/simulate', headers=self.headers,
            json=dict(method='upi', outcome=outcome, **extra))

    def get(self, order):
        return self.client.get('/api/payments/orders/' + order['id'], headers=self.headers)

    def success(self):
        order = self.create().json(); self.attempt(order); self.time += timedelta(seconds=3)
        return self.get(order).json()

    def test_all_routes_require_authentication(self):
        identity = str(ObjectId())
        for method, path, payload in [('POST', '/orders', {'trip_id': self.trip_id}),
            ('POST', f'/orders/{identity}/simulate', {'method': 'upi', 'outcome': 'success'}),
            ('GET', f'/orders/{identity}', None), ('GET', '/history', None), ('GET', f'/orders/{identity}/receipt', None)]:
            response = self.client.request(method, '/api/payments' + path, **({'json': payload} if payload else {}))
            self.assertEqual(response.status_code, 401)

    def test_price_and_canonical_order(self):
        first = self.create().json(); second = self.create().json()
        self.assertEqual(first['id'], second['id']); self.assertEqual(first['amount'], 49900)
        self.assertEqual(first['currency'], 'INR'); self.assertEqual(len(self.db.payments.docs), 1)
        self.assertFalse(service.plus_access(self.db, self.trip_id, self.owner))

    def test_tampered_price_status_and_access_rejected(self):
        for field in ('amount', 'currency', 'status', 'plus_access', 'user_id'):
            self.assertEqual(self.create(**{field: 1}).status_code, 422)
        order = self.create().json()
        self.assertEqual(self.attempt(order, amount=1).status_code, 422)
        self.assertEqual(self.attempt(order, status='succeeded').status_code, 422)
        self.assertFalse(service.plus_access(self.db, self.trip_id, self.owner))

    def test_success_only_after_three_seconds(self):
        order = self.create().json(); result = self.attempt(order).json()
        self.assertEqual(result['status'], 'pending')
        self.time += timedelta(seconds=2)
        self.assertEqual(self.get(order).json()['status'], 'pending')
        self.time += timedelta(seconds=1)
        self.assertEqual(self.get(order).json()['status'], 'succeeded')
        self.assertTrue(service.plus_access(self.db, self.trip_id, self.owner))
        response = self.client.get('/api/trips/' + self.trip_id, headers=self.headers).json()
        self.assertTrue(response['plus_access'])

    def test_duplicate_pending_clicks_keep_one_attempt(self):
        order = self.create().json(); self.attempt(order)
        original = copy.deepcopy(self.db.payments.docs[0])
        self.time += timedelta(seconds=1)
        self.attempt(order, 'failure')
        self.assertEqual(self.db.payments.docs[0], original)

    def test_success_is_terminal_for_every_outcome(self):
        order = self.success(); original = copy.deepcopy(self.db.payments.docs[0])
        for outcome in ('success', 'failure', 'delayed', 'cancel'):
            self.assertEqual(self.attempt(order, outcome).json()['status'], 'succeeded')
        self.assertEqual(self.db.payments.docs[0], original)

    def test_failure_and_retry_same_order(self):
        order = self.create().json(); self.attempt(order, 'failure'); self.time += timedelta(seconds=3)
        self.assertEqual(self.get(order).json()['status'], 'failed')
        self.assertFalse(service.plus_access(self.db, self.trip_id, self.owner))
        self.assertEqual(self.create().json()['id'], order['id'])
        self.attempt(order); self.time += timedelta(seconds=3)
        result = self.get(order).json()
        self.assertEqual(result['status'], 'succeeded'); self.assertEqual(len(result['attempts']), 2)

    def test_cancel_created_and_pending_without_unlock(self):
        order = self.create().json()
        self.assertEqual(self.attempt(order, 'cancel').json()['status'], 'cancelled')
        self.attempt(order); self.time += timedelta(seconds=1)
        self.assertEqual(self.attempt(order, 'cancel').json()['status'], 'cancelled')
        self.time += timedelta(seconds=30)
        self.assertEqual(self.get(order).json()['status'], 'cancelled')
        self.assertFalse(service.plus_access(self.db, self.trip_id, self.owner))

    def test_delayed_confirmation_and_new_client_resume(self):
        order = self.create().json(); self.attempt(order, 'delayed'); self.time += timedelta(seconds=19)
        self.client = TestClient(app)
        self.assertEqual(self.get(order).json()['status'], 'pending')
        self.time += timedelta(seconds=1)
        self.assertEqual(self.get(order).json()['status'], 'succeeded')

    def test_owner_isolation_for_orders_receipts_and_history(self):
        order = self.success()
        other = str(ObjectId()); self.db.users.insert_one({'_id': ObjectId(other)})
        self.headers = {'Authorization': 'Bearer ' + auth_utils.generate_token('other@example.com', other)}
        self.assertEqual(self.create().status_code, 404)
        self.assertEqual(self.get(order).status_code, 404)
        self.assertEqual(self.attempt(order).status_code, 404)
        self.assertEqual(self.client.get('/api/payments/orders/' + order['id'] + '/receipt', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get('/api/payments/history', headers=self.headers).json(), [])

    def test_deleted_pending_trip_cancels(self):
        order = self.create().json(); self.attempt(order)
        self.db.trips.docs.clear(); self.time += timedelta(seconds=3)
        self.assertEqual(self.get(order).json()['status'], 'cancelled')
        self.assertEqual(self.attempt(order).status_code, 404)

    def test_receipt_survives_deleted_successful_trip(self):
        order = self.success(); self.db.trips.docs.clear()
        result = self.client.get('/api/payments/orders/' + order['id'] + '/receipt', headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['receipt_type'], 'demo'); self.assertEqual(result.json()['money_charged'], 0)
        self.assertEqual(result.json()['trip_title'], 'Hyderabad')

    def test_receipt_not_available_before_success(self):
        order = self.create().json()
        self.assertEqual(self.client.get('/api/payments/orders/' + order['id'] + '/receipt', headers=self.headers).status_code, 409)

    def test_only_purchased_trip_unlocks_without_trip_mutation(self):
        before = copy.deepcopy(self.db.trips.docs)
        self.success(); self.assertEqual(self.db.trips.docs, before)
        other = sample_trip(); other['user_id'] = self.owner; self.db.trips.insert_one(other)
        self.assertFalse(service.plus_access(self.db, str(other['_id']), self.owner))
        self.db.trips.docs[0]['revision'] += 1
        self.assertTrue(service.plus_access(self.db, self.trip_id, self.owner))

    def test_progress_and_reroute_require_plus(self):
        self.db.trips.docs[0]['plus_access'] = True  # Stored/client flags confer no entitlement.
        endpoint = '/api/trips/' + self.trip_id
        for suffix, payload in [('/execution_state', {'expected_revision': 1, 'execution_state': {}}),
            ('/reroute/preview', {'day_number': 1, 'skipped_activity_id': 'a'}),
            ('/reroute/apply', {'proposal_id': 'fake', 'day_number': 1, 'skipped_activity_id': 'a', 'proposed_stops': []})]:
            self.assertEqual(self.client.post(endpoint + suffix, json=payload, headers=self.headers).status_code, 402)
        self.success()
        self.assertEqual(self.client.post(endpoint + '/execution_state', json={'expected_revision': 1, 'execution_state': {}}, headers=self.headers).status_code, 200)

    def test_competing_attempt_compare_and_swap(self):
        order = self.create().json()
        original = self.db.payments.update_one
        entered = False
        def race(query, update):
            nonlocal entered
            if not entered:
                entered = True
                service.simulate(self.db, order['id'], self.owner, 'card', 'success')
            return original(query, update)
        with patch.object(self.db.payments, 'update_one', race):
            result = self.attempt(order, 'failure').json()
        self.assertEqual(len(result['attempts']), 1)
        self.assertEqual(result['method'], 'card'); self.assertEqual(result['completion_outcome'], 'succeeded')

    def test_duplicate_key_creation_recovers_canonical_order(self):
        original = self.db.payments.insert_one
        def race(doc):
            original(dict(doc))
            raise DuplicateKeyError('another request won')
        with patch.object(self.db.payments, 'insert_one', race):
            order = self.create()
        self.assertEqual(order.status_code, 200); self.assertEqual(len(self.db.payments.docs), 1)


if __name__ == '__main__':
    unittest.main()
