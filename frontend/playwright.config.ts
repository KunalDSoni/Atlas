import { defineConfig, devices } from '@playwright/test';

// E2E drives the REAL app: the backend serves the built SPA, so we boot
// `backend/server.js` against a throwaway SQLite DB with demo data, then run
// Chromium against it. This is the verification layer the app was missing.
const PORT = 3123;
const DB = `/private/tmp/atlas-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `SQLITE_PATH="${DB}" PORT=${PORT} SEED_DEMO_DATA=true SESSION_SECRET=e2e-secret node ../backend/server.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
