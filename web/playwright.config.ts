import { defineConfig, devices } from '@playwright/test';

// e2e + axe against the built site (npm run build first). Local runs default to system Chrome (H.264 for loops);
// CI uses the bundled Chromium (PW_CHANNEL unset there via `npx playwright install chromium`).
const channel = process.env.CI ? undefined : (process.env.PW_CHANNEL ?? 'chrome');
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4398', channel, colorScheme: 'dark' },
  webServer: { command: 'npx tsx scripts/serve.ts 4398', url: 'http://127.0.0.1:4398/', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, testMatch: /responsive\.spec/ },
  ],
});
