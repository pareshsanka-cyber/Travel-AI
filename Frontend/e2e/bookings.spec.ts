import { test, expect, Page } from '@playwright/test';

const backend = 'http://127.0.0.1:8000';
async function fixture(page: Page, options: { empty?: boolean; conflict?: boolean; usd?: boolean; legacy?: boolean; multiple?: boolean } = {}) {
  const trip: any = { id: 'booking-trip', destination: 'Goa', origin: 'Hyderabad', days: 3, travelers: 2, budget: 20000, currency: 'INR', revision: 1,
    start_date: '2026-12-01', end_date: '2026-12-03', destination_timezone: 'Asia/Kolkata', plus_access: false,
    selections: { flight_id: 'f1', hotel_id: 'h1' },
    flights: options.empty ? [] : [{ id: 'f1', airline: 'First airline', flight_number: 'FA 1', departure_time: '08:00', arrival_time: '10:00', price: 1000 },
      { id: 'f2', airline: 'Second airline', flight_number: 'SA 2', departure_time: '09:00', arrival_time: '11:00', price: 1500 }],
    hotels: options.empty ? [] : [{ id: 'h1', name: 'Test Hotel', price_per_night: options.usd ? 120 : 2500, currency: options.usd ? 'USD' : 'INR', address: 'Goa' },
      { id: 'h2', name: 'Other Hotel', price_per_night: 3000, address: 'Goa' }],
    route_details: { day_by_day_route: [{ day: 1, date: '2026-12-01', stops: [{ id: 'museum', name: 'Goa Museum', title: 'Goa Museum', type: 'attraction', start_time: '09:00', end_time: '10:00', time: '09:00 - 10:00' }] }] },
    execution_state: { is_active: false, current_day_number: 1, activity_log: {}, reroute_history: [] } };
  if (options.legacy) {
    delete trip.revision; delete trip.selections;
    trip.route_details.day_by_day_route = [{ day: 1, stops: [{ name: 'Sydney landmark', lat: -33.8, lon: 151.2, type: 'attraction' }] }];
    trip.execution_state = { is_active: true, activity_log: { preserved: 'completed' } };
    trip.plus_access = true;
  }
  const originalRoute = JSON.stringify(trip.route_details);
  const otherTrip = { ...structuredClone(trip), id: 'other-trip', destination: 'Pune', title: 'Other expedition' };
  const orders = new Map<string, any>();
  let held = false;
  let createCount = 0;
  let statusUnavailable = false;
  const requests: string[] = [];
  await page.addInitScript(({ backend }) => {
    localStorage.setItem('TRAVELAI_FASTAPI_URL', backend);
    localStorage.setItem('travelai_token', 'booking-session');
    localStorage.setItem('travelai_user', JSON.stringify({ id: 'booking-user', name: 'Explorer', email: 'demo@example.com' }));
  }, { backend });
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: any = {}, status = 200;
    requests.push(path);
    if (path === '/api/auth/me') data = { user: { id: 'booking-user', name: 'Explorer', email: 'demo@example.com' } };
    else if (path === '/api/trips/history') data = options.multiple ? [trip, otherTrip] : [trip];
    else if (path === '/api/trips/booking-trip') data = trip;
    else if (path === '/api/trips/other-trip') data = otherTrip;
    else if (path === '/api/bookings/status') {
      if (statusUnavailable) { await route.fulfill({ status: 500, json: { detail: 'Status temporarily unavailable', request_id: 'status-check-ref' } }); return; }
      const requestedId = new URL(request.url()).searchParams.get('trip_id');
      const matching = [...orders.values()].filter(order => order.trip_id === requestedId && order.booking.departure_date === trip.start_date && order.booking.check_out === trip.end_date);
      const byOption = new Map<string, any>();
      for (const order of matching) {
        const key = order.booking.kind + order.booking.source + order.booking.option_id;
        if (!byOption.has(key) || order.status === 'succeeded') byOption.set(key, order);
      }
      data = { trip_id: requestedId, current: [...byOption.values()], previous: [...orders.values()].filter(order => order.trip_id === requestedId && order.status === 'succeeded' && !matching.includes(order)) };
    }
    else if (path === '/api/chat/conversations') data = [];
    else if (path === '/api/bookings/history' || path === '/api/payments/history') data = [...orders.values()];
    else if (path.endsWith('/selections')) {
      if (options.conflict) { status = 409; data = { detail: 'Trip changed. Refresh and select again.' }; }
      else { const body = request.postDataJSON(); trip.selections = { ...trip.selections, ...(body.flight_id ? { flight_id: body.flight_id } : { hotel_id: body.hotel_id }) }; trip.revision = (trip.revision || 1) + 1; data = { status: 'success', trip }; }
    } else if (path === '/api/bookings/orders') {
      createCount++;
      expect(request.headers().authorization).toBe('Bearer booking-session');
      const body = request.postDataJSON(); expect(body.expected_revision).toBe(trip.revision);
      expect(body.amount).toBeUndefined(); expect(body.plus_access).toBeUndefined();
      const item = body.source === 'sample' ? null : (body.kind === 'flight' ? trip.flights : trip.hotels).find((item: any) => item.id === body.option_id);
      const rooms = body.rooms || 1, nights = 2;
      const unit = body.source === 'sample' ? body.kind === 'flight' ? 500000 : 250000 : Math.round((body.kind === 'flight' ? item.price : item.price_per_night) * 100);
      const currency = body.source === 'sample' ? 'INR' : item.currency || 'INR';
      const id = body.kind + '-' + body.option_id + '-' + rooms;
      if (!orders.has(id)) orders.set(id, { id, trip_id: trip.id, trip_title: 'Goa', days: 3, travelers: 2,
        currency, amount: unit * (body.kind === 'flight' ? 2 : nights * rooms), mode: 'demo', product: body.kind + '_demo',
        expected_revision: trip.revision, status: 'created', attempts: [], created_at: '2026-10-14T12:00:00', updated_at: '2026-10-14T12:00:00',
        booking: { kind: body.kind, source: body.source, option_id: body.option_id, name: item?.name || item?.airline || (body.kind === 'flight' ? 'Sample demo airline' : 'Sample demo hotel'),
          origin: 'Hyderabad', destination: 'Goa', departure_date: '2026-12-01', departure_time: item?.departure_time || '08:00', arrival_time: item?.arrival_time || '10:00',
          check_in: '2026-12-01', check_out: '2026-12-03', nights, rooms, travelers: 2, unit_amount: unit, currency } });
      data = orders.get(id);
    } else if (path.startsWith('/api/payments/orders/') || path.startsWith('/api/bookings/orders/')) {
      const id = path.split('/')[4], order = orders.get(id);
      if (!order) { status = 404; data = { detail: 'Order not found' }; }
      else if (path.endsWith('/simulate')) {
        const body = request.postDataJSON();
        if (order.status !== 'succeeded') { order.method = body.method; order.outcome = body.outcome; order.status = body.outcome === 'cancel' ? 'cancelled' : 'pending'; order.attempts.push({ method: body.method }); }
        data = order;
      } else {
        if (order.status === 'pending' && !held) { order.status = order.outcome === 'failure' ? 'failed' : 'succeeded'; if (order.status === 'succeeded') { trip.plus_access = true; trip.plus_access_source = 'booking'; } }
        data = { ...order, ...(order.status === 'succeeded' && trip.end_date !== order.booking.check_out ? { booking_notice: 'Your trip details changed. This demo booking retains its original details.' } : {}) };
      }
    } else if (path === '/' || path === '/health/ready') data = { status: 'ok' };
    await route.fulfill({ status, json: data });
  });
  await page.route('https://**/*', route => route.abort());
  return { hold: () => { held = true; }, release: () => { held = false; }, trip, requests, orders,
    unavailable: (value: boolean) => { statusUnavailable = value; },
    createCount: () => createCount, routeIntact: () => JSON.stringify(trip.route_details) === originalRoute };
}

async function selections(page: Page) {
  await page.getByRole('button', { name: 'Book a flight or hotel — Demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Travel Selections', exact: true })).toBeVisible();
}

for (const kind of ['flight', 'hotel'] as const) {
  test(`${kind} success returns to its tab with a persistent booked badge and confirmation`, async ({ page }) => {
    const mock = await fixture(page);
    await page.goto('/');
    await page.getByRole('button', { name: kind === 'flight' ? /^Flights \(/ : /^Hotels \(/ }).click();
    await page.getByRole('button', { name: `Book ${kind} — Demo`, exact: true }).first().click();
    await page.getByRole('button', { name: /^Pay .*Demo$/ }).click();
    await expect(page.getByRole('heading', { name: `${kind === 'flight' ? 'Flight' : 'Hotel'} booked successfully — Demo`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `View booked ${kind}`, exact: true }).click();
    await expect(page.getByText('Booked — Demo', { exact: true })).toBeVisible();
    const bought = [...mock.orders.values()].find(order => order.status === 'succeeded');
    // A later failed attempt and changed estimate cannot replace a successful purchase.
    mock.orders.set('later-failure', { ...bought, id: 'later-failure', status: 'failed' });
    if (kind === 'flight') mock.trip.flights[0].price *= 2;
    else mock.trip.hotels[0].price_per_night *= 2;
    await page.reload();
    await page.getByRole('button', { name: kind === 'flight' ? /^Flights \(/ : /^Hotels \(/ }).click();
    await expect(page.getByText('Booked — Demo', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View confirmation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Demo booking confirmation', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Demo booking confirmation', exact: true })).toBeVisible();
    expect(mock.createCount()).toBe(1);
  });
}

test('unavailable booking status prevents duplicate purchases and can be retried', async ({ page }) => {
  const mock = await fixture(page); mock.unavailable(true);
  await page.goto('/'); await page.getByRole('button', { name: /^Flights \(/ }).click();
  await expect(page.getByText('Booking status unavailable', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book flight — Demo', exact: true })).toHaveCount(0);
  mock.unavailable(false);
  await page.getByRole('button', { name: 'Retry status check', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Book flight — Demo', exact: true }).first()).toBeVisible();
  expect(mock.createCount()).toBe(0);
});

test('legacy current hotel can be booked with active Companion without changing untimed stops or progress', async ({ page }) => {
  const mock = await fixture(page, { legacy: true });
  const progress = JSON.stringify(mock.trip.execution_state);
  await page.goto('/'); await page.getByRole('button', { name: /^Hotels \(/ }).click();
  await page.getByRole('button', { name: 'Book hotel — Demo', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Demo hotel checkout', exact: true })).toBeVisible();
  expect(mock.requests).toContain('/api/trips/booking-trip/selections');
  await page.getByRole('button', { name: /^Pay .*Demo$/ }).click();
  await expect(page.getByRole('heading', { name: 'Hotel booked successfully — Demo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View booked hotel', exact: true }).click();
  await expect(page.getByText('Booked — Demo', { exact: true })).toBeVisible();
  expect(mock.routeIntact()).toBe(true);
  expect(JSON.stringify(mock.trip.execution_state)).toBe(progress);
});

test('trip switching clears purchased status and changed dates expose the original confirmation', async ({ page }) => {
  const mock = await fixture(page, { multiple: true });
  await page.goto('/'); await page.getByRole('button', { name: /^Flights \(/ }).click();
  await page.getByRole('button', { name: 'Book flight — Demo', exact: true }).first().click();
  await page.getByRole('button', { name: /^Pay .*Demo$/ }).click();
  await page.getByRole('button', { name: 'View booked flight', exact: true }).click();
  await expect(page.getByText('Booked — Demo', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  if (await menu.isVisible()) await menu.click();
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }); if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: /^Other expedition/ }).click();
  await page.getByRole('button', { name: /^Flights \(/ }).click();
  await expect(page.getByText('Booked — Demo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Book flight — Demo', exact: true }).first()).toBeVisible();
  mock.trip.end_date = '2026-12-04';
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: /^Goa Circuit/ }).click();
  await page.getByRole('button', { name: /^Flights \(/ }).click();
  await expect(page.getByText('Booked — Demo', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View previous confirmation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo booking confirmation', exact: true })).toBeVisible();
  expect(mock.createCount()).toBe(1);
});

test('unselected flight is saved before booking; refresh, confirmation and Companion work', async ({ page }) => {
  const mock = await fixture(page); mock.hold();
  await page.goto('/');
  await page.getByRole('button', { name: /^Flights \(/ }).click();
  await page.getByRole('button', { name: 'Book flight — Demo', exact: true }).nth(1).click();
  await expect(page.getByRole('heading', { name: 'Demo flight checkout', exact: true })).toBeVisible();
  expect(mock.requests.indexOf('/api/trips/booking-trip/selections')).toBeLessThan(mock.requests.indexOf('/api/bookings/orders'));
  await expect(page.getByText('Trip Plus included for this trip — ₹0 extra', { exact: true })).toBeVisible();
  await expect(page.getByText('Second airline', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Card', exact: true }).focus(); await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Pay ₹3,000 — Demo', exact: true }).click();
  await expect(page.getByText('Confirming your demo payment', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('Confirming your demo payment', { exact: true })).toBeVisible();
  mock.release();
  await expect(page.getByText('Demo booking successful — no money charged', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View demo confirmation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo booking confirmation', exact: true })).toBeVisible();
  await page.evaluate(() => { window.print = () => { (window as any).__printed = document.getElementById('travelai-print-document')?.textContent; }; });
  await page.getByRole('button', { name: 'Print / save to PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toContain('Second airline');
  await page.getByRole('button', { name: 'Back to payment', exact: true }).click();
  await page.getByRole('button', { name: 'Open Companion Mode', exact: true }).click();
  await expect(page.getByText('Plus active \u2713', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Complete', exact: true })).toBeVisible();
});

test('hotel room counts reprice in the original currency and history retains the snapshot', async ({ page }) => {
  const mock = await fixture(page, { usd: true });
  await page.goto('/'); await selections(page);
  await page.getByRole('button', { name: 'Book hotel — Demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo hotel checkout', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Rooms', exact: true }).selectOption('3');
  await expect(page.getByText('2 nights · 3 rooms · 2 guests', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Pay.*720.*Demo/ }).click();
  await expect(page.getByText('Demo booking successful — no money charged', { exact: true })).toBeVisible();
  const paid = [...mock.orders.values()].find(item => item.status === 'succeeded');
  expect(paid.currency).toBe('USD'); expect(paid.amount).toBe(72000);
  mock.trip.end_date = '2026-12-04';
  await page.getByRole('button', { name: 'View demo confirmation', exact: true }).click();
  await expect(page.getByText(/This demo booking retains its original details/)).toBeVisible();
  await expect(page.getByText('2026-12-01 → 2026-12-03', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Payment history', exact: true }).click();
  await expect(page.getByText('Goa · Hotel demo booking', { exact: true })).toHaveCount(2);
});

test('sample bookings are visibly fictional and leave the itinerary and travel selections unchanged', async ({ page }) => {
  const mock = await fixture(page, { empty: true });
  await page.goto('/'); await selections(page);
  await expect(page.getByRole('heading', { name: 'Try sample demo bookings' })).toBeVisible();
  await page.getByRole('button', { name: 'Try sample hotel — Demo', exact: true }).click();
  await expect(page.getByText(/Fictional sample choice/)).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₹5,000 — Demo', exact: true }).click();
  await expect(page.getByText('Demo booking successful — no money charged', { exact: true })).toBeVisible();
  expect(mock.routeIntact()).toBe(true); expect(mock.trip.flights).toEqual([]); expect(mock.trip.hotels).toEqual([]);
  await page.getByRole('button', { name: 'Return to trip', exact: true }).click();
  await expect(page.getByText('Plus active \u2713', { exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation menu' }); if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Travel Selections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View demo booking', exact: true })).toBeVisible();
});

test('a selection conflict cannot open checkout or create a booking', async ({ page }) => {
  const mock = await fixture(page, { conflict: true }); await page.goto('/');
  await page.getByRole('button', { name: /^Flights \(/ }).click();
  await page.getByRole('button', { name: 'Book flight — Demo', exact: true }).nth(1).click();
  await expect(page.getByRole('alert')).toContainText('Trip changed');
  expect(mock.createCount()).toBe(0);
  await expect(page.getByRole('heading', { name: 'Demo flight checkout', exact: true })).toHaveCount(0);
});

test('booking failure, cancellation, delayed pending notice and retry are safe on mobile and desktop', async ({ page }) => {
  const mock = await fixture(page, { empty: true }); await page.clock.install();
  await page.goto('/'); await selections(page);
  await page.getByRole('button', { name: 'Try sample flight — Demo', exact: true }).click();
  await page.getByRole('radio', { name: 'Failure', exact: true }).check();
  await page.getByRole('button', { name: 'Pay ₹10,000 — Demo', exact: true }).click();
  await page.clock.fastForward(1000);
  await expect(page.getByText(/intentionally set to fail/)).toBeVisible();
  expect(mock.trip.plus_access).toBe(false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(/Demo payment cancelled/)).toBeVisible();
  mock.hold();
  await page.getByRole('radio', { name: 'Delayed confirmation', exact: true }).check();
  await page.getByRole('button', { name: 'Pay ₹10,000 — Demo', exact: true }).click();
  await expect(page.getByText('Confirming your demo payment', { exact: true })).toBeVisible();
  await page.clock.fastForward(31000);
  await expect(page.getByText('Demo confirmation is still pending', { exact: true })).toBeVisible();
  expect(mock.trip.plus_access).toBe(false);
  mock.release(); await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByText('Demo booking successful — no money charged', { exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});
