import { expect, Page } from '@playwright/test';

const backend = 'http://127.0.0.1:8000';
export async function demo(page: Page) {
  const trip = { id: 'payment-trip', destination: 'Goa', days: 2, travelers: 2, budget: 15000, currency: 'INR',
    revision: 1, plus_access: false, start_date: '2026-12-01', end_date: '2026-12-02', destination_timezone: 'Asia/Kolkata',
    selections: {}, flights: [], hotels: [], weather: { data_status: 'unavailable' },
    execution_state: { is_active: false, current_day_number: 1, activity_log: {}, reroute_history: [] },
    route_details: { day_by_day_route: [{ day: 1, date: '2026-12-01', stops: [{ id: 'museum', name: 'Goa Museum', title: 'Goa Museum', type: 'attraction', time: '09:00 - 10:00', start_time: '09:00', end_time: '10:00' }] }] } };
  let order: any = null;
  let settle = true;
  let attempts = 0;
  let outcome = 'success';
  await page.addInitScript(({ backend }) => {
    localStorage.setItem('TRAVELAI_FASTAPI_URL', backend);
    localStorage.setItem('travelai_token', 'demo-session');
    localStorage.setItem('travelai_user', JSON.stringify({ id: 'demo-user', name: 'Explorer', email: 'demo@example.com' }));
  }, { backend });
  await page.route(`${backend}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: any = {}, status = 200;
    if (path === '/api/auth/me') data = { user: { id: 'demo-user', name: 'Explorer', email: 'demo@example.com' } };
    else if (path === '/api/trips/history') data = [trip];
    else if (path === '/api/trips/payment-trip') data = trip;
    else if (path === '/api/bookings/status') data = { trip_id: trip.id, current: [], previous: [] };
    else if (path === '/api/chat/conversations' || path === '/api/bookings/history') data = [];
    else if (path.startsWith('/api/payments')) {
      expect(request.headers().authorization).toBe('Bearer demo-session');
      if (path === '/api/payments/orders' && request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({ trip_id: trip.id });
        order ??= { id: 'demo-order', trip_id: trip.id, trip_title: 'Goa', amount: 49900, currency: 'INR', product: 'trip_plus', mode: 'demo', days: 2, travelers: 2, status: 'created', attempts: [], created_at: '2026-10-14T12:00:00', updated_at: '2026-10-14T12:00:00' };
        data = order;
      } else if (path === '/api/payments/history') data = order ? [order] : [];
      else if (path.endsWith('/simulate')) {
        const body = request.postDataJSON(); expect(Object.keys(body).sort()).toEqual(['method', 'outcome']);
        outcome = body.outcome;
        if (order.status !== 'succeeded') {
          attempts++;
          order = { ...order, method: body.method, status: outcome === 'cancel' ? 'cancelled' : 'pending', attempts: [...order.attempts, { number: attempts, method: body.method }] };
        }
        data = order;
      } else if (path.endsWith('/receipt')) {
        if (order?.status !== 'succeeded') { status = 409; data = { detail: 'Not confirmed' }; }
        else data = { ...order, receipt_type: 'demo', money_charged: 0 };
      } else if (path === '/api/payments/orders/demo-order' && order) {
        if (order.status === 'pending' && settle) {
          order = { ...order, status: outcome === 'failure' ? 'failed' : 'succeeded' };
          trip.plus_access = order.status === 'succeeded';
        }
        data = order;
      } else { status = 404; data = { detail: 'Demo order not found' }; }
    } else if (path === '/' || path === '/health/ready') data = { status: 'ok' };
    await route.fulfill({ status, json: data });
  });
  await page.route('https://**/*', route => route.abort());
  return { hold: () => { settle = false; }, release: () => { settle = true; }, attempts: () => attempts, trip };
}
