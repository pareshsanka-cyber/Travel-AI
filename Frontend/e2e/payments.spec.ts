import { test, expect, Page } from '@playwright/test';

import { demo } from './fixtures/payment';

async function navigation(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('locked exports lead to demo checkout; refresh resumes and server success unlocks only this trip', async ({ page }) => {
  const mock = await demo(page); mock.hold();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Basic planning is free.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unlock Companion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upgrade your Goa trip' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to itinerary', exact: true }).click();
  await expect(page.locator('.trip-dashboard')).toBeVisible();
  const moreActions = page.locator('.trip-more-actions > summary'); if (await moreActions.isVisible()) await moreActions.click();
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
  await expect(page.getByText('Plus active \u2713', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Basic planning is free.', { exact: true })).toBeVisible();
  await navigation(page, 'Travel Selections');
  await expect(page.getByText(/Flight and hotel costs are separate and are not collected/)).toBeVisible();
  await page.getByRole('button', { name: 'Upgrade only — ₹499 Demo', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Order summary' })).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Back to itinerary', exact: true }).click();
  await expect(page.getByText('Basic planning is free.', { exact: true })).toBeVisible();
});
