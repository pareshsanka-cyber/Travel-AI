"""Offline demo booking totals, ownership, snapshots and access regressions."""
import copy
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError
from app.main import app
from app.api import payments, bookings, auth, trips
from app.utils import auth_utils
from app.services import payment_service, booking_service
from security_consistency_tests import Collection, sample_trip


class UniqueOrders(Collection):
    def insert_one(self, doc):
        keys = ('user_id', 'trip_id', 'product') + (('booking_key',) if 'booking_key' in doc else ())
        if self.find_one({key: doc[key] for key in keys}):
            raise DuplicateKeyError('canonical order')
        return super().insert_one(doc)


class BookingTests(unittest.TestCase):
    def setUp(self):
        self.owner = str(ObjectId())
        self.trip = sample_trip()
        self.trip.update(user_id=self.owner, origin='Hyderabad', travelers=2, days=3,
            start_date='2026-12-01', end_date='2026-12-03', selections={'flight_id': 'f1', 'hotel_id': 'h1'},
            flights=[{'id': 'f1', 'airline_name': 'Test airline', 'price_per_person': 1000.25, 'departure_time': '08:00', 'arrival_time': '10:00'},
                {'id': 'f2', 'airline_name': 'Another airline', 'price': 1500}],
            hotels=[{'id': 'h1', 'name': 'Test hotel', 'price_per_night': 2500}, {'id': 'h2', 'name': 'Other hotel', 'price_per_night': 3000}])
        self.id = str(self.trip['_id'])
        self.db = SimpleNamespace(users=Collection([{'_id': ObjectId(self.owner)}]), sessions=Collection(),
            trips=Collection([self.trip]), payments=UniqueOrders(), reroute_proposals=Collection())
        for module in (payments, bookings, auth, trips, auth_utils):
            p = patch.object(module, 'db', self.db); p.start(); self.addCleanup(p.stop)
        self.time = datetime(2026, 10, 14, 12)
        p = patch.object(payment_service, 'now', lambda: self.time); p.start(); self.addCleanup(p.stop)
        self.client = TestClient(app)
        self.headers = {'Authorization': 'Bearer ' + auth_utils.generate_token('owner@example.com', self.owner)}

    def create(self, kind='flight', **changes):
        payload = dict(trip_id=self.id, kind=kind, source='discovered', option_id='f1' if kind == 'flight' else 'h1', expected_revision=1)
        payload.update(changes)
        return self.client.post('/api/bookings/orders', json=payload, headers=self.headers)

    def simulate(self, order, outcome='success'):
        return self.client.post('/api/payments/orders/' + order['id'] + '/simulate',
            json={'method': 'card', 'outcome': outcome}, headers=self.headers)

    def finish(self, order):
        self.simulate(order); self.time += timedelta(seconds=3)
        return self.client.get('/api/payments/orders/' + order['id'], headers=self.headers)

    def test_flight_server_total_and_duplicate_order(self):
        order = self.create().json()
        self.assertEqual(order['amount'], 200050); self.assertEqual(order['currency'], 'INR')
        self.assertEqual(order['booking']['travelers'], 2); self.assertEqual(order['booking']['unit_amount'], 100025)
        self.assertEqual(self.create().json()['id'], order['id'])

    def test_hotel_nights_rooms_and_distinct_quotes(self):
        first = self.create('hotel').json(); second = self.create('hotel', rooms=3).json()
        self.assertEqual(first['amount'], 500000); self.assertEqual(second['amount'], 1500000)
        self.assertEqual(second['booking']['nights'], 2); self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(self.create('hotel', rooms=3).json()['id'], second['id'])

    def test_one_day_hotel_is_one_night(self):
        self.db.trips.docs[0].update(end_date='2026-12-01', days=1)
        order = self.create('hotel').json()
        self.assertEqual(order['booking']['check_out'], '2026-12-02'); self.assertEqual(order['amount'], 250000)

    def test_room_bounds_and_flight_room_validation(self):
        for rooms in (0, 11): self.assertEqual(self.create('hotel', rooms=rooms).status_code, 422)
        self.assertEqual(self.create(rooms=2).status_code, 400)

    def test_payload_cannot_set_amount_or_access(self):
        for key in ('amount', 'currency', 'status', 'plus_access', 'user_id'):
            self.assertEqual(self.create(**{key: 'invented'}).status_code, 422)

    def test_unselected_or_unknown_option_rejected(self):
        self.assertEqual(self.create(option_id='f2').status_code, 409)
        self.assertEqual(self.create('hotel', option_id='h2').status_code, 409)
        self.assertEqual(self.create(option_id='invented').status_code, 400)

    def test_missing_zero_invalid_prices_rejected(self):
        for price in (None, 0, -1, 'unavailable', float('nan')):
            self.db.trips.docs[0]['hotels'][0]['price_per_night'] = price
            self.assertEqual(self.create('hotel').status_code, 400)

    def test_discovered_currency_not_converted(self):
        self.db.trips.docs[0]['hotels'][0].update(currency='USD', price_per_night=120.5)
        order = self.create('hotel').json()
        self.assertEqual(order['currency'], 'USD'); self.assertEqual(order['amount'], 24100)

    def test_hostel_beds_are_outside_hotel_booking_scope(self):
        self.db.trips.docs[0]['hotels'][0]['name'] = 'Budget Hostel'
        self.assertEqual(self.create('hotel').status_code, 400)

    def test_samples_are_fixed_priced_and_isolated(self):
        self.db.trips.docs[0].update(flights=[], hotels=[])
        before = copy.deepcopy(self.db.trips.docs)
        flight = self.create(source='sample', option_id='sample-flight').json()
        hotel = self.create('hotel', source='sample', option_id='sample-hotel', rooms=2).json()
        self.assertEqual(flight['amount'], 1000000); self.assertEqual(hotel['amount'], 1000000)
        self.assertEqual(flight['booking']['source'], 'sample')
        self.assertEqual(self.db.trips.docs, before)

    def test_sample_is_unavailable_when_real_priced_options_exist(self):
        self.assertEqual(self.create(source='sample', option_id='sample-flight').status_code, 409)
        self.db.trips.docs[0]['flights'] = []
        self.assertEqual(self.create(source='sample', option_id='invented').status_code, 400)

    def test_success_unlocks_only_owned_trip_and_keeps_data_intact(self):
        before = copy.deepcopy(self.db.trips.docs)
        order = self.create().json()
        self.assertFalse(payment_service.plus_access(self.db, self.id, self.owner))
        self.assertEqual(self.finish(order).json()['status'], 'succeeded')
        result = self.client.get('/api/trips/' + self.id, headers=self.headers).json()
        self.assertTrue(result['plus_access']); self.assertEqual(result['plus_access_source'], 'booking')
        self.assertEqual(self.db.trips.docs, before)
        other = sample_trip(); other['user_id'] = self.owner; self.db.trips.insert_one(other)
        self.assertFalse(payment_service.plus_access(self.db, str(other['_id']), self.owner))

    def test_hotel_success_and_standalone_upgrade_coexist(self):
        order = self.create('hotel').json(); self.finish(order)
        self.assertEqual(payment_service.plus_source(self.db, self.id, self.owner), 'booking')
        upgrade = self.client.post('/api/payments/orders', json={'trip_id': self.id}, headers=self.headers).json()
        self.assertEqual(upgrade['amount'], 49900); self.assertEqual(len(self.db.payments.docs), 2)

    def test_success_preserves_progress_api_access(self):
        self.finish(self.create().json())
        result = self.client.post('/api/trips/' + self.id + '/execution_state', json={'expected_revision': 1, 'execution_state': {}}, headers=self.headers)
        self.assertEqual(result.status_code, 200)

    def test_failure_cancel_retry_and_terminal_success(self):
        order = self.create().json()
        self.simulate(order, 'failure'); self.time += timedelta(seconds=3)
        self.assertEqual(self.client.get('/api/payments/orders/' + order['id'], headers=self.headers).json()['status'], 'failed')
        self.assertFalse(payment_service.plus_access(self.db, self.id, self.owner))
        self.assertEqual(self.simulate(order, 'cancel').json()['status'], 'cancelled')
        self.finish(order)
        for outcome in ('failure', 'cancel', 'success'):
            self.assertEqual(self.simulate(order, outcome).json()['status'], 'succeeded')

    def test_delayed_duplicate_attempt_and_new_client(self):
        order = self.create().json(); self.simulate(order, 'delayed'); self.simulate(order, 'success')
        self.time += timedelta(seconds=19)
        self.client = TestClient(app)
        result = self.client.get('/api/payments/orders/' + order['id'], headers=self.headers).json()
        self.assertEqual(result['status'], 'pending'); self.assertEqual(len(result['attempts']), 1)
        self.time += timedelta(seconds=1)
        self.assertEqual(self.client.get('/api/payments/orders/' + order['id'], headers=self.headers).json()['status'], 'succeeded')

    def test_revision_changed_before_attempt_requires_new_review(self):
        order = self.create().json(); self.db.trips.docs[0]['revision'] = 2
        self.assertEqual(self.simulate(order).status_code, 409)
        self.assertEqual(self.create().status_code, 409)
        reviewed = self.create(expected_revision=2).json()
        self.assertEqual(reviewed['id'], order['id']); self.assertEqual(self.simulate(reviewed).status_code, 200)

    def test_date_or_price_changes_create_new_quote_keep_old_snapshot(self):
        original = self.create('hotel').json()
        self.finish(original)
        self.db.trips.docs[0].update(end_date='2026-12-04', revision=2)
        fresh = self.create('hotel', expected_revision=2).json()
        self.assertNotEqual(fresh['id'], original['id'])
        result = self.client.get('/api/bookings/orders/' + original['id'] + '/confirmation', headers=self.headers).json()
        self.assertEqual(result['booking'], original['booking']); self.assertTrue(result['booking_notice'])

    def test_changed_selection_notice(self):
        order = self.create().json(); self.finish(order)
        self.db.trips.docs[0]['selections']['flight_id'] = 'f2'
        result = self.client.get('/api/bookings/orders/' + order['id'] + '/confirmation', headers=self.headers).json()
        self.assertTrue(result['booking_notice']); self.assertEqual(result['booking']['option_id'], 'f1')

    def test_pending_deleted_trip_cancels_and_successful_confirmation_survives(self):
        paid = self.create().json(); self.finish(paid)
        pending = self.create('hotel').json(); self.simulate(pending)
        self.db.trips.docs.clear(); self.time += timedelta(seconds=3)
        self.assertEqual(self.client.get('/api/payments/orders/' + pending['id'], headers=self.headers).json()['status'], 'cancelled')
        result = self.client.get('/api/bookings/orders/' + paid['id'] + '/confirmation', headers=self.headers)
        self.assertEqual(result.status_code, 200); self.assertFalse(result.json()['reservation_made'])
        self.assertEqual(result.json()['money_charged'], 0)

    def test_confirmation_requires_success_and_booking_product(self):
        order = self.create().json()
        self.assertEqual(self.client.get('/api/bookings/orders/' + order['id'] + '/confirmation', headers=self.headers).status_code, 409)
        self.finish(order)
        self.assertEqual(self.client.get('/api/payments/orders/' + order['id'] + '/receipt', headers=self.headers).status_code, 200)

    def test_history_and_all_routes_require_ownership(self):
        order = self.create().json(); self.finish(order)
        self.client.post('/api/payments/orders', json={'trip_id': self.id}, headers=self.headers)
        result = self.client.get('/api/bookings/history', headers=self.headers).json()
        self.assertEqual(len(result), 1)
        self.assertEqual(self.client.get('/api/bookings/history').status_code, 401)
        other = str(ObjectId()); self.db.users.insert_one({'_id': ObjectId(other)})
        self.headers = {'Authorization': 'Bearer ' + auth_utils.generate_token('other@example.com', other)}
        self.assertEqual(self.create().status_code, 404)
        self.assertEqual(self.simulate(order).status_code, 404)
        self.assertEqual(self.client.get('/api/bookings/orders/' + order['id'] + '/confirmation', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get('/api/bookings/history', headers=self.headers).json(), [])

    def test_duplicate_key_race_recovers_same_booking(self):
        original = self.db.payments.insert_one
        def race(doc):
            original(dict(doc)); raise DuplicateKeyError('another request won')
        with patch.object(self.db.payments, 'insert_one', race): result = self.create()
        self.assertEqual(result.status_code, 200); self.assertEqual(len(self.db.payments.docs), 1)

    def test_index_upgrade_preserves_data_and_unrelated_indexes(self):
        collection = MagicMock()
        collection.index_information.return_value = {'user_id_1_trip_id_1_product_1': {'unique': True, 'key': [('user_id', 1), ('trip_id', 1), ('product', 1)]}, 'custom': {'key': [('amount', 1)]}}
        booking_service.setup_indexes(SimpleNamespace(payments=collection))
        collection.drop_index.assert_called_once_with('user_id_1_trip_id_1_product_1')
        self.assertEqual(collection.create_index.call_count, 3)
        collection.delete_many.assert_not_called()

    def test_trip_status_prioritizes_success_over_failed_quotes(self):
        paid = self.create().json(); self.finish(paid)
        duplicate = copy.deepcopy(self.db.payments.docs[0]); duplicate['_id'] = ObjectId()
        duplicate.update(status='failed', created_at=self.time + timedelta(seconds=1), booking_key='failed-quote')
        self.db.payments.docs.append(duplicate)
        response = self.client.get('/api/bookings/status', params={'trip_id': self.id}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['current'][0]['id'], paid['id'])
        self.assertEqual(response.json()['current'][0]['status'], 'succeeded')

    def test_status_is_owned_and_not_truncated_by_other_trip_history(self):
        order = self.create().json(); self.finish(order)
        for index in range(110):
            self.db.payments.insert_one(dict(user_id=self.owner, trip_id=str(ObjectId()), product='trip_plus', created_at=self.time + timedelta(seconds=index), status='created'))
        response = self.client.get('/api/bookings/status', params={'trip_id': self.id}, headers=self.headers)
        self.assertEqual(len(response.json()['current']), 1)
        self.assertEqual(self.client.get('/api/bookings/status', params={'trip_id': self.id}).status_code, 401)
        self.assertEqual(self.client.get('/api/bookings/status', params={'trip_id': str(ObjectId())}, headers=self.headers).status_code, 404)

    def test_paid_price_changes_reuse_original_booking_without_downgrade(self):
        original = self.create('hotel', rooms=2).json(); self.finish(original)
        before = copy.deepcopy(self.db.payments.docs)
        self.db.trips.docs[0]['hotels'][0]['price_per_night'] = 5000
        self.db.trips.docs[0]['revision'] = 2
        repeated = self.create('hotel', rooms=2, expected_revision=2).json()
        self.assertEqual(repeated['id'], original['id']); self.assertEqual(repeated['amount'], original['amount'])
        self.assertEqual(self.db.payments.docs, before)
        self.assertEqual(self.client.get('/api/bookings/status', params={'trip_id': self.id}, headers=self.headers).json()['current'][0]['status'], 'succeeded')

    def test_status_returns_previous_dates_separately(self):
        original = self.create().json(); self.finish(original)
        self.db.trips.docs[0]['end_date'] = '2026-12-04'
        status = self.client.get('/api/bookings/status', params={'trip_id': self.id}, headers=self.headers).json()
        self.assertEqual(status['current'], []); self.assertEqual(status['previous'][0]['id'], original['id'])

    def test_sample_and_discovered_option_statuses_are_separate(self):
        self.db.trips.docs[0]['flights'] = []
        order = self.create(source='sample', option_id='sample-flight').json(); self.finish(order)
        status = self.client.get('/api/bookings/status', params={'trip_id': self.id}, headers=self.headers).json()
        self.assertEqual(status['current'][0]['booking']['source'], 'sample')

    def test_legacy_current_hotel_does_not_rebuild_schedule_even_when_active(self):
        trip = self.db.trips.docs[0]; trip.pop('revision'); trip.pop('selections')
        trip['route_details'] = {'day_by_day_route': [{'day': 1, 'stops': [{'name': 'Airport', 'type': 'airport'}, {'name': 'Test hotel', 'type': 'hotel'}]}]}
        trip['execution_state'] = {'is_active': True, 'activity_log': {'old-id': {'status': 'completed'}}}
        before = copy.deepcopy(trip)
        with patch('app.services.itinerary_edit_service.reflow_day', side_effect=AssertionError('must not reflow')):
            result = self.client.post('/api/trips/' + self.id + '/selections', json={'expected_revision': 1, 'hotel_id': 'h1'}, headers=self.headers)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.db.trips.docs[0]['route_details'], before['route_details'])
        self.assertEqual(self.db.trips.docs[0]['execution_state'], before['execution_state'])
        order = self.create('hotel', expected_revision=2)
        self.assertEqual(order.status_code, 200, order.text)

    def test_legacy_alternative_hotel_has_readable_error_and_no_mutation(self):
        trip = self.db.trips.docs[0]; trip['route_details'] = {'day_by_day_route': [{'day': 1, 'stops': [{'name': 'Old stop'}]}]}
        before = copy.deepcopy(trip)
        response = self.client.post('/api/trips/' + self.id + '/selections', json={'expected_revision': 1, 'hotel_id': 'h2'}, headers=self.headers)
        self.assertEqual(response.status_code, 409)
        self.assertIn('older itinerary needs updated timings', response.json()['detail'])
        self.assertEqual(self.db.trips.docs[0], before)

    def test_active_trip_can_book_current_hotel_but_not_switch(self):
        self.db.trips.docs[0]['execution_state']['is_active'] = True
        self.assertEqual(self.create('hotel').status_code, 200)
        response = self.client.post('/api/trips/' + self.id + '/selections', json={'expected_revision': 1, 'hotel_id': 'h2'}, headers=self.headers)
        self.assertEqual(response.status_code, 409)

    def test_unhandled_booking_error_keeps_json_cors_and_reference(self):
        headers = dict(self.headers, Origin='http://localhost:3000')
        with patch.object(booking_service, 'create_order', side_effect=KeyError('secret-internal-value')):
            response = self.client.post('/api/bookings/orders', json=dict(trip_id=self.id, kind='hotel', source='discovered', option_id='h1', expected_revision=1), headers=headers)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers.get('access-control-allow-origin'), 'http://localhost:3000')
        self.assertTrue(response.headers.get('X-Request-ID'))
        self.assertEqual(response.json()['request_id'], response.headers['X-Request-ID'])
        self.assertNotIn('secret-internal-value', response.text)


if __name__ == '__main__':
    unittest.main()
