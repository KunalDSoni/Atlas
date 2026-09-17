# Embedded Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a second build of the Atlas frontend at `/demo/` that runs on recorded sample data with no login, and embed it in the landing page's product frame.

**Architecture:** `request()` in `frontend/src/lib/api.ts` is the single network choke point; in a Vite `demo`-mode build it hands every call to an in-memory store seeded from `src/demo/fixtures.json`, which a Playwright script records off a freshly seeded backend. A compile-time constant `__ATLAS_DEMO__` gates every demo branch so the normal build drops them. Express serves `build/demo/` under `/demo/` and allows same-origin framing for that path only.

**Tech Stack:** React 18, React Router 7, Vite 7, Vitest, Playwright, Express 5, Jest.

**Spec:** `docs/superpowers/specs/2026-09-17-embedded-demo-design.md`

## Global Constraints

- The demo never reads or writes `localStorage['atlas_token']` or `atlas_last_project`.
- Fixtures are captured only from a brand-new temp SQLite database with `SEED_DEMO_DATA=true`, `DB_DRIVER=sqlite`.
- Writes that stick: `PUT /issues/:id/move`, `PUT /issues/:id`, `POST /projects/:id/issues`, `POST /issues/:id/comments`. Every other write changes nothing.
- The normal build must contain no fixture data.
- `X-Frame-Options` stays `DENY` for every path except `/demo` and `/demo/*`, which get `SAMEORIGIN`.
- Backend `POST /api/auth/demo` and `backend/seed-demo.js` are not modified.
- `postMessage` traffic is accepted only when `event.origin === window.location.origin`.

**Deviation from spec, found while planning:** `backend/server.js` sets `X-Frame-Options: DENY` on every response, which would stop the iframe from loading at all. Task 4 relaxes it to `SAMEORIGIN` for `/demo` only.

---

### Task 1: Demo store

A pure in-memory store. No DOM, no fetch, no fixtures file — tests feed it small hand-written fixtures.

**Files:**
- Create: `frontend/src/demo/demo-store.ts`
- Test: `frontend/src/demo/demo-store.test.ts`

**Interfaces:**
- Produces:
  - `type Fixtures = Record<string, unknown>`
  - `class DemoNotFound extends Error { readonly path: string }`
  - `createDemoStore(fixtures: Fixtures, now?: () => Date): { read(path: string): unknown; write(method: string, path: string, body?: Record<string, unknown>): unknown }`

- [ ] **Step 1: Write the failing tests**

`frontend/src/demo/demo-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDemoStore, DemoNotFound, type Fixtures } from './demo-store';

const ME = { id: 'u-admin', name: 'Kunal Soni', avatar_color: '#0c66e4' };
const ALEX = { id: 'u-alex', name: 'Alex Rivera', avatar_color: '#22a06b' };

function issue(over: Record<string, unknown>) {
  return {
    id: 'i-1', project_id: 'p-atl', sprint_id: 's-1', issue_key: 'ATL-1', issue_number: 1,
    title: 'First', status: 'todo', assignee_id: null, assignee_name: null, assignee_color: null,
    comment_count: 0, subtask_count: 0, parent_id: null, ...over,
  };
}

function fixtures(): Fixtures {
  const one = issue({});
  const two = issue({ id: 'i-2', issue_key: 'ATL-2', issue_number: 2, title: 'Second', sprint_id: null });
  return {
    '/auth/me': ME,
    '/users': [ME, ALEX],
    '/projects': [{ id: 'p-atl', key: 'ATL', name: 'Atlas Platform' }],
    '/projects/p-atl/issues': [one, two],
    '/projects/p-atl/issues?sprint_id=s-1': [issue({})],
    '/projects/p-atl/epics': [{ id: 'e-1', issue_key: 'ATL-9', children: [{ id: 'i-1', issue_key: 'ATL-1', status: 'todo' }] }],
    '/issues/i-1/comments': [],
  };
}

const NOW = new Date('2026-09-17T10:00:00.000Z');
const store = () => createDemoStore(fixtures(), () => NOW);

describe('demo store reads', () => {
  it('returns a recorded response by exact path and query', () => {
    expect(store().read('/projects')).toEqual([{ id: 'p-atl', key: 'ATL', name: 'Atlas Platform' }]);
  });

  it('returns a copy, so callers cannot mutate the store', () => {
    const s = store();
    (s.read('/projects') as { name: string }[])[0].name = 'Changed';
    expect((s.read('/projects') as { name: string }[])[0].name).toBe('Atlas Platform');
  });

  it('finds an unrecorded issue by id or key in any recorded list', () => {
    const s = store();
    expect(s.read('/issues/i-2')).toMatchObject({ issue_key: 'ATL-2', title: 'Second' });
    expect(s.read('/issues/by-key/atl-2')).toMatchObject({ id: 'i-2' });
  });

  it('prefers the richest copy of an issue over a summary', () => {
    expect(store().read('/issues/i-1')).toMatchObject({ title: 'First', project_id: 'p-atl' });
  });

  it('answers an unrecorded issue sub-collection with an empty list', () => {
    expect(store().read('/issues/i-2/activity')).toEqual([]);
  });

  it('throws DemoNotFound for anything else', () => {
    expect(() => store().read('/nope')).toThrow(DemoNotFound);
  });
});

describe('demo store writes that stick', () => {
  it('a move updates every copy of the issue', () => {
    const s = store();
    s.write('PUT', '/issues/i-1/move', { status: 'in_progress', board_order: 3 });
    expect((s.read('/projects/p-atl/issues') as { status: string }[])[0].status).toBe('in_progress');
    expect((s.read('/projects/p-atl/epics') as { children: { status: string }[] }[])[0].children[0].status).toBe('in_progress');
    expect(s.read('/issues/i-1')).toMatchObject({ status: 'in_progress', updated_at: NOW.toISOString() });
  });

  it('an edit resolves the assignee name from the recorded users', () => {
    const s = store();
    const out = s.write('PUT', '/issues/i-1', { assignee_id: 'u-alex' });
    expect(out).toMatchObject({ assignee_id: 'u-alex', assignee_name: 'Alex Rivera', assignee_color: '#22a06b' });
  });

  it('moving an issue out of a sprint drops it from that sprint list, and back in re-adds it', () => {
    const s = store();
    s.write('PUT', '/issues/i-1', { sprint_id: null });
    expect(s.read('/projects/p-atl/issues?sprint_id=s-1')).toEqual([]);
    s.write('PUT', '/issues/i-2', { sprint_id: 's-1' });
    expect((s.read('/projects/p-atl/issues?sprint_id=s-1') as { id: string }[]).map((i) => i.id)).toEqual(['i-2']);
  });

  it('create assigns the next key, credits the demo user and lands in the project list', () => {
    const s = store();
    const created = s.write('POST', '/projects/p-atl/issues', { title: 'New one', type: 'task', status: 'todo', sprint_id: 's-1', assignee_id: 'u-alex' }) as Record<string, unknown>;
    expect(created).toMatchObject({ issue_key: 'ATL-3', issue_number: 3, reporter_name: 'Kunal Soni', assignee_name: 'Alex Rivera', created_at: NOW.toISOString() });
    expect((s.read('/projects/p-atl/issues') as { id: string }[]).map((i) => i.id)).toContain(created.id);
    expect((s.read('/projects/p-atl/issues?sprint_id=s-1') as { id: string }[]).map((i) => i.id)).toContain(created.id);
    expect(s.read(`/issues/${created.id as string}`)).toMatchObject({ title: 'New one' });
  });

  it('creating a subtask bumps the parent subtask count', () => {
    const s = store();
    s.write('POST', '/projects/p-atl/issues', { title: 'Child', type: 'subtask', parent_id: 'i-1' });
    expect(s.read('/issues/i-1')).toMatchObject({ subtask_count: 1 });
  });

  it('a comment is appended by the demo user and counted on the issue', () => {
    const s = store();
    const c = s.write('POST', '/issues/i-2/comments', { body: 'Looks good' });
    expect(c).toMatchObject({ issue_id: 'i-2', body: 'Looks good', author_name: 'Kunal Soni' });
    expect(s.read('/issues/i-2/comments')).toEqual([c]);
    expect(s.read('/issues/i-2')).toMatchObject({ comment_count: 1 });
  });
});

describe('demo store writes that do not stick', () => {
  it('echoes the body with the id from the path and changes nothing', () => {
    const s = store();
    const sprint = '6f1c2a4e-8d3b-4c1a-9e2f-1a2b3c4d5e6f';
    const before = JSON.stringify(fixtures());
    expect(s.write('POST', `/sprints/${sprint}/reopen`, { end_date: '2026-10-01' })).toEqual({ end_date: '2026-10-01', id: sprint });
    for (const key of Object.keys(fixtures())) expect(s.read(key)).toEqual((JSON.parse(before) as Fixtures)[key]);
  });

  it('DELETE answers ok and removes nothing', () => {
    const s = store();
    expect(s.write('DELETE', '/issues/i-1')).toEqual({ ok: true });
    expect(s.read('/issues/i-1')).toMatchObject({ id: 'i-1' });
  });

  it('issue key resolution answers an empty set', () => {
    expect(store().write('POST', '/issues/resolve', { keys: ['ATL-1'] })).toEqual({ issues: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/demo/demo-store.test.ts`
Expected: FAIL — `Failed to resolve import "./demo-store"`.

- [ ] **Step 3: Implement the store**

`frontend/src/demo/demo-store.ts`:

```ts
// The demo build's stand-in for the API: recorded responses held in memory for
// the life of the page. Four writes stick until reload (move, edit, create,
// comment); every other write answers success and changes nothing. Pure — no
// DOM, no network — so it is tested without a browser.

export type Fixtures = Record<string, unknown>;

export class DemoNotFound extends Error {
  constructor(readonly path: string) {
    super(`No sample data for ${path}`);
    this.name = 'DemoNotFound';
  }
}

type Obj = Record<string, unknown>;

/** Unrecorded issue sub-resources that read as "none yet" rather than missing. */
const ISSUE_COLLECTIONS = new Set(['comments', 'activity', 'links', 'watchers', 'worklogs', 'attachments', 'pages', 'children']);
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const SPRINT_LIST = /^\/projects\/([^/?]+)\/issues\?sprint_id=([^&]+)$/;

/** Fields a list payload carries that a create body usually does not. */
const ISSUE_DEFAULTS: Obj = {
  sprint_id: null, description: null, type: 'task', status: 'todo', priority: 'medium',
  assignee_id: null, parent_id: null, story_points: null, labels: null, due_date: null,
  start_date: null, board_order: 0, comment_count: 0, attachment_count: 0, watcher_count: 0,
  link_count: 0, epic_color: null, epic_key: null, epic_title: null, epic_badge_color: null,
  parent_key: null, parent_title: null, parent_type: null, sprint_name: null, sprint_slug: null,
  subtask_count: 0, subtask_done_count: 0, original_estimate: null, time_spent: null,
  in_progress_minutes_live: null, fix_version_id: null, component_id: null,
  fix_version_name: null, fix_version_status: null, component_name: null, labels_parsed: [],
};

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every object anywhere inside `value`, nested ones included. */
function* objects(value: unknown): Generator<Obj> {
  if (Array.isArray(value)) {
    for (const v of value) yield* objects(v);
    return;
  }
  if (!isObj(value)) return;
  yield value;
  for (const v of Object.values(value)) yield* objects(v);
}

function segments(path: string): string[] {
  return path.split('?')[0].split('/').filter(Boolean);
}

export function createDemoStore(fixtures: Fixtures, now: () => Date = () => new Date()) {
  const data: Fixtures = structuredClone(fixtures);

  const me = () => (isObj(data['/auth/me']) ? data['/auth/me'] : {});
  const users = (): Obj[] => (Array.isArray(data['/users']) ? (data['/users'] as Obj[]) : []);
  const projects = (): Obj[] => (Array.isArray(data['/projects']) ? (data['/projects'] as Obj[]) : []);

  /** Every recorded copy of an issue matching `match`. */
  function copies(match: (o: Obj) => boolean): Obj[] {
    const out: Obj[] = [];
    for (const value of Object.values(data)) {
      for (const o of objects(value)) {
        if (typeof o.id === 'string' && typeof o.issue_key === 'string' && match(o)) out.push(o);
      }
    }
    return out;
  }

  /** The fullest copy — a list row beats an epic's child summary. */
  function richest(match: (o: Obj) => boolean): Obj | undefined {
    return copies(match).sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
  }

  function assigneeFields(assigneeId: unknown): Obj {
    const u = users().find((x) => x.id === assigneeId);
    return { assignee_name: u?.name ?? null, assignee_color: u?.avatar_color ?? null };
  }

  /** Keep `?sprint_id=` lists in step with where the issue now lives. */
  function syncSprintLists(issue: Obj) {
    for (const [key, value] of Object.entries(data)) {
      const m = key.match(SPRINT_LIST);
      if (!m || m[1] !== issue.project_id || !Array.isArray(value)) continue;
      const at = value.findIndex((o) => isObj(o) && o.id === issue.id);
      const belongs = issue.sprint_id === decodeURIComponent(m[2]);
      if (belongs && at === -1) value.push(structuredClone(issue));
      if (!belongs && at !== -1) value.splice(at, 1);
    }
  }

  function updateIssue(id: string, patch: Obj): unknown {
    const fields: Obj = { ...patch, updated_at: now().toISOString() };
    if ('assignee_id' in patch) Object.assign(fields, assigneeFields(patch.assignee_id));
    for (const o of copies((x) => x.id === id)) Object.assign(o, fields);
    const issue = richest((x) => x.id === id);
    if (!issue) return { id, ...fields };
    syncSprintLists(issue);
    return structuredClone(issue);
  }

  function createIssue(projectId: string, body: Obj): unknown {
    const key = (projects().find((p) => p.id === projectId)?.key as string | undefined) ?? 'DEMO';
    const numbers = copies((o) => o.project_id === projectId).map((o) => Number(o.issue_number) || 0);
    const n = Math.max(0, ...numbers) + 1;
    const stamp = now().toISOString();
    const user = me();
    const issue: Obj = {
      ...ISSUE_DEFAULTS,
      ...body,
      ...assigneeFields(body.assignee_id ?? null),
      id: crypto.randomUUID(),
      project_id: projectId,
      issue_key: `${key}-${n}`,
      issue_number: n,
      reporter_id: user.id ?? null,
      reporter_name: user.name ?? null,
      reporter_color: user.avatar_color ?? null,
      created_at: stamp,
      updated_at: stamp,
    };
    const list = data[`/projects/${projectId}/issues`];
    if (Array.isArray(list)) list.push(issue);
    syncSprintLists(issue);
    if (typeof body.parent_id === 'string') {
      for (const o of copies((x) => x.id === body.parent_id)) o.subtask_count = Number(o.subtask_count ?? 0) + 1;
    }
    return structuredClone(issue);
  }

  function addComment(issueId: string, text: string): unknown {
    const stamp = now().toISOString();
    const user = me();
    const comment: Obj = {
      id: crypto.randomUUID(),
      issue_id: issueId,
      author_id: user.id ?? '',
      body: text,
      created_at: stamp,
      updated_at: stamp,
      author_name: user.name ?? 'Demo user',
      author_color: user.avatar_color ?? '#0c66e4',
    };
    const key = `/issues/${issueId}/comments`;
    if (!Array.isArray(data[key])) data[key] = [];
    (data[key] as Obj[]).push(comment);
    for (const o of copies((x) => x.id === issueId)) o.comment_count = Number(o.comment_count ?? 0) + 1;
    return structuredClone(comment);
  }

  function read(path: string): unknown {
    if (path in data) return structuredClone(data[path]);
    const parts = segments(path);
    if (parts[0] === 'issues') {
      if (parts.length === 3 && parts[1] === 'by-key') {
        const key = decodeURIComponent(parts[2]).toUpperCase();
        const hit = richest((o) => String(o.issue_key).toUpperCase() === key);
        if (hit) return structuredClone(hit);
      } else if (parts.length === 2) {
        const hit = richest((o) => o.id === parts[1]);
        if (hit) return structuredClone(hit);
      } else if (parts.length === 3 && ISSUE_COLLECTIONS.has(parts[2])) {
        return [];
      }
    }
    throw new DemoNotFound(path);
  }

  function write(method: string, path: string, body: Obj = {}): unknown {
    const m = method.toUpperCase();
    const parts = segments(path);
    if (parts[0] === 'issues' && m === 'PUT' && parts.length === 2) return updateIssue(parts[1], body);
    if (parts[0] === 'issues' && m === 'PUT' && parts.length === 3 && parts[2] === 'move') return updateIssue(parts[1], body);
    if (parts[0] === 'projects' && m === 'POST' && parts.length === 3 && parts[2] === 'issues') return createIssue(parts[1], body);
    if (parts[0] === 'issues' && m === 'POST' && parts.length === 3 && parts[2] === 'comments') return addComment(parts[1], String(body.body ?? ''));
    if (parts[0] === 'issues' && m === 'POST' && parts[1] === 'resolve') return { issues: [] };
    if (m === 'DELETE') return { ok: true };
    const id = [...parts].reverse().find((p) => UUIDISH.test(p)) ?? crypto.randomUUID();
    return { ...body, id };
  }

  return { read, write };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/demo/demo-store.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/demo/demo-store.ts frontend/src/demo/demo-store.test.ts
git commit -m "feat(demo): in-memory store the demo build answers from"
```

---

### Task 2: Capture the sample data

**Files:**
- Create: `frontend/scripts/capture-demo-fixtures.mjs`
- Create (generated): `frontend/src/demo/fixtures.json`
- Modify: `frontend/package.json` (scripts)

**Interfaces:**
- Produces: `frontend/src/demo/fixtures.json` — `{ "<path after /api, with query>": <response body> }`, keys sorted. Must contain `/auth/me`, `/projects`, `/users`.

- [ ] **Step 1: Write the capture script**

`frontend/scripts/capture-demo-fixtures.mjs`:

```js
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
```

- [ ] **Step 2: Add the npm script**

In `frontend/package.json` `scripts`, add:

```json
"demo:capture": "vite build && node scripts/capture-demo-fixtures.mjs",
```

(`build` is changed in Task 3, after the fixtures exist.)

- [ ] **Step 3: Run the capture**

Run: `cd frontend && npm run demo:capture`
Expected: a line of dots, then `N responses from M screens → src/demo/fixtures.json`, with N in the hundreds.

- [ ] **Step 4: Sanity-check the output**

Run:
```bash
cd frontend && node -e '
const f = require("./src/demo/fixtures.json");
const keys = Object.keys(f);
console.log(keys.length, "keys;", (JSON.stringify(f).length/1024|0) + " KB");
console.log(f["/auth/me"].email, f["/projects"].map(p => p.key).join(","));
console.log(keys.filter(k => k.includes("/issues")).slice(0, 5));'
```
Expected: `kunal@example.com`, project keys including `ATL`, and issue list keys. Note the size in the commit message.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/capture-demo-fixtures.mjs frontend/src/demo/fixtures.json frontend/package.json
git commit -m "feat(demo): record sample data off a freshly seeded backend"
```

---

### Task 3: The demo build

**Files:**
- Create: `frontend/src/demo/env.d.ts`, `frontend/src/demo/demo-api.ts`, `frontend/src/demo/messages.ts`, `frontend/src/demo/demo-bridge.tsx`
- Modify: `frontend/vite.config.ts`, `frontend/package.json`, `frontend/src/lib/api.ts:26-35,81-84`, `frontend/src/App.tsx:2,155-160`, `frontend/src/context/auth-provider.tsx:60-68`, `frontend/src/hooks/use-live-events.tsx:14-17`, `frontend/src/hooks/use-projects.tsx:21`, `frontend/src/lib/urls.ts:76-78`, `frontend/src/screens/reports.tsx:218-220`

**Interfaces:**
- Consumes: `createDemoStore`, `DemoNotFound`, `Fixtures` (Task 1); `fixtures.json` (Task 2).
- Produces:
  - global `declare const __ATLAS_DEMO__: boolean`
  - `demoRequest(path: string, options?: RequestInit): Promise<unknown>` in `@/demo/demo-api`
  - `DEMO_NAVIGATE = 'atlas-demo:navigate'`, `DEMO_READY = 'atlas-demo:ready'` in `@/demo/messages`
  - `<DemoBridge />` in `@/demo/demo-bridge`
  - build output `frontend/build/demo/index.html` referencing `/demo/assets/*`

- [ ] **Step 1: Declare the constant and the fixtures module**

`frontend/src/demo/env.d.ts`:

```ts
/** True only in `vite build --mode demo`. Replaced at build time, so `if (__ATLAS_DEMO__)` branches vanish from the normal bundle. */
declare const __ATLAS_DEMO__: boolean;

declare module '*/fixtures.json' {
  const fixtures: Record<string, unknown>;
  export default fixtures;
}
```

- [ ] **Step 2: Configure Vite for the demo mode**

Replace `frontend/vite.config.ts` with (existing comments kept):

```ts
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // `vite build --mode demo` is the sample-data demo served at /demo/ — the same
  // app with its API client answering from src/demo/fixtures.json.
  const demo = mode === 'demo';

  return {
    base: demo ? '/demo/' : '/',
    define: { __ATLAS_DEMO__: JSON.stringify(demo) },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    build: {
      // Express serves this directory (backend/server.js -> ../frontend/build).
      // The demo builds second, into build/demo, so it must not empty build/.
      outDir: demo ? 'build/demo' : 'build',
      emptyOutDir: !demo,
      rollupOptions: {
        output: {
          // Split the dependencies out of the entry chunk. This does not shrink
          // the first visit — the app shell needs React, the router and the Radix
          // primitives before it can paint anything — but it stops every app
          // change from invalidating the ~450 kB of vendor code that did not
          // change, which is what a returning user re-downloads today.
          //
          // One vendor chunk, not several: splitting a dependency graph by
          // package invites a chunk that runs before the one it initialises from,
          // and the failure mode is a blank page rather than a build error.
          manualChunks(id: string) {
            if (id.includes('node_modules')) return 'vendor';
          },
        },
      },
    },
    server: {
      // `npm run dev` proxies the API to the Express backend
      proxy: { '/api': 'http://localhost:3001' },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      // Unit tests only. Without this vitest sweeps the whole tree, picks up the
      // Playwright specs in e2e/, and fails ~20 files on an unresolvable
      // @playwright/test import — so `npm test` greeted everyone with a wall of
      // red that meant nothing, and buried any real failure in it.
      // The browser specs run under `npm run test:e2e`.
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  } as any;
});
```

In `frontend/package.json`, change `build` to:

```json
"build": "tsc -b && vite build && vite build --mode demo",
```

- [ ] **Step 3: The request adapter**

`frontend/src/demo/demo-api.ts`:

```ts
// The demo build's replacement for the network. lib/api.ts's request() calls
// this instead of fetch when __ATLAS_DEMO__ is set; nothing else in the app
// knows it is running on sample data.
import { ApiError } from '@/lib/api';
import fixtures from './fixtures.json';
import { createDemoStore, DemoNotFound } from './demo-store';

const store = createDemoStore(fixtures);

export async function demoRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const method = (options.method ?? 'GET').toUpperCase();
  try {
    if (method === 'GET') return store.read(path);
    const body = typeof options.body === 'string' ? (JSON.parse(options.body) as Record<string, unknown>) : {};
    return store.write(method, path, body);
  } catch (e) {
    if (e instanceof DemoNotFound) throw new ApiError('This part of Atlas has no sample data in the demo.', 404);
    throw e;
  }
}
```

- [ ] **Step 4: Swap it in at the API client**

In `frontend/src/lib/api.ts`, replace the three token functions:

```ts
export function getToken(): string | null {
  // The demo is always signed in, and never touches the real session's key.
  if (__ATLAS_DEMO__) return 'demo';
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  if (__ATLAS_DEMO__) return;
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  if (__ATLAS_DEMO__) return;
  localStorage.removeItem(TOKEN_KEY);
}
```

and make the first lines of `request()`:

```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (__ATLAS_DEMO__) {
    const { demoRequest } = await import('@/demo/demo-api');
    return (await demoRequest(path, options)) as T;
  }

  const token = getToken();
```

- [ ] **Step 5: Messages and the bridge**

`frontend/src/demo/messages.ts`:

```ts
/** Landing page → framed demo: show this in-app path. */
export const DEMO_NAVIGATE = 'atlas-demo:navigate';
/** Framed demo → landing page: listening now. */
export const DEMO_READY = 'atlas-demo:ready';
```

`frontend/src/demo/demo-bridge.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO_NAVIGATE, DEMO_READY } from './messages';

/**
 * Mounted only in the demo build. Lets the landing page's tabs drive the framed
 * demo, and keeps visitors inside /demo when they click a link the router does
 * not own — wiki HTML and issue mentions are plain anchors with root paths.
 */
export function DemoBridge() {
  const navigate = useNavigate();
  const nav = useRef(navigate);
  nav.current = navigate;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: unknown; path?: unknown } | null;
      if (msg?.type === DEMO_NAVIGATE && typeof msg.path === 'string' && msg.path.startsWith('/')) {
        nav.current(msg.path);
      }
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || (a.target && a.target !== '_self')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === '/demo' || url.pathname.startsWith('/demo/') || url.pathname.startsWith('/api/')) return;
      e.preventDefault();
      nav.current(url.pathname + url.search + url.hash);
    }

    window.addEventListener('message', onMessage);
    document.addEventListener('click', onClick);
    if (window.parent !== window) window.parent.postMessage({ type: DEMO_READY }, window.location.origin);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('click', onClick);
    };
  }, []);

  return null;
}
```

- [ ] **Step 6: Router, login and sign-out**

In `frontend/src/App.tsx`, add the import beside the other component imports:

```ts
import { DemoBridge } from '@/demo/demo-bridge';
```

and change the start of `App`'s tree to:

```tsx
      <BrowserRouter basename={__ATLAS_DEMO__ ? '/demo' : undefined}>
        <AuthProvider>
          {__ATLAS_DEMO__ && <DemoBridge />}
          <Routes>
            <Route path="/login" element={__ATLAS_DEMO__ ? <Navigate to="/dashboard" replace /> : <LoginScreen />} />
```

In `frontend/src/context/auth-provider.tsx`, make `logout` start:

```ts
  const logout = useCallback(async () => {
    // Nothing to sign out of: start the demo over instead.
    if (__ATLAS_DEMO__) {
      window.location.assign('/demo/');
      return;
    }
```

- [ ] **Step 7: The remaining demo branches**

`frontend/src/hooks/use-live-events.tsx`, first line of `open()`:

```ts
function open() {
  // The demo has no server to stream from.
  if (__ATLAS_DEMO__ || source) return;
```

`frontend/src/hooks/use-projects.tsx`:

```ts
// The demo keeps its own key so it never re-points a real session on the same origin.
const LAST_PROJECT_KEY = __ATLAS_DEMO__ ? 'atlas_demo_last_project' : 'atlas_last_project';
```

`frontend/src/lib/urls.ts`:

```ts
/** For Copy Link — a URL that survives being pasted into Slack. */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${__ATLAS_DEMO__ ? '/demo' : ''}${path}`;
}
```

`frontend/src/screens/reports.tsx`, first lines of `downloadCsv`:

```ts
  async function downloadCsv() {
    if (__ATLAS_DEMO__) {
      toast.info('CSV export is turned off in the demo.');
      return;
    }
    if (!currentProjectId) return;
```

- [ ] **Step 8: Type-check, unit tests, build**

Run: `cd frontend && npm run lint && npx vitest run && npm run build`
Expected: no type errors; all unit tests pass; `build/index.html` and `build/demo/index.html` both exist.

If `tsc` reports TS2732 on `./fixtures.json`, the ambient `*/fixtures.json` declaration is not being picked up — add `"src/demo/env.d.ts"` explicitly to `tsconfig.app.json` `include`, and re-run.

- [ ] **Step 9: Verify the normal bundle holds no demo data**

Run:
```bash
cd frontend && T=$(node -e 'const f=require("./src/demo/fixtures.json");const k=Object.keys(f).find(k=>/^\/projects\/[^/]+\/issues$/.test(k)&&f[k].length);console.log(f[k][0].title)') && echo "marker: $T" && ! grep -rlF "$T" build/assets && grep -rlF "$T" build/demo/assets | head -1
```
Expected: the marker title, no match under `build/assets`, one match under `build/demo/assets`.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/demo frontend/vite.config.ts frontend/package.json frontend/src/lib/api.ts frontend/src/App.tsx frontend/src/context/auth-provider.tsx frontend/src/hooks/use-live-events.tsx frontend/src/hooks/use-projects.tsx frontend/src/lib/urls.ts frontend/src/screens/reports.tsx frontend/build
git commit -m "feat(demo): build the app a second time against the sample data"
```

---

### Task 4: Serve and allow framing of /demo

**Files:**
- Create: `backend/utils/frame-options.js`
- Test: `backend/tests/backend/frame-options.test.js`
- Modify: `backend/server.js:75-79` (headers), `backend/server.js:245` (fallback)
- Modify: `backend/tests/frontend/build-output.test.js` (append)

**Interfaces:**
- Produces: `frameOptionsFor(pathname: string): 'DENY' | 'SAMEORIGIN'`

- [ ] **Step 1: Write the failing test**

`backend/tests/backend/frame-options.test.js`:

```js
const { frameOptionsFor } = require('../../utils/frame-options');

describe('frameOptionsFor', () => {
  test('the demo may be framed by its own origin', () => {
    expect(frameOptionsFor('/demo')).toBe('SAMEORIGIN');
    expect(frameOptionsFor('/demo/')).toBe('SAMEORIGIN');
    expect(frameOptionsFor('/demo/atl/board')).toBe('SAMEORIGIN');
  });

  test('everything else stays unframeable', () => {
    for (const p of ['/', '/login', '/dashboard', '/api/auth/me', '/demonstration', '/atl/demo']) {
      expect(frameOptionsFor(p)).toBe('DENY');
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/backend/frame-options.test.js`
Expected: FAIL — `Cannot find module '../../utils/frame-options'`.

- [ ] **Step 3: Implement**

`backend/utils/frame-options.js`:

```js
// X-Frame-Options per request path. The app stays unframeable (clickjacking)
// except the sample-data demo, which the landing page on this same origin
// embeds. The demo holds no real data and no session.
function frameOptionsFor(pathname) {
  return pathname === '/demo' || pathname.startsWith('/demo/') ? 'SAMEORIGIN' : 'DENY';
}

module.exports = { frameOptionsFor };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest tests/backend/frame-options.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into server.js**

Add beside the other `require('./utils/...')` lines:

```js
const { frameOptionsFor } = require('./utils/frame-options');
```

Replace `res.setHeader('X-Frame-Options', 'DENY');` with:

```js
  res.setHeader('X-Frame-Options', frameOptionsFor(req.path));
```

Immediately above the `// SPA fallback (Express 5 compatible)` block add:

```js
// The sample-data demo is a second SPA (frontend `vite build --mode demo`) with
// its own entry. express.static above serves /demo/ and its assets; deep links
// need the demo's index.html, not the app's.
app.get('/demo/{*splat}', (req, res) => {
  res.sendFile('index.html', { root: path.join(BUILD_DIR, 'demo') });
});
```

- [ ] **Step 6: Extend the build contract test**

Append to `backend/tests/frontend/build-output.test.js`:

```js
const DEMO_INDEX = path.join(BUILD_DIR, 'demo', 'index.html');
const describeIfDemoBuilt = fs.existsSync(DEMO_INDEX) ? describe : describe.skip;

describeIfDemoBuilt('Demo build', () => {
  test('its shell loads assets from /demo/assets, and they exist', () => {
    const html = fs.readFileSync(DEMO_INDEX, 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="(\/demo\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(fs.existsSync(path.join(BUILD_DIR, ref.replace(/^\//, '')))).toBe(true);
    }
  });

  test('sample data ships in the demo bundle only', () => {
    const fixtures = require('../../../frontend/src/demo/fixtures.json');
    const listKey = Object.keys(fixtures).find((k) => /^\/projects\/[^/]+\/issues$/.test(k) && fixtures[k].length);
    const marker = fixtures[listKey][0].title;
    const contains = (dir) => fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .some((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(marker));

    expect(contains(path.join(BUILD_DIR, 'demo', 'assets'))).toBe(true);
    expect(contains(path.join(BUILD_DIR, 'assets'))).toBe(false);
  });
});
```

- [ ] **Step 7: Run the backend suites touched**

Run: `cd backend && npx jest tests/backend/frame-options.test.js tests/frontend/build-output.test.js`
Expected: PASS, with the Demo build tests running (not skipped).

- [ ] **Step 8: Smoke the served demo**

Run:
```bash
cd backend && (PORT=3198 SQLITE_PATH=$(mktemp -d)/s.db SEED_DEMO_DATA=true node server.js >/dev/null 2>&1 &) && sleep 4 \
 && curl -sI localhost:3198/demo/atl/board | grep -iE "^HTTP|x-frame|content-type" \
 && curl -s localhost:3198/demo/atl/board | grep -o '/demo/assets/index-[^"]*\.js' \
 && curl -sI localhost:3198/dashboard | grep -i x-frame; pkill -f "PORT=3198" ; lsof -tiTCP:3198 -sTCP:LISTEN | xargs kill
```
Expected: `HTTP/1.1 200`, `X-Frame-Options: SAMEORIGIN`, `text/html`, a `/demo/assets/index-….js` path, then `X-Frame-Options: DENY` for `/dashboard`.

- [ ] **Step 9: Commit**

```bash
git add backend/utils/frame-options.js backend/tests/backend/frame-options.test.js backend/server.js backend/tests/frontend/build-output.test.js
git commit -m "feat(demo): serve /demo and let the landing page frame it"
```

---

### Task 5: Landing page embeds the demo

**Files:**
- Modify: `frontend/src/components/landing/product-frame.tsx` (rewrite)
- Delete: `frontend/src/components/landing/product-frame-views.tsx`
- Modify: `frontend/src/components/landing/demo-button.tsx` (rewrite)
- Modify: `frontend/src/lib/landing-content.ts:36-42`
- Modify: `frontend/src/lib/api.ts:238` (remove `demoLogin`)
- Modify: `frontend/src/context/auth-provider.tsx` (remove `adoptSession`)
- Modify: `frontend/e2e/landing.spec.ts`
- Create: `frontend/e2e/demo.spec.ts`

**Interfaces:**
- Consumes: `DEMO_NAVIGATE`, `DEMO_READY` (Task 3); `/demo/*` served (Task 4).
- Produces: `LANDING_COPY.frame.tabs[i].path: string`.

- [ ] **Step 1: Write the failing e2e specs**

`frontend/e2e/demo.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { assertNoCrash } from './helpers';

test.describe('sample-data demo', () => {
  test('opens straight into the app, with no sign-in', async ({ page }) => {
    await page.goto('/demo/');
    await expect(page).toHaveURL(/\/demo\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('#email')).toHaveCount(0);
    await assertNoCrash(page);
  });

  test('a moved card stays moved until reload', async ({ page }) => {
    await page.goto('/demo/atl/board');
    // Board columns are <section aria-label={status label}>; cards carry data-issue-key.
    const todo = page.locator('section[aria-label="To Do"]');
    const review = page.locator('section[aria-label="In Review"]');
    const card = todo.locator('[data-issue-key]').first();
    await expect(card).toBeVisible();
    const key = await card.getAttribute('data-issue-key');

    await card.dragTo(review);
    await expect(review.locator(`[data-issue-key="${key}"]`)).toBeVisible();

    // Leave and come back inside the app — a page load would reset the demo.
    await page.locator('a[href="/demo/atl/backlog"]').first().click();
    await expect(page).toHaveURL(/\/demo\/atl\/backlog/);
    await page.locator('a[href="/demo/atl/board"]').first().click();
    await expect(page.locator(`section[aria-label="In Review"] [data-issue-key="${key}"]`)).toBeVisible();
  });

  test('never touches a real session on the same origin', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('atlas_token', 'real-session');
      localStorage.setItem('atlas_last_project', 'real-project');
    });
    await page.goto('/demo/atl/board');
    await expect(page.locator('[data-issue-key]').first()).toBeVisible();
    expect(await page.evaluate(() => [localStorage.getItem('atlas_token'), localStorage.getItem('atlas_last_project')]))
      .toEqual(['real-session', 'real-project']);
  });
});
```

In `frontend/e2e/landing.spec.ts`, replace the first test's demo assertion with:

```ts
    await expect(page.getByRole('link', { name: /try the live demo/i }).first()).toHaveAttribute('href', '/demo/');
```

and replace the whole `'the product frame tabs switch panels'` test with:

```ts
  test('the product frame runs the demo, and its tabs drive it', async ({ page }) => {
    await page.goto('/');

    const board = page.getByRole('tab', { name: 'Board' });
    const roadmap = page.getByRole('tab', { name: 'Roadmap' });
    await expect(board).toHaveAttribute('aria-selected', 'true');

    const frame = page.frameLocator('#frame-panel iframe');
    await expect(frame.getByRole('heading').first()).toBeVisible();
    const demo = () => page.frames().find((f) => f.url().includes('/demo/'))?.url() ?? '';
    await expect.poll(demo).toContain('/demo/atl/board');

    await roadmap.click();
    await expect(roadmap).toHaveAttribute('aria-selected', 'true');
    await expect.poll(demo).toContain('/demo/product/roadmap');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx playwright test e2e/demo.spec.ts e2e/landing.spec.ts`
Expected: the demo specs may already pass (Tasks 3–4); the landing specs FAIL — no link to `/demo/`, no iframe.

- [ ] **Step 3: Tab paths in the copy**

In `frontend/src/lib/landing-content.ts`:

```ts
  frame: {
    // `path` is where the embedded demo goes; `url` is only the address-bar label.
    tabs: [
      { key: 'board', label: 'Board', url: 'open-atlas.xyz/ATL/board', path: '/atl/board' },
      { key: 'roadmap', label: 'Roadmap', url: 'open-atlas.xyz/product/roadmap', path: '/product/roadmap' },
      { key: 'insights', label: 'Insights', url: 'open-atlas.xyz/product/insights', path: '/product/insights' },
    ],
  },
```

- [ ] **Step 4: Rewrite the product frame**

`frontend/src/components/landing/product-frame.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { LANDING_COPY } from '@/lib/landing-content';
import { DEMO_NAVIGATE, DEMO_READY } from '@/demo/messages';

const TABS = LANDING_COPY.frame.tabs;

/**
 * Not a picture of Atlas — Atlas. The frame is the /demo/ build: the real app
 * answering from recorded sample data, so nothing a visitor does is saved or
 * sent anywhere. Tabs navigate the framed app by message rather than reloading
 * it, which would throw away whatever the visitor just changed.
 */
export function ProductFrame() {
  const [active, setActive] = useState<string>(TABS[0].key);
  const frame = useRef<HTMLIFrameElement>(null);
  const path = useRef<string>(TABS[0].path);
  const tab = TABS.find((t) => t.key === active)!;

  function show(to: string) {
    frame.current?.contentWindow?.postMessage({ type: DEMO_NAVIGATE, path: to }, window.location.origin);
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type !== DEMO_READY) return;
      // A tab clicked while the frame was still loading, or the demo restarted.
      if (path.current !== TABS[0].path) show(path.current);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function select(key: string) {
    const next = TABS.find((t) => t.key === key)!;
    setActive(key);
    path.current = next.path;
    show(next.path);
  }

  return (
    <section id="product" className="px-6 pb-16 pt-12">
      <div className="mx-auto max-w-6xl">
        <div role="tablist" aria-label="Product views" className="mb-4 flex justify-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls="frame-panel"
              onClick={() => select(t.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                active === t.key
                  ? 'border border-border bg-card text-foreground shadow-sm'
                  : 'border border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="flex h-10 items-center gap-2 border-b border-border-light bg-surface px-4">
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="ml-2 rounded-full border border-border bg-background px-3 py-0.5 text-[11px] text-faint">
              {tab.url}
            </span>
          </div>

          <div id="frame-panel" role="tabpanel" aria-labelledby={`tab-${active}`}>
            <iframe
              ref={frame}
              src={`/demo${TABS[0].path}`}
              title="A live Atlas workspace running on sample data"
              className="block h-[34rem] w-full border-0 bg-background md:h-[40rem]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
```

Then delete the drawings:

```bash
git rm frontend/src/components/landing/product-frame-views.tsx
```

- [ ] **Step 5: The demo buttons become links**

`frontend/src/components/landing/demo-button.tsx`:

```tsx
import { LANDING_COPY } from '@/lib/landing-content';

/** Opens the sample-data demo full page. No account, no sign-in. */
export function DemoButton({ variant = 'primary' }: { variant?: 'primary' | 'inverse' }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 font-semibold';
  const tone = variant === 'inverse'
    ? 'bg-primary-foreground text-primary hover:opacity-90'
    : 'bg-primary text-primary-foreground hover:bg-primary-hover';

  return (
    <a href="/demo/" className={`${base} ${tone}`}>
      {LANDING_COPY.nav.demo}
    </a>
  );
}
```

- [ ] **Step 6: Remove the now-unused demo sign-in client code**

In `frontend/src/lib/api.ts` delete the line:

```ts
    demoLogin: () => post<AuthUser>('/auth/demo'),
```

In `frontend/src/context/auth-provider.tsx`: delete `adoptSession: (authed: AuthUser) => void;` from `AuthContextValue`, delete the `adoptSession` `useCallback` block and its comment, and change the provider value to `{ user, loading, login, logout, refresh }`. Drop `AuthUser` from the type import if nothing else in the file uses it (`login` does not name it).

Run: `cd frontend && grep -rn "adoptSession\|demoLogin" src` — Expected: no output.

- [ ] **Step 7: Build and run the specs**

Run: `cd frontend && npm run lint && npx playwright test e2e/demo.spec.ts e2e/landing.spec.ts`
Expected: PASS (the Playwright config rebuilds first).

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src frontend/e2e frontend/build
git commit -m "feat(landing): embed the sample-data demo in the product frame"
```

---

### Task 6: Full verification and docs

**Files:**
- Modify: `README.md` ("The public landing page" section)

- [ ] **Step 1: Document it**

Replace the second paragraph of "### The public landing page" in `README.md` with:

```markdown
The product frame under the hero, and every "Try the live demo" button, open
`/demo/`: the real app built a second time (`vite build --mode demo`, part of
`npm run build`) with its API client answering from recorded sample data in
`frontend/src/demo/fixtures.json`. It needs no account and no server state —
moving a card, editing or creating an issue, and commenting stick until reload;
nothing else is saved. Re-record the sample data with
`cd frontend && npm run demo:capture` when screens change.

`POST /api/auth/demo` (gated on `DEMO_EMAIL`) still exists on the backend but
the landing page no longer calls it.
```

- [ ] **Step 2: Run every suite**

Run, from the repo root:
```bash
cd frontend && npm run lint && npx vitest run && npm run test:e2e && npm run test:e2e:empty && cd ../backend && npm test
```
Expected: all green. Any failure is investigated (superpowers:systematic-debugging), not skipped.

- [ ] **Step 3: See it in the real app**

Restart the local preview (`.claude/launch.json` → `atlas-demo`, port 3011). In the browser: `/` shows the frame with board cards inside it; the Roadmap tab switches the frame; `/demo/` opens on the dashboard; dragging a card on `/demo/atl/board` survives visiting Backlog and back; narrow the viewport to ~400px and confirm the landing page does not scroll horizontally. Screenshot each.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the sample-data demo"
```
