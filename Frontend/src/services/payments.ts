import { apiFetch } from './api';

export type DemoMethod = 'upi' | 'card' | 'netbanking';
export type DemoOutcome = 'success' | 'failure' | 'delayed' | 'cancel';
export interface DemoOrder {
  id: string; trip_id: string; trip_title: string; days: number; travelers: number;
  amount: number; currency: string; mode: 'demo'; product: 'trip_plus' | 'flight_demo' | 'hotel_demo';
  booking?: BookingSnapshot; booking_notice?: string | null;
  expected_revision?: number;
  status: 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled';
  method?: DemoMethod; created_at: string; updated_at: string;
  attempts: { number: number; method: DemoMethod; status: string }[];
}
export interface BookingSnapshot {
  kind: 'flight' | 'hotel'; source: 'discovered' | 'sample'; option_id: string; name: string;
  origin: string; destination: string; departure_date: string; departure_time?: string;
  arrival_time?: string; flight_number?: string; check_in: string; check_out: string;
  arrival_date?: string;
  nights: number; travelers: number; rooms?: number; unit_amount: number; quantity: number;
  currency: string; amount: number;
}
export interface BookingRequest {
  trip_id: string; kind: 'flight' | 'hotel'; source: 'discovered' | 'sample';
  option_id: string; rooms?: number; expected_revision: number;
}
export const formatMoney = (amount: number, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 100);
export const productLabel = (order: DemoOrder) => order.product === 'flight_demo' ? 'Flight demo booking' : order.product === 'hotel_demo' ? 'Hotel demo booking' : 'Trip Plus';
export const methodLabels: Record<DemoMethod, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking' };
export const paymentApi = {
  create: (tripId: string): Promise<DemoOrder> => apiFetch('/api/payments/orders', { method: 'POST', body: JSON.stringify({ trip_id: tripId }) }),
  get: (id: string): Promise<DemoOrder> => apiFetch(`/api/payments/orders/${encodeURIComponent(id)}`),
  simulate: (id: string, method: DemoMethod, outcome: DemoOutcome): Promise<DemoOrder> => apiFetch(`/api/payments/orders/${encodeURIComponent(id)}/simulate`, { method: 'POST', body: JSON.stringify({ method, outcome }) }),
  history: (): Promise<DemoOrder[]> => apiFetch('/api/payments/history'),
  receipt: (id: string): Promise<DemoOrder> => apiFetch(`/api/payments/orders/${encodeURIComponent(id)}/receipt`),
  book: (request: BookingRequest): Promise<DemoOrder> => apiFetch('/api/bookings/orders', { method: 'POST', body: JSON.stringify(request) }),
  bookings: (): Promise<DemoOrder[]> => apiFetch('/api/bookings/history'),
  status: (tripId: string): Promise<TripBookingStatus> => apiFetch(`/api/bookings/status?trip_id=${encodeURIComponent(tripId)}`),
  confirmation: (id: string): Promise<DemoOrder> => apiFetch(`/api/bookings/orders/${encodeURIComponent(id)}/confirmation`),
};
export interface TripBookingStatus { trip_id: string; current: DemoOrder[]; previous: DemoOrder[] }

export function orderUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (!id || id !== url.searchParams.get('payment_order')) url.searchParams.delete('payment_view');
  if (id) url.searchParams.set('payment_order', id);
  else url.searchParams.delete('payment_order');
  window.history.replaceState(null, '', url);
}
