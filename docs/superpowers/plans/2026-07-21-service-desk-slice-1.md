# Service Desk Slice 1 Implementation Plan (epics 39–41)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working service desk foundation — request types, requests as
issues, public/internal comments — and a customer-facing help center reachable
only by `role='client'` users.

**Architecture:** A request is an ordinary row in `issues` with `type='request'`
and a `request_type_id`, so it inherits comments, attachments, watchers,
activity, and automation unchanged. Everything a customer can reach passes
through one allow-list projection (`toPublicRequest`) and one access middleware
(`requireClientSafe`), so no route builds a customer payload by hand.

**Tech Stack:** Express 5, sql.js (SQLite) / mysql2, Jest + supertest,
React 18.3.1 + TypeScript + Vite, Tailwind, shadcn/ui, React Router.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-service-desk-design.md`. Read it first.
- **React 18.3.1** — any UI primitive used as an `asChild` trigger MUST be
  wrapped in `React.forwardRef`. See `KNOWN-ISSUES.md`; this exact omission
  broke every popper menu in the app once already.
- Every migration step must tolerate being re-run. The runner records a
  migration only after all its steps succeed (`migrations.js:325`).
- Every new route file must be registered in **both** `backend/server.js` and
  `backend/tests/backend/setup.js` — the test harness mounts routes explicitly
  and a route missing there 404s only in tests.
- Never trust client-supplied identity. Role comes from `req.userRole`, set by
  `authMiddleware` from the session token alone.
- SQL must run on both drivers. Use `datetime('now')` for SQLite and the MySQL
  equivalent via the `{sqlite, mysql}` step form in migrations; in route code
  use the existing helpers in `backend/utils/sql.js`.
- Run backend tests with `npm test --prefix backend -- --testPathPatterns=<file>`.
- Commit after every task. Branch is `service-desk-wave`; do not push.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `backend/utils/servicedesk.js` | `toPublicRequest()` projection + `validateFields()`; pure functions, no HTTP |
| `backend/middleware/servicedesk.js` | `requireClientSafe` — may this caller see this request? |
| `backend/routes/request-types.js` | Agent-side request type CRUD |
| `backend/routes/help.js` | The customer surface: `/api/help/*` |
| `backend/tests/backend/servicedesk-core.test.js` | Migration rebuild, request types, comment visibility |
| `backend/tests/backend/help-center.test.js` | Help center lifecycle + all five security rules |
| `frontend/src/screens/help-center.tsx` | Browse request types, raise a request |
| `frontend/src/screens/help-requests.tsx` | My requests (list + detail) |

**Modified:** `backend/migrations.js` (migration 011), `backend/database.js`
(schema + seed), `backend/routes/comments.js` (visibility), `backend/server.js`
and `backend/tests/backend/setup.js` (route registration), `frontend/src/App.tsx`
(routes), `frontend/src/components/app/app-shell.tsx` (client redirect),
`frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`,
`backend/tests/backend/epics.test.js` (epic count).

---

## Task 1: Epic 39 — seed wiki focus mode

Bookkeeping only, no production code. Does the roadmap tell the truth?

**Files:**
- Modify: `backend/database.js:1679` (after the `taskEpics` block)
- Test: `backend/tests/backend/epics.test.js:211`

**Interfaces:**
- Consumes: nothing.
- Produces: the ATLAS project seeds **39** epics. Later tasks raise this count.

- [ ] **Step 1: Update the failing test**

In `backend/tests/backend/epics.test.js`, change the count assertion:

```js
  test('seeds the ATLAS project with 39 roadmap epics, Epic support done', async () => {
    const projects = await request(app).get('/api/projects').set(headers);
    const atlas = projects.body.find((p) => p.key === 'ATLAS');
    const epics = await request(app).get(`/api/projects/${atlas.id}/epics`).set(headers);
    expect(epics.body.length).toBe(39);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=epics.test.js -t "roadmap epics"`
Expected: FAIL — `Expected: 39, Received: 38`.

- [ ] **Step 3: Seed the epic**

In `backend/database.js`, immediately after the `taskEpics.forEach(...)` block
that closes the wiki task lists wave, add:

```js
  // ===== Wiki focus mode (epic 39) — shipped =====
  // Shipped in commit 8000025 but never seeded; the roadmap under-reported by one.
  {
    const eid = uuid();
    const num = atlasIssueNumber;
    atlasIssueNumber += 1;
    const [startDate, dueDate] = epicWindow(38);
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, epic_color, start_date, due_date, board_order)
      VALUES (?, ?, ?, ?, ?, ?, 'epic', 'done', 'high', ?, ?, ?, ?, 38)`,
      [eid, projId3, `ATLAS-${num}`, num, 'Wiki focus mode',
       'Full-width distraction-free reading and editing: the page fills the window, both sidebars collapse, and the choice persists per user.',
       userIds[0], 'blue', startDate, dueDate]);
    [
      { title: 'Focus mode toggle with full-width page layout', type: 'story' },
      { title: 'Collapse both sidebars and restore on exit', type: 'task' },
      { title: 'Persist the focus preference per user', type: 'task' },
    ].forEach((c, ci) => {
      const cnum = atlasIssueNumber;
      atlasIssueNumber += 1;
      db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, assignee_id, reporter_id, parent_id, board_order)
        VALUES (?, ?, ?, ?, ?, ?, 'done', 'high', ?, ?, ?, ?)`,
        [uuid(), projId3, `ATLAS-${cnum}`, cnum, c.title, c.type, userIds[0], userIds[0], eid, ci]);
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix backend -- --testPathPatterns=epics.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add backend/database.js backend/tests/backend/epics.test.js
git commit -m "chore(roadmap): seed the wiki focus mode epic (ATLAS-39)"
```

---

## Task 2: Migration 011 — service desk schema

The riskiest task in the wave. Read spec §40.2 before starting.

**Files:**
- Modify: `backend/migrations.js` (append to `MIGRATIONS`)
- Modify: `backend/database.js:12` and `:478` (both `issues` type CHECKs),
  plus the `comments` and `project_statuses` schemas
- Test: `backend/tests/backend/servicedesk-core.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `projects.is_service_desk`, `sd_request_types`,
  `issues.request_type_id`, `issues.sd_fields`, `comments.visibility`,
  `project_statuses.waiting_for_customer`, and `'request'` accepted by
  `issues.type`.

- [ ] **Step 1: Write the failing migration test**

Create `backend/tests/backend/servicedesk-core.test.js`. This test drives the
runner directly rather than through HTTP, because it must prove the migration
works on a database that predates it — which the normal test harness never
produces (spec §40.2, "Trap this creates for testing").

```js
/**
 * SERVICE DESK CORE — migration 011, request types, comment visibility.
 */
const initSqlJs = require('sql.js');
const { MIGRATIONS, runMigrations, sqliteAdapter } = require('../../migrations');

// The pre-011 shape of the tables the migration rewrites, verbatim from the
// schema as it stood before this wave. Building the old shape by hand is the
// only way to exercise the upgrade path.
const LEGACY_SCHEMA = [
  `CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL)`,
  `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)`,
  `CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    issue_key TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'task' CHECK(type IN ('story','task','bug','epic','subtask')),
    status TEXT DEFAULT 'todo',
    parent_id TEXT REFERENCES issues(id),
    board_order INTEGER DEFAULT 0
  )`,
  `CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL
  )`,
  `CREATE TABLE project_statuses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT DEFAULT 'in_progress',
    position INTEGER DEFAULT 0
  )`,
];

async function legacyDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  LEGACY_SCHEMA.forEach((sql) => db.run(sql));
  db.run("INSERT INTO projects (id, name, key) VALUES ('p1', 'Legacy', 'LEG')");
  db.run("INSERT INTO users (id, name) VALUES ('u1', 'Agent')");
  ['story', 'task', 'bug', 'epic', 'subtask'].forEach((t, i) => {
    db.run("INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, board_order) VALUES (?, 'p1', ?, ?, ?, ?, ?)",
      [`i${i}`, `LEG-${i + 1}`, i + 1, `Legacy ${t}`, t, i]);
  });
  db.run("INSERT INTO comments (id, issue_id, author_id, body) VALUES ('c1', 'i0', 'u1', 'legacy comment')");
  return db;
}

function all(db, sql) {
  const stmt = db.prepare(sql);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

describe('migration 011_service_desk_core', () => {
  test('is registered', () => {
    expect(MIGRATIONS.some((m) => m.id === '011_service_desk_core')).toBe(true);
  });

  test('preserves every issue row and its comments through the rebuild', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));

    const issues = all(db, 'SELECT * FROM issues ORDER BY issue_number');
    expect(issues.length).toBe(5);
    expect(issues.map((i) => i.type)).toEqual(['story', 'task', 'bug', 'epic', 'subtask']);
    expect(issues[0].issue_key).toBe('LEG-1');

    // The child table still resolves to the rebuilt issues table.
    const joined = all(db, 'SELECT c.body FROM comments c JOIN issues i ON i.id = c.issue_id');
    expect(joined.length).toBe(1);
    expect(joined[0].body).toBe('legacy comment');
  });

  test("accepts type='request' after the rebuild", async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    expect(() => db.run(
      "INSERT INTO issues (id, project_id, issue_key, issue_number, title, type) VALUES ('r1', 'p1', 'LEG-99', 99, 'A request', 'request')",
    )).not.toThrow();
  });

  test('still rejects a bogus type after the rebuild', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    expect(() => db.run(
      "INSERT INTO issues (id, project_id, issue_key, issue_number, title, type) VALUES ('r2', 'p1', 'LEG-98', 98, 'Nope', 'banana')",
    )).toThrow();
  });

  test('adds the new columns and tables', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    const issueCols = all(db, 'PRAGMA table_info(issues)').map((c) => c.name);
    expect(issueCols).toContain('request_type_id');
    expect(issueCols).toContain('sd_fields');
    expect(all(db, 'PRAGMA table_info(projects)').map((c) => c.name)).toContain('is_service_desk');
    expect(all(db, 'PRAGMA table_info(comments)').map((c) => c.name)).toContain('visibility');
    expect(all(db, 'PRAGMA table_info(project_statuses)').map((c) => c.name)).toContain('waiting_for_customer');
    expect(all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='sd_request_types'").length).toBe(1);
  });

  test('existing comments default to public', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    expect(all(db, "SELECT visibility FROM comments WHERE id='c1'")[0].visibility).toBe('public');
  });

  test('is idempotent — running twice changes nothing', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    const applied = await runMigrations(sqliteAdapter(db));
    expect(applied).not.toContain('011_service_desk_core');
    expect(all(db, 'SELECT * FROM issues').length).toBe(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=servicedesk-core`
Expected: FAIL on the first test — `011_service_desk_core` is not registered.

- [ ] **Step 3: Add migration 011**

In `backend/migrations.js`, append to the `MIGRATIONS` array (before the closing
`];` at line 250):

```js
  {
    id: '011_service_desk_core',
    description: "Service desk foundation: request types, request issue type, comment visibility",
    steps: [
      {
        addColumn: {
          table: 'projects', column: 'is_service_desk',
          sqlite: 'ALTER TABLE projects ADD COLUMN is_service_desk INTEGER DEFAULT 0',
          mysql: 'ALTER TABLE projects ADD COLUMN is_service_desk TINYINT DEFAULT 0',
        },
      },
      {
        addColumn: {
          table: 'comments', column: 'visibility',
          sqlite: "ALTER TABLE comments ADD COLUMN visibility TEXT DEFAULT 'public'",
          mysql: "ALTER TABLE comments ADD COLUMN visibility VARCHAR(10) DEFAULT 'public'",
        },
      },
      {
        addColumn: {
          table: 'project_statuses', column: 'waiting_for_customer',
          sqlite: 'ALTER TABLE project_statuses ADD COLUMN waiting_for_customer INTEGER DEFAULT 0',
          mysql: 'ALTER TABLE project_statuses ADD COLUMN waiting_for_customer TINYINT DEFAULT 0',
        },
      },
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_request_types (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            icon TEXT DEFAULT 'help-circle',
            fields TEXT NOT NULL DEFAULT '[]',
            position INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_request_types (
            id VARCHAR(36) PRIMARY KEY,
            project_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            icon VARCHAR(50) DEFAULT 'help-circle',
            fields TEXT NOT NULL,
            position INT DEFAULT 0,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        addColumn: {
          table: 'issues', column: 'request_type_id',
          sqlite: 'ALTER TABLE issues ADD COLUMN request_type_id TEXT REFERENCES sd_request_types(id)',
          mysql: 'ALTER TABLE issues ADD COLUMN request_type_id VARCHAR(36) NULL',
        },
      },
      {
        addColumn: {
          table: 'issues', column: 'sd_fields',
          sqlite: "ALTER TABLE issues ADD COLUMN sd_fields TEXT DEFAULT '{}'",
          mysql: "ALTER TABLE issues ADD COLUMN sd_fields TEXT",
        },
      },
      // ---- The type CHECK rebuild. SQLite cannot alter a CHECK in place, so the
      // table is rebuilt. Foreign keys are not enforced here (database.js issues
      // no PRAGMA foreign_keys=ON and sql.js defaults it off), and child tables
      // reference `issues` by name, so the rename leaves them resolving to the
      // new table. Each step tolerates a re-run because the runner records the
      // migration only after all steps succeed.
      { sql: { sqlite: 'DROP TABLE IF EXISTS issues_rebuild_011', mysql: 'SELECT 1' } },
      {
        sql: {
          sqlite: `CREATE TABLE issues_rebuild_011 (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            sprint_id TEXT REFERENCES sprints(id),
            issue_key TEXT NOT NULL,
            issue_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            type TEXT DEFAULT 'task' CHECK(type IN ('story','task','bug','epic','subtask','request')),
            status TEXT DEFAULT 'todo',
            priority TEXT DEFAULT 'medium' CHECK(priority IN ('highest','high','medium','low','lowest')),
            assignee_id TEXT REFERENCES users(id),
            reporter_id TEXT REFERENCES users(id),
            parent_id TEXT REFERENCES issues(id),
            story_points INTEGER,
            labels TEXT DEFAULT '[]',
            due_date TEXT,
            start_date TEXT,
            original_estimate TEXT,
            time_spent TEXT,
            epic_color TEXT DEFAULT 'purple',
            request_type_id TEXT REFERENCES sd_request_types(id),
            sd_fields TEXT DEFAULT '{}',
            board_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: 'SELECT 1',
        },
      },
      // Column-list INSERT by name: the legacy table may lack columns added by
      // migrations 003/004, so `SELECT *` would misalign.
      {
        sql: {
          sqlite: `INSERT INTO issues_rebuild_011 (id, project_id, issue_key, issue_number, title, type, status, parent_id, board_order)
            SELECT id, project_id, issue_key, issue_number, title, type, status, parent_id, board_order FROM issues`,
          mysql: 'SELECT 1',
        },
      },
      { sql: { sqlite: 'DROP TABLE issues', mysql: 'SELECT 1' } },
      { sql: { sqlite: 'ALTER TABLE issues_rebuild_011 RENAME TO issues', mysql: 'SELECT 1' } },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)',
          mysql: 'SELECT 1',
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id)',
          mysql: 'SELECT 1',
        },
      },
      {
        sql: {
          sqlite: 'SELECT 1',
          mysql: "ALTER TABLE issues MODIFY COLUMN type VARCHAR(20) DEFAULT 'task'",
        },
      },
    ],
  },
```

> **Note on the SQLite copy step:** it carries only the columns guaranteed to
> exist in every historical shape. Columns added by earlier migrations
> (`start_date`, WIP limits and so on) are re-declared on the rebuilt table and
> land at their defaults for pre-existing rows. If you need those values
> preserved, extend the column list *and* guard each with `adapter.hasColumn`
> before referencing it — but do not use `SELECT *`.

> **Note on MySQL:** MySQL alters a CHECK by name and tolerates
> `ALTER TABLE ... MODIFY`, so no rebuild is needed. The `SELECT 1` steps are
> deliberate no-ops that keep one step list driving both drivers. The MySQL
> `MODIFY` drops the inline CHECK, matching how the MySQL schema declares type.

- [ ] **Step 4: Run the migration test to verify it passes**

Run: `npm test --prefix backend -- --testPathPatterns=servicedesk-core`
Expected: PASS — all 7 tests in the `migration 011` describe block.

- [ ] **Step 5: Update the base schema for fresh databases**

In `backend/database.js`, make the fresh-install schema match what the migration
produces. Four edits:

1. Line ~12, SQLite `issues`: `CHECK(type IN ('story','task','bug','epic','subtask','request'))`
2. Line ~478, MySQL `issues`: the same list.
3. `issues` (both drivers): add `request_type_id` and `sd_fields TEXT DEFAULT '{}'`.
4. `comments` (both): add `visibility TEXT DEFAULT 'public'`;
   `project_statuses` (both): add `waiting_for_customer INTEGER DEFAULT 0`;
   `projects` (both): add `is_service_desk INTEGER DEFAULT 0`.
   Add the `sd_request_types` CREATE TABLE to the schema list for both drivers,
   matching the migration's shape exactly.

- [ ] **Step 6: Run the full backend suite — nothing may regress**

Run: `npm test --prefix backend -- --testPathPatterns=tests/backend`
Expected: PASS. The migration and MySQL parity suites are the ones that matter
here; if `mysql-migrations.test.js` skips for lack of a MySQL service, note that
in the commit body rather than assuming it passed.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations.js backend/database.js backend/tests/backend/servicedesk-core.test.js
git commit -m "feat(servicedesk): migration 011 — request types, request issue type, comment visibility"
```

---

## Task 3: Request types API

**Files:**
- Create: `backend/routes/request-types.js`
- Modify: `backend/server.js`, `backend/tests/backend/setup.js`
- Test: `backend/tests/backend/servicedesk-core.test.js` (append)

**Interfaces:**
- Consumes: migration 011 from Task 2.
- Produces: `GET/POST /api/projects/:projectId/request-types`,
  `PUT/DELETE /api/request-types/:id`. A request type serialises as
  `{id, project_id, name, description, icon, fields, position, created_at}`
  where `fields` is a **parsed array**, not a JSON string.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/servicedesk-core.test.js`:

```js
const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');

describe('request types', () => {
  let app, headers, memberHeaders, projectId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    memberHeaders = await userHeaders();
    const projects = await request(app).get('/api/projects').set(headers);
    projectId = projects.body.find((p) => p.key === 'ATL').id;
  });

  test('creates a request type with a parsed fields array', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({
      name: 'Report a bug',
      description: 'Something is broken',
      icon: 'bug',
      fields: [{ key: 'steps', label: 'Steps to reproduce', type: 'textarea', required: true }],
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Report a bug');
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.fields[0].key).toBe('steps');
  });

  test('rejects a request type with no name', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({ name: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  test('rejects a field of an unknown type', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({
      name: 'Bad form',
      fields: [{ key: 'x', label: 'X', type: 'hologram' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  test('rejects a field with no key', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({
      name: 'Bad form 2',
      fields: [{ label: 'No key', type: 'text' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
  });

  test('a non-admin member cannot create a request type', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(memberHeaders).send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  test('lists request types in position order', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/request-types`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body[0].fields)).toBe(true);
  });

  test('updates a request type', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({ name: 'Rename me' });
    const res = await request(app).put(`/api/request-types/${created.body.id}`).set(headers).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
  });

  test('deletes a request type that has no requests', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({ name: 'Delete me' });
    const res = await request(app).delete(`/api/request-types/${created.body.id}`).set(headers);
    expect(res.status).toBe(200);
    const after = await request(app).get(`/api/request-types/${created.body.id}`).set(headers);
    expect(after.status).toBe(404);
  });

  test('404s on an unknown request type', async () => {
    const res = await request(app).put('/api/request-types/does-not-exist').set(headers).send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=servicedesk-core -t "request types"`
Expected: FAIL — 404s, because the routes do not exist.

- [ ] **Step 3: Write the field validator**

Create `backend/utils/servicedesk.js`:

```js
// ===== SERVICE DESK — pure helpers =====
// No HTTP, no database. Field-schema validation and the customer projection
// live here so they can be tested directly and reused by every route.

const FIELD_TYPES = ['text', 'textarea', 'select', 'date'];

/**
 * Validates a request type's `fields` schema.
 * Returns { ok: true, fields } or { ok: false, error }.
 */
function validateFieldSchema(raw) {
  if (raw === undefined || raw === null) return { ok: true, fields: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'fields must be an array' };
  const seen = new Set();
  for (const f of raw) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'each field must be an object' };
    if (!f.key || !String(f.key).trim()) return { ok: false, error: 'each field needs a key' };
    if (seen.has(f.key)) return { ok: false, error: `duplicate field key "${f.key}"` };
    seen.add(f.key);
    if (!FIELD_TYPES.includes(f.type)) {
      return { ok: false, error: `field "${f.key}" has an unknown type. Try: ${FIELD_TYPES.join(', ')}` };
    }
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) {
      return { ok: false, error: `field "${f.key}" is a select and needs options` };
    }
  }
  return {
    ok: true,
    fields: raw.map((f) => ({
      key: String(f.key).trim(),
      label: String(f.label || f.key).trim(),
      type: f.type,
      required: !!f.required,
      ...(f.type === 'select' ? { options: f.options.map(String) } : {}),
    })),
  };
}

/**
 * Validates submitted values against a field schema.
 * Unknown keys are dropped rather than stored (spec §Security rule 5).
 * Returns { ok: true, values } or { ok: false, error }.
 */
function validateSubmission(schema, submitted) {
  const input = submitted && typeof submitted === 'object' ? submitted : {};
  const values = {};
  for (const f of schema) {
    const raw = input[f.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) {
      if (f.required) return { ok: false, error: `"${f.label}" is required` };
      continue;
    }
    const s = String(raw).trim();
    if (f.type === 'select' && !f.options.includes(s)) {
      return { ok: false, error: `"${f.label}" is not a valid option` };
    }
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { ok: false, error: `"${f.label}" must be YYYY-MM-DD` };
    }
    values[f.key] = s.slice(0, 2000);
  }
  return { ok: true, values };
}

/** Renders submitted values into the issue description an agent reads. */
function renderSubmission(schema, values) {
  return schema
    .filter((f) => values[f.key] !== undefined)
    .map((f) => `**${f.label}**\n${values[f.key]}`)
    .join('\n\n');
}

module.exports = { FIELD_TYPES, validateFieldSchema, validateSubmission, renderSubmission };
```

- [ ] **Step 4: Write the routes**

Create `backend/routes/request-types.js`:

```js
// ===== SERVICE DESK REQUEST TYPES =====
// The forms a customer can raise a request through. Agent-facing CRUD; the
// customer-facing projection of these lives in routes/help.js.
//
// GET    /api/projects/:projectId/request-types
// POST   /api/projects/:projectId/request-types   (board admin)
// GET    /api/request-types/:id
// PUT    /api/request-types/:id                   (board admin)
// DELETE /api/request-types/:id                   (board admin, 409 if in use)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { validateFieldSchema } = require('../utils/servicedesk');

const router = express.Router();
const requireBoardAdmin = requireRole('admin', 'board_admin');

function parseType(t) {
  let fields = [];
  try { fields = JSON.parse(t.fields || '[]'); } catch (e) { fields = []; }
  return { ...t, fields };
}

router.get('/projects/:projectId/request-types', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      'SELECT * FROM sd_request_types WHERE project_id = ? ORDER BY position, created_at',
      [req.params.projectId]);
    res.json(rows.map(parseType));
  } catch (e) { serverError(res, e); }
});

router.get('/request-types/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const row = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Request type not found' });
    res.json(parseType(row));
  } catch (e) { serverError(res, e); }
});

router.post('/projects/:projectId/request-types', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, description, icon, fields, position } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });

    const schema = validateFieldSchema(fields);
    if (!schema.ok) return res.status(400).json({ error: schema.error });

    const id = uuidv4();
    await run(db,
      'INSERT INTO sd_request_types (id, project_id, name, description, icon, fields, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, String(name).trim(), description || '', icon || 'help-circle',
       JSON.stringify(schema.fields), position || 0]);

    const created = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [id]);
    res.status(201).json(parseType(created));
  } catch (e) { serverError(res, e); }
});

router.put('/request-types/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Request type not found' });

    const { name, description, icon, fields, position } = req.body;
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name required' });

    let fieldsJson = existing.fields;
    if (fields !== undefined) {
      const schema = validateFieldSchema(fields);
      if (!schema.ok) return res.status(400).json({ error: schema.error });
      fieldsJson = JSON.stringify(schema.fields);
    }

    await run(db,
      'UPDATE sd_request_types SET name = ?, description = ?, icon = ?, fields = ?, position = ? WHERE id = ?',
      [name !== undefined ? String(name).trim() : existing.name,
       description !== undefined ? description : existing.description,
       icon !== undefined ? icon : existing.icon,
       fieldsJson,
       position !== undefined ? position : existing.position,
       req.params.id]);

    const updated = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [req.params.id]);
    res.json(parseType(updated));
  } catch (e) { serverError(res, e); }
});

router.delete('/request-types/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Request type not found' });

    const inUse = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE request_type_id = ?', [req.params.id]);
    if (inUse.count > 0) {
      return res.status(409).json({ error: `${inUse.count} request(s) use this type` });
    }

    await run(db, 'DELETE FROM sd_request_types WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
```

- [ ] **Step 5: Register the route in both places**

In `backend/server.js`, beside the other `app.use('/api', ...)` lines (~line 199):

```js
const requestTypesRoutes = require('./routes/request-types');
app.use('/api', requestTypesRoutes);
```

In `backend/tests/backend/setup.js`, after the `custom-fields` line:

```js
  testApp.use('/api', require('../../routes/request-types'));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --prefix backend -- --testPathPatterns=servicedesk-core`
Expected: PASS — migration block plus all 9 request type tests.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/request-types.js backend/utils/servicedesk.js backend/server.js backend/tests/backend/setup.js backend/tests/backend/servicedesk-core.test.js
git commit -m "feat(servicedesk): request types with a validated field schema"
```

---

## Task 4: Comment visibility

**Files:**
- Modify: `backend/routes/comments.js`
- Test: `backend/tests/backend/servicedesk-core.test.js` (append)

**Interfaces:**
- Consumes: `comments.visibility` from Task 2.
- Produces: comments carry `visibility: 'public' | 'internal'`. `POST` accepts
  it; `GET` hides `internal` rows from `role='client'`.

- [ ] **Step 1: Read the existing comments route**

Run: `sed -n '1,80p' backend/routes/comments.js`

Note the exact handler names and the shape returned by the list endpoint. The
code below must slot into that shape, not replace it.

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/backend/servicedesk-core.test.js`:

```js
describe('comment visibility', () => {
  let app, headers, clientHeaders, issueId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    const projects = await request(app).get('/api/projects').set(headers);
    const projectId = projects.body.find((p) => p.key === 'ATL').id;
    const issue = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Visibility fixture', type: 'task' });
    issueId = issue.body.id;

    // A client-role user, created through the admin API then logged in.
    const created = await request(app).post('/api/users').set(headers)
      .send({ name: 'Casey Client', email: 'casey@example.com', role: 'client' });
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'casey@example.com', password: created.body.initial_password });
    clientHeaders = { 'x-auth-token': login.body.token, 'Content-Type': 'application/json' };
  });

  test('a comment defaults to public', async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(headers).send({ body: 'Hello' });
    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('public');
  });

  test('an agent can post an internal note', async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: 'Internal only', visibility: 'internal' });
    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('internal');
  });

  test('an agent sees both public and internal comments', async () => {
    const res = await request(app).get(`/api/issues/${issueId}/comments`).set(headers);
    const visibilities = res.body.map((c) => c.visibility);
    expect(visibilities).toContain('public');
    expect(visibilities).toContain('internal');
  });

  test('a client never sees an internal comment', async () => {
    const res = await request(app).get(`/api/issues/${issueId}/comments`).set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.every((c) => c.visibility === 'public')).toBe(true);
    expect(res.body.some((c) => c.body === 'Internal only')).toBe(false);
  });

  test("a client's attempt to post an internal note is rejected, not downgraded", async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(clientHeaders)
      .send({ body: 'Sneaky', visibility: 'internal' });
    expect(res.status).toBe(403);
  });

  test('an invalid visibility is rejected', async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: 'Bad', visibility: 'secret' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=servicedesk-core -t "comment visibility"`
Expected: FAIL — `visibility` is undefined on the response.

- [ ] **Step 4: Implement**

In `backend/routes/comments.js`, add near the top:

```js
const VISIBILITIES = ['public', 'internal'];
```

In the **create** handler, after the body validation and before the INSERT:

```js
    const visibility = req.body.visibility || 'public';
    if (!VISIBILITIES.includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be public or internal' });
    }
    // A customer may only ever speak publicly. Rejected outright rather than
    // silently downgraded, so a broken client surfaces instead of hiding.
    if (visibility === 'internal' && req.userRole === 'client') {
      return res.status(403).json({ error: 'Clients cannot post internal notes' });
    }
```

Add `visibility` to the INSERT column list and pass the value.

In the **list** handler, filter for clients:

```js
    const rows = await queryAll(db,
      req.userRole === 'client'
        ? "SELECT * FROM comments WHERE issue_id = ? AND visibility = 'public' ORDER BY created_at"
        : 'SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at',
      [req.params.issueId]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --prefix backend -- --testPathPatterns=servicedesk-core`
Expected: PASS, all describe blocks.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/comments.js backend/tests/backend/servicedesk-core.test.js
git commit -m "feat(servicedesk): public and internal comment visibility"
```

---

## Task 5: The customer projection and access middleware

The security boundary. Everything in Task 6 depends on it.

**Files:**
- Modify: `backend/utils/servicedesk.js` (add `toPublicRequest`)
- Create: `backend/middleware/servicedesk.js`
- Test: `backend/tests/backend/help-center.test.js` (create)

**Interfaces:**
- Consumes: `validateSubmission`, `renderSubmission` from Task 3.
- Produces:
  - `toPublicRequest(issue, { requestType, statusLabel, comments })` →
    `{key, summary, description, fields, request_type, status, status_category, created_at, updated_at, comments}`
  - `requireClientSafe` — Express middleware; sets `req.request` to the issue row
    and 404s when the caller may not see it.

- [ ] **Step 1: Write the failing projection test**

Create `backend/tests/backend/help-center.test.js`:

```js
/**
 * HELP CENTER — the customer surface. Security rules from spec §Security.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { toPublicRequest } = require('../../utils/servicedesk');

describe('toPublicRequest projection', () => {
  // A raw issue row carrying every internal field a customer must never see.
  const rawIssue = {
    id: 'i1', project_id: 'p1', issue_key: 'HD-1', issue_number: 1,
    title: 'Laptop will not boot', description: 'rendered summary',
    type: 'request', status: 'in_progress', priority: 'highest',
    assignee_id: 'u-agent', reporter_id: 'u-customer', sprint_id: 's1',
    story_points: 8, labels: '["internal-escalation"]', original_estimate: '3h',
    time_spent: '1h', parent_id: 'i0', board_order: 3, epic_color: 'red',
    request_type_id: 'rt1', sd_fields: '{"model":"X1"}',
    created_at: '2026-07-01 10:00:00', updated_at: '2026-07-02 10:00:00',
  };

  const projected = toPublicRequest(rawIssue, {
    requestType: { id: 'rt1', name: 'Hardware problem', icon: 'laptop' },
    statusLabel: 'In Progress',
    statusCategory: 'in_progress',
    comments: [
      { id: 'c1', body: 'public reply', visibility: 'public', author_name: 'Agent', created_at: '2026-07-01 11:00:00' },
      { id: 'c2', body: 'internal note', visibility: 'internal', author_name: 'Agent', created_at: '2026-07-01 12:00:00' },
    ],
  });

  test('exposes only the allow-listed keys', () => {
    expect(Object.keys(projected).sort()).toEqual([
      'comments', 'created_at', 'description', 'fields', 'key',
      'request_type', 'status', 'status_category', 'summary', 'updated_at',
    ]);
  });

  test.each([
    'assignee_id', 'reporter_id', 'story_points', 'labels', 'sprint_id',
    'original_estimate', 'time_spent', 'parent_id', 'board_order', 'priority',
    'project_id', 'id', 'request_type_id',
  ])('does not leak %s', (field) => {
    expect(projected).not.toHaveProperty(field);
  });

  test('drops internal comments', () => {
    expect(projected.comments).toHaveLength(1);
    expect(projected.comments[0].body).toBe('public reply');
  });

  test('surfaces the status label rather than the raw key', () => {
    expect(projected.status).toBe('In Progress');
    expect(projected.status_category).toBe('in_progress');
  });

  test('parses sd_fields into an object', () => {
    expect(projected.fields).toEqual({ model: 'X1' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=help-center`
Expected: FAIL — `toPublicRequest is not a function`.

- [ ] **Step 3: Implement the projection**

Append to `backend/utils/servicedesk.js`, before `module.exports`:

```js
/**
 * The ONLY way an issue becomes a customer-visible payload.
 *
 * This is an allow-list: it names every key a customer may see and copies
 * nothing else. Adding a column to `issues` can therefore never leak it here.
 * Rejected alternative: a deny-list of internal fields, which fails open the
 * day someone adds a column.
 */
function toPublicRequest(issue, { requestType, statusLabel, statusCategory, comments = [] } = {}) {
  let fields = {};
  try { fields = JSON.parse(issue.sd_fields || '{}'); } catch (e) { fields = {}; }

  return {
    key: issue.issue_key,
    summary: issue.title,
    description: issue.description || '',
    fields,
    request_type: requestType ? { name: requestType.name, icon: requestType.icon } : null,
    status: statusLabel || issue.status,
    status_category: statusCategory || null,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    comments: comments
      .filter((c) => c.visibility !== 'internal')
      .map((c) => ({
        id: c.id,
        body: c.body,
        author_name: c.author_name,
        created_at: c.created_at,
      })),
  };
}
```

Add `toPublicRequest` to the `module.exports` list.

- [ ] **Step 4: Run the projection tests to verify they pass**

Run: `npm test --prefix backend -- --testPathPatterns=help-center`
Expected: PASS — 17 tests (4 named plus the 13 generated by `test.each`).

- [ ] **Step 5: Write the access middleware**

Create `backend/middleware/servicedesk.js`:

```js
// ===== SERVICE DESK ACCESS =====
// Answers one question: may this caller see this request?
//
// A caller qualifies if they reported the request or watch it. Commenting adds
// the commenter as a watcher, which is how a second customer gains access.
//
// Failure is 404, never 403: a 403 would confirm that a request key exists,
// letting anyone enumerate keys (spec §Security rule 4).

const { getDb, queryOne } = require('../database');
const { serverError } = require('../utils/errors');

async function requireClientSafe(req, res, next) {
  try {
    const db = await getDb();
    const issue = await queryOne(db,
      "SELECT * FROM issues WHERE issue_key = ? AND type = 'request'",
      [req.params.key]);

    if (!issue) return res.status(404).json({ error: 'Request not found' });

    if (issue.reporter_id === req.userId) {
      req.request = issue;
      return next();
    }

    const watching = await queryOne(db,
      'SELECT id FROM issue_watchers WHERE issue_id = ? AND user_id = ?',
      [issue.id, req.userId]);
    if (watching) {
      req.request = issue;
      return next();
    }

    return res.status(404).json({ error: 'Request not found' });
  } catch (e) { serverError(res, e); }
}

module.exports = { requireClientSafe };
```

- [ ] **Step 6: Commit**

```bash
git add backend/utils/servicedesk.js backend/middleware/servicedesk.js backend/tests/backend/help-center.test.js
git commit -m "feat(servicedesk): customer projection and request access middleware"
```

---

## Task 6: Help center routes

**Files:**
- Create: `backend/routes/help.js`
- Modify: `backend/server.js`, `backend/tests/backend/setup.js`
- Test: `backend/tests/backend/help-center.test.js` (append)

**Interfaces:**
- Consumes: `toPublicRequest`, `validateSubmission`, `renderSubmission`,
  `requireClientSafe`.
- Produces: `GET /api/help/request-types`, `POST /api/help/requests`,
  `GET /api/help/requests`, `GET /api/help/requests/:key`,
  `POST /api/help/requests/:key/comments`, `POST /api/help/requests/:key/resolve`.

- [ ] **Step 1: Write the failing lifecycle and security tests**

Append to `backend/tests/backend/help-center.test.js`:

```js
describe('help center lifecycle', () => {
  let app, headers, clientHeaders, otherClientHeaders, sdProjectId, typeId, raisedKey;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();

    // Key must NOT be 'HD': projects.key is UNIQUE and Task 10 seeds a demo
    // project with that key, which would make this test collide once it lands.
    const created = await request(app).post('/api/projects').set(headers)
      .send({ name: 'Test Service Desk', key: 'SD', description: 'Service desk' });
    sdProjectId = created.body.id;
    await request(app).put(`/api/projects/${sdProjectId}`).set(headers).send({ is_service_desk: true });

    const type = await request(app).post(`/api/projects/${sdProjectId}/request-types`).set(headers).send({
      name: 'Hardware problem',
      fields: [
        { key: 'model', label: 'Device model', type: 'text', required: true },
        { key: 'urgency', label: 'Urgency', type: 'select', options: ['Low', 'High'] },
      ],
    });
    typeId = type.body.id;

    async function makeClient(name, email) {
      const u = await request(app).post('/api/users').set(headers).send({ name, email, role: 'client' });
      const login = await request(app).post('/api/auth/login').send({ email, password: u.body.initial_password });
      return { 'x-auth-token': login.body.token, 'Content-Type': 'application/json' };
    }
    clientHeaders = await makeClient('Casey Client', 'casey.help@example.com');
    otherClientHeaders = await makeClient('Robin Rival', 'robin.help@example.com');
  });

  test('a client lists the request types they can raise', async () => {
    const res = await request(app).get('/api/help/request-types').set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.some((t) => t.name === 'Hardware problem')).toBe(true);
  });

  test('raises a request and returns the projected shape', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders).send({
      request_type_id: typeId,
      summary: 'Laptop will not boot',
      fields: { model: 'X1 Carbon', urgency: 'High' },
    });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^HD-/);
    expect(res.body.summary).toBe('Laptop will not boot');
    expect(res.body.fields.model).toBe('X1 Carbon');
    expect(res.body).not.toHaveProperty('assignee_id');
    raisedKey = res.body.key;
  });

  test('rejects a submission missing a required field', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders)
      .send({ request_type_id: typeId, summary: 'No model given', fields: { urgency: 'Low' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Device model/i);
  });

  test('rejects a value outside a select field options', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders)
      .send({ request_type_id: typeId, summary: 'Bad urgency', fields: { model: 'T14', urgency: 'Catastrophic' } });
    expect(res.status).toBe(400);
  });

  test('drops unknown field keys rather than storing them', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders)
      .send({ request_type_id: typeId, summary: 'Extra keys', fields: { model: 'T14', injected: 'evil' } });
    expect(res.status).toBe(201);
    expect(res.body.fields).not.toHaveProperty('injected');
  });

  test('lists only my own requests', async () => {
    const mine = await request(app).get('/api/help/requests').set(clientHeaders);
    expect(mine.body.length).toBeGreaterThan(0);
    const theirs = await request(app).get('/api/help/requests').set(otherClientHeaders);
    expect(theirs.body.length).toBe(0);
  });

  test('another customer gets 404 — not 403 — for a request they do not own', async () => {
    const res = await request(app).get(`/api/help/requests/${raisedKey}`).set(otherClientHeaders);
    expect(res.status).toBe(404);
  });

  test('the reporter can read their own request', async () => {
    const res = await request(app).get(`/api/help/requests/${raisedKey}`).set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.key).toBe(raisedKey);
  });

  test('a customer reply is always public', async () => {
    const res = await request(app).post(`/api/help/requests/${raisedKey}/comments`).set(clientHeaders)
      .send({ body: 'Any update?', visibility: 'internal' });
    expect(res.status).toBe(201);
    const detail = await request(app).get(`/api/help/requests/${raisedKey}`).set(clientHeaders);
    expect(detail.body.comments.some((c) => c.body === 'Any update?')).toBe(true);
  });

  test('an agent internal note never reaches the customer', async () => {
    const issues = await request(app).get(`/api/projects/${sdProjectId}/issues`).set(headers);
    const issue = issues.body.find((i) => i.issue_key === raisedKey);
    await request(app).post(`/api/issues/${issue.id}/comments`).set(headers)
      .send({ body: 'Ordering a replacement part', visibility: 'internal' });

    const detail = await request(app).get(`/api/help/requests/${raisedKey}`).set(clientHeaders);
    expect(detail.body.comments.some((c) => c.body === 'Ordering a replacement part')).toBe(false);
  });

  test('the customer can resolve their own request', async () => {
    const res = await request(app).post(`/api/help/requests/${raisedKey}/resolve`).set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.status_category).toBe('done');
  });

  test('an unauthenticated caller gets 401', async () => {
    const res = await request(app).get('/api/help/requests');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=help-center -t "help center lifecycle"`
Expected: FAIL — 404 on every `/api/help/*` call.

- [ ] **Step 3: Implement the routes**

Create `backend/routes/help.js`:

```js
// ===== HELP CENTER =====
// The customer-facing surface. Every response goes through toPublicRequest();
// no handler here builds a payload by hand.
//
// GET  /api/help/request-types
// POST /api/help/requests
// GET  /api/help/requests
// GET  /api/help/requests/:key
// POST /api/help/requests/:key/comments
// POST /api/help/requests/:key/resolve

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { requireClientSafe } = require('../middleware/servicedesk');
const { serverError } = require('../utils/errors');
const { toPublicRequest, validateSubmission, renderSubmission } = require('../utils/servicedesk');

const router = express.Router();

function parseFields(t) {
  try { return JSON.parse(t.fields || '[]'); } catch (e) { return []; }
}

// Resolves a status key to its label and category for the customer view.
async function statusFor(db, projectId, statusKey) {
  const row = await queryOne(db,
    'SELECT label, category FROM project_statuses WHERE project_id = ? AND key = ?',
    [projectId, statusKey]);
  if (row) return { statusLabel: row.label, statusCategory: row.category };
  const FALLBACK = {
    todo: ['To Do', 'todo'],
    in_progress: ['In Progress', 'in_progress'],
    in_review: ['In Review', 'in_progress'],
    done: ['Done', 'done'],
  };
  const [label, category] = FALLBACK[statusKey] || [statusKey, 'in_progress'];
  return { statusLabel: label, statusCategory: category };
}

async function projectRequest(db, issue) {
  const requestType = issue.request_type_id
    ? await queryOne(db, 'SELECT id, name, icon FROM sd_request_types WHERE id = ?', [issue.request_type_id])
    : null;
  const { statusLabel, statusCategory } = await statusFor(db, issue.project_id, issue.status);
  const comments = await queryAll(db,
    `SELECT c.id, c.body, c.visibility, c.created_at, u.name as author_name
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.issue_id = ? ORDER BY c.created_at`, [issue.id]);
  return toPublicRequest(issue, { requestType, statusLabel, statusCategory, comments });
}

// GET /api/help/request-types — every type in every service desk project.
router.get('/help/request-types', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT rt.id, rt.name, rt.description, rt.icon, rt.fields
         FROM sd_request_types rt
         JOIN projects p ON p.id = rt.project_id
        WHERE p.is_service_desk = 1
        ORDER BY rt.position, rt.created_at`);
    res.json(rows.map((t) => ({ ...t, fields: parseFields(t) })));
  } catch (e) { serverError(res, e); }
});

// POST /api/help/requests — raise one.
router.post('/help/requests', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { request_type_id, summary, fields } = req.body;
    if (!summary || !String(summary).trim()) return res.status(400).json({ error: 'Summary required' });

    const type = await queryOne(db,
      `SELECT rt.* FROM sd_request_types rt
         JOIN projects p ON p.id = rt.project_id
        WHERE rt.id = ? AND p.is_service_desk = 1`, [request_type_id]);
    if (!type) return res.status(404).json({ error: 'Request type not found' });

    const schema = parseFields(type);
    const submission = validateSubmission(schema, fields);
    if (!submission.ok) return res.status(400).json({ error: submission.error });

    const project = await queryOne(db, 'SELECT * FROM projects WHERE id = ?', [type.project_id]);
    const count = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE project_id = ?', [project.id]);
    const issueNumber = count.count + 1;
    const id = uuidv4();

    const statuses = await queryAll(db,
      'SELECT key FROM project_statuses WHERE project_id = ? ORDER BY position', [project.id]);
    const defaultStatus = statuses[0]?.key || 'todo';

    await run(db,
      `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, request_type_id, sd_fields, board_order)
       VALUES (?, ?, ?, ?, ?, ?, 'request', ?, 'medium', ?, ?, ?, 0)`,
      [id, project.id, `${project.key}-${issueNumber}`, issueNumber,
       String(summary).trim(), renderSubmission(schema, submission.values),
       defaultStatus, req.userId, type.id, JSON.stringify(submission.values)]);

    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [id]);
    res.status(201).json(await projectRequest(db, issue));
  } catch (e) { serverError(res, e); }
});

// GET /api/help/requests — mine, newest first.
router.get('/help/requests', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT * FROM issues
        WHERE type = 'request' AND (reporter_id = ?
          OR id IN (SELECT issue_id FROM issue_watchers WHERE user_id = ?))
        ORDER BY created_at DESC`, [req.userId, req.userId]);
    res.json(await Promise.all(rows.map((i) => projectRequest(db, i))));
  } catch (e) { serverError(res, e); }
});

router.get('/help/requests/:key', requireAuth, requireClientSafe, async (req, res) => {
  try {
    const db = await getDb();
    res.json(await projectRequest(db, req.request));
  } catch (e) { serverError(res, e); }
});

// POST /api/help/requests/:key/comments — always public, whatever was asked for.
router.post('/help/requests/:key/comments', requireAuth, requireClientSafe, async (req, res) => {
  try {
    const db = await getDb();
    const { body } = req.body;
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'Comment body required' });

    const id = uuidv4();
    await run(db,
      "INSERT INTO comments (id, issue_id, author_id, body, visibility) VALUES (?, ?, ?, ?, 'public')",
      [id, req.request.id, req.userId, String(body).trim()]);

    // Commenting subscribes the caller, which is how a second customer keeps access.
    const watching = await queryOne(db,
      'SELECT id FROM issue_watchers WHERE issue_id = ? AND user_id = ?', [req.request.id, req.userId]);
    if (!watching) {
      await run(db, 'INSERT INTO issue_watchers (id, issue_id, user_id) VALUES (?, ?, ?)',
        [uuidv4(), req.request.id, req.userId]);
    }

    const comment = await queryOne(db, 'SELECT * FROM comments WHERE id = ?', [id]);
    res.status(201).json({ id: comment.id, body: comment.body, created_at: comment.created_at });
  } catch (e) { serverError(res, e); }
});

router.post('/help/requests/:key/resolve', requireAuth, requireClientSafe, async (req, res) => {
  try {
    const db = await getDb();
    if (req.request.reporter_id !== req.userId) {
      return res.status(403).json({ error: 'Only the reporter can resolve a request' });
    }
    const done = await queryOne(db,
      "SELECT key FROM project_statuses WHERE project_id = ? AND category = 'done' ORDER BY position LIMIT 1",
      [req.request.project_id]);
    await run(db, 'UPDATE issues SET status = ? WHERE id = ?', [done?.key || 'done', req.request.id]);
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.request.id]);
    res.json(await projectRequest(db, issue));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
```

- [ ] **Step 4: Register the route in both places**

`backend/server.js`:

```js
const helpRoutes = require('./routes/help');
app.use('/api', helpRoutes);
```

`backend/tests/backend/setup.js`, after the `request-types` line:

```js
  testApp.use('/api', require('../../routes/help'));
```

- [ ] **Step 5: Support `is_service_desk` on project update**

The lifecycle test sets `is_service_desk` through `PUT /api/projects/:id`. Open
`backend/routes/projects.js`, find the update handler, and add `is_service_desk`
to the accepted body fields, coercing to 0/1:

```js
    const isServiceDesk = req.body.is_service_desk === undefined
      ? existing.is_service_desk
      : (req.body.is_service_desk ? 1 : 0);
```

Include it in the UPDATE statement's column list and parameters, and make sure
the project SELECT projections return it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --prefix backend -- --testPathPatterns=help-center`
Expected: PASS — projection tests plus all 12 lifecycle tests.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/help.js backend/routes/projects.js backend/server.js backend/tests/backend/setup.js backend/tests/backend/help-center.test.js
git commit -m "feat(servicedesk): help center — raise, track, reply, resolve"
```

---

## Task 7: Client lockdown

Spec §Security rule 3. Asserted, not assumed.

**Files:**
- Create: `backend/middleware/servicedesk.js` (add `blockClients`)
- Modify: `backend/server.js`, `backend/tests/backend/setup.js`
- Test: `backend/tests/backend/help-center.test.js` (append)

**Interfaces:**
- Consumes: `req.userRole` from `authMiddleware`.
- Produces: `blockClients` middleware, mounted before every internal route.

- [ ] **Step 1: Write the failing lockdown test**

Append to `backend/tests/backend/help-center.test.js`:

```js
describe('client lockdown', () => {
  let app, headers, clientHeaders, projectId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    const projects = await request(app).get('/api/projects').set(headers);
    projectId = projects.body.find((p) => p.key === 'ATL').id;
    const u = await request(app).post('/api/users').set(headers)
      .send({ name: 'Locked Out', email: 'locked@example.com', role: 'client' });
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'locked@example.com', password: u.body.initial_password });
    clientHeaders = { 'x-auth-token': login.body.token, 'Content-Type': 'application/json' };
  });

  test.each([
    ['issues', () => `/api/projects/${projectId}/issues`],
    ['sprints', () => `/api/projects/${projectId}/sprints`],
    ['epics', () => `/api/projects/${projectId}/epics`],
    ['reports', () => `/api/projects/${projectId}/reports/velocity`],
    ['wiki spaces', () => '/api/wiki/spaces'],
    ['users', () => '/api/users'],
    ['admin stats', () => '/api/admin/stats'],
    ['product features', () => '/api/pb/features'],
    ['search', () => '/api/search?q=test'],
  ])('a client cannot reach %s', async (_label, url) => {
    const res = await request(app).get(url()).set(clientHeaders);
    expect(res.status).toBe(403);
  });

  test('a client can still reach the help center', async () => {
    const res = await request(app).get('/api/help/requests').set(clientHeaders);
    expect(res.status).toBe(200);
  });

  test('a client can still reach their own profile', async () => {
    const res = await request(app).get('/api/profile').set(clientHeaders);
    expect(res.status).toBe(200);
  });
});
```

> Before implementing, run the test and read the actual URLs in the failures.
> If any path above does not exist in this codebase (route names drift), fix the
> test to use the real path rather than deleting the case.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=help-center -t "client lockdown"`
Expected: FAIL — clients currently get 200 from internal endpoints.

- [ ] **Step 3: Free the test harness from the `client` role — do this FIRST**

> **This step is why Task 7 is dangerous.** `backend/database.js:1110` seeds
> **Priya Patel as `role: 'client'`**, and `userHeaders()` in
> `backend/tests/backend/setup.js` logs in as exactly that account. The role has
> been inert until now — nothing referenced it — so seven existing test files
> (`admin`, `auth`, `users`, `comments`, `custom-fields`, `parity-wave`,
> `product-wave`) use `userHeaders()` to mean "an ordinary non-admin user".
> The moment `blockClients` exists, every one of those calls starts 403ing.
>
> Do not work around this in the middleware. Fix the seed.

In `backend/database.js:1110`, Priya becomes an ordinary user — which also
matches her seeded job title of Product Manager:

```js
  const roles = ['admin', 'board_admin', 'user', 'user', 'user'];
```

Then add a real customer to the seed arrays, so the service desk has someone to
be a customer. Extend each of the five parallel arrays (`userIds` gains a sixth
`uuid()`, then `colors`, `names`, `emails`, `roles`, `depts`, `titles`,
`phones`, `bios`, `tzs`) with one entry:

```js
  // The service desk customer. Every other seeded user is staff; this is the
  // only account that sees the app the way a customer does.
  // names:  'Dana Okafor'
  // emails: 'dana@customer.example.com'
  // roles:  'client'
  // depts:  'Customer'      titles: 'IT Manager, Northwind'
  // colors: '#8b5cf6'       tzs:    'Europe/Berlin'
  // phones: '+1-555-0106'
  // bios:   'Customer contact at Northwind, raises hardware and access requests.'
```

Verify every array now has the same length — they are indexed in parallel and a
short array silently seeds `undefined`:

```bash
node -e "const s=require('fs').readFileSync('backend/database.js','utf8');
['colors','names','emails','roles','depts','titles','phones','tzs'].forEach(k=>{
  const m=s.match(new RegExp('const '+k+' = \\\\[([^\\\\]]*)\\\\]'));
  console.log(k, m ? m[1].split(',').length : 'NOT FOUND');
});"
```

Expected: every name prints `6`.

- [ ] **Step 4: Run the full suite before touching the middleware**

Run: `npm test --prefix backend -- --testPathPatterns=tests/backend`
Expected: PASS. This proves the seed change alone broke nothing, so any failure
after the next step belongs to `blockClients` and not to the role edit.

- [ ] **Step 5: Implement `blockClients`**

Append to `backend/middleware/servicedesk.js`:

```js
// A client's entire world is the help center and their own profile. Everything
// else is refused here, once, rather than by each route remembering to check.
function blockClients(req, res, next) {
  if (req.userRole === 'client') {
    return res.status(403).json({ error: 'Not available to service desk customers' });
  }
  next();
}
```

Export it alongside `requireClientSafe`.

- [ ] **Step 6: Mount it in front of the internal routes**

In `backend/server.js`, mount `blockClients` before the internal route
registrations but **after** `/api/auth`, `/api/profile`, and the help center:

```js
const { blockClients } = require('./middleware/servicedesk');

// Order matters: auth, profile, and the help center mount first and stay open
// to clients; everything registered after this line is staff-only.
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api', helpRoutes);
app.use('/api', blockClients);
// ... every other route registration follows
```

Mirror the same ordering in `backend/tests/backend/setup.js`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --prefix backend -- --testPathPatterns=help-center`
Expected: PASS.

- [ ] **Step 8: Run the whole backend suite — ordering changes are high blast radius**

Run: `npm test --prefix backend -- --testPathPatterns=tests/backend`
Expected: PASS. Moving route registration can change which handler wins a path;
if any suite fails, the ordering is wrong, not the test.

- [ ] **Step 9: Commit**

```bash
git add backend/middleware/servicedesk.js backend/database.js backend/server.js backend/tests/backend/setup.js backend/tests/backend/help-center.test.js
git commit -m "feat(servicedesk): confine client-role users to the help center

Priya was seeded as role=client, which userHeaders() logs in as, so the
new lockdown would have 403'd seven existing suites. She becomes a normal
user and a real customer account joins the seed."
```

---

## Task 8: Frontend types and API client

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: the endpoints from Tasks 3, 6.
- Produces: `api.help.*` and `api.requestTypes.*`, plus the `RequestType`,
  `RequestField`, and `PublicRequest` types.

- [ ] **Step 1: Add the types**

In `frontend/src/lib/types.ts`:

```ts
export type RequestFieldType = 'text' | 'textarea' | 'select' | 'date';

export interface RequestField {
  key: string;
  label: string;
  type: RequestFieldType;
  required: boolean;
  options?: string[];
}

export interface RequestType {
  id: string;
  project_id?: string;
  name: string;
  description: string;
  icon: string;
  fields: RequestField[];
  position?: number;
}

export interface PublicRequestComment {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
}

export interface PublicRequest {
  key: string;
  summary: string;
  description: string;
  fields: Record<string, string>;
  request_type: { name: string; icon: string } | null;
  status: string;
  status_category: 'todo' | 'in_progress' | 'done' | null;
  created_at: string;
  updated_at: string;
  comments: PublicRequestComment[];
}
```

- [ ] **Step 2: Add the API methods**

In `frontend/src/lib/api.ts`, add `PublicRequest`, `RequestType`, and
`RequestField` to the type import block, then add to the `api` object:

```ts
  help: {
    requestTypes: () => get<RequestType[]>('/help/request-types'),
    raise: (body: { request_type_id: string; summary: string; fields: Record<string, string> }) =>
      post<PublicRequest>('/help/requests', body),
    myRequests: () => get<PublicRequest[]>('/help/requests'),
    getRequest: (key: string) => get<PublicRequest>(`/help/requests/${key}`),
    reply: (key: string, body: string) =>
      post<{ id: string; body: string; created_at: string }>(`/help/requests/${key}/comments`, { body }),
    resolve: (key: string) => post<PublicRequest>(`/help/requests/${key}/resolve`),
  },

  requestTypes: {
    list: (projectId: string) => get<RequestType[]>(`/projects/${projectId}/request-types`),
    create: (projectId: string, body: Partial<RequestType>) =>
      post<RequestType>(`/projects/${projectId}/request-types`, body),
    update: (id: string, body: Partial<RequestType>) => put<RequestType>(`/request-types/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/request-types/${id}`),
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run build --prefix frontend`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat(servicedesk): typed help center API client"
```

---

## Task 9: Help center screens

**Files:**
- Create: `frontend/src/screens/help-center.tsx`, `frontend/src/screens/help-requests.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/app/app-shell.tsx`

**Interfaces:**
- Consumes: `api.help.*` from Task 8.
- Produces: routes `/help`, `/help/requests`, `/help/requests/:key`.

- [ ] **Step 1: Read the shell and an existing screen**

Run:
```bash
sed -n '1,60p' frontend/src/screens/portal.tsx
grep -n "role\|Navigate\|useAuth" frontend/src/components/app/app-shell.tsx | head -30
```

Match the loading/error/empty pattern (`RowsSkeleton`, `ErrorState`,
`EmptyState`, `PageHeader` from `@/components/app/primitives`) exactly.

- [ ] **Step 2: Build the help center screen**

Create `frontend/src/screens/help-center.tsx`. The non-obvious part is rendering
an arbitrary field schema, so that is given in full; the surrounding screen
follows `portal.tsx` exactly (`useCallback` loader, `loading`/`error` state,
`RowsSkeleton` while loading, `ErrorState` on failure, `EmptyState` when no
request types exist).

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import type { RequestField, RequestType } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';

/** Renders one field of a request type's schema. */
function FieldInput({ field, value, onChange }: {
  field: RequestField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `field-${field.key}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      {field.type === 'textarea' && (
        <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={4} />
      )}
      {field.type === 'text' && (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === 'date' && (
        <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === 'select' && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder="Choose one" /></SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default function HelpCenterScreen() {
  const navigate = useNavigate();
  const [types, setTypes] = useState<RequestType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<RequestType | null>(null);
  const [summary, setSummary] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTypes(await api.help.requestTypes());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the help center');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function open(t: RequestType) {
    setActive(t);
    setSummary('');
    setValues({});
  }

  // Mirrors the server's rule so the customer sees the problem before a round
  // trip. The server re-validates regardless — this is convenience, not trust.
  const missing = active
    ? active.fields.filter((f) => f.required && !(values[f.key] ?? '').trim()).map((f) => f.label)
    : [];
  const canSubmit = !!summary.trim() && missing.length === 0 && !submitting;

  async function submit() {
    if (!active) return;
    setSubmitting(true);
    try {
      const created = await api.help.raise({
        request_type_id: active.id,
        summary: summary.trim(),
        fields: values,
      });
      toast.success(`${created.key} raised`);
      setActive(null);
      navigate(`/help/requests/${created.key}`);
    } catch (e) {
      toast.error('Could not raise the request', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <RowsSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader title="How can we help?" subtitle="Choose the kind of request you want to raise" />
      {types.length === 0 ? (
        <EmptyState title="No request types yet" description="An administrator needs to create one first." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {types.map((t) => (
            <Card key={t.id} className="cursor-pointer p-5 transition hover:border-primary" onClick={() => open(t)}>
              <h3 className="font-semibold">{t.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{active?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="summary">Summary <span className="ml-1 text-red-500">*</span></Label>
              <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)}
                placeholder="A one-line description" />
            </div>
            {active?.fields.map((f) => (
              <FieldInput key={f.key} field={f} value={values[f.key] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

> Confirm `Label` exists at `frontend/src/components/ui/label.tsx` before
> relying on the import; if it does not, use a plain `<label className="text-sm
> font-medium">` rather than adding a new primitive.

> **React 18 constraint:** if you introduce any new UI primitive used as an
> `asChild` trigger, it MUST be wrapped in `React.forwardRef` — see
> `KNOWN-ISSUES.md`. The existing `Button`, `Dialog`, and `Select` are already
> correct; do not add a plain-function wrapper around them.

- [ ] **Step 3: Build the requests screen**

Create `frontend/src/screens/help-requests.tsx` handling both the list
(`/help/requests`) and the detail (`/help/requests/:key`) via `useParams`:

- List: status pill from `status_category` (`todo` slate, `in_progress` blue,
  `done` emerald), summary, request type name, relative updated time.
- Detail: summary, submitted `fields` as a definition list, the public comment
  thread, a reply box posting through `api.help.reply`, and a "Mark as resolved"
  button calling `api.help.resolve` when `status_category !== 'done'`.

- [ ] **Step 4: Wire the routes**

In `frontend/src/App.tsx`, alongside the other lazy imports:

```tsx
const HelpCenter = lazy(() => import('@/screens/help-center'));
const HelpRequests = lazy(() => import('@/screens/help-requests'));
```

And within the routes block:

```tsx
              <Route path="/help" element={<HelpCenter />} />
              <Route path="/help/requests" element={<HelpRequests />} />
              <Route path="/help/requests/:key" element={<HelpRequests />} />
```

- [ ] **Step 5: Redirect clients to the help center**

In `frontend/src/components/app/app-shell.tsx`, where the authenticated user is
known, send `role === 'client'` to `/help` and render neither the project
sidebar nor the internal nav for them:

```tsx
  if (user?.role === 'client' && !location.pathname.startsWith('/help')) {
    return <Navigate to="/help" replace />;
  }
```

Import `Navigate` and `useLocation` from `react-router-dom` if not already
present.

- [ ] **Step 6: Build and verify**

Run: `npm run build --prefix frontend`
Expected: build succeeds.

Then run the app and check by hand — `/help` renders request types, raising one
lands on its detail, and an admin session is not redirected:

```bash
node backend/server.js
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/help-center.tsx frontend/src/screens/help-requests.tsx frontend/src/App.tsx frontend/src/components/app/app-shell.tsx
git commit -m "feat(servicedesk): help center screens and client redirect"
```

---

## Task 10: Seed the demo service desk and epics 40–41

**Files:**
- Modify: `backend/database.js` (seed), `backend/tests/backend/epics.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: 41 seeded roadmap epics and a working "Help Desk" demo project.

- [ ] **Step 1: Update the epic count test**

In `backend/tests/backend/epics.test.js`, change 39 to 41 and the test name to
match.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix backend -- --testPathPatterns=epics.test.js -t "roadmap epics"`
Expected: FAIL — `Expected: 41, Received: 39`.

- [ ] **Step 3: Seed epics 40 and 41**

In `backend/database.js`, after the focus mode block from Task 1, following the
same pattern (`epicWindow(39)` and `epicWindow(40)`, `board_order` 39 and 40):

- **Service desk foundation** (`purple`) — children: "Migration 011: request
  types, request issue type, comment visibility", "Request types with a
  validated field schema", "Public and internal comment visibility".
- **Help center** (`teal`) — children: "Customer projection and request access
  middleware", "Help center: raise, track, reply, resolve", "Confine client-role
  users to the help center", "Help center screens and client redirect".

- [ ] **Step 4: Seed the demo Help Desk project**

After the ATLAS seed block, add a service desk project so the screens have shape
on a fresh database:

```js
  // ===== DEMO SERVICE DESK =====
  const projId4 = uuid();
  db.run("INSERT INTO projects (id, name, key, description, lead_id, is_service_desk) VALUES (?, ?, ?, ?, ?, 1)",
    [projId4, 'Help Desk', 'HD', 'Customer requests raised through the help center', userIds[0]]);
  db.run("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'lead')",
    [uuid(), projId4, userIds[0]]);

  const requestTypes = [
    { name: 'Hardware problem', icon: 'laptop', desc: 'A device is broken or missing',
      fields: [
        { key: 'model', label: 'Device model', type: 'text', required: true },
        { key: 'urgency', label: 'Urgency', type: 'select', required: true, options: ['Low', 'Medium', 'High'] },
      ] },
    { name: 'Access request', icon: 'key', desc: 'Ask for access to a system',
      fields: [
        { key: 'system', label: 'System', type: 'text', required: true },
        { key: 'reason', label: 'Why do you need access?', type: 'textarea', required: true },
      ] },
    { name: 'Something else', icon: 'help-circle', desc: 'Anything that does not fit the other forms',
      fields: [{ key: 'details', label: 'Tell us more', type: 'textarea', required: false }] },
  ];
  const requestTypeIds = [];
  requestTypes.forEach((t, i) => {
    const rtId = uuid();
    requestTypeIds.push(rtId);
    db.run("INSERT INTO sd_request_types (id, project_id, name, description, icon, fields, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [rtId, projId4, t.name, t.desc, t.icon, JSON.stringify(t.fields), i]);
  });

  // A handful of requests across states so queues and the customer view both
  // have something to render.
  const demoRequests = [
    { type: 0, title: 'Laptop will not power on', status: 'todo', fields: { model: 'ThinkPad X1', urgency: 'High' } },
    { type: 1, title: 'Access to the analytics dashboard', status: 'in_progress', fields: { system: 'Analytics', reason: 'Reporting for Q3' } },
    { type: 2, title: 'Meeting room display keeps disconnecting', status: 'done', fields: { details: 'Room 4B, every morning' } },
  ];
  demoRequests.forEach((r, i) => {
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, request_type_id, sd_fields, board_order)
      VALUES (?, ?, ?, ?, ?, ?, 'request', ?, 'medium', ?, ?, ?, ?)`,
      [uuid(), projId4, `HD-${i + 1}`, i + 1, r.title,
       Object.entries(r.fields).map(([k, v]) => `**${k}**\n${v}`).join('\n\n'),
       r.status, userIds[5], requestTypeIds[r.type], JSON.stringify(r.fields), i]);
  });
```

> `userIds[5]` is Dana Okafor, the `client` account added to the seed in Task 7
> Step 3. Requests must be reported by a customer — seeding them against a staff
> account would make the help center look empty when Dana logs in, which is the
> one view this demo data exists to populate.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test --prefix backend -- --testPathPatterns=tests/backend`
Expected: PASS. Watch for suites that assert a project count or index into the
projects list — a fourth seeded project can break those, and the fix is to
select by key (as `epics.test.js` already does).

- [ ] **Step 6: Commit**

```bash
git add backend/database.js backend/tests/backend/epics.test.js
git commit -m "feat(servicedesk): seed the help desk demo project and epics 40-41"
```

---

## Deliberately deferred to slice 2

The spec's Surfaces paragraph mentions request types being managed "under
project settings". Slice 1 ships the request types **API** (Task 3) but no agent
UI for it — types come from the seed or from the API. The management screen
belongs with the queues work in slice 2, where the service desk project settings
page gets built once rather than twice.

This is the only spec item in epics 39–41 that slice 1 does not implement.

## Done criteria

- [ ] `npm test --prefix backend -- --testPathPatterns=tests/backend` passes in full.
- [ ] `npm run build --prefix frontend` succeeds.
- [ ] A `client` user logging in lands on `/help`, can raise a request, see it,
      reply, and resolve it — and receives 403 from every internal API.
- [ ] An agent sees the request in the normal issue views with its submitted
      fields in the description, and can post an internal note the customer
      never sees.
- [ ] Nothing pushed. The branch `service-desk-wave` holds all commits.
