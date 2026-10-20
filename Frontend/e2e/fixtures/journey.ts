import { Page } from '@playwright/test';
import { reviewSnapshot, directionsSnapshot } from './routingV2';

export async function journeyFixture(page: Page, options: { legacy?: boolean; failure?: boolean; skipOnly?: boolean; conflict?: boolean; fallbackRoute?: boolean; flight?: boolean } = {}) {
  const stops = [
    { id: 'a', name: 'Sydney Harbour', type: 'attraction', start_time: '09:00', end_time: '10:00', timezone: 'Australia/Sydney', lat: -33.86, lon: 151.21 },
    { id: 'b', name: 'Royal Botanic Garden', type: 'attraction', start_time: '11:00', end_time: '12:00', timezone: 'Australia/Sydney', lat: -33.864, lon: 151.216 },
    { id: 'c', name: 'Museum of Contemporary Art', type: 'attraction', start_time: '13:00', end_time: '14:00', timezone: 'Australia/Sydney', lat: -33.859, lon: 151.209 },
  ];
  if (options.flight) {
    Object.assign(stops[0], { name: 'Hyderabad Airport', type: 'airport', lat: 17.2403, lon: 78.4294, timezone: 'Asia/Kolkata' });
    Object.assign(stops[1], { name: 'Sydney Airport', type: 'airport' });
  }
  const trip: any = { id: 'journey-trip', destination: 'Sydney, Australia', origin: 'Hyderabad', days: 2, travelers: 2, budget: 120000,
    currency: 'INR', destination_timezone: options.legacy ? undefined : 'Australia/Sydney', revision: 1, plus_access: true, flights: [], hotels: [],
    start_date: '2026-10-22', end_date: '2026-10-23', execution_state: { is_active: true, current_day_number: 1, activity_log: {}, reroute_history: [] },
    route_details: { day_by_day_route: [{ day: 1, date: '2026-10-22', stops: options.legacy ? stops.map(({ start_time, end_time, timezone, ...stop }) => stop) : stops },
      { day: 2, date: '2026-10-23', stops: [{ ...stops[0], id: 'd' }] }] } };
  await page.addInitScript(() => {
    localStorage.setItem('travelai_token', 'journey-session');
    localStorage.setItem('travelai_user', JSON.stringify({ id: 'journey-owner', name: 'Traveler' }));
    localStorage.setItem('TRAVELAI_FASTAPI_URL', 'http://127.0.0.1:8000'); localStorage.setItem('TRAVELAI_THEME', 'dark');
    const animate = Element.prototype.animate;
    (window as any).__journeyAnimations = [];
    Element.prototype.animate = function (frames, settings) {
      const row = this.closest('[data-activity-id]');
      (window as any).__journeyAnimations.push({ row: row?.getAttribute('data-activity-id'),
        check: !!this.closest('[data-completion-check]'), mask: this.parentElement?.tagName.toLowerCase() === 'mask',
        timer: !!this.closest('[data-testid="companion-countdown"]'), progress: this.getAttribute('data-testid') === 'companion-progress', frames });
      return animate.call(this, frames, settings);
    };
  });
  const writes: any[] = [], previews: any[] = [], confirmations: any[] = [];
  let gate: Promise<void> = Promise.resolve(), release = () => {};
  const replacement = { ...stops[0], id: 'replacement', name: 'Sydney Observatory', start_time: '09:30', end_time: '10:30' };
  const proposed = options.skipOnly ? stops.slice(1) : [replacement, { ...stops[1], start_time: '11:30', end_time: '12:30' }, stops[2]];
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200, data: any = {};
    if (path === '/api/auth/me') data = { user: { id: 'journey-owner', name: 'Traveler' } };
    else if (path === '/api/trips/history') data = [trip];
    else if (path === '/api/trips/journey-trip') data = trip;
    else if (path === '/api/bookings/status') data = { trip_id: trip.id, current: [], previous: [] };
    else if (path === '/api/chat/conversations') data = [];
    else if (path.endsWith('/execution_state')) {
      const body = route.request().postDataJSON(); writes.push(body); await gate;
      if (options.failure) { status = 500; data = { detail: 'Progress could not be saved.', request_id: 'progress-ref' }; }
      else { trip.execution_state = body.execution_state; trip.revision++; data = { status: 'success', execution_state: trip.execution_state, revision: trip.revision }; }
    } else if (path.endsWith('/directions')) {
      const url = new URL(route.request().url());
      const day = trip.route_details.day_by_day_route.find((d: any) => d.day === Number(url.searchParams.get('day_number')));
      data = directionsSnapshot(trip.revision, day?.stops || [], options.fallbackRoute, options.flight);
    } else if (path.endsWith('/reroute/preview')) {
      const body = route.request().postDataJSON(); previews.push(body);
      data = reviewSnapshot(trip.revision, stops, options.skipOnly ? stops : proposed, !!options.skipOnly, body.trigger);
    }
    else if (path.endsWith('/reroute/apply')) {
      confirmations.push(route.request().postDataJSON());
      if (options.conflict) { status = 409; data = { detail: 'Trip changed. Generate a fresh preview.', request_id: 'reroute-ref' }; }
      else { if (!options.skipOnly) trip.route_details.day_by_day_route[0].stops = proposed;
        trip.execution_state.activity_log.a = { status: 'skipped', activity_id: 'a' };
        trip.revision++; data = { status: 'success', trip_id: trip.id, revision: trip.revision, route_details: trip.route_details, execution_state: trip.execution_state }; }
    } else if (path === '/' || path === '/health/ready') data = { status: 'ok' };
    await route.fulfill({ status, json: data });
  });
  await page.route('https://**/*', async route => {
    if (route.request().url().includes('router.project-osrm.org') && !options.fallbackRoute) {
      const match = route.request().url().match(/driving\/([^?]+)/);
      const coordinates = (match?.[1] || '').split(';').map(pair => pair.split(',').map(Number));
      await route.fulfill({ json: { code: 'Ok', routes: [{ distance: 1100, duration: 240, geometry: { coordinates }, legs: [{ steps: [] }] }] } });
    } else await route.abort();
  });
  return { trip, writes, previews, confirmations, hold: () => { gate = new Promise<void>(resolve => { release = resolve; }); }, release: () => release() };
}
