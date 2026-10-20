"""Offline V2 engine, routing and authenticated API safety checks."""
import copy
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
import unittest
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from security_consistency_tests import Collection, sample_trip
import security_consistency_tests as security
from app.services import road_routing
from app.services.reroute_v2 import preview, apply, purpose

NOW = datetime(2026, 10, 17, 3, tzinfo=timezone.utc)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.trip = sample_trip()
        self.trip['timezone'] = 'Asia/Kolkata'
        self.trip['attractions'] = [dict(name='Gallery', type='attraction', lat=17.401, lon=78.4, opening_hours='24 hours', rating=4, entrance_fee=200)]
        self.network = patch.object(road_routing, '_request', return_value=None)
        self.network.start(); self.addCleanup(self.network.stop)
        discovery = patch('app.ai.agents.attraction_agent.discover_via_serpapi', return_value=[])
        discovery.start(); self.addCleanup(discovery.stop)

    def make(self, trigger='skip', **kwargs):
        return preview(self.trip, 1, 'a', trigger, 'driving', now=NOW, **kwargs)

    def test_preview_does_not_mutate_and_has_review_options(self):
        before = copy.deepcopy(self.trip)
        result = self.make()
        self.assertEqual(self.trip, before)
        self.assertGreaterEqual(len(result['options']), 2)
        self.assertTrue(result['options'][0]['recommended'])
        self.assertEqual(result['options'][-1]['kind'], 'skip_only')

    def test_delay_keeps_target_and_uses_saved_start(self):
        result = self.make('delay', delay=30)
        stops = result['options'][0]['proposed_stops']
        self.assertEqual([s['id'] for s in stops], ['a', 'b'])
        self.assertEqual(stops[0]['start_time'], '09:30')
        self.assertEqual(stops[0]['end_time'], '10:30')
        self.assertGreaterEqual(stops[1]['transition_buffer_minutes'], 5)

    def test_legacy_skip_only_preserves_snapshot(self):
        self.trip.pop('timezone')
        result = self.make()
        self.assertEqual([o['kind'] for o in result['options']], ['skip_only'])
        self.assertEqual(result['options'][0]['proposed_stops'], result['original_stops'])
        self.assertEqual(self.make('delay')['options'], [])

    def test_historical_day_rejects_replanning(self):
        self.trip['route_details']['day_by_day_route'][0]['date'] = '2020-01-01'
        with self.assertRaisesRegex(ValueError, 'Historical'):
            self.make('delay')
        self.assertEqual([o['kind'] for o in self.make()['options']], ['skip_only'])

    def test_completed_target_cannot_change(self):
        self.trip['execution_state']['activity_log']['a'] = dict(status='completed', activity_id='a')
        with self.assertRaisesRegex(ValueError, 'unfinished'):
            self.make()

    def test_fixed_target_cannot_skip(self):
        self.trip['route_details']['day_by_day_route'][0]['stops'][0]['type'] = 'hotel'
        self.assertEqual(self.make()['options'], [])

    def test_structured_type_beats_description(self):
        self.assertEqual(purpose(dict(type='attraction', title='Old hotel museum', description='Lunch available')), 'attraction')

    def test_meal_replacements_are_meals(self):
        self.trip['route_details']['day_by_day_route'][0]['stops'][0]['type'] = 'restaurant'
        self.trip['restaurants'] = [dict(name='Cafe', lat=17.4, lon=78.4)]
        result = self.make('closed')
        self.assertEqual(purpose(result['options'][0]['replacement_activity']), 'meal')
        self.assertIsNone(result['options'][0]['impact']['price_difference'])

    def test_gps_not_persisted_and_stale_fix_disclosed(self):
        result = self.make(location=dict(lat=1, lon=2, timestamp=NOW.isoformat(), accuracy=10))
        self.assertIn('Location not used', result['warnings'][0])
        self.assertNotIn('current_location', result)
        self.assertNotIn('accuracy', str(result))

    def test_day_cutoff_and_closed_hours_reject_replacements(self):
        self.trip['attractions'][0]['opening_hours'] = 'Closed'
        result = self.make()
        self.assertNotIn('replacement', [o['kind'] for o in result['options']])
        self.assertGreater(result['rejection_reasons'].get('opening_window', 0), 0)

    def test_discovery_is_used_only_after_saved_candidates_fail(self):
        self.trip['attractions'][0]['opening_hours'] = 'Closed'
        alternative = dict(name='New gallery', type='attraction', lat=17.402, lon=78.4, opening_hours='24 hours')
        with patch('app.ai.agents.attraction_agent.discover_via_serpapi', return_value=[alternative]) as discovery:
            result = self.make()
        self.assertEqual(result['options'][0]['replacement_activity']['name'], 'New gallery')
        self.assertEqual(discovery.call_count, 1)

    def test_skip_accept_preserves_route_and_duplicate_conflicts(self):
        proposal = self.make()
        db = SimpleNamespace(trips=Collection([self.trip]))
        saved = dict(proposal=proposal, revision=1, proposal_id='p')
        before = copy.deepcopy(db.trips.docs[0]['route_details'])
        result = apply(db, str(self.trip['_id']), 'owner', saved, proposal['options'][-1]['id'], 1)
        self.assertEqual(db.trips.docs[0]['route_details'], before)
        self.assertEqual(result['execution_state']['activity_log']['a']['status'], 'skipped')
        with self.assertRaises(Exception):
            apply(db, str(self.trip['_id']), 'owner', saved, proposal['options'][-1]['id'], 1)

    def test_tampered_option_rejected(self):
        proposal = self.make()
        with self.assertRaises(Exception):
            apply(SimpleNamespace(trips=Collection([self.trip])), str(self.trip['_id']), 'owner', dict(proposal=proposal, revision=1), 'invented', 1)

    def test_walking_without_provider_is_honest_fallback(self):
        with patch.dict('os.environ', {'ROUTING_WALKING_URL': ''}):
            routing = road_routing.RoutingSession('walking')
            routing.batch([(17.4, 78.4), (17.41, 78.4)])
            result = routing.leg((17.4, 78.4), (17.41, 78.4), True)
            self.assertEqual(result['source'], 'distance_estimate')
            self.assertEqual(result['geometry'], [])

    def test_delay_apply_preserves_progress_bookings_and_other_days(self):
        self.trip['route_details']['day_by_day_route'].append(dict(day=2, date='2026-12-02', stops=[]))
        self.trip['selections'] = dict(flight_id='f1', hotel_id='h1')
        proposal = self.make('delay')
        db = SimpleNamespace(trips=Collection([self.trip]))
        result = apply(db, str(self.trip['_id']), 'owner', dict(proposal=proposal, revision=1, proposal_id='delay'), proposal['options'][0]['id'], 1)
        self.assertNotIn('a', result['execution_state']['activity_log'])
        self.assertEqual(result['route_details']['day_by_day_route'][1], self.trip['route_details']['day_by_day_route'][1])
        self.assertEqual(db.trips.docs[0]['selections'], self.trip['selections'])

    def test_completed_tail_and_fixed_appointment_reject_unsafe_delay(self):
        self.trip['execution_state']['activity_log']['b'] = dict(status='completed', activity_id='b')
        result = self.make('delay', delay=60)
        self.assertEqual(result['options'], [])
        self.assertIn('fixed_or_completed_commitment', result['rejection_reasons'])

    def test_no_shortening_or_midnight_extension(self):
        self.trip['bedtime'] = '10:15'
        result = self.make('delay')
        self.assertEqual(result['options'], [])
        self.assertIn('day_cutoff', result['rejection_reasons'])

    def test_must_visit_cannot_be_removed(self):
        self.trip['must_visit_places'] = ['Museum']
        self.assertEqual(self.make()['options'], [])
        self.assertEqual(len(self.make('delay')['options']), 1)

    def test_ambiguous_dst_date_cannot_reschedule(self):
        self.trip['timezone'] = 'America/New_York'
        self.trip['route_details']['day_by_day_route'][0]['date'] = '2026-11-01'
        self.trip['route_details']['day_by_day_route'][0]['stops'][0].update(start_time='01:10', end_time='01:40')
        self.assertEqual([o['kind'] for o in self.make()['options']], ['skip_only'])

    def test_invalid_explicit_stop_zone_cannot_be_overridden_by_trip_zone(self):
        self.trip['route_details']['day_by_day_route'][0]['stops'][0]['timezone'] = 'Invalid/Zone'
        self.assertEqual([o['kind'] for o in self.make()['options']], ['skip_only'])

    def test_more_than_twelve_candidates_are_shortlisted_and_deduplicated(self):
        self.trip['attractions'] = [dict(name=f'Place {i}', lat=17.4+i/100, lon=78.4) for i in range(30)]
        result = self.make()
        self.assertLessEqual(len(result['options']), 3)
        self.assertEqual(sum(bool(o['recommended']) for o in result['options']), 1)

    def test_current_day_uses_server_time_not_browser_time(self):
        self.trip['route_details']['day_by_day_route'][0]['date'] = '2026-10-17'
        later = datetime(2026, 10, 17, 8, tzinfo=timezone.utc)  # 13:30 in destination.
        result = preview(self.trip, 1, 'a', 'delay', 'driving', 15, now=later)
        first = result['options'][0]['proposed_stops'][0]
        self.assertGreaterEqual(first['start_time'], '13:30')


class RoutingTests(unittest.TestCase):
    def setUp(self):
        road_routing._cache.clear(); road_routing._pairs.clear(); road_routing._inflight.clear()

    def test_batch_pair_cache_is_shared_across_different_day_candidate_sets(self):
        points = [(1., 2.), (1.01, 2.), (1.02, 2.)]
        data = dict(code='Ok', durations=[[0, 120, 240], [120, 0, 120], [240, 120, 0]], distances=[[0, 1000, 2000], [1000, 0, 1000], [2000, 1000, 0]])
        with patch.object(road_routing, '_request', return_value=data) as request:
            one = road_routing.RoutingSession(); one.batch(points)
            two = road_routing.RoutingSession(); two.batch(points[:2])
            self.assertEqual(request.call_count, 1)
            self.assertEqual(two.leg(*points[:2])['source'], 'road')
            self.assertTrue(two.leg(*points[:2])['cached'])

    def test_invalid_coordinates_never_start_provider_work(self):
        self.assertIsNone(road_routing.coords(dict(lat=float('nan'), lon=0)))
        self.assertIsNone(road_routing.coords(dict(lat=91, lon=0)))
        with patch.object(road_routing, '_request') as request:
            routing = road_routing.RoutingSession(); routing.batch([None]); routing.leg(None, None, True)
            request.assert_not_called()

    def test_public_car_dataset_cannot_be_presented_as_walking(self):
        with patch.dict('os.environ', dict(ROUTING_WALKING_URL='https://router.project-osrm.org', ROUTING_WALKING_PROFILE='foot')):
            self.assertEqual(road_routing.configuration('walking')[0], '')

    def test_identical_requests_coalesce_and_cache_provider_failures(self):
        import anyio
        calls = []
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def get(self, url):
                calls.append(url); await anyio.sleep(.03)
                return SimpleNamespace(raise_for_status=lambda: None, json=lambda: dict(code='NoRoute'))
        with patch.object(road_routing.httpx, 'AsyncClient', Client):
            with ThreadPoolExecutor(max_workers=2) as executor:
                work = [executor.submit(road_routing._request, 'https://local.test/route', time.monotonic()+2) for _ in range(2)]
                self.assertEqual([w.result() for w in work], [None, None])
            self.assertIsNone(road_routing._request('https://local.test/route', time.monotonic()+2))
        self.assertEqual(len(calls), 1)

    def test_absolute_routing_deadline_cancels_slow_provider(self):
        import anyio
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def get(self, url): await anyio.sleep(1)
        start = time.monotonic()
        with patch.object(road_routing.httpx, 'AsyncClient', Client):
            self.assertIsNone(road_routing._request('https://local.test/slow', start+.05))
        self.assertLess(time.monotonic()-start, .5)

    def test_public_requests_are_serialized_at_least_one_second_apart(self):
        calls = []
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def get(self, url):
                calls.append(time.monotonic())
                return SimpleNamespace(raise_for_status=lambda: None, json=lambda: dict(code='Ok'))
        road_routing._last_public = 0
        with patch.object(road_routing.httpx, 'AsyncClient', Client):
            with ThreadPoolExecutor(max_workers=2) as executor:
                work = [executor.submit(road_routing._request, f'https://router.project-osrm.org/route/{i}', time.monotonic()+3) for i in range(2)]
                [w.result() for w in work]
        self.assertEqual(len(calls), 2)
        self.assertGreaterEqual(calls[1]-calls[0], .99)


class ApiTests(unittest.TestCase):
    setUp = security.SecurityTests.setUp
    def test_v2_preview_cancel_and_apply_server_option(self):
        trip_id = str(self.trip['_id'])
        before = copy.deepcopy(self.db.trips.docs[0])
        result = self.client.post(f'/api/trips/{trip_id}/reroute/preview', headers=self.headers,
            json=dict(version=2, day_number=1, target_activity_id='a', trigger='skip', expected_revision=1))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.db.trips.docs[0], before)
        proposal = result.json()
        payload = dict(version=2, proposal_id=proposal['proposal_id'], option_id=proposal['options'][0]['id'], expected_revision=1,
            proposed_stops=[dict(id='tampered')])
        accepted = self.client.post(f'/api/trips/{trip_id}/reroute/apply', headers=self.headers, json=payload)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(self.db.trips.docs[0]['route_details'], before['route_details'])
        self.assertEqual(self.client.post(f'/api/trips/{trip_id}/reroute/apply', headers=self.headers, json=payload).status_code, 409)

    def test_directions_is_owned_but_free(self):
        self.db.payments.docs = []
        trip_id = str(self.trip['_id'])
        with patch.object(road_routing, '_request', return_value=None):
            result = self.client.get(f'/api/trips/{trip_id}/directions?day_number=1', headers=self.headers)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['legs'][0]['source'], 'distance_estimate')
        self.assertEqual(self.client.get(f'/api/trips/{trip_id}/directions?day_number=1').status_code, 401)

    def test_v2_tampered_option_expiry_and_entitlements(self):
        trip_id = str(self.trip['_id'])
        preview_url = f'/api/trips/{trip_id}/reroute/preview'
        payload = dict(version=2, day_number=1, target_activity_id='a', trigger='skip', expected_revision=1)
        result = self.client.post(preview_url, headers=self.headers, json=payload).json()
        accept = dict(version=2, proposal_id=result['proposal_id'], option_id='invented', expected_revision=1)
        self.assertEqual(self.client.post(f'/api/trips/{trip_id}/reroute/apply', headers=self.headers, json=accept).status_code, 400)
        self.db.reroute_proposals.docs[0]['expires_at'] = datetime.utcnow()-timedelta(seconds=1)
        accept['option_id'] = result['options'][0]['id']
        self.assertEqual(self.client.post(f'/api/trips/{trip_id}/reroute/apply', headers=self.headers, json=accept).status_code, 409)
        self.db.payments.docs = []
        self.assertEqual(self.client.post(preview_url, headers=self.headers, json=payload).status_code, 402)

    def test_stale_revision_and_non_owner_directions_are_rejected(self):
        trip_id = str(self.trip['_id'])
        result = self.client.post(f'/api/trips/{trip_id}/reroute/preview', headers=self.headers,
            json=dict(version=2, day_number=1, target_activity_id='a', trigger='skip', expected_revision=999))
        self.assertEqual(result.status_code, 409)
        self.db.trips.docs[0]['user_id'] = 'someone-else'
        self.assertEqual(self.client.get(f'/api/trips/{trip_id}/directions?day_number=1', headers=self.headers).status_code, 404)


if __name__ == '__main__':
    unittest.main()
