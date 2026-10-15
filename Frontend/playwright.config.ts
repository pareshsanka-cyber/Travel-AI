import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: process.env.CI ? 2 : 1, fullyParallel: true, retries: process.env.CI ? 1 : 0,
  timeout: 45000, expect: { timeout: 10000 },
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [ { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
              { name: 'mobile', use: { ...devices['Pixel 7'] } } ],
  webServer: { command: 'npm run preview -- --port 4173 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60000 },
});
