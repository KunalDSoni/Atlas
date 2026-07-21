# Product Discovery Slice 1 Implementation Plan (epics 47–48)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a PM capture feedback from the service desk, issue comments and
wiki pages into the insights inbox, and rank features by the real revenue behind
them rather than by a three-point tier proxy.

**Architecture:** Insights gain four nullable columns recording where they came
from plus a snapshot of the captured text, so evidence survives its source being
edited or deleted. A single `POST /api/product/insights/capture` endpoint
resolves the origin, verifies the caller may see it, and stores the excerpt.
Demand is computed in JavaScript from rows already stored — never a new column —
and arrives alongside the existing `user_impact` rather than redefining it.

**Tech Stack:** Node 20, Express 4, sql.js (SQLite) in dev/test and MySQL 8.4 in
production, Jest + supertest, React 18 + TypeScript + shadcn/ui + Vite.

## Global Constraints

- **Both dialects, always.** Every migration step carries a `sqlite` and a
  `mysql` form. `backend/migrations.js` is append-only — never edit or reorder a
  shipped id.
- **Register new routes in two places** — `backend/server.js` and
  `backend/tests/backend/setup.js`. A route registered in only one passes tests
  and 404s in production, or the reverse.
- **Product routes are staff-only.** They mount after
  `middleware/servicedesk.blockClients` in both files. Never mount a
  `/api/product/*` route before it.
- **Seeded users:** `kunal@example.com` is `admin`, `sarah@example.com` is
  `board_admin`, `priya@example.com` is `user` (ordinary staff — this is
  `userHeaders()`), `dana@customer.example.com` is `client`. All use password
  `password123`. Note `product-wave.test.js:14` carries a stale comment calling
  Priya a client; she is staff since epic 41.
- **No new dependencies.** Everything here uses what is already in
  `backend/package.json`.
- **Leave the suite green.** `cd backend && npm test` before every commit.

## File Structure

**Create:**
- `backend/utils/insight-origin.js` — resolves an origin reference to
  `{excerpt, title, customer_id}` and enforces the caller may see it. One
  responsibility: turning a `(kind, id)` pair into verified capture material.
- `backend/utils/demand.js` — the ARR-weighted demand calculation and its tier
  median fallback. Pure functions plus one query helper; no Express.
- `backend/tests/backend/insight-capture.test.js`
- `backend/tests/backend/product-demand.test.js`
- `frontend/src/screens/product-inbox.tsx`

**Modify:**
- `backend/migrations.js` — append migration `015_insight_origins`
- `backend/database.js` — base schema for fresh databases; demo seed
- `backend/routes/product-insights.js` — capture, inbox filters, dismiss
- `backend/routes/portal.js` — stamp origin columns on portal-created insights
- `backend/routes/product-features.js` — expose `demand` and `demand_breakdown`
- `backend/server.js`, `backend/tests/backend/setup.js` — no new route files, so
  no changes needed; verify before assuming
- `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`
- `frontend/src/App.tsx` — lazy route for the inbox
- `frontend/src/screens/product-features.tsx` — demand column and sort

---

## Task 1: Migration 015 — insight origins

**Files:**
- Modify: `backend/migrations.js` (append to `MIGRATIONS`)
- Modify: `backend/database.js` (base schema for `pb_insights`)
- Test: `backend/tests/backend/migrations.test.js`

**Interfaces:**
- Produces: columns `pb_insights.origin_kind`, `.origin_id`, `.origin_excerpt`,
  `.dismissed_at`. Every later task depends on these.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/migrations.test.js`:

```javascript
test('015 adds origin columns to pb_insights', async () => {
  const db = await getDb();
  const cols = await queryAll(db, "PRAGMA table_info(pb_insights)");
  const names = cols.map((c) => c.name);
  expect(names).toContain('origin_kind');
  expect(names).toContain('origin_id');
  expect(names).toContain('origin_excerpt');
  expect(names).toContain('dismissed_at');
});

test('015 is recorded in the migration ledger', async () => {
  const db = await getDb();
  const row = await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['015_insight_origins']);
  expect(row).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/backend/migrations.test.js --runInBand --forceExit`
Expected: FAIL — `expect(names).toContain('origin_kind')` receives an array without it.

- [ ] **Step 3: Append the migration**

At the end of the `MIGRATIONS` array in `backend/migrations.js`, after
`014_*` if the service desk wave has landed, otherwise after `011_service_desk_core`:

```javascript
  {
    id: '015_insight_origins',
    description: 'Where an insight came from, and a snapshot of the captured text',
    steps: [
      {
        addColumn: {
          table: 'pb_insights', column: 'origin_kind',
          // No CHECK here: ALTER cannot carry one, and the allowed set is
          // enforced by ORIGIN_KINDS in utils/insight-origin.js.
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN origin_kind TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN origin_kind VARCHAR(20)',
        },
      },
      {
        addColumn: {
          table: 'pb_insights', column: 'origin_id',
          // Deliberately not a foreign key: it points at issues, comments or
          // wiki_pages depending on origin_kind, and a deleted source must
          // leave the insight and its excerpt intact.
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN origin_id TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN origin_id VARCHAR(36)',
        },
      },
      {
        addColumn: {
          table: 'pb_insights', column: 'origin_excerpt',
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN origin_excerpt TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN origin_excerpt TEXT',
        },
      },
      {
        addColumn: {
          table: 'pb_insights', column: 'dismissed_at',
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN dismissed_at TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN dismissed_at DATETIME(3) NULL',
        },
      },
    ],
  },
```

- [ ] **Step 4: Update the base schema for fresh databases**

The migration handles existing deployments; `database.js` handles new ones. In
`backend/database.js`, find the `CREATE TABLE IF NOT EXISTS pb_insights` block
(there are two — SQLite and MySQL) and add the four columns to each, before
`created_at`.

SQLite form:

```sql
    processed INTEGER DEFAULT 0,
    origin_kind TEXT,
    origin_id TEXT,
    origin_excerpt TEXT,
    dismissed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
```

MySQL form:

```sql
    processed TINYINT DEFAULT 0,
    origin_kind VARCHAR(20),
    origin_id VARCHAR(36),
    origin_excerpt TEXT,
    dismissed_at DATETIME(3) NULL,
    created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/migrations.test.js --runInBand --forceExit`
Expected: PASS

- [ ] **Step 6: Run the full suite — nothing may regress**

Run: `cd backend && npm test`
Expected: all suites pass. The MySQL suite skips locally; CI runs it.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations.js backend/database.js backend/tests/backend/migrations.test.js
git commit -m "feat(product): migration 015 — insight origin columns (ATLAS-47)"
```

---

## Task 2: Origin resolution

The security boundary for capture. Task 3 depends entirely on it.

**Files:**
- Create: `backend/utils/insight-origin.js`
- Test: `backend/tests/backend/insight-capture.test.js`

**Interfaces:**
- Consumes: `pageAccess` from `backend/routes/wiki.js` (exported at line 848).
- Produces: `ORIGIN_KINDS` (array), and
  `resolveOrigin(db, kind, originId, userId, userRole)` →
  `{ ok: true, title, excerpt, customer_id }` or
  `{ ok: false, status: 403|404, error: string }`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/insight-capture.test.js`:

```javascript
/**
 * INSIGHT CAPTURE — Epic 47
 * Origin resolution, capture endpoint, excerpt snapshotting, inbox triage.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders, loginAs } = require('./setup');

let app, headers, staffHeaders, clientHeaders, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  staffHeaders = await userHeaders();
  clientHeaders = await loginAs('dana@customer.example.com', 'password123');
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
});

describe('origin resolution', () => {
  test('resolves an issue comment into excerpt and title', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();

    const issue = await queryOne(db, "SELECT id FROM issues WHERE type != 'epic' LIMIT 1");
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);
    const created = await request(app)
      .post(`/api/issues/${issue.id}/comments`)
      .set(headers)
      .send({ body: 'Exporting to CSV every Monday is killing us.' });
    expect(created.status).toBe(201);

    const out = await resolveOrigin(db, 'comment', created.body.id, me.id, me.role);
    expect(out.ok).toBe(true);
    expect(out.excerpt).toContain('killing us');
  });

  test('rejects an unknown origin kind', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);
    const out = await resolveOrigin(db, 'telepathy', 'whatever', me.id, me.role);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
  });

  test('missing source row is a 404, not a crash', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);
    const out = await resolveOrigin(db, 'comment', 'no-such-comment', me.id, me.role);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/backend/insight-capture.test.js --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../utils/insight-origin'`

- [ ] **Step 3: Implement**

Create `backend/utils/insight-origin.js`:

```javascript
// ===== INSIGHT ORIGIN RESOLUTION =====
// Turns an (origin_kind, origin_id) pair into verified capture material:
// a title, an excerpt snapshot, and — where the source knows one — the
// customer it came from.
//
// Two rules this file exists to enforce:
//   1. The caller must be allowed to see the source. Product routes are
//      staff-only, but "staff" does not imply "may read every restricted wiki
//      page", so wiki captures delegate to the same pageAccess() the wiki
//      routes use rather than reimplementing restriction logic.
//   2. The excerpt is a SNAPSHOT. Sources get edited and deleted; evidence
//      that silently rewrites itself is not evidence.

const { queryOne } = require('../database');

const ORIGIN_KINDS = ['request', 'comment', 'wiki', 'portal', 'manual'];

// Excerpts are stored, listed, and rendered in a table row. Long enough to
// carry the point, short enough not to bloat the inbox payload.
const MAX_EXCERPT = 500;

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function excerptOf(s) {
  const text = stripHtml(s);
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 1)}…` : text;
}

// A source authored by someone with a matching pb_customers row attributes the
// insight to that customer. No match is not an error — it is an unattributed
// insight, which epic 48 counts separately rather than folding into demand.
async function customerForUser(db, userId) {
  if (!userId) return null;
  const row = await queryOne(db,
    `SELECT cu.id FROM users u JOIN pb_customers cu ON LOWER(cu.email) = LOWER(u.email)
     WHERE u.id = ?`, [userId]);
  return row ? row.id : null;
}

async function resolveOrigin(db, kind, originId, userId, userRole) {
  if (!ORIGIN_KINDS.includes(kind)) {
    return { ok: false, status: 400, error: `origin_kind must be one of: ${ORIGIN_KINDS.join(', ')}` };
  }
  if (kind === 'manual' || kind === 'portal') {
    return { ok: false, status: 400, error: `${kind} insights are not captured through this endpoint` };
  }
  if (!originId) return { ok: false, status: 400, error: 'origin_id required' };

  if (kind === 'request') {
    const issue = await queryOne(db,
      `SELECT id, key_id, title, description, reporter_id, type FROM issues WHERE id = ?`, [originId]);
    if (!issue) return { ok: false, status: 404, error: 'Request not found' };
    if (issue.type !== 'request') return { ok: false, status: 400, error: 'Issue is not a service desk request' };
    return {
      ok: true,
      title: issue.title,
      excerpt: excerptOf(issue.description),
      customer_id: await customerForUser(db, issue.reporter_id),
    };
  }

  if (kind === 'comment') {
    const comment = await queryOne(db,
      `SELECT c.id, c.body, c.user_id, i.title as issue_title
       FROM comments c JOIN issues i ON c.issue_id = i.id WHERE c.id = ?`, [originId]);
    if (!comment) return { ok: false, status: 404, error: 'Comment not found' };
    return {
      ok: true,
      title: comment.issue_title,
      excerpt: excerptOf(comment.body),
      customer_id: await customerForUser(db, comment.user_id),
    };
  }

  // kind === 'wiki'
  const page = await queryOne(db, 'SELECT id, title, content FROM wiki_pages WHERE id = ?', [originId]);
  if (!page) return { ok: false, status: 404, error: 'Page not found' };
  const { pageAccess } = require('../routes/wiki');
  const access = await pageAccess(db, originId, userId, userRole);
  if (!access || !access.view) return { ok: false, status: 403, error: 'This page is restricted' };
  return { ok: true, title: page.title, excerpt: excerptOf(page.content), customer_id: null };
}

module.exports = { ORIGIN_KINDS, resolveOrigin, excerptOf, MAX_EXCERPT };
```

Note the `require('../routes/wiki')` sits inside the function, not at module
top. `routes/wiki.js` requires other modules at load time, and a top-level
require here creates a cycle that resolves to an empty object under the test
harness's cache-clearing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/insight-capture.test.js --runInBand --forceExit`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/insight-origin.js backend/tests/backend/insight-capture.test.js
git commit -m "feat(product): resolve and verify insight origins (ATLAS-47)"
```

---

## Task 3: The capture endpoint

**Files:**
- Modify: `backend/routes/product-insights.js`
- Test: `backend/tests/backend/insight-capture.test.js`

**Interfaces:**
- Consumes: `resolveOrigin`, `ORIGIN_KINDS` from Task 2.
- Produces: `POST /api/product/insights/capture` accepting
  `{origin_kind, origin_id, title?, customer_id?}` → 201 with the enriched
  insight, carrying `origin_kind`, `origin_id`, `origin_excerpt`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/insight-capture.test.js`:

```javascript
describe('capture endpoint', () => {
  let commentId;

  beforeAll(async () => {
    const issues = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
    const issue = issues.body.find((i) => i.type !== 'epic');
    const c = await request(app).post(`/api/issues/${issue.id}/comments`).set(headers)
      .send({ body: 'We need bulk CSV export before renewal.' });
    commentId = c.body.id;
  });

  test('captures a comment into an unprocessed insight with a snapshot', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'comment', origin_id: commentId });
    expect(res.status).toBe(201);
    expect(res.body.origin_kind).toBe('comment');
    expect(res.body.origin_id).toBe(commentId);
    expect(res.body.origin_excerpt).toContain('bulk CSV export');
    expect(res.body.processed).toBe(0);
    expect(res.body.source).toBe('support');
  });

  test('the excerpt survives the source being deleted', async () => {
    const c = await request(app).post(`/api/issues/${
      (await request(app).get(`/api/projects/${projectId}/issues`).set(headers)).body.find((i) => i.type !== 'epic').id
    }/comments`).set(headers).send({ body: 'Ephemeral but important.' });

    const captured = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'comment', origin_id: c.body.id });
    expect(captured.status).toBe(201);

    await request(app).delete(`/api/comments/${c.body.id}`).set(headers);

    const after = await request(app).get(`/api/product/insights/${captured.body.id}`).set(headers);
    expect(after.status).toBe(200);
    expect(after.body.origin_excerpt).toContain('Ephemeral but important');
  });

  test('rejects an unknown origin kind with 400', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'telepathy', origin_id: commentId });
    expect(res.status).toBe(400);
  });

  test('a client cannot reach the capture endpoint', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(clientHeaders)
      .send({ origin_kind: 'comment', origin_id: commentId });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/insight-capture.test.js --runInBand --forceExit`
Expected: FAIL — capture returns 404 (route does not exist).

- [ ] **Step 3: Implement**

In `backend/routes/product-insights.js`, add the import below the existing ones:

```javascript
const { resolveOrigin } = require('../utils/insight-origin');
```

Add `origin_kind`, `origin_id` and `origin_excerpt` to `ENRICHED_SELECT` — they
come through `ins.*` already, so no change is needed there; verify by reading
line 21.

Insert this route immediately before the `GET /api/product/insights/:id` route,
so `/capture` is matched before `:id` swallows it:

```javascript
// POST /api/product/insights/capture — turn an existing piece of text in Atlas
// into a triageable insight. The excerpt is snapshotted; origin_id is a
// backlink that may dangle if the source is deleted.
router.post('/product/insights/capture', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { origin_kind, origin_id, title, customer_id } = req.body;

    const origin = await resolveOrigin(db, origin_kind, origin_id, req.userId, req.userRole);
    if (!origin.ok) return res.status(origin.status).json({ error: origin.error });

    if (customer_id) {
      const customer = await queryOne(db, 'SELECT id FROM pb_customers WHERE id = ?', [customer_id]);
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
    }

    // A request or comment is support feedback; a wiki capture is research
    // somebody wrote up. Neither is 'other', which is the manual-form default.
    const source = origin_kind === 'wiki' ? 'interview' : 'support';
    const id = uuidv4();
    await run(db,
      `INSERT INTO pb_insights (id, title, content, source, customer_id, created_by,
         origin_kind, origin_id, origin_excerpt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, (title || origin.title || 'Captured feedback').trim(), '', source,
       customer_id || origin.customer_id || null, req.userId,
       origin_kind, origin_id, origin.excerpt]);

    const insight = await queryOne(db, `${ENRICHED_SELECT} WHERE ins.id = ?`, [id]);
    res.status(201).json(insight);
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/insight-capture.test.js --runInBand --forceExit`
Expected: PASS — 7 tests.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/product-insights.js backend/tests/backend/insight-capture.test.js
git commit -m "feat(product): capture insights from requests, comments and wiki pages (ATLAS-47)"
```

---

## Task 4: Portal origin stamping and inbox triage

**Files:**
- Modify: `backend/routes/portal.js:47`
- Modify: `backend/routes/product-insights.js`
- Test: `backend/tests/backend/insight-capture.test.js`

**Interfaces:**
- Produces: `GET /api/product/insights?dismissed=0|1` filter;
  `POST /api/product/insights/:id/dismiss` → `{ok: true}`; portal insights
  carrying `origin_kind='portal'`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/insight-capture.test.js`:

```javascript
describe('inbox triage', () => {
  test('a portal idea is stamped with its origin', async () => {
    const res = await request(app).post('/api/portal/ideas').set(clientHeaders)
      .send({ title: 'Dark mode please', content: 'The dashboard is blinding at night.' });
    expect(res.status).toBe(201);

    const list = await request(app).get('/api/product/insights?source=portal').set(headers);
    const mine = list.body.find((i) => i.title === 'Dark mode please');
    expect(mine).toBeTruthy();
    expect(mine.origin_kind).toBe('portal');
  });

  test('dismiss removes an insight from the inbox without deleting it', async () => {
    const created = await request(app).post('/api/product/insights').set(headers)
      .send({ title: 'Not actionable', content: 'A rant.' });

    const dismissed = await request(app).post(`/api/product/insights/${created.body.id}/dismiss`).set(headers);
    expect(dismissed.status).toBe(200);

    const inbox = await request(app).get('/api/product/insights?processed=0&dismissed=0').set(headers);
    expect(inbox.body.find((i) => i.id === created.body.id)).toBeUndefined();

    const still = await request(app).get(`/api/product/insights/${created.body.id}`).set(headers);
    expect(still.status).toBe(200);
    expect(still.body.dismissed_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/insight-capture.test.js --runInBand --forceExit`
Expected: FAIL — `mine.origin_kind` is `undefined`; dismiss returns 404.

- [ ] **Step 3: Stamp the portal insert**

In `backend/routes/portal.js`, change the insert at line 47 to carry origin
columns. The idea's own text is its excerpt — a portal idea has no separate
source row, so `origin_id` is null and `origin_kind` exists purely so the inbox
renders one consistent source chip:

```javascript
    await run(db, `INSERT INTO pb_insights
        (id, title, content, source, customer_id, created_by, origin_kind, origin_excerpt)
      VALUES (?, ?, ?, 'portal', ?, ?, 'portal', ?)`,
      [id, title.trim(), content || '', customerId, req.userId, (content || title).slice(0, 500)]);
```

Read the surrounding lines first — the existing statement's parameter order and
variable names (`customerId`, `req.userId`) must be preserved exactly.

- [ ] **Step 4: Add the dismissed filter and endpoint**

In `backend/routes/product-insights.js`, inside `GET /api/product/insights`,
after the `customer_id` filter:

```javascript
    if (req.query.dismissed !== undefined) {
      clauses.push(Number(req.query.dismissed) ? 'ins.dismissed_at IS NOT NULL' : 'ins.dismissed_at IS NULL');
    }
```

And add this route after the `PUT` route:

```javascript
// POST /api/product/insights/:id/dismiss — triaged as not actionable. Kept, not
// deleted: a dismissed insight is still evidence of what people asked for.
router.post('/product/insights/:id/dismiss', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM pb_insights WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Insight not found' });
    await run(db, "UPDATE pb_insights SET dismissed_at = datetime('now') WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});
```

`datetime('now')` is SQLite syntax that MySQL also accepts via the driver's
translation used elsewhere in this file — confirm by grepping
`datetime('now')` in `backend/routes/` and matching the prevailing pattern.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/insight-capture.test.js --runInBand --forceExit`
Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/portal.js backend/routes/product-insights.js backend/tests/backend/insight-capture.test.js
git commit -m "feat(product): portal origin stamping and inbox dismiss (ATLAS-47)"
```

---

## Task 5: The demand calculation

**Files:**
- Create: `backend/utils/demand.js`
- Test: `backend/tests/backend/product-demand.test.js`

**Interfaces:**
- Produces: `tierMedians(companies)` → `{strategic, growth, standard}`;
  `computeDemand(rows, medians)` → `{demand, breakdown, unattributed}`;
  `demandForFeatures(db, featureIds)` → `Map<featureId, {demand, breakdown, unattributed}>`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/product-demand.test.js`:

```javascript
/**
 * REVENUE-WEIGHTED DEMAND — Epic 48
 * Pure arithmetic first, then the query helper against seeded data.
 */
const { tierMedians, computeDemand } = require('../../utils/demand');

describe('tier medians', () => {
  test('median per tier from companies that have ARR', () => {
    const medians = tierMedians([
      { tier: 'strategic', arr: 1000000 },
      { tier: 'strategic', arr: 3000000 },
      { tier: 'growth', arr: 120000 },
      { tier: 'standard', arr: null },
    ]);
    expect(medians.strategic).toBe(2000000);
    expect(medians.growth).toBe(120000);
    expect(medians.standard).toBe(0);
  });

  test('an even count averages the middle two', () => {
    const medians = tierMedians([
      { tier: 'growth', arr: 100 },
      { tier: 'growth', arr: 200 },
      { tier: 'growth', arr: 300 },
      { tier: 'growth', arr: 500 },
    ]);
    expect(medians.growth).toBe(250);
  });
});

describe('demand', () => {
  const medians = { strategic: 2000000, growth: 120000, standard: 10000 };

  test('sums arr x importance per company', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c1', company_name: 'Northwind', tier: 'strategic', arr: 2400000, importance: 3 },
      { feature_id: 'f1', company_id: 'c2', company_name: 'Initech', tier: 'growth', arr: 100000, importance: 1 },
    ], medians);

    expect(out.demand).toBe(2400000 * 3 + 100000);
    expect(out.breakdown).toHaveLength(2);
    expect(out.breakdown[0].company_name).toBe('Northwind'); // ranked by contribution
    expect(out.breakdown[0].estimated).toBe(false);
  });

  test('null ARR falls back to the tier median and is marked estimated', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c3', company_name: 'Acme', tier: 'growth', arr: null, importance: 2 },
    ], medians);

    expect(out.demand).toBe(120000 * 2);
    expect(out.breakdown[0].estimated).toBe(true);
  });

  test('insights with no company are counted separately, never folded in', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: null, company_name: null, tier: null, arr: null, importance: 3 },
    ], medians);

    expect(out.demand).toBe(0);
    expect(out.unattributed).toBe(1);
    expect(out.breakdown).toHaveLength(0);
  });

  test('several insights from one company accumulate into one breakdown row', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c1', company_name: 'Northwind', tier: 'strategic', arr: 1000000, importance: 1 },
      { feature_id: 'f1', company_id: 'c1', company_name: 'Northwind', tier: 'strategic', arr: 1000000, importance: 2 },
    ], medians);

    expect(out.breakdown).toHaveLength(1);
    expect(out.breakdown[0].insight_count).toBe(2);
    expect(out.demand).toBe(3000000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/product-demand.test.js --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../utils/demand'`

- [ ] **Step 3: Implement**

Create `backend/utils/demand.js`:

```javascript
// ===== REVENUE-WEIGHTED DEMAND =====
// How much revenue asked for a feature, and how emphatically.
//
//   demand = Σ  arr(company) × importance
//
// This is deliberately NOT a replacement for `user_impact` in
// routes/product-features.js, which weights the same evidence by tier on a
// 3/2/1 scale and is the features screen's default sort. That number keeps its
// meaning; this one sits beside it in real currency. Where they disagree — many
// excited small accounts versus one quiet large one — the disagreement is the
// finding.
//
// Computed in JS rather than SQL, following utils/flow.js: the set is bounded
// (the features of one project, all of which the screen fetches anyway) so
// there is no pagination pressure forcing the arithmetic into a WHERE clause.

const TIERS = ['strategic', 'growth', 'standard'];

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Null ARR falls back to the median of its tier, computed from the companies
// that do carry a figure. Keeping one unit throughout is the point: a fallback
// expressed as a small integer would be summed against six-figure ARR values
// and vanish — worse than no fallback, because it looks like it worked.
function tierMedians(companies) {
  const out = {};
  for (const tier of TIERS) {
    const values = companies
      .filter((c) => c.tier === tier && c.arr != null && Number(c.arr) > 0)
      .map((c) => Number(c.arr));
    out[tier] = median(values);
  }
  return out;
}

function computeDemand(rows, medians) {
  const byCompany = new Map();
  let unattributed = 0;

  for (const row of rows) {
    if (!row.company_id) { unattributed += 1; continue; }

    const importance = Number(row.importance) || 1;
    const estimated = row.arr == null || Number(row.arr) <= 0;
    const arr = estimated ? (medians[row.tier] || 0) : Number(row.arr);

    const existing = byCompany.get(row.company_id);
    if (existing) {
      existing.contribution += arr * importance;
      existing.insight_count += 1;
    } else {
      byCompany.set(row.company_id, {
        company_id: row.company_id,
        company_name: row.company_name,
        tier: row.tier,
        arr: estimated ? null : Number(row.arr),
        estimated,
        insight_count: 1,
        contribution: arr * importance,
      });
    }
  }

  const breakdown = [...byCompany.values()].sort((a, b) => b.contribution - a.contribution);
  const demand = breakdown.reduce((sum, b) => sum + b.contribution, 0);
  return { demand, breakdown, unattributed };
}

// One query for every feature asked about, not one per feature.
async function demandForFeatures(db, featureIds) {
  const { queryAll } = require('../database');
  const result = new Map();
  for (const id of featureIds) result.set(id, { demand: 0, breakdown: [], unattributed: 0 });
  if (featureIds.length === 0) return result;

  const companies = await queryAll(db, 'SELECT tier, arr FROM pb_companies', []);
  const medians = tierMedians(companies);

  const placeholders = featureIds.map(() => '?').join(', ');
  const rows = await queryAll(db,
    `SELECT il.feature_id, il.importance,
       co.id as company_id, co.name as company_name, co.tier, co.arr
     FROM pb_insight_links il
     JOIN pb_insights ins ON il.insight_id = ins.id
     LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
     LEFT JOIN pb_companies co ON cu.company_id = co.id
     WHERE il.feature_id IN (${placeholders})`, featureIds);

  for (const id of featureIds) {
    result.set(id, computeDemand(rows.filter((r) => r.feature_id === id), medians));
  }
  return result;
}

module.exports = { tierMedians, computeDemand, demandForFeatures, median };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/product-demand.test.js --runInBand --forceExit`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/demand.js backend/tests/backend/product-demand.test.js
git commit -m "feat(product): revenue-weighted demand calculation (ATLAS-48)"
```

---

## Task 6: Expose demand on the features API

**Files:**
- Modify: `backend/routes/product-features.js`
- Test: `backend/tests/backend/product-demand.test.js`

**Interfaces:**
- Consumes: `demandForFeatures` from Task 5.
- Produces: `demand` (number) and `demand_breakdown` (array) on every feature
  returned by `GET /api/product/features` and `GET /api/product/features/:id`.
  `user_impact` is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/product-demand.test.js`:

```javascript
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

describe('demand on the features API', () => {
  let app, headers;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
  });

  test('features carry demand alongside the untouched user_impact', async () => {
    const res = await request(app).get('/api/product/features').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const f of res.body) {
      expect(f).toHaveProperty('demand');
      expect(f).toHaveProperty('user_impact');
      expect(typeof f.demand).toBe('number');
    }
  });

  test('the single-feature route carries the breakdown', async () => {
    const list = await request(app).get('/api/product/features').set(headers);
    const withEvidence = list.body.find((f) => (f.insight_count || 0) > 0) || list.body[0];
    const res = await request(app).get(`/api/product/features/${withEvidence.id}`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.demand_breakdown)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/product-demand.test.js --runInBand --forceExit`
Expected: FAIL — `expect(f).toHaveProperty('demand')` fails.

- [ ] **Step 3: Implement**

In `backend/routes/product-features.js`, add near the other requires:

```javascript
const { demandForFeatures } = require('../utils/demand');
```

Replace `getEnrichedFeature` (currently at line ~69) with a version that also
attaches demand, and add a list-level helper beside it:

```javascript
async function getEnrichedFeature(db, id) {
  const feature = await queryOne(db, `${ENRICHED_SELECT} WHERE f.id = ?`, [id]);
  if (!feature) return null;
  const demand = await demandForFeatures(db, [id]);
  const d = demand.get(id);
  return { ...withRice(feature), demand: d.demand, demand_breakdown: d.breakdown, demand_unattributed: d.unattributed };
}

// One demand query for the whole list rather than one per feature.
async function withDemand(db, features) {
  const map = await demandForFeatures(db, features.map((f) => f.id));
  return features.map((f) => {
    const d = map.get(f.id) || { demand: 0, breakdown: [], unattributed: 0 };
    return { ...withRice(f), demand: d.demand, demand_breakdown: d.breakdown, demand_unattributed: d.unattributed };
  });
}
```

Then find every place the list route maps `withRice` over results — grep
`withRice(` in this file — and route those through `withDemand(db, rows)`
instead. Leave `USER_IMPACT_SQL` and the `user_impact` column exactly as they
are; this task adds a field and changes nothing existing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/product-demand.test.js --runInBand --forceExit`
Expected: PASS — 8 tests.

- [ ] **Step 5: Run the full suite — product-wave.test.js must not regress**

Run: `cd backend && npm test`
Expected: all green, `product-wave.test.js` included.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/product-features.js backend/tests/backend/product-demand.test.js
git commit -m "feat(product): expose demand and its breakdown on features (ATLAS-48)"
```

---

## Task 7: Frontend types and API client

**Files:**
- Modify: `frontend/src/lib/types.ts:658`
- Modify: `frontend/src/lib/api.ts:362`

**Interfaces:**
- Produces: `PbInsight` gains origin fields; `PbFeature` gains `demand` and
  `demand_breakdown`; `api.product.captureInsight`, `api.product.dismissInsight`.

- [ ] **Step 1: Extend the types**

In `frontend/src/lib/types.ts`, add to `PbInsight` (after `processed`):

```typescript
  origin_kind: 'request' | 'comment' | 'wiki' | 'portal' | 'manual' | null;
  origin_id: string | null;
  origin_excerpt: string | null;
  dismissed_at: string | null;
```

Add above `PbInsight`:

```typescript
export interface PbDemandRow {
  company_id: string;
  company_name: string | null;
  tier: CompanyTier | null;
  arr: number | null;
  estimated: boolean;
  insight_count: number;
  contribution: number;
}
```

And to `PbFeature` (beside `user_impact` at line 708):

```typescript
  demand: number;
  demand_breakdown?: PbDemandRow[];
  demand_unattributed?: number;
```

- [ ] **Step 2: Extend the API client**

In `frontend/src/lib/api.ts`, inside the `product` object beside the existing
insight calls:

```typescript
    captureInsight: (body: {
      origin_kind: 'request' | 'comment' | 'wiki';
      origin_id: string;
      title?: string;
      customer_id?: string;
    }) => post<PbInsight>('/product/insights/capture', body),
    dismissInsight: (id: string) => post<{ ok: boolean }>(`/product/insights/${id}/dismiss`, {}),
```

Extend the existing `insights` call's params type to include the new filter:

```typescript
    insights: (params: { processed?: 0 | 1; dismissed?: 0 | 1; source?: string; customer_id?: string } = {}) => {
```

Read lines 378–382 first and preserve the query-string construction exactly.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat(product): typed capture, dismiss and demand in the API client (ATLAS-47/48)"
```

---

## Task 8: The inbox screen

**Files:**
- Create: `frontend/src/screens/product-inbox.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api.product.insights`, `api.product.dismissInsight`,
  `api.product.linkInsight` from Task 7.

- [ ] **Step 1: Read two existing screens for the house pattern**

Read `frontend/src/screens/product-insights.tsx` in full (294 lines) and
`frontend/src/screens/help-requests.tsx`. The inbox follows their structure
exactly: `PageHeader`, `RowsSkeleton` while loading, `EmptyState` when empty,
shadcn `Table` for rows. Do not invent a new layout idiom.

- [ ] **Step 2: Build the screen**

Create `frontend/src/screens/product-inbox.tsx` with:

- A `useEffect` load of `api.product.insights({ processed: 0, dismissed: 0 })`.
- One table row per insight: `origin_excerpt` (truncated, `title` as fallback),
  a source chip derived from `origin_kind`, `company_name` with its tier badge,
  and relative `created_at`.
- Two row actions: **Link to feature** (reuse the feature picker from
  `product-insights.tsx` — extract it into
  `frontend/src/components/app/feature-picker.tsx` if it is inline, rather than
  copying it) and **Dismiss**, which calls `dismissInsight` and removes the row
  optimistically.
- An `EmptyState` reading "Inbox zero — nothing waiting to be triaged."

- [ ] **Step 3: Route it**

In `frontend/src/App.tsx`, add the lazy import beside the other product screens
and a `/product/inbox` route. Match the existing `lazy(() => import(...))` form
exactly. Add the nav entry wherever the Product group is defined.

- [ ] **Step 4: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/product-inbox.tsx frontend/src/App.tsx frontend/src/components/app/
git commit -m "feat(product): insight inbox screen (ATLAS-47)"
```

---

## Task 9: Capture from a service desk request

**Files:**
- Modify: the agent-facing request/issue detail component — find it with
  `grep -rln "request_type" frontend/src/components/app/`

**Interfaces:**
- Consumes: `api.product.captureInsight` from Task 7.

- [ ] **Step 1: Locate the component**

Run: `grep -rln "request_type\|sd_fields" frontend/src/components/app/ frontend/src/screens/`
Read the component that renders a request for an agent. This is the surface the
epic exists for — an agent reading a customer's problem is the moment feedback
becomes an insight.

- [ ] **Step 2: Add the action**

Add a "Capture as insight" action to the issue detail sheet, shown only when
`issue.type === 'request'`. On click it calls:

```typescript
await api.product.captureInsight({ origin_kind: 'request', origin_id: issue.id });
```

then shows the existing toast on success. Disable the control while in flight
and re-enable on completion. Do not render it for `client` sessions — those
never reach this component, but the guard costs one condition.

- [ ] **Step 3: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(product): capture an insight from a service desk request (ATLAS-47)"
```

---

## Task 10: Demand in the prioritize and features screens

**Files:**
- Modify: `frontend/src/screens/product-features.tsx:26,35,111,144`
- Modify: `frontend/src/components/app/feature-detail-sheet.tsx:127`

- [ ] **Step 1: Add demand as a sort key and column**

In `product-features.tsx`, extend the sort union at line 26:

```typescript
type SortKey = 'user_impact' | 'demand' | 'rice' | 'vote_count';
```

Add the `SelectItem` beside the existing ones at line 111:

```tsx
<SelectItem value="demand">Sort: Demand (ARR)</SelectItem>
```

Add a table column rendering `formatArr(f.demand)` — reuse the `formatArr`
helper already used in `product-customers.tsx:122`; import it rather than
redefining it, extracting it to `frontend/src/lib/format.ts` if it is local to
that screen.

**Leave the default sort as `user_impact`.** Changing what people already sort
by is a separate decision from adding a number they can sort by.

- [ ] **Step 2: Add the "Who asked for this" panel**

In `feature-detail-sheet.tsx`, beside the existing `ScoreTile` for user impact,
add a `ScoreTile` for demand, then a panel listing `demand_breakdown` rows:
company name, tier badge, insight count, contribution formatted as currency, and
an "est." marker where `estimated` is true. Below it, when
`demand_unattributed > 0`, one line: "N insights with no company attached —
not counted."

- [ ] **Step 3: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(product): demand column and who-asked-for-this panel (ATLAS-48)"
```

---

## Task 11: Seed and roadmap

**Files:**
- Modify: `backend/database.js` (demo seed + roadmap epics)
- Modify: `backend/tests/backend/epics.test.js`

- [ ] **Step 1: Update the epic count test**

In `backend/tests/backend/epics.test.js`, change both assertions (lines ~222
and ~231) from the current count to that count **plus two**. Read the file to
get the current number rather than assuming — the service desk wave may have
landed first and moved it.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/backend/epics.test.js --runInBand --forceExit`
Expected: FAIL — received count is two lower than expected.

- [ ] **Step 3: Seed the two epics**

Follow the `taskEpics` block at `backend/database.js:1715` exactly — same shape,
same `forEach` registration below it:

```javascript
  const discoveryEpics = [
    { title: 'Insight capture', color: 'teal',
      desc: 'Turn text that already exists in Atlas — a service desk request, an issue comment, a wiki passage — into a triageable insight, snapshotting the excerpt so evidence survives its source being edited or deleted.',
      children: [
        { title: 'Migration 015: insight origin columns', type: 'task' },
        { title: 'Origin resolution with source-visibility checks', type: 'task' },
        { title: 'Capture endpoint and portal origin stamping', type: 'story' },
        { title: 'Insight inbox with triage and dismiss', type: 'story' },
      ] },
    { title: 'Revenue-weighted demand', color: 'green',
      desc: 'Rank features by the ARR behind them rather than a three-point tier proxy, with a breakdown naming the companies that asked. Sits alongside user_impact rather than redefining it.',
      children: [
        { title: 'Demand calculation with tier-median fallback', type: 'task' },
        { title: 'Demand and breakdown on the features API', type: 'task' },
        { title: 'Demand column and who-asked-for-this panel', type: 'story' },
      ] },
  ];
```

- [ ] **Step 4: Seed demo insights with origins**

In the product demo seed (near `backend/database.js:1977`), add two insights
carrying `origin_kind='request'` and the ids of two seeded help desk requests,
and ensure at least two seeded companies carry distinct `arr` values so demand
ranking differs visibly from `user_impact` ranking on a fresh database. Keep it
behind the existing `SEED_DEMO_DATA` guard.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/database.js backend/tests/backend/epics.test.js
git commit -m "feat(product): seed epics 47-48 and demo insight origins (ATLAS-47/48)"
```

---

## Self-Review

**Spec coverage.** §47.1 migration → Task 1. §47.2 capture points → Tasks 2, 3,
4 (request, comment, wiki; portal stamped rather than rebuilt) and Task 9 (the
UI affordance). §47.3 inbox → Task 8. §48.0 additive-to-`user_impact` → Task 6
step 3 and Task 10 step 1. §48.1 formula with tier-median fallback → Task 5.
§48.2 surfacing → Task 10. Security rule 1 (client 403) → Task 3. Security rule
3 (source visibility) → Task 2. Seeding → Task 11.

**Gap, accepted deliberately:** the spec's §47.2 lists a wiki-selection capture
affordance in the page UI. Tasks 2–4 build and test the backend for it, but no
task wires the frontend control, because the wiki selection surface (epic 31's
comment-on-selection) needs its own investigation to extend safely. Capture from
wiki pages is reachable by API and by the inbox; the in-page control is deferred
to slice 2 rather than half-specified here.

**Not covered, by design:** spec §49–52 belong to later slices.
