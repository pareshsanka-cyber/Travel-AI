import logging
import httpx
from app.ai.orchestrator.state import TravelState

# City coordinates mapping for accurate Open-Meteo queries
CITY_COORDINATES = {
    "jaipur": {"lat": 26.9124, "lon": 75.7873},
    "goa": {"lat": 15.2993, "lon": 74.1240},
    "delhi": {"lat": 28.6139, "lon": 77.2090},
    "mumbai": {"lat": 19.0760, "lon": 72.8777},
    "bengaluru": {"lat": 12.9716, "lon": 77.5946},
    "bangalore": {"lat": 12.9716, "lon": 77.5946},
    "agra": {"lat": 27.1767, "lon": 78.0081},
    "varanasi": {"lat": 25.3176, "lon": 82.9739},
    "udaipur": {"lat": 24.5854, "lon": 73.7125},
    "leh": {"lat": 34.1526, "lon": 77.5771},
    "amritsar": {"lat": 31.6340, "lon": 74.8723},
    "kerala": {"lat": 9.9312, "lon": 76.2673},
    "kochi": {"lat": 9.9312, "lon": 76.2673},
    "darjeeling": {"lat": 27.0410, "lon": 88.2663},
    "shimla": {"lat": 31.1048, "lon": 77.1734},
    "manali": {"lat": 32.2432, "lon": 77.1892},
    "ooty": {"lat": 11.4102, "lon": 76.6950}
}

# WMO Weather interpretation codes
WMO_WEATHER_CODES = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm"
}

def fetch_realtime_weather_openmeteo(destination: str, days: int = 3, start_date=None, end_date=None):
    """Return dated provider values, or an explicit reason; never invent weather."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    from dateutil.parser import parse
    from app.ai.agents.route_agent import resolve_destination_timezone

    def unavailable(reason, summary):
        return {"data_status": "unavailable", "reason": reason, "summary": summary, "dailyForecast": []}

    try:
        today = datetime.now(ZoneInfo(resolve_destination_timezone(destination))).date()
        start = parse(str(start_date)).date() if start_date else today
        end = parse(str(end_date)).date() if end_date else start + timedelta(days=max(1, days) - 1)
    except (ValueError, TypeError, OverflowError):
        return unavailable('invalid_dates', 'Set valid trip dates to view the forecast.')
    if end < start:
        return unavailable('invalid_dates', 'The trip end date must be on or after the start date.')
    if start < today:
        return unavailable('past_dates', f'This trip runs from {start} to {end}. Its dates include past days, so a trip forecast is unavailable. You can view the next 7 days separately.')
    if end > today + timedelta(days=15):
        return unavailable('outside_window', f'This trip runs from {start} to {end}. Open-Meteo forecasts cover today through {today + timedelta(days=15)}. Check again closer to departure, or view the next 7 days.')

    coords = CITY_COORDINATES.get(destination.lower().strip())
    try:
        if not coords:
            response = httpx.get('https://geocoding-api.open-meteo.com/v1/search', params={'name': destination, 'count': 1}, timeout=10.0)
            response.raise_for_status()
            results = response.json().get('results') or []
            if not results:
                return unavailable('location_unavailable', 'The weather provider could not find this destination. Check its city and country.')
            coords = {'lat': results[0]['latitude'], 'lon': results[0]['longitude']}
        response = httpx.get('https://api.open-meteo.com/v1/forecast', params={
            'latitude': coords['lat'], 'longitude': coords['lon'], 'timezone': 'auto',
            'daily': 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
            'start_date': start.isoformat(), 'end_date': end.isoformat()}, timeout=10.0)
        response.raise_for_status()
        data = response.json()
        daily = data.get('daily') or {}
        forecast = []
        dates = daily.get('time') or []
        expected = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
        if dates != expected:
            return unavailable('incomplete_data', 'The weather provider did not return the requested dates. Please refresh the weather.')
        def value(field, i):
            values = daily.get(field) or []
            return values[i] if i < len(values) else None
        for i, day in enumerate(dates):
            code = value('weather_code', i)
            forecast.append({'dayNumber': i + 1, 'date': day, 'dayLabel': f'Day {i + 1}',
                'icon': 'sunny' if code in (0, 1) else 'partly-cloudy',
                'tempHigh': value('temperature_2m_max', i), 'tempLow': value('temperature_2m_min', i),
                'rainChancePercent': value('precipitation_probability_max', i),
                'conditionText': WMO_WEATHER_CODES.get(code, 'Condition unavailable')})
        if not any(day['tempHigh'] is not None or day['tempLow'] is not None for day in forecast):
            return unavailable('incomplete_data', 'The weather provider returned no temperatures. Please refresh the weather.')
        return {'data_status': 'forecast', 'dailyForecast': forecast,
            'summary': f'Open-Meteo forecast for {start} to {end}. Conditions may change.',
            'fetched_at': datetime.now().astimezone().isoformat(), 'timezone': data.get('timezone')}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, RuntimeError) as error:
        logging.getLogger('travelai.weather').warning('Weather provider failed operation=forecast error_type=%s', type(error).__name__)
        return unavailable('provider_unavailable', 'The weather provider is temporarily unavailable. Please retry.')


def weather_node(state: TravelState) -> dict:
    return {'weather': fetch_realtime_weather_openmeteo(state['destination'], int(state.get('days') or 3), state.get('start_date'), state.get('end_date'))}
