import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { layoutFixture } from './fixtures/layout';

async function installProgress(page: Page) {
  await layoutFixture(page);
  await page.addInitScript(() => {
    localStorage.removeItem('TRAVELAI_CONVERSATION_ID');
    localStorage.setItem('TRAVELAI_TRAVEL_CONTEXT', JSON.stringify({ origin: 'Hyderabad', destination: 'Goa, India', days: 3, start_date: '2030-06-20', end_date: '2030-06-22', budget: 30000, currency: 'INR', travelers: 2 }));
  });
  let creates = 0, reads = 0, retries = 0, unavailable = false;
  let saved: any = null;
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/health/ready') return route.fulfill({ json: { status: 'ok', features: { planning_progress: true } } });
    if (path === '/api/chat/requests' || path.startsWith('/api/chat/requests/')) {
      if (unavailable) return route.fulfill({ status: 503, json: { detail: 'Service unavailable' } });
      if (path.endsWith('/retry')) {
        const payload = route.request().postDataJSON();
        expect(Object.keys(payload)).toEqual(['attempt_id']);
        if (saved.retry_attempt_id !== payload.attempt_id) {
          retries++; saved = { ...saved, status: 'running', result: null, error: null, recovery: null, retry_attempt_id: payload.attempt_id };
        }
      } else if (route.request().method() === 'POST') {
        creates++;
        const payload = route.request().postDataJSON();
        saved ||= { request_id: payload.request_id, status: 'running', kind: 'planning', conversation_id: 'progress-conversation', stages: {
          analysis: { status: 'done' }, parser: { status: 'done' }, planner: { status: 'done' }, flights: { status: 'done' }, hotels: { status: 'running' }, weather: { status: 'warning', note: 'No forecast available for the trip dates.' }, attractions: { status: 'running' }, restaurants: { status: 'done' },
        } };
      } else reads++;
      return route.fulfill({ status: saved ? 200 : 404, json: saved || { detail: 'Not found' } });
    }
    if (path === '/api/chat/conversations/progress-conversation') return route.fulfill({ json: { conversation_id: 'progress-conversation', travel_context: { destination: 'Goa, India' }, messages: [{ role: 'user', content: 'Plan my trip' }] } });
    return route.fallback();
  });
  await page.goto('/?view=plan');
  // The connection label is intentionally hidden in the compact mobile header.
  await expect(page.getByRole('banner').getByText('Connected', { exact: true })).toHaveText('Connected');
  const composer = page.getByRole('textbox', { name: /Ask TravelAI/i });
  await composer.fill('Plan my trip');
  await page.getByRole('button', { name: 'Send Message', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Planning progress' })).toBeVisible();
  return { composer, counts: () => ({ creates, reads, retries }), update: (value: any) => { saved = { ...saved, ...value }; }, unavailable: (value: boolean) => { unavailable = value; } };
}

test('real stage states survive refresh without another submission and recover a response', async ({ page }, info) => {
  const state = await installProgress(page);
  const progress = page.getByRole('region', { name: 'Planning progress' });
  await expect(progress.getByRole('status')).toContainText('Checking places and travel options');
  await progress.getByText('View planning steps', { exact: true }).click();
  await expect(progress.getByText('Flights: checked', { exact: true })).toBeVisible();
  await expect(progress.getByText('Hotels: checking', { exact: true })).toBeVisible();
  await expect(progress.getByText('Weather: unavailable')).toBeVisible();
  await expect(progress).not.toContainText('%');
  await expect(state.composer).toBeDisabled();
  await mkdir('../.cache/planning-progress', { recursive: true });
  await page.screenshot({ path: `../.cache/planning-progress/${info.project.name}-dark.png` });
  await page.reload();
  await expect(progress).toBeVisible();
  await expect.poll(() => state.counts().reads).toBeGreaterThan(0);
  expect(state.counts().creates).toBe(1);
  state.update({ status: 'succeeded', result: { conversation_id: 'progress-conversation', intent: 'GENERAL_CHAT', message: { role: 'assistant', content: 'Your request finished successfully.' }, travel_context: { destination: 'Goa, India' }, data: null } });
  await expect(page.getByText('Your request finished successfully.', { exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(state.composer).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('TRAVELAI_PENDING_PLANNING:layout-user'))).toBeNull();
  expect(state.counts().creates).toBe(1);
});

test('lost connection offers status recovery without another payment or planning submission', async ({ page }) => {
  const state = await installProgress(page);
  state.unavailable(true);
  const progress = page.getByRole('region', { name: 'Planning progress' });
  await expect(progress.getByRole('button', { name: 'Check status', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(state.composer).toBeDisabled();
  state.unavailable(false);
  await progress.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(progress.getByRole('status')).toContainText('Checking places and travel options');
  expect(state.counts().creates).toBe(1);
});

test('interrupted planning restores the original prompt and reduced motion remains readable', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const state = await installProgress(page);
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); });
  state.update({ status: 'interrupted', error: 'The server restarted. Review saved trips before trying again.' });
  const progress = page.getByRole('region', { name: 'Planning progress' });
  await expect(progress.getByRole('alert')).toContainText('The server restarted');
  await page.screenshot({ path: `../.cache/planning-progress/${info.project.name}-light-recovery.png` });
  await progress.getByRole('button', { name: 'Return to planning' }).click();
  await expect(progress).toHaveCount(0);
  await expect(state.composer).toHaveValue('Plan my trip');
  await expect(state.composer).toBeEnabled();
});

test('failed responses show a persistent summary and explicit retry survives refresh once', async ({ page }, info) => {
  const state = await installProgress(page);
  const progress = page.getByRole('region', { name: 'Planning progress' });
  state.update({ status: 'failed', error: 'The AI service could not be reached.', recovery: { code: 'provider_unavailable', retryable: true, message: 'Your details are saved.' },
    result: { conversation_id: 'progress-conversation', intent: 'ERROR', message: { role: 'assistant', content: 'The AI service could not be reached.' }, travel_context: {}, data: null } });
  await expect(progress.getByRole('alert')).toContainText('could not be reached');
  await expect(progress.getByRole('button', { name: 'Retry saved request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review request above', exact: true })).toBeDisabled();
  await expect(state.composer).toBeDisabled();
  await mkdir('../.cache/failure-recovery', { recursive: true });
  await page.screenshot({ path: `../.cache/failure-recovery/${info.project.name}-retry.png` });
  await progress.getByRole('button', { name: 'Retry saved request' }).click();
  await expect.poll(() => state.counts().retries).toBe(1);
  await page.reload();
  await expect(progress).toBeVisible();
  state.update({ status: 'succeeded', result: { conversation_id: 'progress-conversation', intent: 'GENERAL_CHAT', message: { role: 'assistant', content: 'Recovered after your retry.' }, travel_context: {}, data: null } });
  await expect(page.getByText('Recovered after your retry.', { exact: true })).toBeVisible();
  expect(state.counts()).toMatchObject({ creates: 1, retries: 1 });
});

test('constraint failures preserve the original request for editing without automatic retries', async ({ page }) => {
  const state = await installProgress(page);
  state.update({ status: 'failed', error: 'Known costs exceed your fixed budget.', recovery: { code: 'trip_constraints', retryable: false, message: 'Review your total trip budget.' } });
  const progress = page.getByRole('region', { name: 'Planning progress' });
  await expect(progress.getByRole('alert')).toContainText('fixed budget');
  await expect(progress.getByRole('button', { name: 'Retry saved request' })).toHaveCount(0);
  await progress.getByRole('button', { name: 'Return to planning' }).click();
  await expect(state.composer).toHaveValue('Plan my trip');
  await expect(state.composer).toBeFocused();
  expect(state.counts().retries).toBe(0);
});

test('a saved itinerary is offered instead of another planning attempt', async ({ page }) => {
  const state = await installProgress(page);
  state.update({ status: 'failed', error: 'The response was interrupted after saving.', trip_id: 'layout-trip', recovery: { retryable: false } });
  const progress = page.getByRole('region', { name: 'Planning progress' });
  await expect(progress.getByRole('button', { name: 'Retry saved request' })).toHaveCount(0);
  await progress.getByRole('button', { name: 'View saved trip' }).click();
  await expect(progress).toHaveCount(0);
  expect(state.counts().retries).toBe(0);
});

test('coming back online checks the existing request without submitting a new one', async ({ page }) => {
  const state = await installProgress(page); state.unavailable(true);
  const progress = page.getByRole('region', { name: 'Planning progress' });
  await expect(progress.getByRole('button', { name: 'Check status', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(progress.getByRole('button', { name: 'API Settings', exact: true })).toBeVisible();
  state.unavailable(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(progress.getByRole('status')).toContainText('Checking places and travel options');
  expect(state.counts()).toMatchObject({ creates: 1, retries: 0 });
});
