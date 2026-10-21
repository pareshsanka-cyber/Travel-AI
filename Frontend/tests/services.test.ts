import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, ApiError, fetchFlightOptions, fetchBudgetOverview, fetchHotelOptions, fetchWeatherCondition, updateExecutionState, applyReroute, extractTripSummary, extractItineraryDays, setApiStatusListener, checkTripPlanningConstraints } from '../src/services/api';
import { getApiBaseUrl } from '../src/services/apiConfig';
import { paymentApi, formatMoney } from '../src/services/payments';

const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => storage.get(key) || null },
  window: { dispatchEvent: () => true },
});

test('saved venue hours normalize strings and arrays and preserve closure information', () => {
  const trip = { destination: 'Sydney', days: 1, start_date: '2026-10-21', end_date: '2026-10-21',
    route_details: { day_by_day_route: [{ day: 1, date: '2026-10-21', stops: [
      { id: 'closed', name: 'Museum', type: 'attraction', opening_hours: ' Monday: Closed\n Tuesday: 09:00–17:00 ', status: 'CLOSED', status_reason: 'Saved venue hours' },
      { id: 'listed', name: 'Gallery', type: 'attraction', opening_hours: [' 09:00–17:00 ', '', null], status: 'UNKNOWN' }
    ] }] } };
  const activities = extractItineraryDays(trip)[0].activities;
  assert.deepEqual(activities[0].operatingHours, ['Monday: Closed', 'Tuesday: 09:00–17:00']);
  assert.equal(activities[0].operatingStatus, 'CLOSED');
  assert.equal(activities[0].statusReason, 'Saved venue hours');
  assert.deepEqual(activities[1].operatingHours, ['09:00–17:00']);
  assert.equal(activities[1].operatingStatus, 'UNKNOWN');
});

test('server errors retain their HTTP status and request reference', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'Please retry.', request_id: 'request-123' }), { status: 500 })) as typeof fetch;
    await assert.rejects(apiFetch('/api/bookings/orders'), (error: unknown) => error instanceof ApiError && error.status === 500 && error.requestId === 'request-123' && error.message.includes('request-123'));
  } finally { globalThis.fetch = originalFetch; }
});

test('connection errors explain how to reconnect instead of exposing Failed to fetch', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(apiFetch('/api/bookings/orders'), /Unable to reach TravelAI.*API Settings/);
  } finally { globalThis.fetch = originalFetch; }
});

test('booking status queries the exact trip with safe URL encoding', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url) => {
      assert.ok(String(url).endsWith('/api/bookings/status?trip_id=trip%2Fwith%20space'));
      return new Response('{"trip_id":"trip/with space","current":[],"previous":[]}');
    }) as typeof fetch;
    assert.equal((await paymentApi.status('trip/with space')).trip_id, 'trip/with space');
  } finally { globalThis.fetch = originalFetch; }
});

test('all requests share configured URL and verified bearer identity', async () => {
  storage.set('TRAVELAI_FASTAPI_URL', 'http://localhost:8123/');
  storage.set('travelai_token', 'verified-session');
  storage.set('travelai_user', JSON.stringify({ id: 'spoofed' }));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, options) => {
      assert.equal(url, `${getApiBaseUrl()}/api/test`);
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer verified-session');
      assert.equal((options?.headers as Record<string, string>)['x-user-id'], undefined);
      return new Response('{}');
    }) as typeof fetch;
    await apiFetch('/api/test');
  } finally { globalThis.fetch = originalFetch; }
});

test('budget uses known backend amounts instead of fixed percentages', () => {
  const result = fetchBudgetOverview({ budget: 10000, budget_breakdown: { flight_cost: 2000, hotel_cost: 1500, notes: 'Missing food' } });
  assert.equal(result?.allocatedExpenditure, 3500);
  assert.equal(result?.notes, 'Missing food');
  assert.equal(result?.isComplete, false);
});

test('reopening a trip preserves its revision for progress writes', () => {
  assert.equal(extractTripSummary({ id:'trip-id', revision:9 }).revision,9);
});

test('overnight flight options retain the next-day arrival date', () => {
  const options = fetchFlightOptions({ start_date: '2026-10-21', flights: [{ id: 'overnight', departure_date: '2026-10-21', departure_time: '23:00', arrival_date: '2026-10-22', arrival_time: '01:30', price: 11000 }] });
  assert.equal(options[0].departureDateIso, '2026-10-21');
  assert.equal(options[0].arrivalDate, '2026-10-22');
  assert.equal(options[0].arrivalTime, '01:30');
});

test('Plus access is opt-in from the authoritative trip response', () => {
  assert.equal(extractTripSummary({ id: 'free' }).plusAccess, false);
  assert.equal(extractTripSummary({ id: 'paid', plus_access: true }).plusAccess, true);
  assert.equal(extractTripSummary({ id: 'forged', plusAccess: true, plus_access: 'true' }).plusAccess, false);
  assert.equal(extractTripSummary({ id: 'booked', plus_access: true, plus_access_source: 'booking' }).plusAccessSource, 'booking');
});

test('demo booking currencies format without conversion or hardcoded INR', () => {
  assert.equal(formatMoney(49900, 'INR'), '₹499');
  assert.match(formatMoney(72000, 'USD'), /720/);
  assert.ok(!formatMoney(72000, 'USD').includes('₹'));
  assert.equal(formatMoney(100025, 'INR'), '₹1,000.25');
});

test('booking requests send option identity and revision rather than a browser total', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, options) => {
      assert.ok(String(url).endsWith('/api/bookings/orders'));
      assert.deepEqual(JSON.parse(String(options?.body)), { trip_id: 'trip', kind: 'hotel', source: 'sample', option_id: 'sample-hotel', rooms: 3, expected_revision: 7 });
      return new Response('{"status":"created"}');
    }) as typeof fetch;
    await paymentApi.book({ trip_id: 'trip', kind: 'hotel', source: 'sample', option_id: 'sample-hotel', rooms: 3, expected_revision: 7 });
  } finally { globalThis.fetch = originalFetch; }
});

test('payment requests use the session and never submit an amount or entitlement', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: object; token: string }[] = [];
  storage.set('travelai_token', 'payment-session');
  try {
    globalThis.fetch = (async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(String(options?.body)), token: (options?.headers as Record<string, string>).Authorization });
      return new Response('{"id":"order","status":"pending"}');
    }) as typeof fetch;
    await paymentApi.create('trip');
    const result = await paymentApi.simulate('order', 'card', 'delayed');
    assert.deepEqual(requests.map(item => item.body), [{ trip_id: 'trip' }, { method: 'card', outcome: 'delayed' }]);
    assert.ok(requests.every(item => item.token === 'Bearer payment-session'));
    assert.equal(result.status, 'pending');
  } finally { globalThis.fetch = originalFetch; }
});

test('missing hotel results do not invent properties', () => {
  assert.deepEqual(fetchHotelOptions({ destination: 'Sydney', hotels: [] }), []);
  assert.deepEqual(fetchHotelOptions({ hotels: [{ name: 'Placeholder', source: 'planning_placeholder' }] }), []);
});

test('hotel options retain their currency and original IDs while excluding hostels', () => {
  const options = fetchHotelOptions({ currency: 'INR', hotels: [{ name: 'Budget Hostel', price_per_night: 500 }, { name: 'Hotel', currency: 'USD', price_per_night: 120 }] });
  assert.equal(options.length, 1);
  assert.equal(options[0].currency, 'USD');
  assert.equal(options[0].id, 'hotels-1');
});

test('weather never synthesizes daily values from a single temperature', () => {
  assert.equal(fetchWeatherCondition({ weather: { average_temp: '25°C' } }), null);
  assert.equal(fetchWeatherCondition({ weather: { data_status: 'unavailable' } }), null);
  const weather = { dailyForecast: [{ date: '2026-12-01', tempHigh: 20, tempLow: 10 }] };
  assert.equal(fetchWeatherCondition({ weather }), weather);
});

test('progress and reroutes include the revision and server proposal', async () => {
  const originalFetch = globalThis.fetch;
  const requests: object[] = [];
  try {
    globalThis.fetch = (async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response('{"status":"success"}');
    }) as typeof fetch;
    await updateExecutionState('persistent-trip', { activity_log: {} }, 7);
    await applyReroute('persistent-trip', { proposal_id: 'server-preview', day_number: 1, skipped_activity_id: 'a', proposed_stops: [], expected_revision: 8 });
    assert.equal((requests[0] as any).expected_revision, 7);
    assert.equal((requests[1] as any).proposal_id, 'server-preview');
    assert.equal((requests[1] as any).expected_revision, 8);
  } finally { globalThis.fetch = originalFetch; }
});

test('an HTTP conflict preserves its status without marking the API offline', async () => {
  const original = globalThis.fetch;
  let disconnected = false;
  setApiStatusListener(() => { disconnected = true; });
  try {
    globalThis.fetch = (async () => new Response('{"detail":"Trip changed"}', {status:409})) as typeof fetch;
    await assert.rejects(apiFetch('/api/test'), error => error instanceof ApiError && error.status === 409);
    assert.equal(disconnected,false);
  } finally { globalThis.fetch = original; setApiStatusListener(null); }
});

test('saved flight and hotel choices are reconstructed from server data', () => {
  const trip = { selections:{hotel_id:'h2'}, hotels:[{id:'h1',name:'First Hotel'},{id:'h2',name:'Second Hotel'}] };
  const options = fetchHotelOptions(trip);
  assert.equal(options[0].isSelected,false);
  assert.equal(options[1].isSelected,true);
});

test('cancelling a weather request on tab change does not mark the API offline', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let disconnected = false;
  setApiStatusListener(() => { disconnected = true; });
  try {
    globalThis.fetch = (async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); }) as typeof fetch;
    await assert.rejects(apiFetch('/api/trips/trip/weather', { signal: controller.signal }));
    assert.equal(disconnected, false);
  } finally { globalThis.fetch = original; setApiStatusListener(null); }
});

test('ordinary hyphenated trip requests recognize duration without extra questions', () => {
  const result = checkTripPlanningConstraints('Plan a 2-day trip from Hyderabad to Goa for 2 adults with a budget of INR 15000');
  assert.equal(result.mergedContext.days,2);
  assert.equal(result.isFullySatisfied,true);
});
