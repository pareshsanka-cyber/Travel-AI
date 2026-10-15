"""Weather dates, missing provider data and owned read-only refresh coverage."""
import copy
import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from types import SimpleNamespace
from unittest.mock import patch
import httpx
from bson import ObjectId
from fastapi.testclient import TestClient
from app.main import app
from app.api import trips
from app.utils import auth_utils
from app.ai.agents.weather_agent import fetch_realtime_weather_openmeteo as forecast
from security_consistency_tests import Collection, sample_trip


class WeatherTests(unittest.TestCase):
    def setUp(self):
        self.today = datetime.now(ZoneInfo('Australia/Sydney')).date()

    def provider(self, null=False):
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'daily': {
            'time': [self.today.isoformat()], 'temperature_2m_max': [None if null else 23.2],
            'temperature_2m_min': [None if null else 14.1], 'weather_code': [3]}})

    def test_past_dates_have_reason_without_network(self):
        with patch('app.ai.agents.weather_agent.httpx.get') as network:
            result = forecast('Sydney, Australia', 4, '2026-10-04', '2026-10-07')
        self.assertEqual(result['reason'], 'past_dates'); network.assert_not_called()

    def test_far_dates_explain_provider_window(self):
        with patch('app.ai.agents.weather_agent.httpx.get') as network:
            result = forecast('Sydney, Australia', 3, '2099-12-01', '2099-12-03')
        self.assertEqual(result['reason'], 'outside_window'); network.assert_not_called()

    def test_invalid_dates_are_not_provider_failures(self):
        self.assertEqual(forecast('Sydney, Australia', start_date='not-a-date')['reason'], 'invalid_dates')

    def test_provider_values_and_missing_rain_are_not_invented(self):
        with patch('app.ai.agents.weather_agent.CITY_COORDINATES', {'sydney, australia': {'lat': -33.86, 'lon': 151.2}}), patch('app.ai.agents.weather_agent.httpx.get', return_value=self.provider()):
            result = forecast('Sydney, Australia', 1)
        self.assertEqual(result['dailyForecast'][0]['tempHigh'], 23.2)
        self.assertIsNone(result['dailyForecast'][0]['rainChancePercent'])
        self.assertEqual(result['data_status'], 'forecast')

    def test_null_temperatures_remain_unavailable(self):
        with patch('app.ai.agents.weather_agent.httpx.get', return_value=self.provider(null=True)):
            self.assertEqual(forecast('Goa', 1)['reason'], 'incomplete_data')

    def test_provider_timeout_is_retryable(self):
        with patch('app.ai.agents.weather_agent.httpx.get', side_effect=httpx.ReadTimeout('timeout')):
            self.assertEqual(forecast('Goa', 1)['reason'], 'provider_unavailable')

    def test_unresolved_location_has_explicit_reason(self):
        response = SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'results': []})
        with patch('app.ai.agents.weather_agent.httpx.get', return_value=response):
            self.assertEqual(forecast('Unknown city', 1)['reason'], 'location_unavailable')

    def test_refresh_is_owned_read_only_and_upcoming_does_not_rewrite_dates(self):
        owner = str(ObjectId()); trip = sample_trip(); trip['user_id'] = owner
        database = SimpleNamespace(trips=Collection([trip]), users=Collection([{'_id': ObjectId(owner)}]), sessions=Collection())
        before = copy.deepcopy(database.trips.docs)
        with patch.object(trips, 'db', database), patch.object(auth_utils, 'db', database):
            token = auth_utils.generate_token('weather@example.com', owner)
            headers = {'Authorization': 'Bearer ' + token}
            client = TestClient(app)
            path = '/api/trips/' + str(trip['_id']) + '/weather'
            self.assertEqual(client.get(path).status_code, 401)
            self.assertEqual(client.get('/api/trips/' + str(ObjectId()) + '/weather', headers=headers).status_code, 404)
            with patch('app.ai.agents.weather_agent.fetch_realtime_weather_openmeteo', return_value={'data_status': 'forecast', 'dailyForecast': []}) as provider:
                response = client.get(path + '?period=upcoming', headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['period'], 'upcoming')
                provider.assert_called_once_with(trip['destination'], 7, None, None)
            self.assertEqual(database.trips.docs, before)
            self.assertEqual(client.get(path + '?period=invalid', headers=headers).status_code, 422)


if __name__ == '__main__':
    unittest.main()
