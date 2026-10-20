"""Deterministic reroute edge cases; no provider calls or saved-account writes."""
import copy
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.reroute_service import generate_reroute_proposal, apply_reroute_proposal
from app.services.trip_consistency import validate_reroute
from app.ai.agents.route_agent import estimate_transit, parse_hhmm_to_minutes
from dynamic_reroute_tests import MockDB


def trip_fixture():
    stops = [
        dict(id='before', name='First visit', type='attraction', start_time='09:00', end_time='10:00', lat=17.4, lon=78.4),
        dict(id='skip', name='Airport transfer', type='airport', start_time='11:00', end_time='12:00', lat=17.4, lon=78.4),
        dict(id='stay', name='Planned hotel', type='hotel', start_time='14:00', end_time='16:00', lat=17.4, lon=78.4),
    ]
    return dict(id='reliable-route', user_id='owner', destination='Hyderabad', destination_timezone='Asia/Kolkata',
        revision=1, bedtime='22:00', route_details={'day_by_day_route': [dict(day=1, date='2026-12-01', stops=stops)]},
        execution_state={'activity_log': {}, 'reroute_history': []})


class RerouteReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.trip = trip_fixture()
        for name in ('discover_via_serpapi', 'discover_via_overpass', 'discover_restaurants_serpapi'):
            stub = patch('app.services.reroute_service.' + name, return_value=[])
            stub.start(); self.addCleanup(stub.stop)

    def preview(self, **kwargs):
        return generate_reroute_proposal(self.trip, 1, 'skip', **kwargs)

    def test_actual_saved_duration_survives_missing_or_inconsistent_metadata(self):
        for duration in (None, 60, 999):
            with self.subTest(duration=duration):
                self.trip['route_details']['day_by_day_route'][0]['stops'][-1]['duration_minutes'] = duration
                proposal = self.preview()
                hotel = proposal['proposed_stops'][-1]
                self.assertEqual((hotel['start_time'], hotel['end_time']), ('14:00', '16:00'))
                validate_reroute(self.trip, 1, 'skip', proposal['proposed_stops'])

    def test_completed_later_stop_is_frozen_including_legacy_progress(self):
        original = copy.deepcopy(self.trip['route_details']['day_by_day_route'][0]['stops'][-1])
        for key in ('stay', '1_2'):
            self.trip['execution_state']['activity_log'] = {key: {'status': 'completed', 'activity_id': 'stay'}}
            proposal = self.preview()
            saved = {k: v for k, v in proposal['proposed_stops'][-1].items() if k not in {'rescheduled', 'status_label'}}
            self.assertEqual(saved, original)
            validate_reroute(self.trip, 1, 'skip', proposal['proposed_stops'])

    def test_late_day_falls_back_to_safe_skip_and_apply_preserves_the_schedule(self):
        self.trip['bedtime'] = '17:00'
        original = copy.deepcopy(self.trip['route_details'])
        proposal = self.preview(current_time_str='16:30')
        self.assertEqual(proposal['mode'], 'skip_only')
        db = MockDB(self.trip)
        result = apply_reroute_proposal(db, self.trip['id'], 1, 'skip', proposal['proposed_stops'],
            expected_revision=1, x_user_id='owner', preserve_schedule=True)
        self.assertEqual(db.doc['route_details'], original)
        self.assertEqual(result['revision'], 2)
        self.assertEqual(result['execution_state']['activity_log']['skip']['status'], 'skipped')

    def test_completed_stop_cannot_be_skipped_using_legacy_status(self):
        self.trip['execution_state']['activity_log'] = {'1_1': {'status': 'completed', 'activity_id': 'skip'}}
        with self.assertRaisesRegex(ValueError, 'cannot be skipped'):
            self.preview()

    def test_fixed_airport_time_is_not_shifted_to_fit_late_current_time(self):
        self.trip['route_details']['day_by_day_route'][0]['stops'][-1]['type'] = 'airport'
        proposal = self.preview(current_time_str='14:30')
        self.assertEqual(proposal['mode'], 'skip_only')
        self.assertEqual(proposal['proposed_stops'][-1]['start_time'], '14:00')

    def test_replacement_must_fit_all_remaining_visits_before_custom_bedtime(self):
        stops = self.trip['route_details']['day_by_day_route'][0]['stops']
        stops[1].update(type='attraction', name='Skipped museum', start_time='13:00', end_time='13:30')
        stops[-1].update(start_time='13:40', end_time='15:40')
        self.trip['bedtime'] = '16:00'
        self.trip['all_attractions'] = [dict(name='Other museum', lat=17.4, lon=78.4, category='museum')]
        proposal = self.preview()
        self.assertFalse(proposal['replacement_found'])
        self.assertEqual(proposal['proposed_stops'][-1]['end_time'], '15:40')

    def test_listed_hours_are_checked_against_the_replacement_visit(self):
        self.trip['route_details']['day_by_day_route'][0]['stops'][1].update(type='attraction', name='Skipped museum', start_time='13:00', end_time='13:30')
        self.trip['all_attractions'] = [dict(name='Morning museum', lat=17.4, lon=78.4, opening_hours='09:00 - 12:00')]
        self.assertFalse(self.preview()['replacement_found'])

    def test_current_time_includes_travel_to_replacement_even_without_gps(self):
        self.trip['route_details']['day_by_day_route'][0]['stops'][1].update(type='attraction', name='Skipped museum')
        self.trip['all_attractions'] = [dict(name='Nearby museum', lat=17.5, lon=78.5)]
        proposal = self.preview(current_time_str='13:00')
        self.assertTrue(proposal['replacement_found'])
        travel = estimate_transit(17.4, 78.4, 17.5, 78.5)[0]
        self.assertGreaterEqual(parse_hhmm_to_minutes(proposal['replacement_activity']['start_time'], 0), 13 * 60 + travel)

    def test_midnight_is_not_wrapped_into_a_morning_schedule(self):
        self.trip['bedtime'] = '23:59'
        proposal = self.preview(current_time_str='23:30')
        self.assertEqual(proposal['mode'], 'skip_only')

    def test_skip_only_cannot_change_any_saved_stop(self):
        proposed = copy.deepcopy(self.trip['route_details']['day_by_day_route'][0]['stops'][::2])
        proposed[-1]['end_time'] = '15:00'
        with self.assertRaisesRegex(ValueError, 'cannot change'):
            validate_reroute(self.trip, 1, 'skip', proposed, preserve_schedule=True)

    def test_backend_imports_with_only_ci_placeholder_configuration(self):
        code = """import os
from unittest.mock import patch
with patch('dotenv.load_dotenv', return_value=False):
    import app.main
print('IMPORT_OK')
"""
        environment = {k: v for k, v in os.environ.items() if not k.startswith(('GROQ_', 'MONGODB_', 'SERPAPI_'))}
        environment.update(GROQ_API_KEY='test-key', MONGODB_URI='mongodb://localhost:27017', SERPAPI_API_KEY='')
        result = subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).parent, env=environment,
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('IMPORT_OK', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
