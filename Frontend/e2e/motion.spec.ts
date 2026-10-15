import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { layoutFixture } from './fixtures/layout';

test.use({ video: 'on' });

async function trackMotion(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    (window as any).__messageMotion = [];
    Element.prototype.animate = function (frames, options) {
      if (this instanceof HTMLElement && this.dataset.messageId) {
        (window as any).__messageMotion.push({ id: this.dataset.messageId, frames });
      }
      return original.call(this, frames, options);
    };
  });
}

async function edit(page: Page) {
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit your Sydney, Australia trip', exact: true })).toBeVisible();
}

test('dialog entrances preserve Escape, focus containment and immediate focus return', async ({ page }) => {
  await layoutFixture(page); await page.goto('/'); await edit(page);
  const trigger = page.getByRole('button', { name: 'Trip details', exact: true });
  for (let iteration = 0; iteration < 2; iteration++) {
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Trip details', exact: true });
    await expect(dialog.getByRole('button', { name: 'Close trip details' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Close trip details' })).toHaveCSS('transition-duration', '0.12s');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Apply trip details', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close trip details' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  }
  await page.getByRole('button', { name: 'API Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'FastAPI Backend Connection', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'API Settings', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('navigation and native actions stay keyboard accessible through rapid changes', async ({ page }) => {
  await layoutFixture(page); await page.goto('/');
  const openNavigation = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  if (await openNavigation.isVisible()) {
    await openNavigation.click(); await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(openNavigation).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toHaveCount(0);
  }
  const avatar = page.getByRole('button', { name: 'User Profile', exact: true });
  await avatar.click(); await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(avatar).toBeFocused();
  for (const name of ['Flights (0)', 'Hotels (0)', 'Overview', 'Days & map', 'Overview']) {
    const tab = page.getByRole('button', { name, exact: true });
    await tab.click(); await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.trip-tabs .motion-active-indicator')).toHaveCount(1);
  }
  const more = page.locator('.trip-more-actions > summary');
  await more.click(); await expect(page.getByRole('button', { name: 'Export itinerary as PDF', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(more).toBeFocused();
});

test('reroute dialog shell preserves cancel, focus and server proposal handling', async ({ page }) => {
  await layoutFixture(page);
  const progress = { is_active: true, current_day_number: 1, activity_log: { a: { status: 'skipped' } }, reroute_history: [] };
  await page.route('http://127.0.0.1:8000/api/trips/layout-trip/execution_state', route => route.fulfill({
    json: { status: 'success', revision: 2, execution_state: progress },
  }));
  let applied = 0;
  await page.route('http://127.0.0.1:8000/api/trips/layout-trip/reroute/apply', async route => {
    applied++; await route.fulfill({ status: 409, json: { detail: 'Generate a fresh preview.' } });
  });
  await page.route('http://127.0.0.1:8000/api/trips/layout-trip/reroute/preview', route => route.fulfill({
    json: { status: 'success', proposal_id: 'server-preview', revision: 2, day_number: 1, mode: 'skip_only',
      skipped_activity: { id: 'a', title: 'Sydney Harbour' }, replacement_found: false, replacement_activity: null,
      original_stops: [], proposed_stops: [], rescheduled_stops: [], reason: 'Saved timings remain unchanged.' },
  }));
  await page.goto('/'); await page.getByRole('button', { name: 'Open Companion', exact: true }).click();
  const skip = page.getByRole('button', { name: 'Skip Stop', exact: true }); await skip.click();
  const dialog = page.getByRole('dialog', { name: /Dynamic AI Rerouting/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Accept & Update Schedule', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(applied).toBe(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

for (const reduced of [false, true]) {
  test(`live messages animate once without replaying history (${reduced ? 'reduced' : 'normal'} motion)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await trackMotion(page); await layoutFixture(page);
    let release!: () => void;
    const responseGate = new Promise<void>(resolve => { release = resolve; });
    await page.route('http://127.0.0.1:8000/api/chat/message', async route => {
      await responseGate;
      await route.fulfill({ json: { conversation_id: 'edit-sydney', intent: 'GENERAL_CHAT',
        message: { role: 'assistant', content: 'Your existing Sydney schedule is unchanged.' } } });
    });
    await page.goto('/'); await edit(page);
    expect(await page.evaluate(() => (window as any).__messageMotion.length)).toBe(0);
    await page.locator('#chatPromptInput').fill('Hello, can you help me?');
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();
    await expect(page.getByText('TravelAI is working on your request…', { exact: true })).toBeVisible();
    const busy = page.getByRole('button', { name: 'Planning Trip...', exact: true });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveCSS('scale', '1');
    release();
    await expect(page.getByText('Your existing Sydney schedule is unchanged.', { exact: true })).toBeVisible();
    const events = await page.evaluate(() => (window as any).__messageMotion);
    expect(events.length).toBe(2);
    expect(new Set(events.map((entry: any) => entry.id)).size).toBe(2);
    if (reduced) expect(events.every((entry: any) => entry.frames.every((frame: any) => !frame.transform))).toBe(true);
    await page.getByRole('button', { name: /Return to trip|View generated itinerary|View saved trip/ }).click();
    await edit(page);
    expect(await page.evaluate(() => (window as any).__messageMotion.length)).toBe(2);
    await page.locator('#chatPromptInput').fill('Keep this unsent draft');
    await page.reload();
    await expect(page.locator('#chatPromptInput')).toHaveValue('Keep this unsent draft');
    expect(await page.evaluate(() => (window as any).__messageMotion.length)).toBe(0);
    await page.getByRole('button', { name: 'Trip details', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Trip details', exact: true });
    if (reduced) {
      const duration = await panel.evaluate(node => parseFloat(getComputedStyle(node).animationDuration));
      expect(duration).toBeLessThanOrEqual(0.001);
    }
    await page.keyboard.press('Escape');
  });
}

test.describe('Phase 1 visual preview', () => {
  test('captures navigation, tabs and dialog motion in both themes', async ({ page }, info) => {
    await layoutFixture(page); await page.goto('/');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const directory = '../.cache/motion-phase1'; await mkdir(directory, { recursive: true });
    const prefix = `${directory}/${info.project.name}`;
    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
    await page.screenshot({ path: `${prefix}-my-trip-dark.png`, fullPage: true });
    await page.getByRole('button', { name: 'Flights (0)', exact: true }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: /Explore Day 1/ }).click();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
    await edit(page);
    await page.locator('#chatPromptInput').fill('A draft stays here while I review my trip.');
    await page.getByRole('button', { name: 'More suggestions', exact: true }).click();
    await page.getByRole('button', { name: 'Trip details', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Trip details', exact: true })).toBeVisible();
    await page.locator('.motion-dialog').evaluate(async node => {
      await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: `${prefix}-trip-details.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
    await page.screenshot({ path: `${prefix}-plan-light.png`, fullPage: true });
    await page.getByRole('button', { name: /Return to trip/ }).click();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    const video = page.video(); await page.close(); await video?.saveAs(`${prefix}-interactions.webm`);
  });
});
