import { RouteLeg, RouteStep, TravelMode } from '../types';

const OSRM_BASE_URL = (import.meta as any).env?.VITE_OSRM_BASE_URL || 'https://router.project-osrm.org';

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
  mode: TravelMode = 'driving'
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
  const timeoutId = setTimeout(() => controller.abort(), 7000); // 7s timeout

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OSRM server returned status ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found by OSRM');
    }

    const route = data.routes[0];
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
        instruction: `Follow the route towards ${toTitle}`,
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        name: toTitle,
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
    clearTimeout(timeoutId);

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
  }
}
