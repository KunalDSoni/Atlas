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

// Read by e2e/landing.spec.ts (via test.skip) to drop the signed-in case:
// this fixture has no seeded kunal@example.com, only the bootstrap admin
// above, so login() has nothing to authenticate against here.
process.env.ATLAS_EMPTY = '1';

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // landing.spec.ts lives in ../e2e (the seeded suite's directory) rather
    // than under e2e-empty, since it is one spec file shared by both configs
    // (see playwright.config.ts) — not a fixture written for this fresh-install
    // scenario specifically. This project points at it directly so it still
    // runs against the empty backend without duplicating the file.
    {
      name: 'chromium-landing',
      testDir: './e2e',
      testMatch: 'landing.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
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
