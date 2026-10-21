import { test, expect } from '@playwright/test';
import { layoutFixture } from './fixtures/layout';

for (const failure of ['connection', 'server', 'malformed'] as const) {
  test(`session ${failure} failure preserves login, preferences and draft until verified`, async ({ page }) => {
    await layoutFixture(page);
    await page.addInitScript(() => sessionStorage.setItem('TRAVELAI_PROMPT:layout-user:new', 'Keep my original planning draft'));
    let broken = true, protectedReads = 0;
    await page.route('http://127.0.0.1:8000/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me' && broken) {
        if (failure === 'connection') return route.abort('connectionrefused');
        if (failure === 'malformed') return route.fulfill({ status: 200, json: {} });
        return route.fulfill({ status: 503, json: { detail: 'Database unavailable' } });
      }
      if (path === '/api/trips/history') protectedReads++;
      return route.fallback();
    });
    await page.goto('/?view=plan');
    await expect(page.getByRole('heading', { name: 'Reconnect to TravelAI' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('preserved');
    const before = await page.evaluate(() => ({ token: localStorage.getItem('travelai_token'), context: localStorage.getItem('TRAVELAI_TRAVEL_CONTEXT'), draft: sessionStorage.getItem('TRAVELAI_PROMPT:layout-user:new') }));
    expect(before.token).toBe('layout-session'); expect(before.context).toContain('Goa');
    expect(before.draft).toBe('Keep my original planning draft'); expect(protectedReads).toBe(0);
    broken = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Ask TravelAI', exact: true })).toHaveValue(before.draft!);
    await expect(page.getByRole('heading', { name: 'Reconnect to TravelAI' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('travelai_token'))).toBe('layout-session');
  });
}

test('signing in instead is explicit and expired sessions still return to login', async ({ page }) => {
  await layoutFixture(page);
  await page.route('http://127.0.0.1:8000/api/auth/me', route => route.fulfill({ status: 503, json: { detail: 'Temporarily unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in instead' }).click();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('travelai_token'))).toBeNull();
});
