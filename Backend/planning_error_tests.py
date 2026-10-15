"""Reproductions of ISO-date corruption and Kerala schedule overflow."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from app.services.slot_extraction_service import extract_context_tags, analyze_user_message, merge_travel_context
from app.ai.orchestrator.planner_agent import planner_node
from app.ai.agents.route_agent import route_node
from app.ai.agents.opening_hours_agent import opening_hours_node
from app.ai.reviewer.reviewer_agent import reviewer_node
from app.ai.agents.synthesis_agent import synthesis_node


class PlanningErrorTests(unittest.TestCase):
    def test_planning_date_boundaries_follow_today(self):
        from datetime import date, timedelta
        from app.services.planning_dates import validate_planning_dates
        today = date.today()
        validate_planning_dates(today.isoformat(), today.isoformat())
        validate_planning_dates(today.isoformat(), (today + timedelta(days=4)).isoformat())
        with self.assertRaisesRegex(ValueError, 'Past travel dates'):
            validate_planning_dates((today - timedelta(days=1)).isoformat())
        with self.assertRaisesRegex(ValueError, 'on or after'):
            validate_planning_dates((today + timedelta(days=2)).isoformat(), today.isoformat())

    def test_chat_past_dates_do_not_generate_itinerary(self):
        from app.services import chat_service
        context = {'destination': 'Goa', 'days': 2, 'start_date': '2020-01-01', 'end_date': '2020-01-02'}
        conversation = SimpleNamespace(conversation_id='date-test', current_trip_id=None,
            travel_context=SimpleNamespace(model_dump=lambda: context))
        with patch.object(chat_service, 'get_or_create_conversation', return_value=conversation), patch.object(chat_service, 'get_conversation_messages', return_value=[]), patch.object(chat_service, 'add_message'), patch.object(chat_service, 'analyze_user_message', return_value={'intent': 'GENERATE_ITINERARY', 'slots': {}}), patch.object(chat_service.graph, 'invoke') as planning:
            result = chat_service.process_chat_message(None, 'plan a trip', 'test-user')
        self.assertIn('Past travel dates are not allowed', result['message']['content'])
        planning.assert_not_called()

    def setUp(self):
        self.state = dict(destination='Kerala, India', origin='Hyderabad', days=4, budget=250000,
            start_date='2026-10-13', end_date='2026-10-16', hotels=[dict(name='Hotel', lat=9.93, lon=76.26)],
            attractions=[dict(name='Fort Kochi', lat=9.96, lon=76.24),
                dict(name='Munnar', lat=10.08, lon=77.06), dict(name='Beach', lat=8.73, lon=76.71)],
            restaurants=[dict(name='Restaurant', lat=9.93, lon=76.26)])
        p = patch('app.ai.agents.route_agent.resolve_airport_details', return_value=dict(name='Airport', lat=9.93, lon=76.26, address='Airport'))
        p.start(); self.addCleanup(p.stop)
        p = patch('app.ai.agents.route_agent.resolve_destination_coordinates', return_value=dict(lat=9.93, lon=76.26))
        p.start(); self.addCleanup(p.stop)

    def pipeline(self, **changes):
        state = dict(self.state, **changes)
        state.update(planner_node(state)); state.update(route_node(state)); state.update(opening_hours_node(state))
        result = reviewer_node(state)
        self.assertTrue(result['is_approved'], result['reviewer_feedback'])
        state.update(synthesis_node(state))
        return state

    def test_iso_ranges_do_not_split_internal_hyphens(self):
        for separator in (' to ', ' - ', ' – ', '-', '–'):
            with self.subTest(separator=separator):
                result = extract_context_tags('[Context: Dates: 2026-10-21' + separator + '2026-10-23 (3 days)]')
                self.assertEqual(result['start_date'], '2026-10-21')
                self.assertEqual(result['end_date'], '2026-10-23')

    def test_display_date_range_still_supported(self):
        result = extract_context_tags('[Context: Dates: 21 Oct 2026 to 23 Oct 2026]')
        self.assertEqual(result['days'], 3)

    def test_explicit_dates_override_corrupt_llm_slots(self):
        response = SimpleNamespace(content='{"intent":"GENERATE_ITINERARY","slots":{"start_date":"2026","end_date":"10-21 to 2026-10-23","days":9}}')
        with patch('app.services.slot_extraction_service.llm.invoke', return_value=response):
            result = analyze_user_message('plan a trip\n[Context: Dates: 2026-10-21 to 2026-10-23 (3 days)]', {})
        context = merge_travel_context({}, result['slots'])
        self.assertEqual(context['start_date'], '2026-10-21'); self.assertEqual(context['end_date'], '2026-10-23')
        self.assertEqual(context['days'], 3)

    def test_selected_dates_determine_inclusive_duration(self):
        result = merge_travel_context({'days': 3}, {'start_date': '2026-10-13', 'end_date': '2026-10-16'})
        self.assertEqual(result['days'], 4)

    def test_long_kerala_transfers_do_not_wrap_midnight(self):
        result = self.pipeline()
        notes = result['route_details']['schedule_notes']
        self.assertTrue(notes)
        self.assertIn('could not fit', result['final_itinerary'])
        self.assertEqual(result['days'], 4)
        self.assertEqual(result['route_details']['day_by_day_route'][-1]['date'], '2026-10-16')

    def test_early_departure_has_positive_checkin_window(self):
        result = self.pipeline(flights=[dict(departure_time='02:00', arrival_time='04:00')])
        first = result['route_details']['day_by_day_route'][0]['stops'][0]
        self.assertEqual(first['start_time'], '00:00'); self.assertEqual(first['end_time'], '02:00')

    def test_late_arrival_omits_dinner_instead_of_crossing_midnight(self):
        result = self.pipeline(flights=[dict(departure_time='18:00', arrival_time='21:00')])
        first = result['route_details']['day_by_day_route'][0]['stops']
        self.assertFalse(any(stop['type'] == 'restaurant' for stop in first))

    def test_overnight_flight_keeps_times_and_arrives_on_day_two(self):
        result = self.pipeline(flights=[dict(departure_time='23:00', arrival_time='01:00')])
        first, second = result['route_details']['day_by_day_route'][:2]
        self.assertEqual(first['stops'][0]['end_time'], '23:00')
        self.assertEqual(second['date'], '2026-10-14')
        self.assertEqual(second['stops'][0]['start_time'], '01:00')
        self.assertTrue(any(stop['type'] == 'hotel' for stop in second['stops']))
        self.assertEqual(result['flights'][0]['arrival_date'], second['date'])

    def test_user_delhi_kerala_six_day_request_keeps_exact_dates(self):
        result = self.pipeline(origin='New Delhi', destination='Kerala, India', days=6, travelers=3,
            start_date='2026-10-21', end_date='2026-10-26', budget=120000, preferences=['Adventure'],
            flights=[dict(departure_time='23:00', arrival_time='01:30', departure_date='2026-10-21', arrival_date='2026-10-22', duration_minutes=150)])
        days = result['route_details']['day_by_day_route']
        self.assertEqual(len(days), 6); self.assertEqual(days[0]['date'], '2026-10-21'); self.assertEqual(days[-1]['date'], '2026-10-26')
        self.assertEqual(days[1]['stops'][0]['start_time'], '01:30')
        self.assertFalse(any(stop['type'] in ('hotel', 'attraction', 'restaurant') for stop in days[0]['stops']))

    def test_legacy_duration_recovers_missing_arrival_date(self):
        from app.services.flight_timing import flight_timing
        from datetime import date
        result = flight_timing(dict(departure_time='23:00', arrival_time='01:30', duration_minutes=150), date(2026, 10, 21))
        self.assertEqual(result['arrival_date'].isoformat(), '2026-10-22')
        self.assertEqual(result['duration'], 150)

    def test_provider_timestamps_preserve_both_calendar_dates(self):
        from app.services.flight_timing import provider_timestamp
        self.assertEqual(provider_timestamp('2026-10-21 23:00'), ('2026-10-21', '23:00'))
        self.assertEqual(provider_timestamp('2026-10-22 01:30'), ('2026-10-22', '01:30'))

    def test_provider_response_flows_through_overnight_route(self):
        import os
        from app.ai.agents import flight_agent
        payload = {'best_flights': [{'price': 11000, 'total_duration': 150, 'flights': [{
            'departure_airport': {'id': 'DEL', 'name': 'Delhi Airport', 'time': '2026-10-21 23:00'},
            'arrival_airport': {'id': 'COK', 'name': 'Cochin Airport', 'time': '2026-10-22 01:30'},
            'airline': 'Test airline', 'flight_number': 'TA 123'}]}]}
        response = SimpleNamespace(status_code=200, json=lambda: payload, raise_for_status=lambda: None)
        with patch.dict(os.environ, {'SERPAPI_API_KEY': 'test-only'}), patch.object(flight_agent, '_FLIGHT_CACHE', {}), \
                patch.object(flight_agent.httpx, 'get', return_value=response), \
                patch.object(flight_agent, 'parse_and_validate_flight_date', return_value=('2026-10-21', False, False, '21 Oct 2026')):
            options = flight_agent.fetch_real_flights_serpapi('Kerala, India', 'New Delhi', 'INR', start_date='2026-10-21', travelers_count=3)['flights']
        self.assertEqual(options[0]['departure_date'], '2026-10-21')
        self.assertEqual(options[0]['arrival_date'], '2026-10-22')
        result = self.pipeline(origin='New Delhi', start_date='2026-10-21', end_date='2026-10-26', days=6, travelers=3, flights=options)
        self.assertEqual(result['route_details']['day_by_day_route'][1]['stops'][0]['start_time'], '01:30')

    def test_valid_westbound_local_clock_is_not_treated_as_overnight(self):
        from app.services.flight_timing import flight_timing
        from datetime import date
        result = flight_timing(dict(departure_time='09:00', arrival_time='07:00', departure_date='2026-10-21', arrival_date='2026-10-21'),
            date(2026, 10, 21), 'Asia/Kolkata', 'Europe/Paris')
        self.assertEqual(result['arrival_offset'], 0); self.assertEqual(result['duration'], 90)

    def test_late_arrival_moves_checkin_to_next_day(self):
        result = self.pipeline(flights=[dict(departure_time='21:00', arrival_time='23:45', arrival_date='2026-10-13')])
        first, second = result['route_details']['day_by_day_route'][:2]
        self.assertFalse(any(stop['type'] == 'hotel' for stop in first['stops']))
        self.assertEqual(second['stops'][0]['type'], 'hotel')
        self.assertEqual(second['stops'][0]['start_time'], '00:40')

    def test_arrival_outside_trip_has_specific_date_error(self):
        with self.assertRaisesRegex(ValueError, 'outside your selected trip dates'):
            self.pipeline(flights=[dict(departure_time='23:00', arrival_time='01:00', arrival_date='2026-10-17')])

    def test_similar_long_names_get_distinct_activity_ids(self):
        prefix = 'A very long attraction name with a shared prefix '
        result = self.pipeline(origin=None, attractions=[dict(name=prefix + 'North', lat=9.93, lon=76.26), dict(name=prefix + 'South', lat=9.93, lon=76.26)])
        identities = [stop['id'] for day in result['route_details']['day_by_day_route'] for stop in day['stops']]
        self.assertEqual(len(identities), len(set(identities)))

    def test_morning_must_visit_waits_for_opening_time(self):
        result = self.pipeline(origin=None, attractions=[dict(name='Must visit museum', lat=9.93, lon=76.26,
            opening_hours='09:30 AM - 05:30 PM', priority_score=1000)])
        stop = next(stop for day in result['route_details']['day_by_day_route'] for stop in day['stops'] if stop['name'] == 'Must visit museum')
        self.assertEqual(stop['start_time'], '09:30')
        self.assertEqual(stop['duration_minutes'], 105)


if __name__ == '__main__':
    unittest.main()
