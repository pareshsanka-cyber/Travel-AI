import { test, expect } from '@playwright/test';
import { journeyFixture } from './fixtures/journey';
import { directionsSnapshot } from './fixtures/routingV2';

test('confirmed progress remains usable when the local cache is full', async ({ page }) => {
  await journeyFixture(page);
  await page.goto('/?view=trip&trip_id=journey-trip&tab=companion-tab');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('TRAVELAI_EXEC_STATE_')) throw new DOMException('Cache full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'completed');
  await expect(page.getByText('Unable to save completion. Refresh and try again.', { exact: true })).toHaveCount(0);
});

test('a late completion response cannot overwrite the trip opened during that request', async ({ page }) => {
  const mock = await journeyFixture(page);
  const other = structuredClone(mock.trip);
  Object.assign(other, { id: 'second-journey', destination: 'Pune', title: 'Other journey', revision: 7 });
  for (const day of other.route_details.day_by_day_route) for (const stop of day.stops) stop.id = 'other-' + stop.id;
  await page.route('http://127.0.0.1:8000/api/trips/history', route => route.fulfill({ json: [mock.trip, other] }));
  await page.route('http://127.0.0.1:8000/api/trips/second-journey', route => route.fulfill({ json: other }));
  let secondRevision: number | undefined;
  await page.route('http://127.0.0.1:8000/api/trips/second-journey/execution_state', async route => {
    const body = route.request().postDataJSON(); secondRevision = body.expected_revision;
    await route.fulfill({ json: { status: 'success', execution_state: body.execution_state, revision: 8 } });
  });
  mock.hold();
  await page.goto('/?view=trip&trip_id=journey-trip&tab=companion-tab');
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await expect.poll(() => mock.writes.length).toBe(1);
  await page.getByRole('button', { name: 'Sydney, Australia Curated Itinerary', exact: true }).click();
  await page.locator('#active-trip-menu').getByRole('button', { name: /Other journey/ }).click();
  await expect(page.getByRole('heading', { name: 'Pune Curated Itinerary', exact: true })).toBeVisible();
  mock.release();
  await page.waitForFunction(() => localStorage.getItem('TRAVELAI_EXEC_STATE_journey-trip') !== null);
  await expect(page.locator('[data-activity-id="other-a"]')).toHaveAttribute('data-status', 'pending');
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await expect.poll(() => secondRevision).toBe(7);
  await expect(page.locator('[data-activity-id="other-a"]')).toHaveAttribute('data-status', 'completed');
});

test('a late reroute acceptance cannot replace another trip itinerary or budget', async ({ page }) => {
  const mock = await journeyFixture(page);
  const other = structuredClone(mock.trip);
  Object.assign(other, { id: 'second-journey', destination: 'Pune', title: 'Other journey', revision: 7, budget: 30000 });
  for (const day of other.route_details.day_by_day_route) for (const stop of day.stops) {
    stop.id = 'other-' + stop.id; stop.name = 'Pune visit ' + stop.id;
  }
  await page.route('http://127.0.0.1:8000/api/trips/history', route => route.fulfill({ json: [mock.trip, other] }));
  await page.route('http://127.0.0.1:8000/api/trips/second-journey', route => route.fulfill({ json: other }));
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://127.0.0.1:8000/api/trips/journey-trip/reroute/apply', async route => {
    await hold;
    await route.fulfill({ json: { status: 'success', trip_id: mock.trip.id, revision: 3,
      route_details: { day_by_day_route: [{ day: 1, stops: [{ id: 'replacement', name: 'Old trip replacement', type: 'attraction', start_time: '09:00', end_time: '10:00' }] }] },
      execution_state: mock.trip.execution_state, budget_breakdown: { flight_cost: 1000000 } } });
  });
  await page.goto('/?view=trip&trip_id=journey-trip&tab=companion-tab');
  await page.getByRole('button', { name: 'Skip / replace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Adjust your day/ });
  await dialog.getByRole('button', { name: /Confirm changes/ }).click();
  // Leave through browser navigation while the accepted request is still pending.
  // A trip selection normally sits outside the modal's focus trap, so use the same
  // selector's click handler directly to exercise asynchronous navigation recovery.
  await page.getByRole('button', { name: 'Sydney, Australia Curated Itinerary', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await page.locator('#active-trip-menu').getByRole('button', { name: /Other journey/ }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.getByRole('heading', { name: 'Pune Curated Itinerary', exact: true })).toBeVisible();
  release();
  await expect(page.locator('[data-activity-id="other-a"]')).toBeVisible();
  await expect(page.getByText('Old trip replacement', { exact: true })).toHaveCount(0);
});

for (const missing of [true, false]) {
  test(`directions use verified coordinates and saved transport (missing coordinates ${missing})`, async ({ page }) => {
    const mock = await journeyFixture(page);
    const trip = structuredClone(mock.trip);
    const stops = trip.route_details.day_by_day_route[0].stops;
    stops.splice(2);
    if (missing) { delete stops[0].lat; delete stops[0].lon; }
    else { Object.assign(stops[0], { lat: 17.4, lon: 78.4 }); Object.assign(stops[1], { lat: 28.6, lon: 77.2 }); }
    await page.route('http://127.0.0.1:8000/api/trips/journey-trip', route => route.fulfill({ json: trip }));
    await page.route('http://127.0.0.1:8000/api/trips/history', route => route.fulfill({ json: [trip] }));
    let requests = 0;
    await page.route('http://127.0.0.1:8000/api/trips/journey-trip/directions?**', async route => {
      requests++;
      await route.fulfill({ json: directionsSnapshot(trip.revision, stops) });
    });
    await page.goto('/?view=trip&trip_id=journey-trip&tab=route-tab');
    await page.getByRole('button', { name: /Explore Day 1/ }).click();
    if (missing) {
      await expect(page.getByText('Location coordinates unavailable', { exact: false }).first()).toBeVisible();
      expect(requests).toBe(1); // The owned API resolves the missing-coordinate state; no provider call is made by the browser.
    } else {
      await expect.poll(() => requests).toBe(1);
      await expect(page.locator('.leaflet-container path[data-route-kind="verified"]').first()).toBeVisible();
      await page.getByRole('button', { name: /^Cab/ }).click();
      expect(requests).toBe(1);
    }
  });
}
