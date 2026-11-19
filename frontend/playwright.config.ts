import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = process.env.CI !== undefined;
/** Optional installed browser instead of Playwright's bundled one, e.g. PW_CHANNEL=chrome. */
const channel = process.env.PW_CHANNEL;
const browser = { ...devices['Desktop Chrome'], ...(channel === undefined ? {} : { channel }) };

/**
 * End-to-end tests run against the mock build (MSW in the browser, simulated live lecture), so
 * they need no backend. `npm run e2e` runs the functional suite; `npm run e2e:screenshots`
 * refreshes docs/screenshots.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    {
      name: 'chromium',
      use: browser,
      testIgnore: /screenshots\.spec\.ts/,
    },
    {
      name: 'screenshots',
      use: browser,
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run build:mock && npm run preview:mock',
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
});
