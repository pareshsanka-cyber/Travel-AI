"""Bounded, shared road estimates. Public OSRM is a best-effort demo, not live traffic.

Use one worker with the public endpoint: its one-request/second limit is coordinated
inside this process. Walking requires its own explicitly configured dataset/profile.
"""
import math
import logging
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future
from urllib.parse import urlencode

import httpx
import anyio

_lock = threading.Lock()
_public_lock = threading.Lock()
_last_public = 0.0
_cache = OrderedDict()
_inflight = {}
_pairs = OrderedDict()
_request_context = threading.local()


class _PrivateRoutingLogs(logging.Filter):
    def filter(self, record):
        return not getattr(_request_context, 'private', False)


# httpx's informational request logging otherwise contains coordinate-bearing URLs.
logging.getLogger('httpx').addFilter(_PrivateRoutingLogs())


def coords(stop):
    try:
        lat, lon = float(stop.get('lat')), float(stop.get('lon', stop.get('lng')))
        return (lat, lon) if math.isfinite(lat + lon) and -90 <= lat <= 90 and -180 <= lon <= 180 else None
    except (TypeError, ValueError):
        return None


def distance(a, b):
    p, q = math.radians(a[0]), math.radians(b[0])
    h = math.sin((q-p)/2)**2 + math.cos(p)*math.cos(q)*math.sin(math.radians(b[1]-a[1])/2)**2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def configuration(mode):
    walking = mode == 'walking'
    endpoint = os.getenv('ROUTING_WALKING_URL' if walking else 'ROUTING_DRIVING_URL', '' if walking else 'https://router.project-osrm.org').rstrip('/')
    profile = os.getenv('ROUTING_WALKING_PROFILE' if walking else 'ROUTING_DRIVING_PROFILE', 'foot' if walking else 'driving')
    if walking:
        driving_url = os.getenv('ROUTING_DRIVING_URL', 'https://router.project-osrm.org').rstrip('/')
        if endpoint == driving_url or '://router.project-osrm.org' in endpoint or profile.lower() in {'driving', 'car', 'auto'}:
            endpoint = ''  # A different URL path/profile label cannot turn the car dataset into walking.
    return endpoint, profile


def _request(url, deadline):
    """Coalesce identical work, bound all waits, and cache successes/failures."""
    global _last_public
    with _lock:
        saved = _cache.get(url)
        if saved and saved[0] > time.monotonic():
            _cache.move_to_end(url)
            return saved[1]
        future = _inflight.get(url)
        owner = future is None
        if owner:
            future = Future()
            _inflight[url] = future
    if not owner:
        try:
            return future.result(timeout=max(0.001, deadline-time.monotonic()))
        except Exception:
            return None
    result = None
    public_acquired = False
    try:
        public = '://router.project-osrm.org/' in url or '://routing.openstreetmap.de/' in url
        if public:
            if not _public_lock.acquire(timeout=max(0, deadline-time.monotonic())):
                return None
            public_acquired = True
            wait = max(0, 1.0 - (time.monotonic()-_last_public))
            if time.monotonic()+wait+0.1 >= deadline:
                return None
            if wait:
                time.sleep(wait)
            _last_public = time.monotonic()
        remaining = deadline-time.monotonic()
        if remaining <= 0:
            return None
        # No coordinates/URLs are logged by this service.
        _request_context.private = True
        async def fetch():
            global _last_public
            with anyio.fail_after(remaining):
                async with httpx.AsyncClient(timeout=httpx.Timeout(min(remaining, 3.0)), follow_redirects=False) as client:
                    if public_acquired:
                        _last_public = time.monotonic()
                    response = await client.get(url)
                    response.raise_for_status()
                    return response.json()
        data = anyio.run(fetch)
        if isinstance(data, dict) and data.get('code') == 'Ok':
            result = data
        return result
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError):
        return None
    finally:
        _request_context.private = False
        if public_acquired:
            _public_lock.release()
        with _lock:
            _cache[url] = (time.monotonic() + (300 if result else 10), result)
            _cache.move_to_end(url)
            while len(_cache) > 128:
                _cache.popitem(last=False)
            _inflight.pop(url, None)
            future.set_result(result)


class RoutingSession:
    def __init__(self, mode='driving', budget=8):
        self.mode = 'walking' if mode == 'walking' else 'driving'
        self.deadline = time.monotonic() + min(8, budget)
        self.estimates = {}
        self.fallbacks = 0

    def batch(self, points):
        points = list(dict.fromkeys(p for p in points if p))[:40]
        endpoint, profile = configuration(self.mode)
        if len(points) < 2 or not endpoint:
            return
        with _lock:
            for a in points:
                for b in points:
                    saved = _pairs.get((endpoint, profile, a, b))
                    if saved and saved[0] > time.monotonic():
                        self.estimates[a, b] = dict(saved[1], cached=True)
            if all((a, b) in self.estimates for a in points for b in points if a != b):
                return
        path = ';'.join(f'{p[1]},{p[0]}' for p in points)
        data = _request(f'{endpoint}/table/v1/{profile}/{path}?annotations=duration,distance', self.deadline)
        if not data:
            return
        for i, a in enumerate(points):
            for j, b in enumerate(points):
                try:
                    seconds = float(data['durations'][i][j])
                    metres = float(data['distances'][i][j])
                    if math.isfinite(seconds + metres) and seconds >= 0 and metres >= 0:
                        self.estimates[a, b] = dict(duration_minutes=math.ceil(seconds/60), distance_km=round(metres/1000, 2), source='road', confidence='Road estimate; no live traffic')
                        with _lock:
                            _pairs[endpoint, profile, a, b] = (time.monotonic()+300, self.estimates[a, b])
                            _pairs.move_to_end((endpoint, profile, a, b))
                            while len(_pairs) > 2048:
                                _pairs.popitem(last=False)
                except (KeyError, IndexError, TypeError, ValueError):
                    pass

    def leg(self, a, b, geometry=False):
        if not a or not b:
            return dict(duration_minutes=0, distance_km=0, source='unavailable', confidence='Coordinates unavailable', geometry=[])
        result = self.estimates.get((a, b))
        if result is None:
            self.fallbacks += 1
            km = distance(a, b)
            result = dict(duration_minutes=max(1, math.ceil(km/(4.5 if self.mode == 'walking' else 25)*60)), distance_km=round(km, 2), source='distance_estimate', confidence='Straight-line distance estimate; road conditions unknown')
        result = dict(result, geometry=[], steps=[])
        endpoint, profile = configuration(self.mode)
        if geometry and endpoint:
            path = f'{a[1]},{a[0]};{b[1]},{b[0]}'
            data = _request(f'{endpoint}/route/v1/{profile}/{path}?'+urlencode(dict(overview='full', geometries='geojson', steps='true')), self.deadline)
            try:
                route = data['routes'][0]
                shape = route['geometry']['coordinates']
                if 2 <= len(shape) <= 40000 and all(coords({'lat': p[1], 'lon': p[0]}) for p in shape):
                    result['geometry'] = [[p[1], p[0]] for p in shape]
                    result.update(duration_minutes=math.ceil(route['duration']/60), distance_km=round(route['distance']/1000, 2), source='road', confidence='Road estimate; no live traffic')
                    result['steps'] = [dict(instruction=step.get('maneuver', {}).get('instruction') or ' '.join(filter(None, [step.get('maneuver', {}).get('type', 'Continue').replace('_', ' '), step.get('maneuver', {}).get('modifier'), step.get('name')])),
                        distanceMeters=step.get('distance', 0), durationSeconds=step.get('duration', 0), name=step.get('name', '')) for section in route.get('legs') or [] for step in section.get('steps') or []][:1000]
            except (KeyError, IndexError, TypeError, ValueError):
                pass
        return result


def day_directions(trip, day_number, mode):
    from app.utils.activity_identity import routes_with_activity_ids
    routes = routes_with_activity_ids((trip.get('route_details') or {}).get('day_by_day_route') or [])
    day = next((d for i, d in enumerate(routes) if int(d.get('day') or d.get('day_number') or i+1) == day_number), None)
    if day is None:
        raise ValueError('Day not found.')
    stops = day.get('stops') or day.get('activities') or []
    routing = RoutingSession(mode)
    routing.batch([coords(s) for s in stops])
    legs = []
    for a, b in zip(stops, stops[1:]):
        start, end = coords(a), coords(b)
        airport_pair = all(str(s.get('type', '')).lower() in {'airport', 'flight'} or 'airport' in str(s.get('name', s.get('title', ''))).lower() for s in (a, b))
        flight = bool(start and end and (str(b.get('travel_mode', '')).lower() == 'flight' or airport_pair and distance(start, end) > 100))
        estimate = routing.leg(start, end, geometry=not flight)
        if flight:
            estimate.update(source='flight', duration_minutes=0, geometry=[start, end], confidence='Flight connection; follow saved flight times')
        legs.append(dict(from_id=a['id'], to_id=b['id'], from_title=a.get('name') or a.get('title'), to_title=b.get('name') or b.get('title'), from_coords=start, to_coords=end, mode=mode, **estimate))
    return dict(version=2, revision=int(trip.get('revision', 1)), day_number=day_number, legs=legs)
