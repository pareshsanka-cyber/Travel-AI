import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { layoutFixture } from './fixtures/layout';

const backend = 'http://127.0.0.1:8000';
const quota = { failure_reason: 'quota_exhausted', title: 'Live-search credits exhausted', message: 'Live results can return when the provider has available credits.', data_status: 'error' };

test('Bangalore quick choice stays selected, custom destinations remain valid, and cancel discards edits', async ({ page }) => {
  await layoutFixture(page);
  await page.goto('/?view=plan');
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Trip details', exact: true });
  await dialog.getByLabel('Destination', { exact: true }).fill('Bangalore');
  const choice = dialog.getByRole('button', { name: 'Bengaluru, India', exact: true });
  await choice.click();
  await expect(choice).toBeVisible();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Destination', { exact: true })).toHaveValue('Bengaluru, India');
  await dialog.getByLabel('Destination', { exact: true }).fill('Custom village');
  await expect(dialog.getByText(/Custom destinations are supported/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  await expect(dialog.getByLabel('Destination', { exact: true })).toHaveValue('Goa, India');
});

test('quota explanations, external search and separate sample checkout are reachable in both tabs', async ({ page }, info) => {
  await layoutFixture(page);
  await page.route(`${backend}/api/trips/layout-trip/discovery-status`, route => route.fulfill({ json: { trip_id: 'layout-trip', revision: 1, provider: quota, flight: {}, hotel: {} } }));
  let refreshes = 0;
  await page.route(`${backend}/api/trips/layout-trip/travel-options/refresh`, async route => {
    refreshes++;
    expect(route.request().postDataJSON()).toEqual({ product: 'flight', expected_revision: 1 });
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.fulfill({ status: 409, json: { detail: 'Trip changed. Refresh the trip.' } });
  });
  let sampleRequest: any;
  await page.route(`${backend}/api/bookings/orders`, async route => {
    sampleRequest = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { detail: 'Sample checkout request reached safely.' } });
  });
  await page.goto('/?view=trip&tab=flights-tab');
  await expect(page.getByRole('heading', { name: 'Live-search credits exhausted' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Google Flights', exact: true })).toHaveAttribute('href', /Hyderabad.*Sydney.*2026-10-21/);
  await expect(page.getByText('Sample demo airline · Fictional', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check live availability', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Checking live availability…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh trip', exact: true })).toBeVisible();
  expect(refreshes).toBe(1);
  await page.getByRole('button', { name: /^Hotels \(/ }).click();
  await expect(page.getByRole('heading', { name: 'Live-search credits exhausted' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search hotels', exact: true })).toHaveAttribute('href', /Sydney.*2026-10-21.*2026-10-24/);
  await expect(page.getByRole('button', { name: 'Try sample hotel — Demo', exact: true })).toBeVisible();
  await mkdir('../.cache/discovery', { recursive: true });
  await page.screenshot({ path: `../.cache/discovery/${info.project.name}-hotels.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Try sample hotel — Demo', exact: true }).click();
  await expect.poll(() => sampleRequest?.source).toBe('sample');
  expect(sampleRequest.option_id).toBe('sample-hotel');
  expect(sampleRequest.amount).toBeUndefined();
});

test('restored availability fills an empty trip without selecting the incoming option', async ({ page }) => {
  await layoutFixture(page);
  const trip = { id: 'layout-trip', origin: 'Hyderabad', destination: 'Bengaluru, India', days: 3, travelers: 3, revision: 2,
    start_date: '2030-11-02', end_date: '2030-11-04', selections: { flight_id: null, hotel_id: null },
    flights: [{ id: 'stable-flight', flight_no: 'Actual 10', airline: 'Returned airline', price: 5000 }], hotels: [],
    flight_metadata: { data_status: 'search_results' } };
  await page.route(`${backend}/api/trips/layout-trip/discovery-status`, route => route.fulfill({ json: { trip_id: 'layout-trip', provider: quota } }));
  await page.route(`${backend}/api/trips/layout-trip/travel-options/refresh`, route => route.fulfill({ json: { trip, availability: { data_status: 'search_results', title: 'Live search is available' } } }));
  await page.goto('/?view=trip&tab=flights-tab');
  await page.getByRole('button', { name: 'Check live availability', exact: true }).click();
  await expect(page.getByText('Returned airline (Actual 10)', { exact: false })).toBeVisible();
  await expect(page.getByText('Selected for Trip', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try sample flight — Demo', exact: true })).toHaveCount(0);
  await expect(page.getByText('Travel choices updated. Nothing was automatically selected or booked.')).toBeVisible();
});

test('a late refresh response cannot replace the trip selected while it was running', async ({ page }) => {
  await layoutFixture(page);
  const first = { id: 'layout-trip', destination: 'Sydney, Australia', origin: 'Hyderabad', revision: 1, flights: [], hotels: [], days: 3, travelers: 2 };
  const second = { ...first, id: 'pune-trip', destination: 'Pune, India' };
  await page.route(`${backend}/api/trips/history`, route => route.fulfill({ json: [first, second] }));
  await page.route(`${backend}/api/trips/pune-trip`, route => route.fulfill({ json: second }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route(`${backend}/api/trips/layout-trip/travel-options/refresh`, async route => {
    requested = true;
    await held;
    await route.fulfill({ json: { trip: { ...first, revision: 2, flights: [{ id: 'late', airline: 'Old trip airline', price: 1000 }] }, availability: { data_status: 'search_results' } } });
  });
  await page.goto('/?view=trip&tab=flights-tab');
  await page.getByRole('button', { name: 'Check live availability', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.locator('button[aria-controls="active-trip-menu"]').click();
  await page.locator('#active-trip-menu').getByRole('button', { name: /Pune/ }).click();
  await expect(page.getByRole('heading', { name: 'Pune, India Curated Itinerary', exact: true })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith('/travel-options/refresh'));
  release(); await response;
  await expect(page.getByRole('heading', { name: 'Pune, India Curated Itinerary', exact: true })).toBeVisible();
  await expect(page.getByText(/Old trip airline/)).toHaveCount(0);
});
