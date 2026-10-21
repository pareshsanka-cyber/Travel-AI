import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { layoutFixture } from './fixtures/layout';

async function openDetails(page: Page, context: Record<string, unknown> = {}) {
  await page.clock.install({ time: new Date('2030-06-15T12:00:00Z') });
  await layoutFixture(page);
  await page.addInitScript(value => localStorage.setItem('TRAVELAI_TRAVEL_CONTEXT', JSON.stringify(value)), context);
  await page.goto('/?view=plan');
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  return page.getByRole('dialog', { name: 'Trip details', exact: true });
}

test('the themed calendar selects a range, disables past dates and only saves on Apply', async ({ page }, info) => {
  const context = { start_date: '2030-06-20', end_date: '2030-06-25', destination: 'Kerala, India' };
  const dialog = await openDetails(page, context);
  let writes = 0; page.on('request', request => { if (request.method() === 'POST') writes++; });
  await dialog.getByRole('button', { name: 'Open start date calendar' }).click();
  const calendar = dialog.getByRole('region', { name: 'Travel dates calendar' });
  await expect(calendar.getByRole('button', { name: 'Previous month', exact: true })).toBeDisabled();
  await expect(calendar.getByRole('button', { name: /14 June 2030/ })).toBeDisabled();
  await calendar.getByRole('button', { name: /21 June 2030/ }).click();
  await expect(calendar.getByText('When does your trip end?', { exact: true })).toBeVisible();
  await expect(calendar.getByLabel('Calendar month', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('2030-06-25');
  await expect(calendar.getByRole('button', { name: /20 June 2030/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Apply trip details' })).toBeInViewport();
  await calendar.getByRole('button', { name: /24 June 2030/ }).hover();
  await expect(calendar.getByRole('button', { name: 'Clear dates', exact: true })).toBeInViewport({ ratio: 1 });
  await mkdir('../.cache/travel-calendar', { recursive: true });
  await page.screenshot({ path: `../.cache/travel-calendar/${info.project.name}-dark.png` });
  await calendar.getByRole('button', { name: /24 June 2030/ }).click();
  await expect(calendar).toHaveCount(0);
  await expect(dialog.getByLabel('Start date', { exact: true })).toHaveValue('2030-06-21');
  await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('2030-06-24');
  await expect(dialog.getByRole('button', { name: 'Open end date calendar' })).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('TRAVELAI_TRAVEL_CONTEXT') || '{}'))).toEqual(context);
  await dialog.getByRole('button', { name: 'Apply trip details' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('TRAVELAI_TRAVEL_CONTEXT') || '{}'))).toMatchObject({ start_date: '2030-06-21', end_date: '2030-06-24', days: 4 });
  expect(writes).toBe(0);
});

test('keyboard dates cross months and Escape closes the calendar before the dialog', async ({ page }) => {
  const context = { start_date: '2030-06-20', end_date: '2030-06-25' };
  const dialog = await openDetails(page, context);
  await dialog.getByRole('button', { name: 'Open start date calendar' }).focus();
  await page.keyboard.press('Enter');
  const calendar = dialog.getByRole('region', { name: 'Travel dates calendar' });
  await expect(calendar.getByRole('button', { name: /20 June 2030/ })).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Home');
  await expect(calendar.getByRole('button', { name: /17 June 2030/ })).toBeFocused();
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('Start date', { exact: true })).toHaveValue('2030-06-17');
  await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('2030-06-18');
  await dialog.getByRole('button', { name: 'Open start date calendar' }).click();
  await page.keyboard.press('PageDown');
  await expect(calendar.getByRole('button', { name: /17 July 2030/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Open start date calendar' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('TRAVELAI_TRAVEL_CONTEXT') || '{}'))).toEqual(context);
});

test('month/year selection, clear dates and same-day trips preserve quick shortcuts', async ({ page }) => {
  const dialog = await openDetails(page);
  await dialog.getByRole('button', { name: 'Open start date calendar' }).click();
  const calendar = dialog.getByRole('region', { name: 'Travel dates calendar' });
  await calendar.getByLabel('Calendar year', { exact: true }).selectOption('2032');
  await calendar.getByLabel('Calendar month', { exact: true }).selectOption('2');
  await calendar.getByRole('button', { name: /29 February 2032/ }).click();
  await calendar.getByRole('button', { name: /29 February 2032/ }).click();
  await expect(dialog.getByText('1 day, including arrival and departure dates.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open start date calendar' }).click();
  await calendar.getByRole('button', { name: 'Clear dates', exact: true }).click();
  await expect(dialog.getByLabel('Start date', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('');
  await calendar.getByRole('button', { name: 'Close calendar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await dialog.getByRole('button', { name: '3 days', exact: true }).click();
  await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('2030-06-18');
  await dialog.getByLabel('Start date', { exact: true }).fill('2030-02-30');
  await expect(dialog.getByRole('button', { name: '3 days', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Apply trip details' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter valid dates');
});

test('calendar fits narrow screens and light theme, with reduced motion and fixed form actions', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openDetails(page, { start_date: '2030-06-20', end_date: '2030-06-25' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  for (const width of info.project.name === 'mobile' ? [320, 393] : [1280, 910]) {
    await page.setViewportSize({ width, height: width < 600 ? 740 : 768 });
    await dialog.getByRole('button', { name: 'Open start date calendar' }).click();
    const calendar = dialog.getByRole('region', { name: 'Travel dates calendar' });
    const grids = calendar.getByRole('grid');
    await expect(grids).toHaveCount(width < 640 ? 1 : 2);
    await expect(calendar.getByLabel('Calendar month', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Apply trip details' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Close trip details' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = (await calendar.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width === 393 || width === 1280) {
      await mkdir('../.cache/travel-calendar', { recursive: true });
      await page.screenshot({ path: `../.cache/travel-calendar/${info.project.name}-light.png` });
    }
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  }
});

test('typing keeps input focus and Jump to today restores focus even without changing month', async ({ page }) => {
  const dialog = await openDetails(page);
  const start = dialog.getByLabel('Start date', { exact: true });
  await start.click(); await expect(start).toBeFocused();
  await expect(dialog.getByRole('region', { name: 'Travel dates calendar' })).toHaveCount(0);
  await start.fill('2030-9');
  await dialog.getByRole('button', { name: 'Open start date calendar' }).click();
  await expect(dialog.getByRole('region', { name: 'Travel dates calendar' }).getByLabel('Calendar month')).toHaveValue('6');
  await page.keyboard.press('Escape');
  await start.fill('2030-06-15');
  await dialog.getByRole('button', { name: 'Open start date calendar' }).click();
  const calendar = dialog.getByRole('region', { name: 'Travel dates calendar' });
  await calendar.getByRole('button', { name: 'Jump to today', exact: true }).click();
  await expect(calendar.getByRole('button', { name: /15 June 2030/ })).toBeFocused();
});
