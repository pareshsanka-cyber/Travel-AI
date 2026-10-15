import { test, expect, Page } from '@playwright/test';

const backend = 'http://127.0.0.1:8000';
async function demo(page: Page) {
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

async function navigation(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('locked exports lead to demo checkout; refresh resumes and server success unlocks only this trip', async ({ page }) => {
  const mock = await demo(page); mock.hold();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Upgrade this trip' })).toBeVisible();
  await page.getByRole('button', { name: 'Unlock Companion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upgrade your Goa trip' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to itinerary', exact: true }).click();
  await page.getByRole('button', { name: 'Download itinerary calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Upgrade your Goa trip' })).toBeVisible();
  await expect(page.getByText('DEMO — NO REAL MONEY')).toBeVisible();
  await page.getByRole('radio', { name: 'Card', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Demo Card selected')).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₹499 — Demo', exact: true }).click();
  await expect(page.getByText('Confirming your demo payment', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/payment_order=demo-order/);
  await page.reload();
  await expect(page.getByText('Confirming your demo payment', { exact: true })).toBeVisible();
  expect(mock.attempts()).toBe(1);
  mock.release();
  await expect(page.getByText('Demo payment successful — no money charged', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View receipt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo receipt', exact: true })).toBeVisible();
  await expect(page.getByText('Card', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.print = () => { (window as any).__printed = document.getElementById('travelai-print-document')?.textContent; }; });
  await page.getByRole('button', { name: 'Print / save to PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toContain('Demo receipt');
  await page.getByRole('button', { name: 'Payment history', exact: true }).click();
  await expect(page.getByText('₹499 · succeeded · Demo')).toBeVisible();
  await page.getByRole('button', { name: 'Open order', exact: true }).click();
  await page.getByRole('button', { name: 'Open Companion Mode', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trip Plus active', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Complete', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('failure can retry, cancellation stays free and checkout never requests banking details', async ({ page }) => {
  const mock = await demo(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Upgrade only — ₹499 Demo', exact: true }).click();
  await page.getByRole('radio', { name: 'Net banking', exact: true }).check();
  await page.getByRole('radio', { name: 'Failure', exact: true }).check();
  await page.getByRole('button', { name: 'Pay ₹499 — Demo', exact: true }).click();
  await expect(page.getByText(/The demo attempt was intentionally set to fail/)).toBeVisible();
  expect(mock.trip.plus_access).toBe(false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(/Demo payment cancelled/)).toBeVisible();
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Success', exact: true }).check();
  await page.getByRole('button', { name: 'Pay ₹499 — Demo', exact: true }).click();
  await expect(page.getByText('Demo payment successful — no money charged', { exact: true })).toBeVisible();
  expect(mock.attempts()).toBe(3);
});

test('delayed confirmation remains pending after timeout and manual checking is authoritative', async ({ page }) => {
  const mock = await demo(page); mock.hold();
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Upgrade only — ₹499 Demo', exact: true }).click();
  await page.getByRole('radio', { name: 'Delayed confirmation', exact: true }).check();
  await page.getByRole('button', { name: 'Pay ₹499 — Demo', exact: true }).click();
  await expect(page.getByText('Confirming your demo payment', { exact: true })).toBeVisible();
  await page.clock.fastForward(31000);
  await expect(page.getByText('Demo confirmation is still pending', { exact: true })).toBeVisible();
  expect(mock.trip.plus_access).toBe(false);
  await expect(page.getByRole('button', { name: 'View receipt', exact: true })).toHaveCount(0);
  mock.release();
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByText('Demo payment successful — no money charged', { exact: true })).toBeVisible();
});

test('travel selections separate Trip Plus from reservations and fit the viewport', async ({ page }) => {
  await demo(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Upgrade this trip' })).toBeVisible();
  await navigation(page, 'Travel Selections');
  await expect(page.getByText(/Flight and hotel costs are separate and are not collected/)).toBeVisible();
  await page.getByRole('button', { name: 'Upgrade only — ₹499 Demo', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Order summary' })).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Back to itinerary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upgrade this trip' })).toBeVisible();
});
