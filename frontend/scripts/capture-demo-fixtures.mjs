// Records the sample data the demo build answers from: src/demo/fixtures.json.
//
// Boots the real backend against a brand-new seeded SQLite file — never an
// existing database, so nothing real can end up in a public bundle — then walks
// every screen in Chromium as the seeded admin and keeps each GET /api response.
//
// The backend serves frontend/build, so `npm run demo:capture` builds first.
// Re-run when screens start requesting endpoints the demo has no answer for.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const OUT = path.join(frontend, 'src', 'demo', 'fixtures.json');
const PORT = 3197;
const BASE = `http://localhost:${PORT}`;
const PROJECT_SCREENS = ['board', 'backlog', 'filters', 'epics', 'roadmap', 'sprints', 'releases', 'reports', 'automation'];

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atlas-demo-capture-'));
const server = spawn(process.execPath, [path.join(frontend, '..', 'backend', 'server.js')], {
  env: {
    ...process.env,
    // Explicit, so a developer's backend/.env can never point this at MySQL.
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: path.join(tmp, 'capture.db'),
    SEED_DEMO_DATA: 'true',
    PORT: String(PORT),
    SESSION_SECRET: 'demo-capture',
    API_RATE_MAX: '20000',
    DEMO_EMAIL: '',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend did not start');
}

const fixtures = {};
const pending = [];
let browser;

try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // The live-events stream never finishes, so it would hold networkidle open.
  await page.route('**/api/stream**', (route) => route.abort());
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (res.request().method() !== 'GET' || !url.pathname.startsWith('/api/') || !res.ok()) return;
    if (!(res.headers()['content-type'] ?? '').includes('application/json')) return;
    const key = url.pathname.slice('/api'.length) + url.search;
    pending.push(res.json().then((body) => { fixtures[key] = body; }, () => {}));
  });

  await page.goto(`${BASE}/login`);
  await page.locator('#email').fill('kunal@example.com');
  await page.locator('#password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard/);

  const api = (p) => page.evaluate(async (p) => {
    const res = await fetch(`/api${p}`, { headers: { 'x-auth-token': localStorage.getItem('atlas_token') ?? '' } });
    return res.json();
  }, p);

  const routes = [
    '/dashboard', '/my-time', '/profile', '/settings', '/portal', '/portal/mine',
    '/product/insights', '/product/features', '/product/prioritize', '/product/roadmap',
    '/product/objectives', '/product/outcomes', '/product/customers', '/product/impact',
    '/wiki', '/admin', '/admin/users', '/admin/projects', '/admin/audit-log',
  ];
  const projects = await api('/projects');
  for (const p of projects) {
    const k = p.key.toLowerCase();
    for (const s of PROJECT_SCREENS) routes.push(`/${k}/${s}`);
    if (p.is_service_desk) routes.push(`/${k}/servicedesk`, `/${k}/servicedesk/report`, `/${k}/servicedesk/settings`);
  }
  const atl = projects.find((p) => p.key === 'ATL');
  for (const issue of await api(`/projects/${atl.id}/issues`)) routes.push(`/atl/${issue.issue_key}`);
  for (const sprint of await api(`/projects/${atl.id}/sprints`)) if (sprint.slug) routes.push(`/atl/sprints/${sprint.slug}`);
  for (const space of await api('/wiki/spaces')) {
    routes.push(`/wiki/space/${space.id}`);
    for (const pg of await api(`/wiki/spaces/${space.id}/pages`)) routes.push(`/wiki/page/${pg.id}`);
  }

  for (const route of routes) {
    await page.goto(`${BASE}${route}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await Promise.all(pending.splice(0));
    process.stdout.write('.');
  }
  await Promise.all(pending.splice(0));

  for (const required of ['/auth/me', '/projects', '/users']) {
    if (!(required in fixtures)) throw new Error(`capture is missing ${required}`);
  }
  const sorted = Object.fromEntries(Object.keys(fixtures).sort().map((k) => [k, fixtures[k]]));
  writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`\n${Object.keys(sorted).length} responses from ${routes.length} screens → ${path.relative(process.cwd(), OUT)}`);
} finally {
  await browser?.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
