import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { layoutFixture } from './fixtures/layout';

const backend = 'http://127.0.0.1:8000';
function tripFixture() {
  return { id: 'layout-trip', destination: 'Sydney, Australia', origin: 'Hyderabad', days: 2, travelers: 2,
    budget: 40000, currency: 'INR', plus_access: true, revision: 7,
    start_date: '2026-10-21', end_date: '2026-10-22', selections: { flight_id: 'f1', hotel_id: 'h1' },
    flights: [{ id: 'f1', airline: 'Test Airline', flight_number: 'TA 101', departure_time: '08:00', arrival_time: '10:00', price: 5000 }],
    hotels: [{ id: 'h1', name: 'Saved Sydney hotel', price_per_night: 2500, address: 'Sydney', amenities: [] }],
    weather: { data_status: 'unavailable', dailyForecast: [] }, budget_breakdown: { flight_cost: 10000, hotel_cost: 2500, is_complete: false },
    route_details: { day_by_day_route: [{ day: 1, date: '2026-10-21', stops: [
      { id: 'visit', name: 'Sydney Harbour', type: 'attraction', start_time: '09:00', end_time: '10:00', lat: -33.86, lon: 151.21 }
    ] }] } };
}
async function prepare(page: Page) {
  await layoutFixture(page);
  const trip = tripFixture();
  await page.route(`${backend}/api/trips/history`, route => route.fulfill({ json: [trip] }));
  await page.route(`${backend}/api/trips/layout-trip`, route => route.fulfill({ json: trip }));
  await page.route(`${backend}/api/trips/layout-trip/weather*`, route => route.fulfill({ json: { trip_id: trip.id, weather: trip.weather } }));
}
const overview = (page: Page) => page.getByRole('button', { name: 'Overview', exact: true }).click();

test('readiness explains saved details and links to every review tab without writing the trip', async ({ page }, info) => {
  await prepare(page);
  const writes: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.url().startsWith(backend) && request.method() !== 'GET' && request.method() !== 'OPTIONS') writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const panel = page.getByLabel('Trip readiness', { exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('3 items to review');
  await expect(panel.locator('[data-readiness-item="flight"]')).toContainText('Planning choice only');
  await expect(panel.locator('[data-readiness-item="hotel"]')).toContainText('Saved Sydney hotel');
  await expect(panel.locator('[data-readiness-item="weather"]')).toContainText('No complete forecast');
  await expect(panel.locator('[data-readiness-item="budget"]')).toContainText('incomplete');
  await expect(panel.locator('[data-readiness-item="hours"]')).toContainText('hours checked');
  await mkdir('../.cache/trip-readiness', { recursive: true });
  await page.screenshot({ path: `../.cache/trip-readiness/${info.project.name}-dark.png`, fullPage: true });
  await panel.getByRole('button', { name: 'Review flights' }).click();
  await expect(page.getByRole('heading', { name: /Matched Flights/ })).toBeVisible();
  await overview(page);
  await panel.getByRole('button', { name: 'Review hotels' }).click();
  await expect(page.getByRole('heading', { name: 'Accommodation Options' })).toBeVisible();
  await overview(page);
  await panel.getByRole('button', { name: 'Check weather' }).click();
  await expect(page.getByRole('heading', { name: 'Forecast unavailable' })).toBeVisible();
  await overview(page);
  await panel.getByRole('button', { name: 'Review budget' }).click();
  await expect(page.getByRole('heading', { name: 'Autonomous Budget Auditor' })).toBeVisible();
  await overview(page);
  await panel.getByRole('button', { name: 'Review days & map' }).click();
  await expect(page.getByRole('navigation', { name: 'Trip days' })).toBeVisible();
  await expect(panel).toHaveCount(0);
  await overview(page);
  const summary = panel.locator('summary'); await summary.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Review flights' })).toBeHidden();
  await page.keyboard.press('Enter'); await expect(panel.getByRole('button', { name: 'Review flights' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: `../.cache/trip-readiness/${info.project.name}-light.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('demo success survives refresh without marking sample or previous bookings as the planned flight', async ({ page }) => {
  await prepare(page);
  const snapshot = { kind: 'flight', source: 'discovered', option_id: 'f1', name: 'Test Airline', travelers: 2 };
  const order = { id: 'demo-order', trip_id: 'layout-trip', status: 'succeeded', booking: snapshot };
  await page.route(`${backend}/api/bookings/status*`, route => route.fulfill({ json: {
    trip_id: 'layout-trip', current: [{ ...order, id: 'later-failure', status: 'failed' }, order], previous: []
  } }));
  await page.goto('/');
  const flight = page.locator('[data-readiness-item="flight"]');
  await expect(flight).toContainText('Booked — Demo');
  await expect(flight).toContainText('No money charged or real reservation made');
  await page.reload(); await expect(flight).toContainText('Booked — Demo');
  await page.route(`${backend}/api/bookings/status*`, route => route.fulfill({ json: {
    trip_id: 'layout-trip', current: [{ ...order, booking: { ...snapshot, source: 'sample' } }], previous: [order]
  } }));
  await page.reload(); await expect(flight).toContainText('Planning choice only');
  await expect(flight).not.toContainText('Booked — Demo');
});

test('booking status failures are explained without hiding itinerary review', async ({ page }) => {
  await prepare(page);
  await page.route(`${backend}/api/bookings/status*`, route => route.fulfill({ status: 503, json: { detail: 'Temporarily unavailable' } }));
  await page.goto('/');
  const panel = page.getByLabel('Trip readiness', { exact: true });
  await expect(panel.locator('[data-readiness-item="flight"]')).toContainText('Demo booking status unavailable');
  await expect(panel.getByRole('button', { name: 'Review flights' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Review flights' }).click();
  await expect(page.getByRole('button', { name: 'Retry status check' })).toBeVisible();
});

test('trip forecast refresh updates readiness, while next-seven-days weather cannot replace it', async ({ page }) => {
  await prepare(page);
  const forecast = { data_status: 'available', dailyForecast: [
    { date: '2026-10-21', tempHigh: 24, tempLow: 18, conditionText: 'Clear' },
    { date: '2026-10-22', tempHigh: 23, tempLow: 17, conditionText: 'Cloudy' }
  ] };
  let available = false;
  await page.route(`${backend}/api/trips/layout-trip/weather*`, route => {
    const upcoming = new URL(route.request().url()).searchParams.get('period') === 'upcoming';
    return route.fulfill({ json: { trip_id: 'layout-trip', weather: available || upcoming ? forecast : { data_status: 'unavailable', dailyForecast: [] } } });
  });
  await page.goto('/');
  const row = page.locator('[data-readiness-item="weather"]');
  await row.getByRole('button', { name: 'Check weather' }).click();
  await expect(page.getByRole('heading', { name: 'Forecast unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Next 7 days', exact: true }).click();
  await expect(page.getByText('Clear', { exact: true })).toBeVisible();
  await overview(page); await expect(row).toContainText('No complete forecast');
  available = true;
  await row.getByRole('button', { name: 'Check weather' }).click();
  await expect(page.getByText('Clear', { exact: true })).toBeVisible();
  await overview(page); await expect(row).toContainText('Available for all trip dates');
});
