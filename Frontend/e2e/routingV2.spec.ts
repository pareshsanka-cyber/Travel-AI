import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { journeyFixture } from './fixtures/journey';
import { reviewSnapshot } from './fixtures/routingV2';

test.use({ video: 'on' });
const start = '/?view=trip&trip_id=journey-trip&tab=companion-tab';

test('preview and cancel leave progress untouched, and duplicate preview clicks are ignored', async ({ page }) => {
  const mock = await journeyFixture(page); await page.goto(start);
  const skip = page.getByRole('button', { name: 'Skip / replace', exact: true });
  await skip.focus();
  await skip.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  const dialog = page.getByRole('dialog', { name: 'Adjust your day' });
  await expect(dialog).toBeVisible(); expect(mock.previews.length).toBe(1); expect(mock.writes.length).toBe(0);
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'pending');
  await expect(dialog).toContainText('Suggested replacement'); await expect(dialog).toContainText('Price difference unknown');
  await dialog.getByRole('button', { name: 'Keep current schedule' }).click();
  await expect(dialog).toHaveCount(0); await expect(skip).toBeFocused();
  expect(mock.writes.length).toBe(0); expect(mock.confirmations.length).toBe(0);
});

test('late and closed actions carry the selected settings and acceptance uses a saved option only', async ({ page }) => {
  const mock = await journeyFixture(page); await page.goto(start);
  await page.getByLabel('Delay from saved start').selectOption('60');
  await page.getByLabel('Adjustment travel mode').selectOption('walking');
  await page.getByRole('button', { name: 'Running late', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Adjust your day' })).toBeVisible();
  expect(mock.previews[0]).toMatchObject({ version: 2, trigger: 'delay', delay_minutes: 60, travel_mode: 'walking', expected_revision: 1 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Place closed', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Adjust your day' })).toBeVisible();
  expect(mock.previews[1].trigger).toBe('closed');
  await page.getByRole('button', { name: 'Confirm changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Adjust your day' })).toHaveCount(0);
  expect(mock.confirmations[0]).toEqual({ version: 2, proposal_id: 'owned-proposal', option_id: 'option-1', expected_revision: 1 });
  expect(mock.writes.length).toBe(0);
});

test('GPS is opt-in and refusal keeps the planned origin; late prompt is dismissible', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-21T22:30:00Z') });
  await journeyFixture(page);
  await page.addInitScript(() => {
    (window as any).__gpsCalls = 0;
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok: unknown, fail: (error: unknown) => void) => {
      (window as any).__gpsCalls++; fail({ code: 1 });
    } } });
  });
  await page.goto(start);
  await expect(page.getByRole('button', { name: 'Review timing', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__gpsCalls)).toBe(0);
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByText('Location not available. Using the planned starting point.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__gpsCalls)).toBe(1);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review timing', exact: true })).toHaveCount(0);
});

test('switching days discards a late preview response', async ({ page }) => {
  const mock = await journeyFixture(page);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/trips/journey-trip/reroute/preview', async route => {
    await hold;
    await route.fulfill({ json: reviewSnapshot(1, mock.trip.route_details.day_by_day_route[0].stops, [], true) }).catch(() => {});
  });
  await page.goto(start);
  await page.getByRole('button', { name: 'Skip / replace', exact: true }).click();
  await page.getByRole('button', { name: /Day 2/ }).first().click();
  release();
  await expect(page.locator('[data-activity-id="d"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Adjust your day' })).toHaveCount(0);
});

test('timing prompt targets the next pending stop while an in-progress visit stays protected', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T00:30:00Z') }); // 11:30 Sydney.
  const mock = await journeyFixture(page);
  mock.trip.execution_state.activity_log.a = { status: 'in_progress', activity_id: 'a' };
  await page.goto(start);
  await expect(page.getByRole('button', { name: 'Skip / replace', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review timing', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Adjust your day' })).toBeVisible();
  expect(mock.previews[0].target_activity_id).toBe('b');
  expect(mock.writes.length).toBe(0);
});

test('review fits both themes and reduced motion with screenshots and recording', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await journeyFixture(page); await page.goto(start);
  await page.getByRole('button', { name: 'Skip / replace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust your day' }); await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const directory = '../.cache/dynamic-routing-v2'; await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${info.project.name}-review-dark.png` });
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
  await page.getByRole('button', { name: 'Skip / replace', exact: true }).click(); await expect(dialog).toBeVisible();
  await page.screenshot({ path: `${directory}/${info.project.name}-review-light.png` });
  await dialog.getByRole('button', { name: 'Keep current schedule' }).click();
  const video = page.video(); await page.close(); await video?.saveAs(`${directory}/${info.project.name}-review.webm`);
});
