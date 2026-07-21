import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// First-run E2E: the same real backend, but seeded with NOTHING — only the
// bootstrap admin from ADMIN_EMAIL/ADMIN_PASSWORD. This is what a fresh
// deployment actually looks like, and the seeded suite (playwright.config.ts)
// can never catch a zero-project regression because it always has projects.
const PORT = 3124;
// See playwright.config.ts — /private/tmp exists only on macOS.
const DB = path.join(os.tmpdir(), `atlas-e2e-empty-${process.pid}.db`);

export default defineConfig({
  testDir: './e2e-empty',
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
    command:
      `SQLITE_PATH="${DB}" PORT=${PORT} SEED_DEMO_DATA=false SESSION_SECRET=e2e-empty-secret ` +
      `ADMIN_NAME="Atlas Admin" ADMIN_EMAIL=admin@atlas.local ADMIN_PASSWORD=changeme123 ` +
      `API_RATE_MAX=20000 node ../backend/server.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
