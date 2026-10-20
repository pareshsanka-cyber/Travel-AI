import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { journeyFixture } from './fixtures/journey';

test.use({ video: 'on' });
const start = 'http://127.0.0.1:4173/?view=trip&trip_id=journey-trip&tab=companion-tab';

test('countdown follows real wall time, visibility recovery and confirmed target changes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-21T21:59:15Z') });
  const mock = await journeyFixture(page); await page.goto(start);
  const timer = page.getByTestId('companion-countdown');
  await expect(timer).toHaveAttribute('data-state', 'counting'); await expect(timer).toContainText('00:00:');
  expect(await timer.getAttribute('aria-live')).toBeNull();
  await page.clock.fastForward(5000);
  await expect(timer).toContainText('00:00:3');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const frozen = await timer.locator('[data-countdown-value]').textContent(); await page.clock.fastForward(10000);
  expect(await timer.locator('[data-countdown-value]').textContent()).toBe(frozen);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(await timer.locator('[data-countdown-value]').textContent()).not.toBe(frozen);
  mock.hold();
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => mock.writes.length).toBe(1);
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'pending');
  mock.release();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'completed');
  await expect(timer).toContainText('11:00');
  expect(await page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.check))).toBe(true);
  await page.reload(); await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'completed');
  expect(await page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.check))).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'pending');
  await expect(timer).toContainText('09:00');
});

test('failed completion and legacy timing gaps never produce false feedback', async ({ page }) => {
  await journeyFixture(page, { failure: true, legacy: true }); await page.goto(start);
  await expect(page.getByTestId('companion-countdown')).toContainText('Countdown unavailable');
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await expect(page.getByText(/Progress could not be saved/)).toBeVisible();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'pending');
  expect(await page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.check || event.progress))).toBe(false);
  await expect(page.getByRole('button', { name: 'Mark Complete', exact: true })).toBeEnabled();
});

test('route reveal preserves the map while leg selection, resizing and theme changes occur', async ({ page }) => {
  await journeyFixture(page); await page.goto(start.replace('companion-tab', 'route-tab'));
  await page.getByRole('button', { name: /Explore Day 1/ }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => (window as any).__journeyAnimations.filter((event: any) => event.mask).length)).toBeGreaterThan(0);
  await page.evaluate(() => { (window as any).__savedMap = document.querySelector('.leaflet-container svg'); });
  const revealCount = await page.evaluate(() => (window as any).__journeyAnimations.filter((event: any) => event.mask).length);
  await page.getByRole('button', { name: 'Leg 1', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__savedMap === document.querySelector('.leaflet-container svg'))).toBe(true);
  await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
  const viewport = page.viewportSize()!; await page.setViewportSize({ width: viewport.width - 20, height: viewport.height });
  expect(await page.evaluate(() => (window as any).__journeyAnimations.filter((event: any) => event.mask).length)).toBe(revealCount);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('fallback routes stay dashed and flight drawing keeps its original dashed stroke', async ({ page }) => {
  await journeyFixture(page, { fallbackRoute: true }); await page.goto(start.replace('companion-tab', 'route-tab'));
  await page.getByRole('button', { name: /Explore Day 1/ }).click();
  await expect(page.locator('.leaflet-overlay-pane path[stroke-dasharray="8, 8"]').first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.mask))).toBe(false);
  await page.getByRole('button', { name: 'Leg 1', exact: true }).click();
  await expect(page.locator('.leaflet-overlay-pane path[stroke-dasharray="8, 8"]').first()).toBeVisible();
  await page.unroute('http://127.0.0.1:8000/**'); await page.unroute('https://**/*');
  await journeyFixture(page, { flight: true }); await page.reload();
  await expect(page.locator('.leaflet-overlay-pane path[stroke-dasharray="10, 7"]')).toBeVisible();
});

test('day switching never replays completion and updates the countdown target', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-21T21:59:15Z') });
  await journeyFixture(page); await page.goto(start);
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'completed');
  const count = await page.evaluate(() => (window as any).__journeyAnimations.filter((event: any) => event.check).length);
  await page.getByRole('button', { name: /Day 2/, exact: false }).first().click();
  await expect(page.getByTestId('companion-countdown')).toContainText('2026-10-23');
  await page.getByRole('button', { name: /Day 1/, exact: false }).first().click();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'completed');
  expect(await page.evaluate(() => (window as any).__journeyAnimations.filter((event: any) => event.check).length)).toBe(count);
});

for (const mode of ['reschedule', 'skip_only', 'conflict'] as const) {
  test(`reroute ${mode} reflects the server outcome without invented movement`, async ({ page }) => {
    await journeyFixture(page, { skipOnly: mode === 'skip_only', conflict: mode === 'conflict' }); await page.goto(start);
    await page.getByRole('button', { name: 'Skip / replace', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Adjust your day/ }); await expect(dialog).toBeVisible();
    if (mode !== 'skip_only') await expect(dialog.locator('[data-proposal-changed="true"]').filter({ hasText: 'Royal Botanic Garden' })).toContainText('11:30');
    const before = await page.locator('[data-activity-id]').allTextContents();
    await page.getByRole('button', { name: 'Confirm changes', exact: true }).click();
    if (mode === 'conflict') {
      await expect(dialog).toContainText('Generate a fresh preview');
      expect(await page.locator('[data-activity-id]').allTextContents()).toEqual(before);
    } else {
      await expect(dialog).toHaveCount(0);
      if (mode === 'reschedule') {
        await expect(page.locator('[data-activity-id="replacement"]')).toBeVisible();
        await expect.poll(() => page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.row === 'replacement'))).toBe(true);
      } else expect(await page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.row))).toBe(false);
      await page.reload(); await expect(page.getByTestId('companion-upcoming')).toBeVisible();
      expect(await page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.row))).toBe(false);
    }
  });
}

test('reduced motion disables spatial feedback and route drawing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await journeyFixture(page); await page.goto(start);
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'completed');
  await page.getByRole('button', { name: 'Days & map', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  expect(await page.evaluate(() => (window as any).__journeyAnimations.some((event: any) => event.mask || event.check || event.progress))).toBe(false);
});

test('Phase 2 screenshots and interaction recording', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T21:59:15Z') }); await journeyFixture(page); await page.goto(start);
  await expect(page.getByTestId('companion-countdown')).toHaveAttribute('data-state', 'counting');
  const directory = '../.cache/motion-phase2'; await mkdir(directory, { recursive: true });
  const prefix = `${directory}/${info.project.name}`;
  await page.screenshot({ path: `${prefix}-countdown.png`, fullPage: true });
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await expect(page.locator('[data-activity-id="a"]')).toHaveAttribute('data-status', 'completed');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Skip / replace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Adjust your day/ })).toBeVisible();
  await page.locator('.motion-dialog').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: `${prefix}-reroute.png` });
  await page.getByRole('button', { name: 'Confirm changes', exact: true }).click();
  await page.getByRole('button', { name: 'Days & map', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Leg 1', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.locator('.leaflet-container').evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
  await page.screenshot({ path: `${prefix}-route-light.png`, fullPage: true });
  const video = page.video(); await page.close(); await video?.saveAs(`${prefix}-journey.webm`);
});
