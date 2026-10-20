import { apiFetch } from './api';
import type { ActivitySegment, RerouteApplyResult, RouteLeg, RouteStep, TravelMode } from '../types';

export type DisruptionTrigger = 'skip' | 'closed' | 'delay';
export interface PreviewLocation { lat: number; lon: number; accuracy: number; timestamp: string; }
export interface ScheduleImpact {
  changed_stops: Array<{ id: string; title: string; before_start?: string; before_end?: string; after_start?: string; after_end?: string }>;
  finish_time?: string; original_finish?: string; travel_minutes: number;
  price_difference: number | null; currency: string; opening_hours: string;
}
export interface ReviewOption {
  id: string; kind: 'replacement' | 'reschedule' | 'skip_only'; title: string; reason: string; recommended: boolean;
  proposed_stops: ActivitySegment[]; replacement_activity: ActivitySegment | null;
  impact: ScheduleImpact; warnings: string[];
  travel: Array<{ to_id: string; duration_minutes: number; distance_km: number; source: string; confidence: string }>;
}
export interface ReviewProposal {
  version: 2; proposal_id: string; day_number: number; revision: number; target_activity_id: string;
  trigger: DisruptionTrigger; origin_location_label: string; original_stops: ActivitySegment[];
  options: ReviewOption[]; warnings: string[]; expires_at: string; server_time: string; timezone: string | null;
}

/** API snapshots are snake_case. Normalize them once; never send displayed stops back. */
export function normalizeReviewStop(raw: Record<string, any>): ActivitySegment {
  return { id: raw.id, title: raw.title || raw.name || 'Saved stop', description: raw.description || '',
    timeOfDay: 'Morning', categoryColor: 'primary', time: raw.time || '', startTime: raw.start_time,
    endTime: raw.end_time, scheduledDate: raw.scheduled_date, timezone: raw.timezone,
    type: raw.type, category: raw.category, lat: raw.lat, lon: raw.lon, placeId: raw.place_id };
}

export async function previewAdjustment(tripId: string, payload: {
  day_number: number; target_activity_id: string; trigger: DisruptionTrigger; expected_revision: number;
  travel_mode: 'driving' | 'walking'; delay_minutes?: 15 | 30 | 60; current_location?: PreviewLocation;
}, signal?: AbortSignal): Promise<ReviewProposal> {
  const raw = await apiFetch<ReviewProposal>(`/api/trips/${encodeURIComponent(tripId)}/reroute/preview`, {
    method: 'POST', body: JSON.stringify({ version: 2, ...payload }), signal,
  });
  if (raw.version !== 2 || !Array.isArray(raw.options)) throw new Error('The server needs the routing V2 update. Restart the updated backend, then review again. Your schedule is unchanged.');
  return { ...raw, original_stops: raw.original_stops.map(normalizeReviewStop), options: raw.options.map(o => ({ ...o,
    proposed_stops: o.proposed_stops.map(normalizeReviewStop), replacement_activity: o.replacement_activity ? normalizeReviewStop(o.replacement_activity) : null })) };
}

export function confirmAdjustment(tripId: string, proposal: ReviewProposal, optionId: string, signal?: AbortSignal) {
  return apiFetch<RerouteApplyResult>(`/api/trips/${encodeURIComponent(tripId)}/reroute/apply`, {
    method: 'POST', signal, body: JSON.stringify({ version: 2, proposal_id: proposal.proposal_id,
      option_id: optionId, expected_revision: proposal.revision }),
  });
}

interface DirectionSnapshot {
  from_title: string; to_title: string; from_coords: [number, number] | null; to_coords: [number, number] | null;
  duration_minutes: number; distance_km: number; geometry: Array<[number, number]>;
  source: 'road' | 'distance_estimate' | 'unavailable' | 'flight'; confidence: string;
  steps?: RouteStep[];
}
export async function fetchDayDirections(tripId: string, day: number, mode: TravelMode, signal: AbortSignal) {
  const data = await apiFetch<{ revision: number; legs: DirectionSnapshot[] }>(`/api/trips/${encodeURIComponent(tripId)}/directions?day_number=${day}&travel_mode=${mode === 'walking' ? 'walking' : 'driving'}`, { signal });
  if (!Array.isArray(data.legs)) throw new Error('Directions unavailable. Restart the updated backend and try again.');
  const legs: RouteLeg[] = data.legs.map(l => ({ fromTitle: l.from_title, toTitle: l.to_title,
    fromCoords: l.from_coords || [0, 0], toCoords: l.to_coords || [0, 0], mode, distanceKm: l.distance_km,
    durationMins: l.source === 'flight' ? 0 : l.duration_minutes,
    geometry: l.geometry.length ? l.geometry : l.source !== 'unavailable' && l.from_coords && l.to_coords ? [l.from_coords, l.to_coords] : [], steps: l.source === 'road' ? l.steps || [] : [],
    status: l.source === 'road' && l.geometry.length > 1 ? 'ok' : l.source === 'flight' ? 'flight' : l.source === 'unavailable' ? 'no_route' : 'fallback',
    isFlightLeg: l.source === 'flight', errorMessage: l.source === 'road' && !l.geometry.length ? 'Road travel estimate; detailed geometry unavailable. Map connection is straight-line.' : l.confidence,
    googleMapsUrl: l.from_coords && l.to_coords ? `https://www.google.com/maps/dir/?api=1&origin=${l.from_coords.join(',')}&destination=${l.to_coords.join(',')}&travelmode=${mode === 'walking' ? 'walking' : 'driving'}` : '',
  }));
  return { ...data, legs };
}
