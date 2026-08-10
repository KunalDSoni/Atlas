import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// E2E drives the REAL app: the backend serves the built SPA, so we boot
// `backend/server.js` against a throwaway SQLite DB with demo data, then run
// Chromium against it. This is the verification layer the app was missing.
const PORT = 3123;
// os.tmpdir(), not a hardcoded /private/tmp: that path is macOS-only and the
// server dies with ENOENT on the Linux CI runner.
const DB = path.join(os.tmpdir(), `atlas-e2e-${process.pid}.db`);

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
    // API_RATE_MAX: the whole suite drives one server from one IP in seconds,
    // which trips the 300 req/min production throttle partway through a run —
    // and the first casualty is login, so failures surface as unrelated
    // assertion timeouts. The limiter's own behaviour is covered by
    // backend/tests/backend/api-ratelimit.test.js, not by these specs.
    //
    // `npm run build` first, always. backend/server.js serves the COMMITTED
    // frontend/build, so without it these specs exercise whatever bundle was
    // last checked in rather than the working tree. That is not a stale-cache
    // annoyance, it is a false green: delete a component from src/ and every
    // spec covering it still passes, because the old bundle still contains it.
    // Verified by deleting the running-timer chip's render and watching all
    // four timer specs pass. The ~4s rebuild is the price of the suite testing
    // the code you actually wrote.
    command: `npm run build && SQLITE_PATH="${DB}" PORT=${PORT} SEED_DEMO_DATA=true SESSION_SECRET=e2e-secret API_RATE_MAX=20000 node ../backend/server.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    // Raised from 30s: the boot now includes a production build.
    timeout: 120_000,
  },
});
