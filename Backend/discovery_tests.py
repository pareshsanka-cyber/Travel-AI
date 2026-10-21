"""Offline quota, identity, refresh and ownership regressions."""
import copy
import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch
import httpx
import booking_tests
from app.services import discovery_status as ds, travel_discovery as td
from app.services.travel_offer_identity import stable_offer_id
from app.services.trip_service import serialize_trip


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        booking_tests.BookingTests.setUp(self)
        ds._cache.clear(); td._requests.clear()
        key = patch.dict(os.environ, SERPAPI_API_KEY='offline-test-key'); key.start(); self.addCleanup(key.stop)
        guard = patch.object(td, 'search_guard', return_value=None); guard.start(); self.addCleanup(guard.stop)

    def refresh(self, product='hotel', revision=1):
        return self.client.post(f'/api/trips/{self.id}/travel-options/refresh', headers=self.headers,
                                json={'product': product, 'expected_revision': revision})

    def test_account_quota_cache_and_simultaneous_checks(self):
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = httpx.Response(200, json={'total_searches_left': 0})
        with patch.object(ds.httpx, 'Client', return_value=client):
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(lambda _: ds.account_status(), range(6)))
        self.assertEqual(client.get.call_count, 1)
        self.assertTrue(all(item['failure_reason'] == 'quota_exhausted' for item in results))

    def test_account_cache_expires_and_recovers(self):
        client = MagicMock(); client.__enter__.return_value = client
        client.get.side_effect = [httpx.Response(200, json={'total_searches_left': 0}), httpx.Response(200, json={'total_searches_left': 20})]
        with patch.object(ds.httpx, 'Client', return_value=client), patch.object(ds.time, 'monotonic', return_value=10):
            self.assertEqual(ds.account_status()['failure_reason'], 'quota_exhausted')
        with patch.object(ds.httpx, 'Client', return_value=client), patch.object(ds.time, 'monotonic', return_value=71):
            self.assertIsNone(ds.account_status()['failure_reason'])
        self.assertEqual(client.get.call_count, 2)

    def test_classification_never_echoes_provider_errors(self):
        for code, error, expected in [(401, 'api_key=secret', 'invalid_credentials'), (429, '', 'rate_limited'),
            (503, '', 'provider_unavailable'), (400, 'bad dates https://example/?api_key=secret', 'invalid_request'),
            (429, 'You have run out of searches.', 'quota_exhausted')]:
            reason = ds.classify_response(httpx.Response(code, json={'error': error}))
            self.assertEqual(reason, expected); self.assertNotIn('secret', str(ds.status(reason)))

    def test_missing_credentials_and_connection_failure(self):
        with patch.dict(os.environ, SERPAPI_API_KEY=''):
            self.assertEqual(ds.account_status()['failure_reason'], 'missing_credentials')
        with patch.object(ds.httpx, 'Client', side_effect=httpx.ConnectError('sensitive URL')):
            self.assertEqual(ds.account_status()['failure_reason'], 'connection_failure')

    def test_zero_credits_skip_flight_hotel_and_maps_searches(self):
        from app.ai.agents.flight_agent import fetch_real_flights_serpapi, _FLIGHT_CACHE
        from app.ai.agents.hotel_agent import hotel_node
        _FLIGHT_CACHE.clear()
        with patch.object(ds, 'account_status', return_value=ds.status('quota_exhausted')), patch.object(httpx, 'get') as search:
            flight = fetch_real_flights_serpapi('Bengaluru', start_date='2090-12-01')
            hotel = hotel_node(self.trip)
        search.assert_not_called()
        self.assertEqual(flight['metadata']['failure_reason'], 'quota_exhausted')
        self.assertEqual(hotel['hotel_metadata']['failure_reason'], 'quota_exhausted')

    def test_safe_serialization_of_legacy_error(self):
        self.trip['flight_metadata'] = {'data_status': 'error', 'error': 'https://x/?api_key=secret', 'message': 'api_key=secret'}
        self.assertNotIn('secret', str(serialize_trip(self.trip)['flight_metadata']))

    def test_status_endpoint_owns_trip(self):
        with patch.object(td, 'account_status', return_value=ds.status('quota_exhausted')):
            response = self.client.get(f'/api/trips/{self.id}/discovery-status', headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['provider']['failure_reason'], 'quota_exhausted')
            self.db.trips.docs[0]['user_id'] = 'someone-else'
            self.assertEqual(self.client.get(f'/api/trips/{self.id}/discovery-status', headers=self.headers).status_code, 404)
            self.assertEqual(self.refresh().status_code, 404)

    def test_quota_failure_preserves_results_itinerary_costs_progress(self):
        before = copy.deepcopy(self.db.trips.docs[0])
        with patch('app.ai.agents.hotel_agent.hotel_node', return_value={'hotel_metadata': dict(ds.status('quota_exhausted'), data_status='error')}):
            response = self.refresh()
        self.assertEqual(response.status_code, 200)
        after = self.db.trips.docs[0]
        for key in before:
            if key != 'revision': self.assertEqual(after[key], before[key], key)

    def test_empty_saved_trip_receives_choices_without_selection(self):
        self.db.trips.docs[0].update(flights=[], hotels=[], nearby_hotels=[], selections={})
        fresh = {'hotels': [{'name': 'Real property', 'address': 'Bengaluru', 'price_per_night': 2000}],
                 'hotel_metadata': {'data_status': 'search_results'}}
        with patch('app.ai.agents.hotel_agent.hotel_node', return_value=fresh):
            response = self.refresh()
        self.assertEqual(response.status_code, 200)
        trip = response.json()['trip']
        self.assertIsNone(trip['selections']['hotel_id'])
        self.assertIsNone(trip['selections']['flight_id'])
        self.assertTrue(trip['hotels'][0]['id'].startswith('hotel-'))
        self.assertEqual(trip['route_details'], serialize_trip(self.trip)['route_details'])

    def test_refresh_keeps_selected_and_purchased_quotes_and_legacy_ids(self):
        old = self.db.trips.docs[0]
        old['hotels'] = [{'name': 'Selected property', 'address': 'Bengaluru', 'price_per_night': 100},
                         {'id': 'paid', 'name': 'Purchased property', 'address': 'Bengaluru', 'price_per_night': 200}]
        old['selections'] = {'hotel_id': 'hotels-0', 'flight_id': 'f1'}
        self.db.payments.insert_one({'user_id': self.owner, 'trip_id': self.id, 'product': 'hotel_demo', 'status': 'succeeded',
            'booking': {'source': 'discovered', 'option_id': 'paid'}})
        orders = copy.deepcopy(self.db.payments.docs)
        found = {'hotels': [dict(item, price_per_night=999) for item in reversed(old['hotels'])], 'hotel_metadata': {'data_status': 'search_results'}}
        with patch('app.ai.agents.hotel_agent.hotel_node', return_value=found):
            result = self.refresh().json()['trip']
        self.assertEqual([(h['id'], h['price_per_night']) for h in result['hotels']], [('hotels-0', 100), ('paid', 200)])
        self.assertEqual(self.db.payments.docs, orders)

    def test_reordered_flight_results_do_not_reuse_wrong_ids(self):
        old = self.db.trips.docs[0]
        old['flights'] = [{'id': 'pos-1', 'flight_no': 'A1', 'departure_airport': 'HYD', 'arrival_airport': 'BLR',
            'departure_date': '2026-12-01', 'departure_time': '08:00', 'price': 100},
            {'id': 'pos-2', 'flight_no': 'A2', 'departure_airport': 'HYD', 'arrival_airport': 'BLR',
            'departure_date': '2026-12-01', 'departure_time': '09:00', 'price': 200}]
        old['selections']['flight_id'] = 'pos-1'
        incoming = [dict(item, id=f'new-{i}', price=500) for i, item in enumerate(reversed(old['flights']))]
        with patch('app.ai.agents.flight_agent.flight_node', return_value={'flights': incoming, 'flight_metadata': {'data_status': 'search_results'}}):
            result = self.refresh('flight').json()['trip']
        self.assertEqual([(f['id'], f['flight_no'], f['price']) for f in result['flights']], [('pos-1', 'A1', 100), ('pos-2', 'A2', 500)])

    def test_stable_identity_ignores_quote_and_result_position(self):
        first = {'name': 'Real hotel', 'property_token': 'property-123', 'price': 100}
        self.assertEqual(stable_offer_id('hotel', first), stable_offer_id('hotel', dict(first, price=900, id='position-2')))

    def test_duplicate_refresh_reuses_search_and_revision(self):
        found = {'hotels': [], 'hotel_metadata': dict(ds.status('empty_results'), data_status='no_results')}
        with patch('app.ai.agents.hotel_agent.hotel_node', return_value=found) as search:
            a = self.refresh(); b = self.refresh()
        self.assertEqual(a.status_code, 200); self.assertEqual(b.json(), a.json())
        self.assertEqual(search.call_count, 1)

    def test_stale_and_tampered_requests_do_not_search(self):
        with patch('app.ai.agents.hotel_agent.hotel_node') as search:
            self.assertEqual(self.refresh(revision=9).status_code, 409)
            response = self.client.post(f'/api/trips/{self.id}/travel-options/refresh', headers=self.headers,
                json={'product': 'hotel', 'expected_revision': 1, 'price': 1})
            self.assertEqual(response.status_code, 422)
        search.assert_not_called()

    def test_revision_change_during_search_does_not_write_options(self):
        def changed(_):
            self.db.trips.docs[0]['revision'] = 2
            return {'hotels': [{'name': 'New hotel'}], 'hotel_metadata': {'data_status': 'search_results'}}
        with patch('app.ai.agents.hotel_agent.hotel_node', side_effect=changed):
            self.assertEqual(self.refresh().status_code, 409)
        self.assertEqual(self.db.trips.docs[0]['hotels'], self.trip['hotels'])

    def test_refresh_known_quota_does_not_return_cached_flight_as_live_search(self):
        with patch.object(td, 'search_guard', return_value=ds.status('quota_exhausted')), patch('app.ai.agents.flight_agent.flight_node') as search:
            response = self.refresh('flight')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['availability']['failure_reason'], 'quota_exhausted')
        search.assert_not_called()

    def test_invalid_hotel_credentials_do_not_trigger_maps_fallback(self):
        from app.ai.agents import hotel_agent
        with patch.object(hotel_agent, 'search_guard', return_value=None), patch.object(hotel_agent, 'resolve_destination_coordinates', return_value={'lat': 12.97, 'lon': 77.59}), \
                patch.object(httpx, 'get', return_value=httpx.Response(401, json={'error': 'Invalid API key: secret'})) as network:
            result = hotel_agent.hotel_node(self.trip)
        self.assertEqual(network.call_count, 1)
        self.assertEqual(result['hotel_metadata']['failure_reason'], 'invalid_credentials')
        self.assertNotIn('secret', str(result))

    def test_shared_concurrent_refresh_calls_only_discover_once(self):
        started, release = threading.Event(), threading.Event()
        def search(_):
            started.set(); release.wait(3)
            return {'hotels': [], 'hotel_metadata': {'data_status': 'no_results'}}
        with patch('app.ai.agents.hotel_agent.hotel_node', side_effect=search) as provider, ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(td.refresh, self.db, self.id, self.owner, 'hotel', 1)
            self.assertTrue(started.wait(2))
            second = pool.submit(td.refresh, self.db, self.id, self.owner, 'hotel', 1)
            release.set()
            self.assertEqual(first.result(), second.result())
        self.assertEqual(provider.call_count, 1)

    def test_network_logs_redact_credentials(self):
        import logging
        record = logging.LogRecord('httpx', logging.INFO, '', 1, 'GET %s', ('https://serpapi.com/search?api_key=offline-test-key&q=test',), None)
        ds._CredentialFilter().filter(record)
        self.assertNotIn('offline-test-key', record.getMessage())
        self.assertIn('[redacted]', record.getMessage())


if __name__ == '__main__':
    unittest.main()
