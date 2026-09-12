// Runs against `npm run dev` (already wired to staging via .env.local's
// VITE_SUPABASE_URL, per BUILD-STATUS.md) -- tests the current checkout's
// code against the real staging backend, never production, matching the
// project's own staging-only browser-testing convention. Viewports match
// the two breakpoints this app actually ships (mobile below 1024px, "BB"
// at 1024px+) and the exact sizes this project's own QA passes already use
// (390x844 / 1440x900), not a generic device preset.
import { defineConfig } from '@playwright/test';

const baseURL = process.env.PW_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'mobile',
      testMatch: /.*\.spec\.js/,
      dependencies: ['setup'],
      use: { viewport: { width: 390, height: 844 }, storageState: 'e2e/.auth/head-coach.json' },
    },
    {
      name: 'bb',
      testMatch: /.*\.spec\.js/,
      dependencies: ['setup'],
      use: { viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/head-coach.json' },
    },
  ],
});
