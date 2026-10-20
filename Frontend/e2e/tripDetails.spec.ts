import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { layoutFixture } from './fixtures/layout';

async function openDetails(page: Page, context: Record<string, unknown> = {}) {
  await layoutFixture(page);
  await page.addInitScript(value => localStorage.setItem('TRAVELAI_TRAVEL_CONTEXT', JSON.stringify(value)), context);
  await page.goto('/?view=plan');
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  return page.getByRole('dialog', { name: 'Trip details', exact: true });
}
async function savedContext(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('TRAVELAI_TRAVEL_CONTEXT') || '{}'));
}

test('quick choices apply only preferences, keep the chat draft, and reopen selected', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-06-15T12:00:00Z') });
  let writes = 0;
  page.on('request', r => { if (r.method() === 'POST') writes++; });
  const dialog = await openDetails(page);
  await expect(dialog.getByRole('group', { name: 'Destination suggestions', exact: true }).getByRole('button')).toHaveCount(6);
  await expect(dialog.getByRole('button', { name: '5 days', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Hyderabad', exact: true }).click();
  await dialog.getByRole('button', { name: 'Kerala, India', exact: true }).click();
  await dialog.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await dialog.getByRole('button', { name: '5 days', exact: true }).click();
  await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('2030-06-20');
  await dialog.getByRole('group', { name: 'Budget presets', exact: true }).getByRole('button').nth(1).click();
  await dialog.getByRole('button', { name: 'Increase adults', exact: true }).click();
  await dialog.getByRole('button', { name: 'Increase children', exact: true }).click();
  await dialog.getByRole('button', { name: 'Nature', exact: true }).click();
  await dialog.getByRole('button', { name: 'Food', exact: true }).click();
  await dialog.getByLabel('Add your own interest', { exact: true }).fill('Photography');
  expect((await savedContext(page)).destination).toBeUndefined();
  await dialog.getByRole('button', { name: 'Apply trip details', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await savedContext(page);
  expect(saved).toMatchObject({ origin: 'Hyderabad', destination: 'Kerala, India', start_date: '2030-06-16', end_date: '2030-06-20', days: 5,
    currency: 'INR', budget: 50000, adults: 2, children: 1, infants: 0, travelers: 3, interests: ['Nature', 'Food', 'Photography'] });
  expect(writes).toBe(0);
  await page.locator('#chatPromptInput').fill('Keep my planning draft');
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Nature', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Adults count', { exact: true })).toHaveText('2');
  await page.keyboard.press('Escape');
  await expect(page.locator('#chatPromptInput')).toHaveValue('Keep my planning draft');
});

test('search, custom values, currency changes and cancel preserve the original context', async ({ page }) => {
  const context = { origin: 'Pune', destination: 'Custom village', adults: 2, children: 2, infants: 1, travelers: 5,
    budget: 45000, currency: 'INR', interests: ['Nature & Parks', 'Bird watching'] };
  const dialog = await openDetails(page, context);
  await expect(dialog.getByRole('button', { name: 'Nature', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Children count', { exact: true })).toHaveText('2');
  await dialog.getByLabel('Destination', { exact: true }).fill('Tokyo');
  await dialog.getByRole('button', { name: 'Tokyo, Japan', exact: true }).click();
  await expect(dialog.getByLabel('Destination', { exact: true })).toHaveValue('Tokyo, Japan');
  await dialog.getByLabel('Currency', { exact: true }).selectOption('USD');
  await expect(dialog.getByLabel('Total trip budget', { exact: true })).toHaveValue('45000');
  await expect(dialog.getByRole('group', { name: 'Budget presets', exact: true }).getByRole('button').first()).toContainText('1,000');
  await dialog.getByRole('button', { name: 'Nature', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Nature', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await savedContext(page)).toEqual(context);
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  await expect(dialog.getByLabel('Destination', { exact: true })).toHaveValue('Custom village');
  await dialog.getByLabel('Add your own interest', { exact: true }).fill(' nature, Bird watching, Stargazing ');
  await dialog.getByLabel('Add your own interest', { exact: true }).press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Destination', { exact: true }).fill('Unlisted destination');
  await expect(dialog.getByText('Your custom destination will be kept.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply trip details', exact: true }).click();
  expect((await savedContext(page)).interests).toEqual(['Nature & Parks', 'Bird watching', 'Stargazing']);
  expect((await savedContext(page)).travelers).toBe(5);
});

test('traveler bounds and manual date changes do not silently move saved dates', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-06-15T12:00:00Z') });
  const dialog = await openDetails(page, { travelers: 20, start_date: '2030-06-15', end_date: '2030-06-17' });
  await expect(dialog.getByLabel('Adults count', { exact: true })).toHaveText('20');
  await expect(dialog.getByRole('button', { name: 'Increase children', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Decrease adults', exact: true }).click();
  await dialog.getByRole('button', { name: 'Increase infants', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Increase adults', exact: true })).toBeDisabled();
  await dialog.getByLabel('Start date', { exact: true }).fill('2030-06-20');
  await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('2030-06-17');
  await dialog.getByRole('button', { name: 'Apply trip details', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('on or after');
});

test('older preferences retain historical dates and allow correcting an oversized traveler total', async ({ page }) => {
  const dialog = await openDetails(page, { travelers: 25, start_date: '2020-01-01', end_date: '2020-01-03', interests: ['Bird watching'] });
  await expect(dialog.getByLabel('Adults count', { exact: true })).toHaveText('25');
  for (let i = 0; i < 5; i++) await dialog.getByRole('button', { name: 'Decrease adults', exact: true }).click();
  await expect(dialog.getByLabel('Adults count', { exact: true })).toHaveText('20');
  await dialog.getByRole('button', { name: 'Remove Bird watching', exact: true }).click();
  await expect(dialog.getByLabel('Add your own interest', { exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Apply trip details', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await savedContext(page)).toMatchObject({ travelers: 20, adults: 20, start_date: '2020-01-01', end_date: '2020-01-03', days: 3, interests: [] });
});

test('dialog stays inside the viewport with fixed actions, keyboard focus and both themes', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await openDetails(page);
  await expect(dialog.getByRole('button', { name: 'Close trip details', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Apply trip details', exact: true })).toBeFocused();
  const directory = '../.cache/trip-details'; await mkdir(directory, { recursive: true });
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Toggle Theme', exact: true }).click();
      await page.getByRole('button', { name: 'Trip details', exact: true }).click();
    }
    await expect(dialog.getByLabel('Start date', { exact: true })).toHaveCSS('color-scheme', theme);
    await expect(dialog).toHaveCSS('color', theme === 'light' ? 'rgb(25, 28, 32)' : 'rgb(223, 226, 238)');
    await expect(dialog.getByLabel('From', { exact: true })).toHaveCSS('color', theme === 'light' ? 'rgb(25, 28, 32)' : 'rgb(223, 226, 238)');
    await dialog.getByTestId('trip-details-body').evaluate(node => { node.scrollTop = 0; });
    const bounds = await dialog.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Apply trip details', exact: true })).toBeInViewport();
    await page.screenshot({ path: `${directory}/${info.project.name}-${theme}-route.png` });
    await dialog.getByLabel('Add your own interest', { exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Close trip details', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Apply trip details', exact: true })).toBeInViewport();
    await page.screenshot({ path: `${directory}/${info.project.name}-${theme}-interests.png` });
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Trip details', exact: true })).toBeFocused();
});
