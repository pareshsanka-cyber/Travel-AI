import { apiFetch } from './api';
import type { TripSummary } from '../types';

export interface DiscoveryStatus {
  failure_reason?: string | null;
  title?: string;
  message?: string;
  data_status?: string;
}
export interface TripDiscoveryStatus {
  trip_id: string;
  revision: number;
  provider: DiscoveryStatus;
  flight: DiscoveryStatus;
  hotel: DiscoveryStatus;
}
export const discoveryApi = {
  status: (id: string, signal?: AbortSignal) => apiFetch<TripDiscoveryStatus>(`/api/trips/${encodeURIComponent(id)}/discovery-status`, { signal }),
  refresh: (id: string, product: 'flight' | 'hotel', expected_revision: number) => apiFetch<{ trip: Record<string, any>; availability: DiscoveryStatus }>(`/api/trips/${encodeURIComponent(id)}/travel-options/refresh`, {
    method: 'POST', body: JSON.stringify({ product, expected_revision }), timeoutMs: 45000,
  }),
};
export function externalTravelUrl(kind: 'flight' | 'hotel', trip: TripSummary) {
  const dates = [trip.startDate, trip.endDate].filter(Boolean).join(' to ');
  const query = kind === 'flight'
    ? `Flights from ${trip.origin || ''} to ${trip.destination} on ${trip.startDate || ''} ${trip.travelersCount} travelers`
    : `Hotels in ${trip.destination} ${dates} ${trip.travelersCount} guests`;
  return `${kind === 'flight' ? 'https://www.google.com/travel/flights' : 'https://www.google.com/travel/hotels'}?q=${encodeURIComponent(query)}`;
}
