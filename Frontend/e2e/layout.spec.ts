import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

import { layoutFixture } from './fixtures/layout';

async function noOverflow(page: Page) {
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
}

test('Plan and My Trip stay separate, bind editing to Sydney and preserve drafts', async ({ page }) => {
  await layoutFixture(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sydney, Australia Curated Itinerary', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'TravelAI conversation' })).toBeHidden();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: /Explore Day 1/ }).click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit your Sydney, Australia trip', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sydney, Australia Curated Itinerary', exact: true })).toBeHidden();
  await page.locator('#chatPromptInput').fill('Keep this Sydney draft');
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Trip details', exact: true });
  await expect(details.getByLabel('Destination', { exact: true })).toHaveValue('Sydney, Australia');
  await expect(details.getByLabel('Travelers', { exact: true })).toHaveValue('7');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Return to trip/ }).click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit your Sydney, Australia trip', exact: true })).toBeVisible();
  await expect(page.locator('#chatPromptInput')).toHaveValue('Keep this Sydney draft');
  await expect(page).toHaveURL(/view=plan/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Edit your Sydney, Australia trip', exact: true })).toBeVisible();
  await expect(page.locator('#chatPromptInput')).toHaveValue('Keep this Sydney draft');
  await noOverflow(page);
  await page.getByRole('button', { name: /Return to trip/ }).click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
});

test('laptop and desktop layouts keep the map and directions readable as available width changes', async ({ page }) => {
  await layoutFixture(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.stack || error.message));
  for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [1024, 768], [390, 844], [1093, 614], [911, 512]]) {
    await page.setViewportSize({ width, height }); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sydney, Australia Curated Itinerary', exact: true })).toBeVisible();
    await noOverflow(page);
    await expect(page.getByRole('button', { name: 'Edit with AI', exact: true })).toBeVisible();
    if (test.info().project.name === 'desktop' && (width === 1366 || width === 1920)) {
      await mkdir('../.cache/layout-previews', { recursive: true });
      await page.screenshot({ path: `../.cache/layout-previews/simple-trip-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    const overview = page.locator('.trip-dashboard').first();
    await overview.getByRole('button', { name: /Explore Day 1/ }).click();
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
    const route = page.locator('.day-route-layout');
    const map = page.locator('.day-route-map');
    const directions = page.locator('.day-route-directions');
    const routeBounds = (await route.boundingBox())!;
    const mapBounds = (await map.boundingBox())!;
    const directionsBounds = (await directions.boundingBox())!;
    if (routeBounds.width >= 960) {
      expect(Math.round(directionsBounds.width)).toBe(320);
      expect(directionsBounds.x).toBeGreaterThan(mapBounds.x + mapBounds.width);
    } else expect(directionsBounds.y).toBeGreaterThanOrEqual(mapBounds.y + mapBounds.height);
    expect(mapBounds.height).toBeGreaterThanOrEqual(300);
    expect(mapBounds.height).toBeLessThanOrEqual(520);
    for (const marker of await page.locator('.leaflet-marker-icon').all()) {
      const bounds = (await marker.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(mapBounds.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width);
    }
    await noOverflow(page);
    if (test.info().project.name === 'desktop' && (width === 1366 || width === 1920)) await page.screenshot({ path: `../.cache/layout-previews/map-simple-trip-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('long titles, dark theme and collapsed navigation retain access to trip actions', async ({ page }) => {
  await layoutFixture(page, true); await page.goto('/');
  await expect(page.getByRole('heading', { name: /^An extended family adventure/ })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
  await noOverflow(page);
  await page.locator('.trip-more-actions > summary').click();
  await expect(page.getByRole('button', { name: 'Export itinerary as PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download itinerary calendar', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('region', { name: 'TravelAI conversation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Return to trip/ }).click();
  await expect(page.getByRole('heading', { name: /^An extended family adventure/ })).toBeVisible();
});
