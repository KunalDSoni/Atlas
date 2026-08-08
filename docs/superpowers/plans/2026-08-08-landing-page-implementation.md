# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the login-screen front door at `/` with a public one-page marketing site, and let an anonymous visitor reach a populated Atlas workspace in one click.

**Architecture:** `POST /api/auth/demo` reuses the exact session machinery as `/login` — same token generation, same `sessions` insert, same JSON response shape — so the frontend adopts the session without a second round trip. The landing page is a lazy-loaded React screen behind a `LandingGate` route declared above the catch-all. Content lives in a data-only `landing-content.ts`; layout lives in eight small components. The demo project re-seeds lazily when its `created_at` is older than the reset interval.

**Tech Stack:** React 18, react-router-dom 7, Tailwind v4, lucide-react icons. Backend: Express, sql.js (SQLite) / MySQL. Tests: Playwright, Jest + supertest.

## Global Constraints

- **No new colour values in `frontend/src/index.css`.** Use existing semantic tokens only (`bg-background`, `text-foreground`, `bg-surface`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `bg-accent`, `text-accent-foreground`, `border-border`, `border-border-light`, `text-success`, `bg-success-muted`, `text-destructive`, `bg-destructive-muted`, `bg-warning-muted`, `text-info`, `bg-info-muted`).
- **Light theme only.** `frontend/src/context/theme-provider.tsx` states Atlas is light-theme only and strips `.dark` on mount. Do not add a theme toggle. Do not use `dark:` variants.
- **All 165 capabilities listed flat**, with no shipped/planned distinction. This is an approved product decision, not an oversight.
- **Demo user role is `user`** — never `admin` or `board_admin`.
- `DEMO_EMAIL` unset ⇒ `POST /api/auth/demo` returns `404`.
- Seeding is idempotent: running it twice produces one demo user, not two.
- Must pass: `cd frontend && npm run lint`, `cd backend && npm test`, `cd frontend && npm run test:e2e`, `cd frontend && npm run test:e2e:empty`.

## Verified Codebase Facts

Read these before writing code. Every one was checked against the repo; guessing at them is how the first draft of this plan went wrong.

**Database helpers** — `backend/database.js` exports `{ getDb, saveDb, initDb, queryAll, queryOne, run, translateForMysql, MYSQL_SCHEMA_SQL }`. Call them as `await queryOne(db, sql, params)` and `await run(db, sql, params)`. There is no `db.get()` or `db.run()` method.

**Real column names** (do not guess — several differ from the obvious name):

| Table | Columns |
|---|---|
| `users` | `id, name, email, password, role, avatar_color, avatar_url, phone, department, job_title, bio, timezone, is_active, last_login, created_at` — **no `updated_at`** |
| `projects` | `id, name, key, description, wip_limits, is_service_desk, lead_id, created_at` — **no `updated_at`** |
| `project_members` | `id, project_id, user_id, role_in_project, added_at` — **`role_in_project`, not `role`; `added_at`, not `created_at`** |
| `sprints` | `id, project_id, name, slug, goal, status, start_date, end_date, created_at` — **`status`, not `state`** |
| `issues` | `id, project_id, sprint_id, issue_key, issue_number, title, description, type, status, priority, assignee_id, reporter_id, parent_id, story_points, labels, due_date, start_date, original_estimate, time_spent, epic_color, fix_version_id, component_id, request_type_id, sd_fields, board_order, created_at, updated_at` — **`issue_key`, not `key`; `reporter_id`, not `created_by`; `issue_number` is required** |
| `sessions` | `id, user_id, token, expires_at, created_at` |

**Password hashing** — `backend/utils/password.js` exports `{ hashPassword, hashPasswordSync, verifyPassword, isHashed }`.

**Rate limiting** — `backend/middleware/ratelimit.js` keys buckets on `` `${req.ip}|${email}` ``, increments on every request *before* handling, and caps at `MAX_ATTEMPTS = 10` per 15-minute window. `clearRateLimit(req)` resets the bucket. **The demo route must not call `clearRateLimit`** — every demo request shares the key `ip|` (no email in body), so clearing on success would make the limit unreachable and leave the endpoint unthrottled.

**Auth response shape** — `POST /api/auth/login` returns the user fields plus `token`. `AuthProvider.login()` does `setToken(authed.token)` then `setUser(rest)`. The demo endpoint returns the identical shape.

**Issue status values** — seeded issues in `database.js` use lowercase statuses (`todo`, `inprogress`, `done`) and lowercase types (`story`, `task`, `bug`, `epic`). Match that, or the demo board renders empty columns.

**CHECK constraints are real and enforced.** `issues.epic_color` is declared `CHECK(epic_color IN ('purple','blue','teal','green','yellow','orange','red','pink'))` in both the SQLite (`database.js:108`) and MySQL (`:694`) schemas. It takes a named colour, never a hex string. SQLite enforces CHECK, and `sqlite` is the default driver.

**`translateForMysql` only rewrites POSITIVE date offsets.** Its regex matches `datetime('now', '+N days')` and has no negative case, so `datetime('now', '-N days')` reaches MySQL untranslated and is a syntax error. Production runs MySQL (`render.yaml`). Compute past dates in JavaScript and bind them as parameters rather than widening the shared helper, which every other caller depends on.

**Bind dates as `YYYY-MM-DD HH:MM:SS`, never raw `toISOString()`.** `translateForMysql` rewrites SQL text only — it never touches bound parameters. A raw `toISOString()` yields `2026-08-01T12:34:56.789Z`, and MySQL `DATETIME` rejects both the `T` separator and the trailing `Z`: strict mode errors, non-strict mode silently writes a zero date. SQLite accepts it either way, so this is invisible in local testing. The codebase's convention is `.toISOString().replace('T', ' ').slice(0, 19)` — see `database.js:2380` and `routes/reports.js:487`.

**The three facts above share one root cause worth internalising:** SQLite is the dev default and MySQL is production, so any date arithmetic, date formatting, or CHECK-constrained value that is only exercised locally will pass tests and fail in production. Verify such code against the MySQL schema definitions in `database.js`, not just against a local run.

---

## File Structure

**Backend**

| File | Responsibility |
|---|---|
| `backend/seed-demo.js` (create) | Idempotent demo user + project seed, and the staleness check |
| `backend/routes/auth.js` (modify) | Add `POST /api/auth/demo` with lazy re-seed |
| `backend/tests/backend/auth-demo.test.js` (create) | Jest coverage for the endpoint and seeding |

**Frontend**

| File | Responsibility |
|---|---|
| `frontend/src/lib/landing-content.ts` (create) | All copy + 165 capabilities. Data only, no JSX |
| `frontend/src/lib/api.ts` (modify) | Add `auth.demoLogin()` |
| `frontend/src/context/auth-provider.tsx` (modify) | Add `adoptSession(authed)` |
| `frontend/src/components/landing/site-nav.tsx` (create) | Sticky nav, mobile menu |
| `frontend/src/components/landing/hero.tsx` (create) | Eyebrow, headline, CTAs, trust strip |
| `frontend/src/components/landing/product-frame.tsx` (create) | Tab state + browser chrome |
| `frontend/src/components/landing/product-frame-views.tsx` (create) | Board, roadmap, insights markup |
| `frontend/src/components/landing/split-section.tsx` (create) | Delivery / discovery cards |
| `frontend/src/components/landing/feature-row.tsx` (create) | Reusable alternating row |
| `frontend/src/components/landing/feature-visuals.tsx` (create) | The five per-row CSS visuals |
| `frontend/src/components/landing/capability-index.tsx` (create) | Pillars, filter, empty state |
| `frontend/src/components/landing/demo-button.tsx` (create) | Demo CTA with loading + error states |
| `frontend/src/components/landing/cta-section.tsx` (create) | Closing accent band |
| `frontend/src/components/landing/site-footer.tsx` (create) | Footer |
| `frontend/src/components/app/landing-gate.tsx` (create) | Auth branch |
| `frontend/src/screens/landing.tsx` (create) | Composition only |
| `frontend/src/App.tsx` (modify) | Route for `/` |
| `frontend/index.html` (modify) | Meta tags |
| `frontend/e2e/landing.spec.ts` (create) | Playwright coverage |
| `frontend/public/og-image.png` (create) | Social preview image |

---

### Task 1: Demo seeding module

**Files:**
- Create: `backend/seed-demo.js`
- Test: covered by Task 2's test file

**Interfaces:**
- Consumes: `queryOne`, `run` from `../database`; `hashPassword` from `../utils/password`
- Produces: `module.exports = { seedDemo, isDemoStale, DEMO_PROJECT_KEY }`
  - `seedDemo(db): Promise<void>` — idempotent; creates demo user if absent, drops and recreates the demo project
  - `isDemoStale(db): Promise<boolean>` — true if the demo project is missing or older than `DEMO_RESET_HOURS`
  - `DEMO_PROJECT_KEY: string` — the literal `'DEMO'`

- [ ] **Step 1: Create `backend/seed-demo.js`**

```javascript
// ===== DEMO SEEDING =====
// Populates a single throwaway workspace for the public landing page's
// "Try the live demo" button.
//
// Deliberately independent of SEED_DEMO_DATA: production runs with that flag
// off, and must keep running with it off. This seed is gated on DEMO_EMAIL
// instead, so enabling a public demo never re-introduces the published
// password123 accounts.

const { v4: uuidv4 } = require('uuid');
const { queryOne, run } = require('./database');
const { hashPassword } = require('./utils/password');

const DEMO_PROJECT_KEY = 'DEMO';

function resetHours() {
  const raw = parseInt(process.env.DEMO_RESET_HOURS || '6', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 6;
}

/**
 * True when the demo project is missing, or old enough to be re-seeded.
 *
 * The project's own created_at IS the last-reset timestamp: a reset deletes
 * and recreates the row. That avoids inventing a settings table this schema
 * does not have.
 */
async function isDemoStale(db) {
  const project = await queryOne(
    db,
    'SELECT created_at FROM projects WHERE key = ?',
    [DEMO_PROJECT_KEY]
  );
  if (!project) return true;

  const created = new Date(project.created_at).getTime();
  if (!Number.isFinite(created)) return true;

  return Date.now() - created > resetHours() * 60 * 60 * 1000;
}

/** Creates the demo user if absent. Returns its id either way. */
async function ensureDemoUser(db) {
  const email = process.env.DEMO_EMAIL;
  const existing = await queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return existing.id;

  const id = uuidv4();
  // The password is never used — /api/auth/demo issues a session directly and
  // there is no path that verifies it. It is random so the account cannot be
  // signed into through the normal login form.
  const password = await hashPassword(uuidv4());

  await run(
    db,
    `INSERT INTO users (id, name, email, password, role, avatar_color, is_active, created_at)
     VALUES (?, ?, ?, ?, 'user', '#0c66e4', 1, datetime('now'))`,
    [id, process.env.DEMO_NAME || 'Demo user', email, password]
  );
  return id;
}

const ISSUES = [
  { title: 'Landing page and one-click demo entry', type: 'story', status: 'inprogress', priority: 'high', points: 8 },
  { title: 'Rate-limit the demo login route', type: 'task', status: 'todo', priority: 'high', points: 3 },
  { title: 'Swimlanes and grouping on the board', type: 'story', status: 'todo', priority: 'medium', points: 5 },
  { title: 'CSV export for sprint reports', type: 'story', status: 'todo', priority: 'low', points: 5 },
  { title: 'Issue stopwatch across midnight', type: 'bug', status: 'inprogress', priority: 'high', points: 2 },
  { title: 'Credit rollup minutes to the work log author', type: 'bug', status: 'done', priority: 'medium', points: 2 },
  { title: 'Blocked status and its transitions', type: 'story', status: 'done', priority: 'medium', points: 3 },
];

/**
 * Idempotent. Safe to call on every boot and on every demo login.
 * Creates the demo user once; drops and recreates the demo project so each
 * reset hands the next visitor a clean workspace.
 */
async function seedDemo(db) {
  if (!process.env.DEMO_EMAIL) return; // Demo not enabled — do nothing.

  const userId = await ensureDemoUser(db);

  // Drop the previous demo project and everything hanging off it. Explicit
  // deletes rather than relying on cascade: the schema does not declare
  // ON DELETE CASCADE on these tables.
  const old = await queryOne(db, 'SELECT id FROM projects WHERE key = ?', [DEMO_PROJECT_KEY]);
  if (old) {
    await run(db, 'DELETE FROM issues WHERE project_id = ?', [old.id]);
    await run(db, 'DELETE FROM sprints WHERE project_id = ?', [old.id]);
    await run(db, 'DELETE FROM project_members WHERE project_id = ?', [old.id]);
    await run(db, 'DELETE FROM projects WHERE id = ?', [old.id]);
  }

  const projectId = uuidv4();
  await run(
    db,
    `INSERT INTO projects (id, name, key, description, lead_id, created_at)
     VALUES (?, 'Demo workspace', ?, 'A sample board, sprint and backlog.', ?, datetime('now'))`,
    [projectId, DEMO_PROJECT_KEY, userId]
  );

  await run(
    db,
    `INSERT INTO project_members (id, project_id, user_id, role_in_project, added_at)
     VALUES (?, ?, ?, 'member', datetime('now'))`,
    [uuidv4(), projectId, userId]
  );

  // Sprint window computed in JS, not with datetime('now', '-8 days'):
  // translateForMysql only rewrites POSITIVE offsets, so a negative one would
  // reach MySQL untranslated and fail. Widening that shared helper would
  // change behaviour for every other caller, so bind the dates instead.
  const nowMs = Date.now();
  const sprintStart = new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString();
  const sprintEnd = new Date(nowMs + 6 * 24 * 60 * 60 * 1000).toISOString();

  const sprintId = uuidv4();
  await run(
    db,
    `INSERT INTO sprints (id, project_id, name, slug, goal, status, start_date, end_date, created_at)
     VALUES (?, ?, 'Sprint 14', 'sprint-14', 'Ship the public landing page', 'active',
             ?, ?, datetime('now'))`,
    [sprintId, projectId, sprintStart, sprintEnd]
  );

  for (let i = 0; i < ISSUES.length; i++) {
    const issue = ISSUES[i];
    await run(
      db,
      `INSERT INTO issues
         (id, project_id, sprint_id, issue_key, issue_number, title, type, status,
          priority, reporter_id, assignee_id, story_points, board_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        uuidv4(), projectId, sprintId,
        `${DEMO_PROJECT_KEY}-${i + 1}`, i + 1,
        issue.title, issue.type, issue.status, issue.priority,
        userId, userId, issue.points, i,
      ]
    );
  }

  // One epic, outside the sprint, so the epics screen is not empty.
  //
  // epic_color takes a NAMED colour, not a hex string: both schemas declare
  // CHECK(epic_color IN ('purple','blue','teal','green','yellow','orange',
  // 'red','pink')). SQLite enforces CHECK and is the default driver, so a hex
  // value throws here — after the rows above are already written.
  await run(
    db,
    `INSERT INTO issues
       (id, project_id, issue_key, issue_number, title, type, status, priority,
        reporter_id, epic_color, board_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Platform readiness', 'epic', 'todo', 'medium', ?, 'purple', ?,
             datetime('now'), datetime('now'))`,
    [uuidv4(), projectId, `${DEMO_PROJECT_KEY}-${ISSUES.length + 1}`, ISSUES.length + 1, userId, ISSUES.length]
  );
}

module.exports = { seedDemo, isDemoStale, DEMO_PROJECT_KEY };
```

- [ ] **Step 2: Verify the module loads without error**

```bash
cd backend && node -e "require('./seed-demo'); console.log('module loads')"
```

Expected: `module loads`

- [ ] **Step 3: Commit**

```bash
git add backend/seed-demo.js
git commit -m "feat: add idempotent demo workspace seeding

Gated on DEMO_EMAIL rather than SEED_DEMO_DATA so enabling a public demo
never re-introduces the published password123 accounts. The demo project's
created_at doubles as the last-reset timestamp, since a reset deletes and
recreates the row — no settings table required."
```

---

### Task 2: POST /api/auth/demo

**Files:**
- Modify: `backend/routes/auth.js` (append before `module.exports`)
- Test: `backend/tests/backend/auth-demo.test.js`

**Interfaces:**
- Consumes: `seedDemo`, `isDemoStale` from `../seed-demo`; existing `loginRateLimit`, `getDb`, `queryOne`, `run`, `auditLog`, `serverError`
- Produces: `POST /api/auth/demo` → `200` with the same body as `/auth/login`, or `404` / `429` / `500`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/backend/auth-demo.test.js`:

```javascript
/**
 * DEMO LOGIN TESTS
 * Tests: POST /api/auth/demo — gating, session issuance, role, seeding, reset.
 */
const request = require('supertest');
const { createTestApp } = require('./setup');

let app;

beforeAll(async () => {
  app = await createTestApp();
});

afterEach(() => {
  delete process.env.DEMO_EMAIL;
  delete process.env.DEMO_NAME;
});

describe('POST /api/auth/demo', () => {
  test('returns 404 when DEMO_EMAIL is unset', async () => {
    const res = await request(app).post('/api/auth/demo');
    expect(res.status).toBe(404);
  });

  test('issues a working session when DEMO_EMAIL is set', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    const res = await request(app).post('/api/auth/demo');

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.email).toBe('demo@example.com');
    expect(res.body).not.toHaveProperty('password');

    // The token must actually authenticate.
    const me = await request(app).get('/api/auth/me').set({ 'x-auth-token': res.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('demo@example.com');
  });

  test('the demo account is role user, never admin', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    const res = await request(app).post('/api/auth/demo');
    expect(res.body.role).toBe('user');

    // And the server must actually refuse admin endpoints for it.
    const admin = await request(app).get('/api/admin/stats').set({ 'x-auth-token': res.body.token });
    expect(admin.status).toBe(403);
  });

  test('seeding twice produces one demo user, not two', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    await request(app).post('/api/auth/demo');
    await request(app).post('/api/auth/demo');

    const { getDb, queryAll } = require('../../database');
    const db = await getDb();
    const users = await queryAll(db, 'SELECT id FROM users WHERE email = ?', ['demo@example.com']);
    expect(users).toHaveLength(1);
  });

  test('a fresh demo project is not re-seeded on the next visit', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    const first = await request(app).post('/api/auth/demo');
    expect(first.status).toBe(200);

    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const before = await queryOne(db, 'SELECT id FROM projects WHERE key = ?', ['DEMO']);

    await request(app).post('/api/auth/demo');
    const after = await queryOne(db, 'SELECT id FROM projects WHERE key = ?', ['DEMO']);

    // Same row id means the project was reused, not dropped and recreated.
    expect(after.id).toBe(before.id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npm test -- auth-demo.test.js
```

Expected: FAIL — every test 404s, because the route does not exist.

- [ ] **Step 3: Add the route**

In `backend/routes/auth.js`, add the import at the top with the others:

```javascript
const { seedDemo, isDemoStale } = require('../seed-demo');
```

Then add this route immediately before `module.exports = router;`:

```javascript
// POST /api/auth/demo
//
// Hands an anonymous visitor a session on the demo account. Deliberately
// credential-free — that is the entire point — so the guards matter:
//   1. Off unless DEMO_EMAIL is configured.
//   2. Rate limited, and NOT cleared on success. Every request shares the
//      bucket key `ip|` (no email in the body), so calling clearRateLimit
//      here would make the cap unreachable.
//   3. The seeded account is role `user`; the server's own middleware refuses
//      admin endpoints for it.
router.post('/demo', loginRateLimit, async (req, res) => {
  try {
    if (!process.env.DEMO_EMAIL) {
      return res.status(404).json({ error: 'Demo is not enabled' });
    }

    const db = await getDb();

    // Lazy reset: re-seed only when the workspace has gone stale. Runs when
    // someone actually visits, so there is no scheduler to drift or fail.
    if (await isDemoStale(db)) {
      await seedDemo(db);
    }

    // The role is pinned HERE, not merely assumed from the seed. seedDemo
    // adopts a pre-existing account at DEMO_EMAIL without inspecting it, so
    // without this filter, pointing DEMO_EMAIL at an admin's address would
    // hand an unauthenticated admin session to anyone who clicks the button.
    // The 500 is deliberately uninformative — it must not reveal whether the
    // account is missing, deactivated, or the wrong role.
    const user = await queryOne(
      db,
      "SELECT * FROM users WHERE email = ? AND is_active = 1 AND role = 'user'",
      [process.env.DEMO_EMAIL]
    );
    if (!user) return res.status(500).json({ error: 'Demo account is unavailable' });

    const token = crypto.randomBytes(32).toString('hex');
    await run(db, "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))", [uuidv4(), user.id, token]);
    await run(db, "UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);

    auditLog({ userId: user.id, action: 'Demo session started', category: 'auth', entityType: 'user', entityId: user.id, entityName: user.name });

    res.json({
      id: user.id, name: user.name, email: user.email, role: user.role,
      avatar_color: user.avatar_color, avatar_url: user.avatar_url,
      phone: user.phone, department: user.department, job_title: user.job_title,
      bio: user.bio, timezone: user.timezone, is_active: user.is_active,
      last_login: new Date().toISOString(), created_at: user.created_at, token
    });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npm test -- auth-demo.test.js
```

Expected: PASS — all five tests.

- [ ] **Step 5: Run the whole backend suite for regressions**

```bash
cd backend && npm test
```

Expected: PASS, with no previously-green test now failing.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/auth.js backend/tests/backend/auth-demo.test.js
git commit -m "feat: add POST /api/auth/demo for one-click demo access

Reuses the /login session machinery so the response shape is identical and
the frontend adopts the session without a second round trip. Gated on
DEMO_EMAIL, rate limited without clearing the bucket on success, and only
ever issues a role-user session. Re-seeds lazily when the workspace is stale."
```

---

### Task 3: Frontend session adoption

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/context/auth-provider.tsx`

**Interfaces:**
- Consumes: existing `post`, `setToken`, `AuthUser`
- Produces:
  - `api.auth.demoLogin(): Promise<AuthUser>`
  - `useAuth().adoptSession(authed: AuthUser): void` — stores the token and sets the user from an already-issued session

**Why this task exists:** `AuthProvider.login(email, password)` performs a *credential* login. The demo endpoint has already issued a session, so calling `login()` afterwards would fire a second request with no password and get a 401. Adoption is a separate operation and needs its own method.

- [ ] **Step 1: Add `demoLogin` to the API client**

In `frontend/src/lib/api.ts`, inside the `auth` object (next to `login`, around line 170):

```typescript
    demoLogin: () => post<AuthUser>('/auth/demo'),
```

- [ ] **Step 2: Add `adoptSession` to AuthProvider**

In `frontend/src/context/auth-provider.tsx`, add to the interface:

```typescript
interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  adoptSession: (authed: AuthUser) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
```

Import the type:

```typescript
import type { AuthUser, User } from '@/lib/types';
```

Add the callback next to `login`:

```typescript
  // Adopts a session the server has already issued (the demo endpoint), as
  // opposed to login(), which exchanges credentials for one.
  const adoptSession = useCallback((authed: AuthUser) => {
    setToken(authed.token);
    const { token: _token, ...rest } = authed;
    setUser(rest as User);
  }, []);
```

And add it to the provider value:

```typescript
    <AuthContext.Provider value={{ user, loading, login, adoptSession, logout, refresh }}>
```

- [ ] **Step 3: Verify it compiles**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/context/auth-provider.tsx
git commit -m "feat: add demoLogin API call and session adoption

adoptSession() stores a token the server has already issued, which is what
the demo endpoint returns. login() cannot serve this — it exchanges
credentials, and the demo flow has none to exchange."
```

---

### Task 4: Landing content data

**Files:**
- Create: `frontend/src/lib/landing-content.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `LANDING_COPY` — every string on the page
  - `CAPABILITY_PILLARS: Pillar[]` where `interface Pillar { name: string; items: string[] }`
  - `CAPABILITY_TOTAL: number` — computed from the data, never hand-written

- [ ] **Step 1: Create the file**

Create `frontend/src/lib/landing-content.ts`:

```typescript
// Landing page content. Data only — no JSX, no layout.
//
// Capabilities are derived from docs/JIRA_FEATURES_COMPARISON.md (112),
// docs/PRODUCTBOARD_FEATURES_COMPLETE.md (44) and
// docs/PRODUCTBOARD_FEATURES_REMAINING.md (44), de-duplicated across the
// overlap between the two comparisons.
//
// Entries carry no shipped/planned distinction — an approved product
// decision. If that is ever revisited, add `status` to the item shape here
// and render it in capability-index.tsx; nothing else needs to change.

export interface Pillar {
  name: string;
  items: string[];
}

export const LANDING_COPY = {
  nav: {
    brand: 'Atlas',
    links: [
      { label: 'Product', href: '#product' },
      { label: 'Delivery', href: '#delivery' },
      { label: 'Discovery', href: '#discovery' },
      { label: 'All capabilities', href: '#capabilities' },
    ],
    signIn: 'Sign in',
    demo: 'Try the live demo',
  },
  hero: {
    badge: 'New',
    badgeText: 'One workspace, zero handoff',
    headline: 'Your backlog and your roadmap, finally in the same tool',
    sub: "Atlas runs sprint delivery and product discovery on one system of record — so the customer request, the roadmap bet and the ticket that ships it are the same object, not three tools pretending to sync.",
    trust: ['Boards', 'Sprints', 'Roadmaps', 'Insights', 'Wiki', 'Service desk', 'Reporting'],
  },
  frame: {
    tabs: [
      { key: 'board', label: 'Board', url: 'open-atlas.xyz/ATL/board' },
      { key: 'roadmap', label: 'Roadmap', url: 'open-atlas.xyz/product/roadmap' },
      { key: 'insights', label: 'Insights', url: 'open-atlas.xyz/product/insights' },
    ],
  },
  split: {
    eyebrow: 'Two halves, one record',
    headline: 'The handoff that usually loses everything',
    sub: 'Most teams run discovery in one tool and delivery in another, then spend the week reconciling them. Atlas keeps both on the same objects, so nothing is retyped and nothing goes missing in the gap.',
    delivery: {
      chip: 'Delivery',
      title: 'Ship the work',
      body: 'Everything an engineering team needs to plan a sprint, run it, and prove what happened — boards, estimates, workflow, and the reports that come out the other end.',
      points: [
        'Kanban and sprint boards with drag-and-drop',
        'Backlog grooming, story points, epics and subtasks',
        'JQL search with saved filters',
        'Burndown, velocity, cumulative flow and time tracking',
      ],
    },
    discovery: {
      chip: 'Discovery',
      title: 'Decide the work',
      body: 'Everything a product team needs to know what to build — customer signal collected in one inbox, scored against objectives, and promoted straight onto the roadmap.',
      points: [
        'Customer insights inbox and public ideas portal',
        'Feature lifecycle from idea to measured impact',
        'Objectives, outcomes and prioritisation scoring',
        'Themes, releases and shareable roadmaps',
      ],
    },
  },
  rows: [
    {
      visual: 'board' as const,
      eyebrow: 'Plan and track',
      title: 'A board that matches how your team actually works',
      body: 'Drag work across the columns your workflow defines, not the ones a vendor picked. Every card carries its type, priority, points, labels, assignee and full history — and every change lands in the audit trail.',
      tags: ['Kanban', 'Sprint board', 'Backlog', 'Epics', 'Subtasks', 'Custom fields', 'Labels', 'Issue linking', 'Attachments', 'Stopwatch'],
    },
    {
      visual: 'insights' as const,
      eyebrow: 'Discovery',
      title: 'Every request in one inbox, scored before it becomes a ticket',
      body: 'Feedback arrives from the portal, the service desk and your own team, then gets grouped, weighted by the customers asking, and promoted to a feature with the original evidence still attached.',
      tags: ['Insights inbox', 'Ideas portal', 'Request aggregation', 'Prioritisation', 'Objectives', 'Outcomes', 'Themes', 'Customers', 'Impact'],
    },
    {
      visual: 'report' as const,
      eyebrow: 'Report',
      title: 'The numbers your stand-up actually asks for',
      body: "Burndown, velocity and cumulative flow are generated from the same issues your team is already moving — no separate reporting tool, no weekly export, no spreadsheet that is stale by Tuesday.",
      tags: ['Burndown', 'Velocity', 'Cumulative flow', 'Flow metrics', 'Time tracking', 'Dashboard gadgets', 'Audit log'],
    },
    {
      visual: 'queue' as const,
      eyebrow: 'Support and knowledge',
      title: 'A help desk and a wiki that know about your backlog',
      body: 'Customer requests come in through a portal with real queues and SLA timers. When one turns out to be a bug, it becomes an issue on the board with the conversation still attached — and the answer becomes a wiki page.',
      tags: ['Customer portal', 'Queues', 'SLA timers', 'Request types', 'Deflection', 'Wiki spaces', 'Page permissions', 'Ask wiki'],
    },
    {
      visual: 'api' as const,
      eyebrow: 'Platform',
      title: 'Yours to run, and yours to extend',
      body: 'Role-based permissions down to the project, a full audit log of every change, and a REST API with webhooks so Atlas can drive whatever else you run. Self-hosted on your own database.',
      tags: ['RBAC', 'Audit log', 'REST API', 'Webhooks', 'API tokens', 'Custom fields', 'Automation', 'Self-hosted'],
    },
  ],
  capabilities: {
    eyebrow: 'Everything in the box',
    headlineSuffix: 'capabilities, no add-ons',
    sub: 'The full surface area, grouped the way the product is. Search it.',
    placeholder: 'Search capabilities…',
    empty: 'No capability matches that.',
  },
  cta: {
    headline: 'See it with real data, in one click',
    body: 'The demo drops you straight into a populated workspace — a live board, a roadmap and a full quarter of history. No signup, no credit card.',
  },
  footer: {
    copyright: '© 2026 Atlas',
    links: [
      { label: 'Product', href: '#product' },
      { label: 'Capabilities', href: '#capabilities' },
      { label: 'Sign in', href: '/login' },
    ],
  },
};

export const CAPABILITY_PILLARS: Pillar[] = [
  {
    name: 'Plan',
    items: ['Projects', 'Issues', 'Issue types', 'Subtasks', 'Story points', 'Priorities', 'Labels and tagging', 'Custom fields', 'Epics', 'Backlog', 'Sprint planning', 'Goal alignment', 'Issue linking', 'Bulk actions', 'Project templates', 'AI-assisted planning'],
  },
  {
    name: 'Track',
    items: ['Kanban board', 'Sprint board', 'Drag and drop', 'Board customisation', 'Swimlanes', 'Workflow states', 'Status categories', 'Custom workflows', 'Automated transitions', 'Blocked status', 'Issue detail view', 'Issue history', 'Audit trail', 'Attachments', 'Watchers', 'Search', 'Saved filters', 'JQL advanced filtering', 'Time tracking', 'Issue stopwatch'],
  },
  {
    name: 'Deliver',
    items: ['Sprints', 'Sprint burndown', 'Velocity tracking', 'Cumulative flow', 'Flow metrics', 'Releases', 'Release planning', 'Release coordination', 'Roadmap', 'Capacity planning', 'Resource allocation'],
  },
  {
    name: 'Discover',
    items: ['Product roadmapping', 'Feature lifecycle', 'Feature dependencies', 'Feature adoption', 'Feature impact', 'Request aggregation', 'Themes and initiatives', 'Objectives and OKRs', 'Outcome tracking', 'Prioritisation scoring', 'Customer insights', 'Feedback collection', 'Feedback organisation', 'Feedback portals', 'Segmented portals', 'In-app feedback widget', 'Idea submission', 'Idea management', 'Company management', 'Customer attributes', 'VIP customer views', 'Feedback segmentation', 'Feedback trends', 'AI-generated insights', 'Automated feedback loops', 'Scheduled outreach'],
  },
  {
    name: 'Collaborate',
    items: ['Comments', 'Threaded discussion', 'Mentions', 'Mention notifications', 'Activity feed', 'Notifications', 'Notification rules', 'Team management', 'Cross-functional collaboration', 'Shareable links', 'Command palette', 'Real-time collaboration'],
  },
  {
    name: 'Automate',
    items: ['Workflow automation', 'Automation rules', 'Conditional workflows', 'No-code automation builder', 'Rules library', 'Webhook triggers', 'Request forms'],
  },
  {
    name: 'Report',
    items: ['Project dashboard', 'Personal dashboard', 'Dashboard gadgets', 'Custom dashboards', 'Real-time dashboards', 'Sprint report', 'Issue report', 'Project reports', 'Time tracking report', 'Agile metrics', 'Custom report builder', 'Scheduled reports', 'Comparative analytics', 'Predictive analytics', 'AI insights'],
  },
  {
    name: 'Support and knowledge',
    items: ['Customer portal', 'Help centre', 'Request types', 'Request queues', 'SLA management', 'SLA timers', 'Service desk reporting', 'Deflection suggestions', 'Knowledge base', 'Wiki spaces', 'Wiki pages', 'Page editing', 'Page templates', 'Page permissions', 'Wiki attachments', 'Ask wiki', 'Article suggestions'],
  },
  {
    name: 'Administer',
    items: ['User management', 'Role-based access control', 'Project members', 'Permission groups', 'Project settings', 'Issue type configuration', 'Workflow configuration', 'Custom field configuration', 'Notification settings', 'Admin dashboard', 'Audit log', 'Advanced audit logging', 'Session management', 'Backup and export', 'Data residency', 'Encryption at rest', 'SOC 2 Type II'],
  },
  {
    name: 'Platform and integrations',
    items: ['REST API', 'API tokens', 'Webhooks', 'Webhook events', 'Activity stream API', 'GraphQL API', 'SDKs and libraries', 'OAuth and SSO', 'SAML SSO', 'LDAP sync', 'Slack', 'Microsoft Teams', 'GitHub', 'Figma', 'Confluence', 'Google Workspace', 'Microsoft 365', 'Salesforce', 'Customer data platform', 'App marketplace', 'Mobile app', 'Mobile web', 'Offline mode', 'Voice and video'],
  },
];

/** Computed, never hand-written — the headline can't drift from the list. */
export const CAPABILITY_TOTAL = CAPABILITY_PILLARS.reduce((n, p) => n + p.items.length, 0);
```

- [ ] **Step 2: Verify it compiles and the total is 165**

```bash
cd frontend && npm run lint
```

Expected: no errors.

```bash
cd frontend && node --input-type=module -e "
const src = await import('fs').then(m => m.readFileSync('src/lib/landing-content.ts','utf8'));
const counts = [...src.matchAll(/items: \[(.*?)\]/gs)].map(m => m[1].split(/',\s*'/).length);
console.log('pillars:', counts.length, 'total:', counts.reduce((a,b)=>a+b,0));
"
```

Expected: `pillars: 10 total: 165`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/landing-content.ts
git commit -m "data: add landing page copy and 165 capabilities

Data only, no JSX — marketing edits never touch layout code, and the
capability list stays a reviewable diff against the comparison docs.
CAPABILITY_TOTAL is computed so the headline cannot drift from the list."
```

---

### Task 5: Nav, hero and footer

**Files:**
- Create: `frontend/src/components/landing/site-nav.tsx`
- Create: `frontend/src/components/landing/hero.tsx`
- Create: `frontend/src/components/landing/site-footer.tsx`

**Interfaces:**
- Consumes: `LANDING_COPY`; `DemoButton` from Task 8 is **not** used here — nav and hero receive their demo control as a `demoSlot` prop so this task has no dependency on Task 8
- Produces: `<SiteNav demoSlot={...} />`, `<Hero demoSlot={...} />`, `<SiteFooter />`

- [ ] **Step 1: Create `site-nav.tsx`**

```typescript
import { useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { LANDING_COPY } from '@/lib/landing-content';

/** `demoSlot` is the demo CTA, injected so the nav has no auth dependency. */
export function SiteNav({ demoSlot }: { demoSlot: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border-light bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-7 px-6">
        <a href="#top" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded bg-primary text-sm font-bold text-primary-foreground">A</span>
          {LANDING_COPY.nav.brand}
        </a>

        <nav className="hidden gap-6 md:flex" aria-label="Sections">
          {LANDING_COPY.nav.links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-muted-foreground hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a href="/login" className="hidden rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface md:inline-block">
            {LANDING_COPY.nav.signIn}
          </a>
          {demoSlot}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-md border border-border md:hidden"
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-1 border-t border-border-light px-6 py-3 md:hidden">
          {LANDING_COPY.nav.links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2 text-sm font-medium text-muted-foreground">
              {l.label}
            </a>
          ))}
          <a href="/login" className="block py-2 text-sm font-medium text-muted-foreground">
            {LANDING_COPY.nav.signIn}
          </a>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Create `hero.tsx`**

```typescript
import type { ReactNode } from 'react';
import { LANDING_COPY } from '@/lib/landing-content';

export function Hero({ demoSlot }: { demoSlot: ReactNode }) {
  const { badge, badgeText, headline, sub, trust } = LANDING_COPY.hero;

  return (
    <section className="px-6 pt-20 text-center">
      <div className="mx-auto max-w-3xl">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-accent px-2 py-1 text-sm font-semibold text-accent-foreground">
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] uppercase tracking-wide text-primary-foreground">{badge}</span>
          {badgeText}
        </p>

        {/* The page's only h1. */}
        <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          {headline}
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{sub}</p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {demoSlot}
          <a href="/login" className="rounded-md border border-border px-6 py-3 font-semibold hover:bg-surface">
            {LANDING_COPY.nav.signIn}
          </a>
        </div>

        <p className="mt-9 text-xs font-medium uppercase tracking-widest text-faint">
          {trust.join(' · ')}
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create `site-footer.tsx`**

```typescript
import { LANDING_COPY } from '@/lib/landing-content';

export function SiteFooter() {
  return (
    <footer className="border-t border-border-light bg-surface px-6 py-11">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 text-sm text-muted-foreground">
        <span>{LANDING_COPY.footer.copyright}</span>
        <nav className="ml-auto flex flex-wrap gap-6" aria-label="Footer">
          {LANDING_COPY.footer.links.map((l) => (
            <a key={l.label} href={l.href} className="hover:text-foreground">{l.label}</a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/landing/site-nav.tsx frontend/src/components/landing/hero.tsx frontend/src/components/landing/site-footer.tsx
git commit -m "feat: add landing nav, hero and footer

The demo CTA is injected as a demoSlot prop rather than imported, so these
components carry no auth dependency and stay trivially testable."
```

---

### Task 6: Product frame

**Files:**
- Create: `frontend/src/components/landing/product-frame-views.tsx`
- Create: `frontend/src/components/landing/product-frame.tsx`

**Interfaces:**
- Consumes: `LANDING_COPY.frame`
- Produces: `<ProductFrame />`; `<BoardView />`, `<RoadmapView />`, `<InsightsView />`

- [ ] **Step 1: Create `product-frame-views.tsx`**

```typescript
// Stylised representations of three Atlas screens, built from the same
// semantic tokens as the real app. Non-interactive by design — this is a
// picture of the product, not the product.

const CARDS = {
  todo: [
    { key: 'ATL-241', title: 'Rate-limit the demo login route', points: 3 },
    { key: 'ATL-244', title: 'Swimlanes and grouping on the board', points: 5 },
  ],
  progress: [{ key: 'ATL-238', title: 'Landing page and one-click demo entry', points: 8 }],
  review: [{ key: 'ATL-233', title: 'Issue stopwatch across midnight', points: 2 }],
  done: [
    { key: 'ATL-230', title: 'Credit rollup minutes to the author', points: 2 },
    { key: 'ATL-229', title: 'Blocked status and transitions', points: 3 },
  ],
};

function Column({ name, cards }: { name: string; cards: { key: string; title: string; points: number }[] }) {
  return (
    <div className="rounded-lg bg-surface p-2.5">
      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {name} <span className="tabular-nums">{cards.length}</span>
      </p>
      <div className="space-y-1.5">
        {cards.map((c) => (
          <div key={c.key} className="rounded border border-border bg-card p-2">
            <p className="mb-2 text-xs leading-snug">{c.title}</p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-faint">{c.key}</span>
              <span className="rounded-full bg-surface px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{c.points}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardView() {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <Column name="To do" cards={CARDS.todo} />
      <Column name="In progress" cards={CARDS.progress} />
      <Column name="In review" cards={CARDS.review} />
      <Column name="Done" cards={CARDS.done} />
    </div>
  );
}

const THEMES = [
  { name: 'Enterprise readiness', start: 1, span: 2 },
  { name: 'Board customisation', start: 1, span: 1 },
  { name: 'Insight intelligence', start: 2, span: 2 },
  { name: 'Automation builder', start: 3, span: 2 },
  { name: 'Mobile parity', start: 1, span: 3 },
];

export function RoadmapView() {
  return (
    <div>
      <div className="mb-2 grid grid-cols-[9rem_repeat(4,1fr)] gap-2 border-b border-border-light pb-2">
        <span />
        {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
          <span key={q} className="text-[11px] font-semibold uppercase tracking-wider text-faint">{q}</span>
        ))}
      </div>
      <div className="space-y-2">
        {THEMES.map((t) => (
          <div key={t.name} className="grid grid-cols-[9rem_repeat(4,1fr)] items-center gap-2">
            <span className="truncate text-xs font-medium">{t.name}</span>
            <div className="col-span-4 grid grid-cols-4 gap-2">
              <div
                className="flex h-6 items-center rounded bg-primary px-2 text-[11px] font-semibold text-primary-foreground"
                style={{ gridColumn: `${t.start} / span ${t.span}` }}
              >
                <span className="truncate">{t.name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SIGNALS = [
  { quote: 'We need SSO before we can roll this out to the whole org.', company: 'Northwind', weight: 92 },
  { quote: 'Exporting the sprint report to CSV would save us hours.', company: 'Kite & Co', weight: 64 },
  { quote: 'Swimlanes by assignee — the board gets noisy at 40 cards.', company: 'Ardent', weight: 41 },
];

export function InsightsView() {
  return (
    <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
      <div className="space-y-2">
        {SIGNALS.map((s) => (
          <div key={s.company} className="rounded-lg border border-border bg-card p-2.5">
            <p className="text-xs leading-snug">“{s.quote}”</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-info-muted px-2 py-0.5 text-[10px] font-semibold text-info">{s.company}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-primary" style={{ width: `${s.weight}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {[
          { n: '142', l: 'Insights this quarter' },
          { n: '27', l: 'Companies represented' },
          { n: '18', l: 'Promoted to features' },
        ].map((s) => (
          <div key={s.l} className="rounded-lg bg-surface p-2.5">
            <p className="text-xl font-semibold tabular-nums">{s.n}</p>
            <p className="text-[11px] text-faint">{s.l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `product-frame.tsx`**

```typescript
import { useState } from 'react';
import { LANDING_COPY } from '@/lib/landing-content';
import { BoardView, RoadmapView, InsightsView } from './product-frame-views';

export function ProductFrame() {
  const [active, setActive] = useState('board');
  const tab = LANDING_COPY.frame.tabs.find((t) => t.key === active)!;

  return (
    <section id="product" className="px-6 pb-16 pt-12">
      <div className="mx-auto max-w-6xl">
        <div role="tablist" aria-label="Product views" className="mb-4 flex justify-center gap-1">
          {LANDING_COPY.frame.tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls="frame-panel"
              onClick={() => setActive(t.key)}
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

          <div id="frame-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="min-h-[26rem] p-4">
            {active === 'board' && <BoardView />}
            {active === 'roadmap' && <RoadmapView />}
            {active === 'insights' && <InsightsView />}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/landing/product-frame.tsx frontend/src/components/landing/product-frame-views.tsx
git commit -m "feat: add the tabbed product frame

Board, roadmap and insights rendered in HTML from the app's own semantic
tokens — sharp at any density, weightless, and unable to go stale the way a
committed screenshot does. Tabs carry proper ARIA wiring."
```

---

### Task 7: Split section, feature rows and their visuals

**Files:**
- Create: `frontend/src/components/landing/split-section.tsx`
- Create: `frontend/src/components/landing/feature-visuals.tsx`
- Create: `frontend/src/components/landing/feature-row.tsx`

**Interfaces:**
- Consumes: `LANDING_COPY.split`, `LANDING_COPY.rows`
- Produces: `<SplitSection />`, `<FeatureRow {...row} flip />`, `<FeatureVisual kind="board" | "insights" | "report" | "queue" | "api" />`

- [ ] **Step 1: Create `split-section.tsx`**

```typescript
import { Check } from 'lucide-react';
import { LANDING_COPY } from '@/lib/landing-content';

function Half({ chip, title, body, points, tone }: {
  chip: string; title: string; body: string; points: string[]; tone: 'accent' | 'success';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-7">
      <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
        tone === 'accent' ? 'bg-accent text-accent-foreground' : 'bg-success-muted text-success'
      }`}>
        {chip}
      </span>
      <h3 className="mt-4 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-muted-foreground">{body}</p>
      <ul className="mt-5 space-y-2.5">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SplitSection() {
  const s = LANDING_COPY.split;
  return (
    <section id="delivery" className="border-y border-border-light bg-surface px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{s.eyebrow}</p>
        <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight md:text-4xl">{s.headline}</h2>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{s.sub}</p>

        <div className="mt-11 grid gap-5 md:grid-cols-2">
          <Half {...s.delivery} points={s.delivery.points} tone="accent" />
          <div id="discovery">
            <Half {...s.discovery} points={s.discovery.points} tone="success" />
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `feature-visuals.tsx`**

```typescript
// One purpose-built visual per feature row. Each is a small, honest sketch of
// the screen the copy is describing — not a placeholder box.

export type VisualKind = 'board' | 'insights' | 'report' | 'queue' | 'api';

function Sprint() {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-semibold">Sprint 14</h4>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">6 days left</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { c: 'To do', items: ['Rate-limit demo route', 'Swimlanes'] },
          { c: 'In progress', items: ['Landing page'] },
          { c: 'Done', items: ['Worklog author', 'Blocked status'] },
        ].map((col) => (
          <div key={col.c} className="rounded-lg bg-background p-2">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">{col.c}</p>
            {col.items.map((t) => (
              <div key={t} className="mb-1 rounded border border-border bg-card p-1.5 text-[11px] leading-tight">{t}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Requests() {
  return (
    <div className="space-y-2">
      {[
        { q: 'We need SSO before rollout.', c: 'Northwind', w: 92 },
        { q: 'CSV export would save us hours.', c: 'Kite & Co', w: 64 },
        { q: 'Swimlanes by assignee.', c: 'Ardent', w: 41 },
      ].map((r) => (
        <div key={r.c} className="rounded-lg border border-border bg-card p-2.5">
          <p className="text-xs">“{r.q}”</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="rounded-full bg-info-muted px-2 py-0.5 text-[10px] font-semibold text-info">{r.c}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-primary" style={{ width: `${r.w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Report() {
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {[
          { n: '38', l: 'Committed' },
          { n: '31', l: 'Completed' },
          { n: '4.2d', l: 'Cycle time' },
          { n: '94%', l: 'SLA met' },
        ].map((s) => (
          <div key={s.l} className="rounded-lg bg-background p-2.5">
            <p className="text-lg font-semibold tabular-nums">{s.n}</p>
            <p className="text-[10px] text-faint">{s.l}</p>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 300 100" className="w-full" role="img" aria-label="Burndown chart falling from 38 points to 7 across the sprint">
        <line x1="0" y1="99" x2="300" y2="99" stroke="currentColor" strokeWidth="1" className="text-border" />
        <path d="M2 14 L298 96" strokeDasharray="4 4" strokeWidth="1.5" fill="none" stroke="currentColor" className="text-faint" />
        <path d="M2 14 L52 20 L102 44 L152 40 L202 62 L252 70 L298 88" strokeWidth="2.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" className="text-primary" />
      </svg>
    </div>
  );
}

function Queue() {
  return (
    <div className="space-y-2">
      {[
        { t: 'Cannot upload attachments over 5 MB', s: '1h 04m left', tone: 'destructive' },
        { t: 'Request access to the Northwind space', s: '6h 20m left', tone: 'warning' },
        { t: 'How do I re-open a closed sprint?', s: 'Deflected', tone: 'success' },
      ].map((r) => (
        <div key={r.t} className="rounded-lg border border-border bg-card p-2.5">
          <p className="text-xs">{r.t}</p>
          <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            r.tone === 'destructive' ? 'bg-destructive-muted text-destructive'
            : r.tone === 'warning' ? 'bg-warning-muted text-warning'
            : 'bg-success-muted text-success'
          }`}>
            {r.s}
          </span>
        </div>
      ))}
    </div>
  );
}

function Api() {
  return (
    <pre className="overflow-x-auto text-xs leading-relaxed text-muted-foreground">
      <code>{`POST /api/webhooks
{
  "event": "issue.transitioned",
  "issue": "ATL-238",
  "from":  "In progress",
  "to":    "Done",
  "actor": "alex@example.com"
}`}</code>
    </pre>
  );
}

export function FeatureVisual({ kind }: { kind: VisualKind }) {
  if (kind === 'board') return <Sprint />;
  if (kind === 'insights') return <Requests />;
  if (kind === 'report') return <Report />;
  if (kind === 'queue') return <Queue />;
  return <Api />;
}
```

- [ ] **Step 3: Create `feature-row.tsx`**

```typescript
import { FeatureVisual, type VisualKind } from './feature-visuals';

export interface FeatureRowProps {
  visual: VisualKind;
  eyebrow: string;
  title: string;
  body: string;
  tags: string[];
  flip?: boolean;
}

export function FeatureRow({ visual, eyebrow, title, body, tags, flip = false }: FeatureRowProps) {
  return (
    <div className="grid items-center gap-12 md:grid-cols-2">
      <div className={flip ? 'md:order-2' : undefined}>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
        <h3 className="mt-3 text-balance text-2xl font-semibold tracking-tight md:text-3xl">{title}</h3>
        <p className="mt-3 text-muted-foreground">{body}</p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t} className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">{t}</li>
          ))}
        </ul>
      </div>
      <div className={`rounded-xl border border-border bg-surface p-4 ${flip ? 'md:order-1' : ''}`}>
        <FeatureVisual kind={visual} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/landing/split-section.tsx frontend/src/components/landing/feature-visuals.tsx frontend/src/components/landing/feature-row.tsx
git commit -m "feat: add split section, feature rows and their visuals

Each row gets a purpose-built sketch of the screen its copy describes —
a sprint board, a request inbox, a burndown, an SLA queue, a webhook
payload — rather than a grey placeholder."
```

---

### Task 8: Capability index and demo button

**Files:**
- Create: `frontend/src/components/landing/capability-index.tsx`
- Create: `frontend/src/components/landing/demo-button.tsx`
- Create: `frontend/src/components/landing/cta-section.tsx`

**Interfaces:**
- Consumes: `CAPABILITY_PILLARS`, `CAPABILITY_TOTAL`, `LANDING_COPY`; `api.auth.demoLogin`, `useAuth().adoptSession`
- Produces: `<CapabilityIndex />`, `<DemoButton variant?="primary"|"inverse" />`, `<CtaSection />`

- [ ] **Step 1: Create `capability-index.tsx`**

```typescript
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CAPABILITY_PILLARS, CAPABILITY_TOTAL, LANDING_COPY } from '@/lib/landing-content';

/** Splits a label around the query so the match can be marked. */
function highlight(label: string, query: string) {
  if (!query) return label;
  const at = label.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="rounded-sm bg-warning-muted text-foreground">{label.slice(at, at + query.length)}</mark>
      {label.slice(at + query.length)}
    </>
  );
}

export function CapabilityIndex() {
  const [query, setQuery] = useState('');
  const c = LANDING_COPY.capabilities;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CAPABILITY_PILLARS;
    return CAPABILITY_PILLARS
      .map((p) => ({ ...p, items: p.items.filter((i) => i.toLowerCase().includes(q)) }))
      .filter((p) => p.items.length > 0);
  }, [query]);

  const matches = shown.reduce((n, p) => n + p.items.length, 0);

  return (
    <section id="capabilities" className="border-y border-border-light bg-surface px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">{c.eyebrow}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              <span className="tabular-nums">{CAPABILITY_TOTAL}</span> {c.headlineSuffix}
            </h2>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">{c.sub}</p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-faint" aria-hidden="true" />
            <label htmlFor="capability-search" className="sr-only">{c.placeholder}</label>
            <input
              id="capability-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c.placeholder}
              className="h-11 w-full rounded-md border border-border bg-background pl-10 pr-3 text-sm"
            />
          </div>
        </div>

        <p aria-live="polite" className="sr-only">
          {matches} of {CAPABILITY_TOTAL} capabilities shown
        </p>

        {shown.length === 0 ? (
          <p className="py-8 text-muted-foreground">{c.empty}</p>
        ) : (
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((p) => (
              <section key={p.name}>
                <h3 className="mb-2 flex justify-between border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
                  {p.name}
                  <span className="tabular-nums text-faint">{p.items.length}</span>
                </h3>
                <ul>
                  {p.items.map((i) => (
                    <li key={i} className="py-0.5 text-sm text-muted-foreground">{highlight(i, query.trim())}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `demo-button.tsx`**

```typescript
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { LANDING_COPY } from '@/lib/landing-content';

export function DemoButton({ variant = 'primary' }: { variant?: 'primary' | 'inverse' }) {
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const authed = await api.auth.demoLogin();
      adoptSession(authed);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // 404 means this deployment has no demo configured. Sending the visitor
      // to the sign-in page is more useful than an error they cannot act on.
      if (err instanceof ApiError && err.status === 404) {
        navigate('/login');
        return;
      }
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many demo sessions right now. Try again in a minute.'
          : 'The demo is unavailable right now.',
      );
      setBusy(false);
    }
  }

  const base = 'inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 font-semibold disabled:opacity-60';
  const tone = variant === 'inverse'
    ? 'bg-primary-foreground text-primary hover:opacity-90'
    : 'bg-primary text-primary-foreground hover:bg-primary-hover';

  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={start} disabled={busy} className={`${base} ${tone}`}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {busy ? 'Starting demo…' : LANDING_COPY.nav.demo}
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} <a href="/login" className="underline">Sign in instead</a>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `cta-section.tsx`**

```typescript
import { LANDING_COPY } from '@/lib/landing-content';
import { DemoButton } from './demo-button';

export function CtaSection() {
  return (
    <section className="bg-primary px-6 py-20 text-center text-primary-foreground">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">{LANDING_COPY.cta.headline}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg opacity-90">{LANDING_COPY.cta.body}</p>
        <div className="mt-7 flex justify-center">
          <DemoButton variant="inverse" />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npm run lint
```

Expected: no errors. If `ApiError` is not exported from `@/lib/api`, export it — it is declared there as `export class ApiError`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/landing/capability-index.tsx frontend/src/components/landing/demo-button.tsx frontend/src/components/landing/cta-section.tsx
git commit -m "feat: add capability index, demo button and closing CTA

The index filters all 165 capabilities live with match highlighting and an
aria-live count. The demo button adopts the session the server issues, and
treats a 404 as 'this deployment has no demo' by falling back to /login
rather than showing an error the visitor cannot act on."
```

---

### Task 9: Compose the page and claim the `/` route

**Files:**
- Create: `frontend/src/screens/landing.tsx`
- Create: `frontend/src/components/app/landing-gate.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: every component from Tasks 5–8
- Produces: `default export Landing`, `<LandingGate />`, a `/` route

- [ ] **Step 1: Create `frontend/src/screens/landing.tsx`**

```typescript
import { SiteNav } from '@/components/landing/site-nav';
import { Hero } from '@/components/landing/hero';
import { ProductFrame } from '@/components/landing/product-frame';
import { SplitSection } from '@/components/landing/split-section';
import { FeatureRow } from '@/components/landing/feature-row';
import { CapabilityIndex } from '@/components/landing/capability-index';
import { CtaSection } from '@/components/landing/cta-section';
import { SiteFooter } from '@/components/landing/site-footer';
import { DemoButton } from '@/components/landing/demo-button';
import { LANDING_COPY } from '@/lib/landing-content';

export default function Landing() {
  return (
    <div id="top" className="min-h-screen bg-background text-foreground">
      <SiteNav demoSlot={<DemoButton />} />
      <main>
        <Hero demoSlot={<DemoButton />} />
        <ProductFrame />
        <SplitSection />

        <section className="mx-auto max-w-6xl space-y-24 px-6 py-24">
          {LANDING_COPY.rows.map((row, i) => (
            <FeatureRow key={row.title} {...row} flip={i % 2 === 1} />
          ))}
        </section>

        <CapabilityIndex />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/app/landing-gate.tsx`**

```typescript
import { Suspense, lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/auth-provider';

const Landing = lazy(() => import('@/screens/landing'));

function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * `/` serves marketing to strangers and nothing to members.
 * A signed-in user is sent straight to their dashboard, so the landing page
 * never flashes behind them.
 */
export function LandingGate() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <Suspense fallback={<Spinner />}>
      <Landing />
    </Suspense>
  );
}
```

- [ ] **Step 3: Wire the route in `frontend/src/App.tsx`**

Add the import beside the other non-lazy imports (near `import LoginScreen from '@/screens/login';`):

```typescript
import { LandingGate } from '@/components/app/landing-gate';
```

Then add the route inside the top-level `<Routes>`, immediately after the `/login` route:

```typescript
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/" element={<LandingGate />} />
```

Leave every other route untouched. React Router ranks the static `/` above the `*` catch-all, so `ProtectedLayout` keeps serving everything else exactly as before.

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Check it by eye**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173/` in a private window (so no token is stored) and confirm: the hero renders, the three frame tabs switch, typing in the capability search narrows the columns, and the page has no horizontal scrollbar at 375px width.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/landing.tsx frontend/src/components/app/landing-gate.tsx frontend/src/App.tsx
git commit -m "feat: serve the landing page at /

LandingGate branches on auth state: spinner while resolving, landing for
strangers, redirect to /dashboard for members — so the marketing page never
flashes behind a signed-in user. /login is unchanged; it simply stops being
the front door."
```

---

### Task 10: Metadata and social preview image

**Files:**
- Modify: `frontend/index.html`
- Create: `frontend/public/og-image.png`
- Create then delete: `frontend/scripts/make-og.mjs`

**Interfaces:**
- Consumes: Playwright, already a dev dependency
- Produces: meta tags and a 1200×630 PNG at `/og-image.png`

- [ ] **Step 1: Add the meta tags**

Replace the `<head>` of `frontend/index.html` with:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Atlas — your backlog and your roadmap in one tool</title>
    <meta name="description" content="Atlas runs sprint delivery and product discovery on one system of record: boards, sprints, roadmaps, customer insights, a wiki and a service desk in a single self-hosted workspace." />
    <link rel="canonical" href="https://www.open-atlas.xyz/" />
    <meta name="theme-color" content="#0c66e4" />

    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.open-atlas.xyz/" />
    <meta property="og:title" content="Atlas — your backlog and your roadmap in one tool" />
    <meta property="og:description" content="Sprint delivery and product discovery on one system of record." />
    <meta property="og:image" content="https://www.open-atlas.xyz/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Atlas — your backlog and your roadmap in one tool" />
    <meta name="twitter:description" content="Sprint delivery and product discovery on one system of record." />
    <meta name="twitter:image" content="https://www.open-atlas.xyz/og-image.png" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
```

- [ ] **Step 2: Generate the OG image with Playwright**

Playwright is already installed, so no new dependency is needed. Create `frontend/scripts/make-og.mjs`:

```javascript
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const HTML = `<body style="margin:0;width:1200px;height:630px;background:#0c66e4;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box">
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:40px">
    <div style="width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,.18);
      display:grid;place-items:center;color:#fff;font-size:30px;font-weight:700">A</div>
    <span style="color:#fff;font-size:34px;font-weight:600;letter-spacing:-.02em">Atlas</span>
  </div>
  <h1 style="margin:0;color:#fff;font-size:66px;line-height:1.1;font-weight:600;letter-spacing:-.03em;max-width:900px">
    Your backlog and your roadmap, finally in one tool</h1>
  <p style="margin:28px 0 0;color:#c7dcff;font-size:27px">Sprint delivery and product discovery on one system of record.</p>
</body>`;

mkdirSync('public', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(HTML);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
console.log('wrote public/og-image.png');
```

Run it:

```bash
cd frontend && node scripts/make-og.mjs
```

Expected: `wrote public/og-image.png`

- [ ] **Step 3: Confirm the image is the right size**

```bash
cd frontend && node -e "
const b = require('fs').readFileSync('public/og-image.png');
console.log('width', b.readUInt32BE(16), 'height', b.readUInt32BE(20));
"
```

Expected: `width 1200 height 630`

- [ ] **Step 4: Remove the generator**

The image is committed; the script was a one-off and would otherwise rot.

```bash
rm frontend/scripts/make-og.mjs && rmdir frontend/scripts 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/public/og-image.png
git commit -m "feat: add page metadata and social preview image

index.html carried a bare <title>Atlas</title>, so every link to
open-atlas.xyz previewed as a blank card. Adds description, canonical,
Open Graph, Twitter card and theme-color, plus a 1200x630 preview image."
```

---

### Task 11: End-to-end tests

**Files:**
- Create: `frontend/e2e/landing.spec.ts`

**Interfaces:**
- Consumes: `login`, `assertNoCrash` from `./helpers`
- Produces: five Playwright specs

- [ ] **Step 1: Write the specs**

Create `frontend/e2e/landing.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

test.describe('landing page', () => {
  test('an anonymous visitor gets marketing, not a login form', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 }))
      .toContainText('Your backlog and your roadmap');
    await expect(page.getByRole('button', { name: /try the live demo/i }).first()).toBeVisible();
    await assertNoCrash(page);
  });

  test('exactly one h1 on the page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('the product frame tabs switch panels', async ({ page }) => {
    await page.goto('/');

    const board = page.getByRole('tab', { name: 'Board' });
    const roadmap = page.getByRole('tab', { name: 'Roadmap' });

    await expect(board).toHaveAttribute('aria-selected', 'true');

    await roadmap.click();
    await expect(roadmap).toHaveAttribute('aria-selected', 'true');
    await expect(board).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByText('Enterprise readiness')).toBeVisible();
  });

  test('the capability filter narrows the list and recovers', async ({ page }) => {
    await page.goto('/');

    const search = page.getByLabel(/search capabilities/i);
    const items = page.locator('#capabilities li');

    const total = await items.count();
    expect(total).toBe(165);

    await search.fill('sprint');
    const filtered = await items.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);

    await search.fill('zzzznotathing');
    await expect(page.getByText('No capability matches that.')).toBeVisible();

    await search.fill('');
    await expect(items).toHaveCount(total);
  });

  test('a signed-in user is sent to the dashboard instead', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1, name: /your backlog/i })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run against the seeded instance**

```bash
cd frontend && npm run test:e2e -- landing.spec.ts
```

Expected: 5 passed.

- [ ] **Step 3: Run against a fresh install**

The landing page must work with zero projects in the database.

```bash
cd frontend && npm run test:e2e:empty -- landing.spec.ts
```

Expected: the four anonymous specs pass. If the signed-in spec fails because the empty fixture has no seeded `kunal@example.com`, scope it out for that config by adding at the top of that test:

```typescript
    test.skip(!!process.env.ATLAS_EMPTY, 'no seeded user in the empty fixture');
```

and set `ATLAS_EMPTY=1` in `playwright.empty.config.ts` under `use.env` or the webServer env block.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/landing.spec.ts
git commit -m "test: cover the landing page end to end

Anonymous visitors see marketing, the page has exactly one h1, frame tabs
switch panels, the capability filter narrows 165 items and recovers, and a
signed-in user is redirected to the dashboard instead."
```

---

### Task 12: Configuration, documentation and full verification

**Files:**
- Modify: `.env.example`
- Modify: `render.yaml`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: a documented, verified feature

- [ ] **Step 1: Document the variables in `.env.example`**

Append:

```bash
# ---- Public demo (optional) ----
# Setting DEMO_EMAIL enables POST /api/auth/demo, which hands anonymous
# visitors a session on a throwaway account so the landing page's
# "Try the live demo" button works. Leave it unset to disable the route
# entirely — it responds 404 when this is empty.
#
# Independent of SEED_DEMO_DATA: the demo workspace is seeded separately, so
# enabling a public demo never re-introduces the password123 accounts.
DEMO_EMAIL=
DEMO_NAME=Demo user
# Hours before a visit re-seeds the demo workspace. Default 6.
DEMO_RESET_HOURS=6
```

- [ ] **Step 2: Add the variable to `render.yaml`**

In the `envVars` list, after the `SEED_DEMO_DATA` entry:

```yaml
      # Set to enable the public one-click demo. Unset -> /api/auth/demo 404s.
      - key: DEMO_EMAIL
        sync: false
      - key: DEMO_NAME
        value: Demo user
```

`SEED_DEMO_DATA` stays `"false"`.

- [ ] **Step 3: Document the landing page in `README.md`**

Under "Quick Start", after the Option B block, add:

```markdown
### The public landing page

`/` serves a public marketing page to signed-out visitors and redirects
signed-in users to `/dashboard`. `/login` is still the sign-in form; it is
just no longer the front door.

To enable the one-click demo button, set `DEMO_EMAIL` (see `.env.example`).
The demo account is created with role `user`, and its workspace re-seeds on
the first visit after `DEMO_RESET_HOURS`. Leaving `DEMO_EMAIL` unset disables
`POST /api/auth/demo` entirely, and the button falls back to `/login`.
```

- [ ] **Step 4: Run every check**

```bash
cd frontend && npm run lint
```

Expected: clean.

```bash
cd backend && npm test
```

Expected: all suites pass, including `auth-demo.test.js`.

```bash
cd frontend && npm run test:e2e
```

Expected: all suites pass, including `landing.spec.ts`.

```bash
cd frontend && npm run test:e2e:empty
```

Expected: pass.

```bash
cd frontend && npm run build
```

Expected: build succeeds, assets in `frontend/build/`.

- [ ] **Step 5: Confirm no new colour tokens were introduced**

```bash
git diff main --stat -- frontend/src/index.css
```

Expected: **no output.** `index.css` must be untouched. If it changed, revert it and replace the new colour with an existing semantic token.

- [ ] **Step 6: Verify the demo path end to end by hand**

```bash
cd backend && DEMO_EMAIL=demo@example.com node server.js
```

Open `http://localhost:3001/`, click **Try the live demo**, and confirm you land on `/dashboard` with a populated board. Then check the guard holds:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/auth/demo
```

Restart the server without `DEMO_EMAIL` and run the same curl — expect `404`.

- [ ] **Step 7: Commit**

```bash
git add .env.example render.yaml README.md
git commit -m "docs: document the landing page and demo configuration

DEMO_EMAIL enables the public demo route and is unset by default, so
existing deployments keep behaving exactly as they do today."
```

---

## Self-Review Record

This plan was checked against `docs/superpowers/specs/2026-08-08-landing-page-design.md`.

**Spec coverage.** Routing → Task 9. Demo endpoint and its four guards → Task 2. Seeding and lazy reset → Tasks 1–2. Env vars → Task 12. All twelve page blocks → Tasks 5–9. Capability index → Task 8. Component/file split → matches the spec table, with `feature-visuals.tsx` added because the spec's "purpose-built CSS visual" per row needed somewhere to live. Data flow → Tasks 3, 8. Error handling → Task 8 (404 falls back to `/login`, 429 gets its own message, other failures get a generic message; every inline error carries a sign-in escape link). SEO → Task 10. Accessibility → single `h1` (asserted in Task 11), ARIA tabs (Task 6), labelled search with `aria-live` count (Task 8). Testing → spec tests 1–6 in Task 11, 7–12 in Task 2.

**Corrections made during review.** The first draft guessed at the database schema and was wrong on five tables (`issues.issue_key` not `key`, `issues.reporter_id` not `created_by`, `sprints.status` not `state`, `project_members.role_in_project` not `role`, and non-existent `updated_at` columns on `users` and `projects`), used a `db.get()`/`db.run()` API that does not exist, called `login(email, '')` after the demo endpoint — which would have fired a second request with an empty password and 401'd — never implemented the lazy reset the spec is built around, and left three literal placeholders in rendered output. All are fixed above.

**The spec was also corrected.** `theme-provider.tsx` declares Atlas light-theme only and strips `.dark` on mount, so the spec's dark-theme claims and the nav theme toggle were removed.
