import { test, expect, Page } from '@playwright/test';

async function weatherFixture(page: Page) {
  const backend = 'http://127.0.0.1:8000';
  const trip = { id: 'weather-trip', destination: 'Sydney, Australia', days: 4, travelers: 7, budget: 250000,
    start_date: '2026-10-04', end_date: '2026-10-07', weather: { average_temp: '32.1 C', summary: 'Old current conditions' }, flights: [], hotels: [] };
  let fail = false;
  await page.addInitScript(() => {
    localStorage.setItem('travelai_token', 'weather-session');
    localStorage.setItem('travelai_user', JSON.stringify({ id: 'weather-user', name: 'Explorer' }));
    localStorage.setItem('TRAVELAI_FASTAPI_URL', 'http://127.0.0.1:8000');
  });
  await page.route(`${backend}/**`, async route => {
    const url = new URL(route.request().url());
    let data: any = {}, status = 200;
    if (url.pathname === '/api/auth/me') data = { user: { id: 'weather-user', name: 'Explorer' } };
    else if (url.pathname === '/api/trips/history') data = [trip];
    else if (url.pathname === '/api/trips/weather-trip') data = trip;
    else if (url.pathname === '/api/bookings/status') data = { trip_id: trip.id, current: [], previous: [] };
    else if (url.pathname === '/api/chat/conversations') data = [];
    else if (url.pathname.endsWith('/weather')) {
      expect(route.request().headers().authorization).toBe('Bearer weather-session');
      if (fail) { status = 503; data = { detail: 'Weather service temporarily unavailable.', request_id: 'weather-ref' }; }
      else data = { trip_id: trip.id, weather: url.searchParams.get('period') === 'upcoming'
        ? { data_status: 'forecast', summary: 'Open-Meteo forecast for the next seven days.', dailyForecast: [{ date: '2026-10-15', tempHigh: 23, tempLow: 14, rainChancePercent: null, conditionText: 'Partly cloudy' }] }
        : { data_status: 'unavailable', reason: 'past_dates', summary: 'Your trip dates 2026-10-04 to 2026-10-07 are in the past. View the next 7 days separately.', dailyForecast: [] } };
    } else if (url.pathname === '/' || url.pathname === '/health/ready') data = { status: 'ok' };
    await route.fulfill({ status, json: data });
  });
  await page.route('https://**/*', route => route.abort());
  return { fail: (value: boolean) => { fail = value; }, trip };
}

test('legacy Sydney weather explains past dates and offers a separate fresh forecast', async ({ page }) => {
  const mock = await weatherFixture(page);
  await page.goto('/'); await page.getByRole('button', { name: 'Weather Forecast', exact: true }).click();
  await expect(page.getByText(/Your trip dates.*are in the past/)).toBeVisible();
  await expect(page.getByText('Old current conditions', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next 7 days', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByText(/These dates are separate from your saved trip/)).toBeVisible();
  await expect(page.getByText('2026-10-15', { exact: true })).toBeVisible();
  await expect(page.getByText('Rain chance: Unavailable', { exact: true })).toBeVisible();
  expect(mock.trip.start_date).toBe('2026-10-04');
  await page.getByRole('button', { name: 'Trip dates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forecast unavailable', exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({ inner: innerWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.inner + 1);
});

test('weather server errors retain a reference and retry loads real daily fields', async ({ page }) => {
  const mock = await weatherFixture(page); mock.fail(true);
  await page.goto('/'); await page.getByRole('button', { name: 'Weather Forecast', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('weather-ref');
  mock.fail(false);
  await page.getByRole('button', { name: 'Retry weather', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forecast unavailable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next 7 days', exact: true }).click();
  await expect(page.getByText(/High 23/)).toBeVisible();
});
