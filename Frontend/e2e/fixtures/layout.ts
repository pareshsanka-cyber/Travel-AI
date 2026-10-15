import { Page } from '@playwright/test';

export async function layoutFixture(page: Page, longTitle = false) {
  const trip = { id: 'layout-trip', destination: longTitle ? 'An extended family adventure through Sydney Harbour, the Royal Botanic Gardens and surrounding cultural highlights' : 'Sydney, Australia', origin: 'Hyderabad', days: 4, travelers: 7,
    budget: 250000, plus_access: true, title: longTitle ? 'An extended family adventure through Sydney Harbour, the Royal Botanic Gardens and surrounding cultural highlights' : undefined,
    start_date: '2026-10-21', end_date: '2026-10-24', flights: [], hotels: [],
    route_details: { day_by_day_route: [{ day: 1, date: '2026-10-21', stops: [
      { id: 'a', name: 'Sydney Harbour', type: 'attraction', start_time: '09:00', end_time: '10:00', lat: -33.86, lon: 151.21 },
      { id: 'b', name: 'Royal Botanic Garden', type: 'attraction', start_time: '11:00', end_time: '12:00', lat: -33.864, lon: 151.216 },
      { id: 'c', name: 'Museum of Contemporary Art', type: 'attraction', start_time: '13:00', end_time: '14:00', lat: -33.859, lon: 151.209 }
    ] }] } };
  await page.addInitScript(() => {
    localStorage.setItem('TRAVELAI_THEME', 'dark');
    localStorage.setItem('travelai_token', 'layout-session');
    localStorage.setItem('travelai_user', JSON.stringify({ id: 'layout-user', name: 'Traveler' }));
    localStorage.setItem('TRAVELAI_FASTAPI_URL', 'http://127.0.0.1:8000');
    localStorage.setItem('TRAVELAI_TRAVEL_CONTEXT', JSON.stringify({ destination: 'Goa, India', origin: 'Hyderabad' }));
  });
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: any = {};
    if (path === '/api/auth/me') data = { user: { id: 'layout-user', name: 'Traveler' } };
    else if (path === '/api/trips/history') data = [trip];
    else if (path === '/api/trips/layout-trip') data = trip;
    else if (path === '/api/bookings/status') data = { trip_id: trip.id, current: [], previous: [] };
    else if (path === '/api/chat/conversations') data = [];
    else if (path === '/api/trips/layout-trip/edit-session') data = { conversation_id: 'edit-sydney', current_trip_id: trip.id };
    else if (path === '/api/chat/conversations/edit-sydney') data = { conversation_id: 'edit-sydney', current_trip_id: trip.id, travel_context: { destination: trip.destination, origin: trip.origin, days: 4, travelers: 7, current_trip_id: trip.id }, messages: [] };
    else if (path === '/health/ready') data = { status: 'ok' };
    await route.fulfill({ json: data });
  });
  await page.route('https://**/*', route => route.abort());
}
