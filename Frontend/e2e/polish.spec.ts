import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { layoutFixture } from './fixtures/layout';
import { demo } from './fixtures/payment';

test.use({ video: 'on' });

async function navigate(page: Page, name: string) {
  await expect(page.getByRole('banner')).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    (window as any).__polish = { success: 0, reveals: 0, hearts: 0 };
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const log = (window as any).__polish;
      if (this instanceof HTMLDivElement && this.querySelector('[data-success-icon]')) log.success++;
      if (this instanceof HTMLDivElement && this.classList.contains('motion-card')) log.reveals++;
      if (this instanceof SVGElement && this.classList.contains('lucide-heart')) log.hearts++;
      return original.call(this, frames, options);
    };
  });
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
}

for (const reduced of [false, true]) {
  test(`checkout confirms once, restored success stays settled (reduced ${reduced})`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await instrument(page); const mock = await demo(page); mock.hold();
    await page.goto('/'); await page.getByRole('button', { name: 'Unlock Companion', exact: true }).click();
    await page.getByRole('radio', { name: 'Card', exact: true }).check();
    await expect(page.getByText('Demo Card selected')).toBeVisible();
    await page.getByRole('button', { name: /Pay .*499.*Demo/ }).click();
    await expect(page.getByText('Confirming your demo payment', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__polish.success)).toBe(0);
    mock.release();
    await expect(page.getByText('Demo payment successful — no money charged', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__polish.success)).toBe(reduced ? 0 : 1);
    await settle(page);
    if (!reduced) {
      await mkdir('../.cache/motion-phase3', { recursive: true });
      await page.screenshot({ path: `../.cache/motion-phase3/${info.project.name}-checkout.png`, fullPage: true });
    }
    await page.reload();
    await expect(page.getByText('Demo payment successful — no money charged', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__polish.success)).toBe(0);
    await page.getByRole('button', { name: 'View receipt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Demo receipt', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__polish.success)).toBe(0);
  if (!reduced) {
    const video = page.video(); await page.close();
    await video?.saveAs(`../.cache/motion-phase3/${info.project.name}-checkout.webm`);
  }
  });

  test(`trip filtering and saving stay immediate with restrained feedback (reduced ${reduced})`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await instrument(page); await layoutFixture(page);
    await page.goto('/'); await navigate(page, 'My trips');
    await expect(page.getByRole('button', { name: 'Open trip', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__polish.reveals)).toBe(reduced ? 0 : 1);
    const search = page.getByPlaceholder('Search by destination or title...');
    await search.fill('no match'); await expect(page.getByRole('button', { name: 'Open trip', exact: true })).toHaveCount(0);
    await search.fill('Sydney'); await expect(page.getByRole('button', { name: 'Open trip', exact: true })).toBeVisible();
    await settle(page);
    expect(await page.evaluate(() => (window as any).__polish.reveals)).toBe(reduced ? 0 : 1);
    if (!reduced) {
      await mkdir('../.cache/motion-phase3', { recursive: true });
      await page.screenshot({ path: `../.cache/motion-phase3/${info.project.name}-trips.png`, fullPage: true });
    }
    await navigate(page, 'Example Places');
    const remove = page.getByRole('button', { name: 'Remove Cavatina by Chef Avinash Martins from saved', exact: true });
    await expect(remove).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as any).__polish.hearts)).toBe(0);
    await remove.click();
    const save = page.getByRole('button', { name: 'Save Cavatina by Chef Avinash Martins to memory', exact: true });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.focus(); await page.keyboard.press('Enter');
    await expect(remove).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as any).__polish.hearts)).toBe(reduced ? 0 : 1);
    const width = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
    expect(width[1]).toBeLessThanOrEqual(width[0] + 1);
    if (!reduced) {
      await settle(page);
      await page.screenshot({ path: `../.cache/motion-phase3/${info.project.name}-places.png`, fullPage: true });
      const video = page.video(); await page.close();
      await video?.saveAs(`../.cache/motion-phase3/${info.project.name}-secondary-pages.webm`);
    }
  });
}

test('forecast loading reserves space and real budget allocations settle in both themes', async ({ page }, info) => {
  await layoutFixture(page);
  const trip = { id: 'layout-trip', destination: 'Sydney, Australia', days: 4, travelers: 7, budget: 250000, currency: 'INR', plus_access: true,
    start_date: '2026-10-21', end_date: '2026-10-24', flights: [], hotels: [],
    budget_breakdown: { flight_cost: 50000, hotel_cost: 75000, gastronomy_cost: 25000, activities_cost: 25000, is_complete: true } };
  await page.route('http://127.0.0.1:8000/api/trips/layout-trip', route => route.fulfill({ json: trip }));
  await page.route('http://127.0.0.1:8000/api/trips/history', route => route.fulfill({ json: [trip] }));
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://127.0.0.1:8000/api/trips/layout-trip/weather*', async route => {
    await hold;
    await route.fulfill({ json: { trip_id: trip.id, weather: { summary: 'Verified forecast for the selected dates.', dailyForecast: [
      { date: '2026-10-21', tempHigh: 24, tempLow: 16, rainChancePercent: 20, conditionText: 'Partly cloudy' },
      { date: '2026-10-22', tempHigh: 23, tempLow: 15, rainChancePercent: 10, conditionText: 'Clear' },
    ] } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Weather Forecast', exact: true }).click();
  const content = page.locator('[data-weather-content]');
  await expect(content).toHaveAttribute('aria-busy', 'true');
  expect((await content.boundingBox())!.height).toBeGreaterThanOrEqual(160);
  release(); await expect(page.getByText('Partly cloudy', { exact: true })).toBeVisible();
  await expect(content).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Weather Forecast', exact: true })).toHaveCSS('color', 'rgb(137, 206, 255)');
  await mkdir('../.cache/motion-phase3', { recursive: true });
  await settle(page); await page.screenshot({ path: `../.cache/motion-phase3/${info.project.name}-weather.png`, fullPage: true });
  await page.getByRole('button', { name: 'Budget Auditor', exact: true }).click();
  await expect(page.locator('[data-budget-segment]')).toHaveCount(5);
  await settle(page);
  const readAllocations = () => page.locator('[data-budget-segment]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.width));
  await expect.poll(readAllocations).toEqual(['20%', '30%', '10%', '10%', '30%']);
  const allocations = await readAllocations();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Weather Forecast', exact: true }).click();
  await page.getByRole('button', { name: 'Budget Auditor', exact: true }).click();
  expect(await page.locator('[data-budget-segment]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.width))).toEqual(allocations);
  const theme = page.getByRole('button', { name: 'Toggle Theme', exact: true });
  await theme.click();
  await expect(page.getByRole('button', { name: 'Budget Auditor', exact: true })).toHaveCSS('color', 'rgb(0, 101, 145)');
  await settle(page); await page.screenshot({ path: `../.cache/motion-phase3/${info.project.name}-budget-light.png`, fullPage: true });
});
