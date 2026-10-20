import { ActivitySegment, RouteLeg, RouteStep, TravelMode } from '../types';

const OSRM_BASE_URL = (import.meta as any).env?.VITE_OSRM_BASE_URL || 'https://router.project-osrm.org';

export function validRouteCoordinates(coords: unknown): coords is [number, number] {
  return Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite) &&
    Math.abs(coords[0]) <= 90 && Math.abs(coords[1]) <= 180 && !(coords[0] === 0 && coords[1] === 0);
}

export function isFlightConnection(from: ActivitySegment, to: ActivitySegment): boolean {
  if ((to.travelMode || '').toLowerCase() === 'flight') return true;
  const airport = (stop: ActivitySegment) => (stop.type || stop.category || '').toLowerCase() === 'airport';
  return airport(from) && airport(to) && validRouteCoordinates([from.lat, from.lon]) &&
    validRouteCoordinates([to.lat, to.lon]) && calculateHaversineKm(from.lat!, from.lon!, to.lat!, to.lon!) > 100;
}

type CachedRoute = { leg: RouteLeg; expires: number };
type PendingRoute = { promise: Promise<RouteLeg>; controller: AbortController; clients: number; settled: boolean };
const routeCache = new Map<string, CachedRoute>();
const pendingRoutes = new Map<string, PendingRoute>();

function rememberRoute(key: string, leg: RouteLeg) {
  if (leg.status !== 'ok' && leg.status !== 'fallback') return;
  const now = Date.now();
  for (const [id, cached] of routeCache) if (cached.expires <= now) routeCache.delete(id);
  if (leg.geometry.length > 10000) return;
  routeCache.delete(key);
  routeCache.set(key, { leg, expires: now + (leg.status === 'ok' ? 300000 : 10000) });
  let points = [...routeCache.values()].reduce((total, item) => total + item.leg.geometry.length, 0);
  while (routeCache.size > 32 || points > 40000) {
    const oldest = routeCache.keys().next().value!;
    points -= routeCache.get(oldest)!.leg.geometry.length;
    routeCache.delete(oldest);
  }
}

export function calculateHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function buildGoogleMapsUrl(
  origin: [number, number],
  destination: [number, number],
  mode: TravelMode
): string {
  const gMode = mode === 'walking' ? 'walking' : 'driving';
  return `https://www.google.com/maps/dir/?api=1&origin=${origin[0]},${origin[1]}&destination=${destination[0]},${destination[1]}&travelmode=${gMode}`;
}

function formatManeuverInstruction(step: any): string {
  const type = step.maneuver?.type || '';
  const modifier = step.maneuver?.modifier || '';
  const name = step.name ? ` onto ${step.name}` : '';
  const dist = step.distance ? ` for ${Math.round(step.distance)}m` : '';

  if (type === 'depart') {
    return `Head ${modifier || 'forward'}${name}${dist}`;
  }
  if (type === 'arrive') {
    return `Arrive at destination`;
  }
  if (type === 'turn') {
    return `Turn ${modifier || 'left'}${name}${dist}`;
  }
  if (type === 'new name' || type === 'continue') {
    return `Continue straight${name}${dist}`;
  }
  if (type === 'roundabout' || type === 'rotary') {
    return `Take roundabout${name}${dist}`;
  }
  if (type === 'fork') {
    return `Keep ${modifier || 'left'} at the fork${name}${dist}`;
  }
  return `${type.charAt(0).toUpperCase() + type.slice(1)} ${modifier}${name}${dist}`.trim();
}

export async function fetchLegDirections(
  fromCoords: [number, number],
  toCoords: [number, number],
  fromTitle: string,
  toTitle: string,
  mode: TravelMode = 'driving',
  signal?: AbortSignal
): Promise<RouteLeg> {
  if (signal?.aborted) throw new DOMException('Route request cancelled', 'AbortError');
  if (!validRouteCoordinates(fromCoords) || !validRouteCoordinates(toCoords)) {
    return { fromTitle, toTitle, fromCoords, toCoords, mode, distanceKm: 0, durationMins: 0,
      geometry: [], steps: [], googleMapsUrl: '', status: 'no_route', errorMessage: 'Missing GPS coordinates for this stop' };
  }
  const key = JSON.stringify([OSRM_BASE_URL, mode === 'walking' ? 'foot' : 'driving', fromCoords, toCoords]);
  const describe = (leg: RouteLeg): RouteLeg => ({ ...structuredClone(leg), fromTitle, toTitle, fromCoords, toCoords,
    mode, googleMapsUrl: buildGoogleMapsUrl(fromCoords, toCoords, mode) });
  const cached = routeCache.get(key);
  if (cached && cached.expires > Date.now()) return describe(cached.leg);
  if (cached) routeCache.delete(key);
  let pending = pendingRoutes.get(key);
  if (!pending) {
    const controller = new AbortController();
    const task: PendingRoute = { controller, clients: 0, settled: false,
      promise: loadLegDirections(fromCoords, toCoords, fromTitle, toTitle, mode, controller.signal) };
    task.promise = task.promise
      .then(leg => { if (!controller.signal.aborted) rememberRoute(key, leg); return leg; })
      .finally(() => { task.settled = true; if (pendingRoutes.get(key) === task) pendingRoutes.delete(key); });
    pendingRoutes.set(key, task);
    pending = task;
  }
  const task = pending;
  task.clients++;
  return new Promise<RouteLeg>((resolve, reject) => {
    let finished = false;
    const done = () => {
      if (finished) return false;
      finished = true; signal?.removeEventListener('abort', cancel); task.clients--;
      if (!task.clients && !task.settled) {
        task.controller.abort();
        if (pendingRoutes.get(key) === task) pendingRoutes.delete(key);
      }
      return true;
    };
    const cancel = () => { if (done()) reject(new DOMException('Route request cancelled', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    task.promise.then(leg => { if (done()) resolve(describe(leg)); }, error => { if (done()) reject(error); });
  });
}

async function loadLegDirections(
  fromCoords: [number, number], toCoords: [number, number], fromTitle: string, toTitle: string,
  mode: TravelMode, signal: AbortSignal
): Promise<RouteLeg> {
  const googleMapsUrl = buildGoogleMapsUrl(fromCoords, toCoords, mode);

  // Validate coordinates
  if (
    !fromCoords ||
    !toCoords ||
    (fromCoords[0] === 0 && fromCoords[1] === 0) ||
    (toCoords[0] === 0 && toCoords[1] === 0)
  ) {
    return {
      fromTitle,
      toTitle,
      fromCoords,
      toCoords,
      mode,
      distanceKm: 0,
      durationMins: 0,
      geometry: [fromCoords, toCoords],
      steps: [{ instruction: 'Location coordinates unavailable', distanceMeters: 0, durationSeconds: 0, name: '' }],
      googleMapsUrl,
      status: 'no_route',
      errorMessage: 'Missing GPS coordinates for route',
    };
  }

  // OSRM profile mapping
  // Note: Cab uses the driving road profile but is presented as Cab in the UI
  const profile = mode === 'walking' ? 'foot' : 'driving';
  const url = `${OSRM_BASE_URL}/route/v1/${profile}/${fromCoords[1]},${fromCoords[0]};${toCoords[1]},${toCoords[0]}?overview=full&geometries=geojson&steps=true`;

  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timeoutId = setTimeout(() => controller.abort(), 7000); // 7s timeout

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`OSRM server returned status ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found by OSRM');
    }

    const route = data.routes[0];
    if (!Number.isFinite(route.distance) || route.distance < 0 || !Number.isFinite(route.duration) || route.duration < 0 ||
        !Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2 ||
        !route.geometry.coordinates.every((coord: number[]) => validRouteCoordinates([coord[1], coord[0]]))) {
      throw new Error('Route server returned invalid geometry or estimates');
    }
    const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
    const durationMins = Math.max(1, Math.round(route.duration / 60));

    // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
    const geometry: Array<[number, number]> = route.geometry.coordinates.map(
      (coord: [number, number]) => [coord[1], coord[0]]
    );

    // Extract turn steps
    const rawSteps = route.legs?.[0]?.steps || [];
    const steps: RouteStep[] = rawSteps.map((step: any) => ({
      instruction: formatManeuverInstruction(step),
      distanceMeters: Math.round(step.distance || 0),
      durationSeconds: Math.round(step.duration || 0),
      name: step.name || '',
      maneuverType: step.maneuver?.type,
      maneuverModifier: step.maneuver?.modifier,
    }));

    // If no explicit steps provided, add default step
    if (steps.length === 0) {
      steps.push({
        instruction: 'Follow the displayed route to your destination',
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        name: '',
      });
    }

    return {
      fromTitle,
      toTitle,
      fromCoords,
      toCoords,
      mode,
      distanceKm,
      durationMins,
      geometry,
      steps,
      googleMapsUrl,
      status: 'ok',
    };
  } catch (err: any) {
    if (signal.aborted) throw new DOMException('Route request cancelled', 'AbortError');

    // Graceful fallback to haversine calculation
    const fallbackDist = calculateHaversineKm(
      fromCoords[0],
      fromCoords[1],
      toCoords[0],
      toCoords[1]
    );
    const speedKmh = mode === 'walking' ? 4.5 : 25; // 25 km/h driving in city, 4.5 km/h walking
    const fallbackDuration = Math.max(2, Math.round((fallbackDist / speedKmh) * 60));

    return {
      fromTitle,
      toTitle,
      fromCoords,
      toCoords,
      mode,
      distanceKm: fallbackDist,
      durationMins: fallbackDuration,
      geometry: [fromCoords, toCoords], // straight line fallback
      steps: [], // No fake turn-by-turn instructions in fallback mode
      googleMapsUrl,
      status: 'fallback',
      errorMessage: err?.name === 'AbortError' ? 'Route server timed out; showing direct estimate' : 'Route server unavailable; showing direct estimate',
    };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', cancel);
  }
}
