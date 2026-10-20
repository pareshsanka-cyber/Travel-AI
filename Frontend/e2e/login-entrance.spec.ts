import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ video: 'on' });
const backend = 'http://127.0.0.1:8000';
const artifacts = '../.cache/login-staggered-hero';

async function prepare(page: Page) {
  await page.addInitScript(url => localStorage.setItem('TRAVELAI_FASTAPI_URL', url), backend);
  await page.route(`${backend}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/health/ready' ? { status: 'ok' } : [] });
  });
}

async function fill(page: Page) {
  await page.getByLabel('Email', { exact: true }).fill('motion-review@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
}

for (const reduced of [false, true]) {
  test(`login entrance settles without replay and honors reduced motion (${reduced})`, async ({ page }, info) => {
    await prepare(page);
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => {
      const ids = ['waypoint-badge', 'brand-hero-heading', 'login-email-group', 'login-password-group', 'login-submit-btn', 'login-register-redirect'];
      const samples: Record<string, { first: number; visible: number }> = {};
      (window as any).__entrance = samples;
      const sample = () => {
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          const opacity = Number(getComputedStyle(el).opacity);
          samples[id] ??= { first: opacity, visible: -1 };
          if (opacity > .1 && samples[id].visible < 0) samples[id].visible = performance.now();
        });
        if (!ids.every(id => samples[id]?.visible >= 0)) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#login-register-redirect')).toHaveCSS('opacity', '1');
    const samples = await page.evaluate(() => (window as any).__entrance);
    if (reduced) {
      expect(Object.values(samples).every((s: any) => s.first === 1)).toBe(true);
    } else {
      expect(samples['waypoint-badge'].first).toBeLessThan(1);
      expect(samples['waypoint-badge'].visible).toBeLessThan(samples['brand-hero-heading'].visible);
      expect(samples['login-email-group'].visible).toBeLessThan(samples['login-password-group'].visible);
      expect(samples['login-password-group'].visible).toBeLessThan(samples['login-submit-btn'].visible);
    }
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: `${artifacts}/${info.project.name}-${reduced ? 'reduced' : 'after'}.png`, fullPage: true });
    await fill(page);
    const toggle = page.getByRole('button', { name: 'Show password', exact: true });
    await toggle.click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('test-only-password');
    await expect(page.locator('#brand-hero-heading')).toHaveCSS('opacity', '1');
    await expect(page.locator('#brand-hero-heading')).toHaveCSS('transform', 'none');
    expect(errors).toEqual([]);
    const video = page.video(); await page.close();
    await video?.saveAs(`${artifacts}/${info.project.name}-${reduced ? 'reduced' : 'entrance'}.webm`);
  });

  test(`pending login stays readable, rejects duplicate submits and allows retry (${reduced})`, async ({ page }) => {
    await prepare(page);
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    let requests = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`${backend}/api/auth/login`, async route => {
      requests++;
      expect(route.request().postDataJSON()).toEqual({ email: 'motion-review@example.com', password: 'test-only-password' });
      await held;
      await route.fulfill({ status: 401, json: { detail: 'Invalid credentials. Please try again.' } });
    });
    await page.goto('/'); await fill(page);
    await page.locator('#login-submit-btn').click();
    await expect(page.getByRole('status')).toHaveText('Signing in...');
    await expect(page.locator('#login-submit-btn')).toBeDisabled();
    await page.locator('#login-form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect.poll(() => requests).toBe(1);
    await page.waitForTimeout(250);
    await expect(page.getByRole('status')).toHaveCSS('transform', 'none');
    if (reduced) await expect(page.locator('#login-submit-btn span[aria-hidden="true"]')).toHaveCSS('transform', 'none');
    release();
    await expect(page.getByRole('alert')).toContainText('Invalid credentials');
    await expect(page.locator('#login-submit-btn')).toBeEnabled();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('motion-review@example.com');
    await page.locator('#login-submit-btn').click();
    await expect.poll(() => requests).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem('travelai_token'))).toBeNull();
  });
}

test('early keyboard focus settles the form; recovery traps and restores focus', async ({ page }) => {
  await prepare(page); await page.goto('/');
  await page.getByLabel('Email', { exact: true }).focus();
  await expect(page.locator('#login-email-group')).toHaveCSS('opacity', '1');
  await expect(page.locator('#login-glass-card-wrapper')).toHaveCSS('transform', 'none');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(close).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#forgot-password-link')).toBeFocused();
});

test('native validation, successful login and registration navigation still work', async ({ page }) => {
  await prepare(page); let requests = 0;
  const user = { id: 'motion-review-user', name: 'Motion Reviewer', email: 'motion-review@example.com' };
  await page.route(`${backend}/api/auth/login`, async route => {
    requests++; await route.fulfill({ json: { token: 'motion-test-session', user } });
  });
  await page.route(`${backend}/api/auth/me`, route => route.fulfill({ json: { user } }));
  await page.goto('/');
  await page.locator('#login-submit-btn').click(); expect(requests).toBe(0);
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.getByLabel('Email', { exact: true }).fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
  await page.locator('#login-submit-btn').click(); expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Create one', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create Account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await fill(page); await page.locator('#login-submit-btn').click();
  await expect(page.getByRole('heading', { name: 'Plan your next trip' })).toBeVisible();
  expect(requests).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('travelai_token'))).toBe('motion-test-session');
  await page.reload(); await expect(page.getByRole('heading', { name: 'Plan your next trip' })).toBeVisible();
});

test('login fits compact phones, tablets, laptop and zoom-equivalent viewports in both themes', async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('TRAVELAI_THEME', value), theme);
    for (const [width, height] of [[320,568], [393,851], [768,1024], [910,512], [1093,614], [1366,768], [1920,1080]]) {
      await page.setViewportSize({ width, height }); await page.goto('/');
      if (theme === 'light') await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      else await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
      await expect(page.locator('#login-card')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      for (const id of ['login-email-input', 'login-password-input', 'login-submit-btn', 'login-goto-register-btn']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        const box = (await page.locator(`#${id}`).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      }
    }
  }
});
