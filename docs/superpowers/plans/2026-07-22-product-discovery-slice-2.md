# Product Discovery Slice 2 Implementation Plan (epics 49–50)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give insight volume a structure above the individual row (themes), and
turn a feature plus its evidence into a draft spec page in the wiki.

**Architecture:** A theme is a named grouping of insights, one level above
feedback and one below a feature, created by hand and optionally proposed by the
model. A spec is an ordinary wiki page assembled from data Atlas already holds,
with AI drafting the prose sections when a key is configured. Every AI feature
produces a draft a human accepts; nothing is written to `pb_*` or `wiki_pages`
by the model.

**Tech Stack:** Node 20, Express 4, sql.js / MySQL 8.4, Jest + supertest,
React 18 + TypeScript + shadcn/ui.

## Global Constraints

- **Both dialects, always.** Every migration step carries a `sqlite` and a
  `mysql` form. `backend/migrations.js` is append-only.
- **Migrations continue at `016`.** `012`–`014` stay reserved for the service
  desk wave; `015` shipped in epic 47.
- **Product routes are staff-only** — mounted after `blockClients` in both
  `server.js` and `tests/backend/setup.js`.
- **The app must work with no API key.** `config.ai.enabled()` is false when
  `ANTHROPIC_API_KEY` is unset. Every screen this slice adds has a manual path;
  AI is additive. Never let an AI failure break a non-AI flow.
- **Run jest from `backend/`.** Running it from the repo root produces a
  misleading cascade of parse failures.
- **Verify builds with a bare exit code** — `npm run build > /dev/null 2>&1; echo $?`.
  Piping through `tail` masks the failure, and `tsc -b` catches errors
  `tsc --noEmit` does not.
- **Seeded users:** `kunal@example.com` admin, `priya@example.com` staff
  (`userHeaders()`), `dana@customer.example.com` client. Password `password123`.

## Design decisions this plan settles

The spec leaves three things open. Decisions, with reasons:

1. **Which space a spec page lands in** — the caller names it.
   `POST /product/features/:id/spec` takes `space_id`. The alternatives were a
   global setting (invisible, and wrong the moment a second team wants a
   different space) and defaulting to the first space (silently arbitrary).
2. **`complete()` reuse** — exported from `routes/ai.js` rather than extracted
   to `utils/ai.js`. `routes/wiki.js` exports `pageAccess` and
   `routes/workflows.js` exports `projectStatuses`; routes exporting helpers to
   routes is the established shape here, and a util requiring a route is what
   forced the in-function require in `utils/insight-origin.js`.
3. **Promoting a theme to a feature** — creates the feature and links every
   insight in the theme to it at importance 1, leaving the theme intact. The
   theme is the record of how the feature was arrived at; consuming it would
   destroy that.

## File Structure

**Create:**
- `backend/routes/product-themes.js` — theme CRUD, membership, promotion, suggest
- `backend/utils/spec-draft.js` — assembles the spec body from stored data;
  pure string building, no Express, no model call
- `backend/tests/backend/insight-themes.test.js`
- `backend/tests/backend/feature-spec.test.js`

**Modify:**
- `backend/migrations.js` — `016_insight_themes`, `017_feature_spec_pages`
- `backend/database.js` — base schema, demo seed, roadmap epics
- `backend/routes/ai.js` — export `complete` and `aiEnabled`
- `backend/routes/product-features.js` — the spec endpoint
- `backend/server.js`, `backend/tests/backend/setup.js` — mount the new route
- `frontend/src/lib/types.ts`, `api.ts`, `screens/product-insights.tsx`,
  `components/app/feature-detail-sheet.tsx`

---

## Task 1: Migration 016 — themes

**Files:**
- Modify: `backend/migrations.js`, `backend/database.js`
- Test: `backend/tests/backend/migrations.test.js`

**Interfaces:**
- Produces: tables `pb_themes`, `pb_insight_themes`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/migrations.test.js`:

```javascript
describe('016_insight_themes', () => {
  test('creates the theme tables', async () => {
    const db = await getDb();
    const tables = (await queryAll(db,
      "SELECT name FROM sqlite_master WHERE type='table'")).map((t) => t.name);
    expect(tables).toContain('pb_themes');
    expect(tables).toContain('pb_insight_themes');
  });

  test('is recorded in the migration ledger', async () => {
    const db = await getDb();
    const row = await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['016_insight_themes']);
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/backend/migrations.test.js --runInBand --forceExit`
Expected: FAIL — `expect(tables).toContain('pb_themes')`.

- [ ] **Step 3: Append the migration**

After `015_insight_origins` in `MIGRATIONS`:

```javascript
  {
    id: '016_insight_themes',
    description: 'Themes: a named grouping of insights between feedback and features',
    steps: [
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS pb_themes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            summary TEXT DEFAULT '',
            created_by TEXT REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS pb_themes (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            summary TEXT,
            created_by VARCHAR(36),
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS pb_insight_themes (
            id TEXT PRIMARY KEY,
            insight_id TEXT NOT NULL REFERENCES pb_insights(id),
            theme_id TEXT NOT NULL REFERENCES pb_themes(id),
            UNIQUE(insight_id, theme_id)
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS pb_insight_themes (
            id VARCHAR(36) PRIMARY KEY,
            insight_id VARCHAR(36) NOT NULL,
            theme_id VARCHAR(36) NOT NULL,
            UNIQUE KEY uniq_insight_theme (insight_id, theme_id)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
    ],
  },
```

- [ ] **Step 4: Add both tables to the base schema**

In `backend/database.js`, add the same two `CREATE TABLE IF NOT EXISTS`
statements to the SQLite schema array (beside `pb_insight_links`) and their
MySQL forms to the MySQL array. Read the neighbouring `pb_insight_links` block
and match its column types exactly.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/migrations.test.js --runInBand --forceExit`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations.js backend/database.js backend/tests/backend/migrations.test.js
git commit -m "feat(product): migration 016 — insight themes (ATLAS-49)"
```

---

## Task 2: Theme CRUD and membership

**Files:**
- Create: `backend/routes/product-themes.js`
- Modify: `backend/server.js`, `backend/tests/backend/setup.js`
- Test: `backend/tests/backend/insight-themes.test.js`

**Interfaces:**
- Produces:
  - `GET /api/product/themes` → themes with `insight_count`
  - `POST /api/product/themes` `{name, summary?, insight_ids?}` → 201
  - `GET /api/product/themes/:id` → theme with `insights[]`
  - `PUT /api/product/themes/:id` `{name?, summary?}`
  - `DELETE /api/product/themes/:id` — removes memberships, keeps insights
  - `POST /api/product/themes/:id/insights` `{insight_ids: string[]}`
  - `DELETE /api/product/themes/:id/insights/:insightId`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/backend/insight-themes.test.js`:

```javascript
/**
 * INSIGHT THEMES — Epic 49
 * A theme groups insights one level above feedback and one below a feature.
 * Manual grouping is the product; the AI suggestion in Task 4 only proposes.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');

let app, headers, clientHeaders;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  clientHeaders = await loginAs('dana@customer.example.com', 'password123');
});

async function newInsight(title) {
  const res = await request(app).post('/api/product/insights').set(headers).send({ title });
  return res.body.id;
}

describe('theme CRUD', () => {
  test('creates a theme with initial members and counts them', async () => {
    const a = await newInsight('Export is manual');
    const b = await newInsight('Export takes all morning');

    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Bulk export', summary: 'Repeated asks for exporting in bulk', insight_ids: [a, b] });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Bulk export');

    const list = await request(app).get('/api/product/themes').set(headers);
    const mine = list.body.find((t) => t.id === created.body.id);
    expect(mine.insight_count).toBe(2);
  });

  test('detail returns the member insights', async () => {
    const a = await newInsight('Slow on mobile');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Mobile performance', insight_ids: [a] });

    const detail = await request(app).get(`/api/product/themes/${created.body.id}`).set(headers);
    expect(detail.status).toBe(200);
    expect(detail.body.insights).toHaveLength(1);
    expect(detail.body.insights[0].title).toBe('Slow on mobile');
  });

  test('adding the same insight twice does not duplicate it', async () => {
    const a = await newInsight('Duplicate me');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Dupes', insight_ids: [a] });

    const again = await request(app).post(`/api/product/themes/${created.body.id}/insights`).set(headers)
      .send({ insight_ids: [a] });
    expect(again.status).toBe(200);

    const detail = await request(app).get(`/api/product/themes/${created.body.id}`).set(headers);
    expect(detail.body.insights).toHaveLength(1);
  });

  test('deleting a theme keeps its insights', async () => {
    const a = await newInsight('Survivor');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Doomed', insight_ids: [a] });

    await request(app).delete(`/api/product/themes/${created.body.id}`).set(headers);

    const insight = await request(app).get(`/api/product/insights/${a}`).set(headers);
    expect(insight.status).toBe(200);
  });

  test('rejects a theme with no name', async () => {
    const res = await request(app).post('/api/product/themes').set(headers).send({ name: '  ' });
    expect(res.status).toBe(400);
  });

  test('a client cannot reach theme endpoints', async () => {
    const res = await request(app).get('/api/product/themes').set(clientHeaders);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/insight-themes.test.js --runInBand --forceExit`
Expected: FAIL — 404 from every theme route.

- [ ] **Step 3: Implement the route file**

Create `backend/routes/product-themes.js`:

```javascript
// ===== PRODUCT: THEMES =====
// A theme is a named grouping of insights — one level above an individual piece
// of feedback, one below a feature. It exists because `pb_insights.processed` is
// a boolean: two hundred insights is two hundred rows with no notion that
// fourteen of them are the same request.
//
// Grouping is manual and works with no API key. routes/ai.js only ever proposes
// groupings; confirming one comes through these endpoints.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

const THEME_SELECT = `
  SELECT t.*, u.name as created_by_name,
    (SELECT COUNT(*) FROM pb_insight_themes it WHERE it.theme_id = t.id) as insight_count
  FROM pb_themes t
  LEFT JOIN users u ON t.created_by = u.id`;

// Membership is idempotent: adding an insight already in the theme is a no-op
// rather than an error, so a retried request cannot fail halfway.
async function addMembers(db, themeId, insightIds) {
  for (const insightId of insightIds || []) {
    if (!insightId) continue;
    const insight = await queryOne(db, 'SELECT id FROM pb_insights WHERE id = ?', [insightId]);
    if (!insight) continue;
    const dup = await queryOne(db,
      'SELECT id FROM pb_insight_themes WHERE theme_id = ? AND insight_id = ?', [themeId, insightId]);
    if (dup) continue;
    await run(db, 'INSERT INTO pb_insight_themes (id, insight_id, theme_id) VALUES (?, ?, ?)',
      [uuidv4(), insightId, themeId]);
  }
}

// GET /api/product/themes
router.get('/product/themes', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    res.json(await queryAll(db, `${THEME_SELECT} ORDER BY t.created_at DESC`, []));
  } catch (e) { serverError(res, e); }
});

// POST /api/product/themes
router.post('/product/themes', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, summary, insight_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

    const id = uuidv4();
    await run(db, 'INSERT INTO pb_themes (id, name, summary, created_by) VALUES (?, ?, ?, ?)',
      [id, name.trim(), summary || '', req.userId]);
    await addMembers(db, id, insight_ids);

    res.status(201).json(await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [id]));
  } catch (e) { serverError(res, e); }
});

// GET /api/product/themes/:id
router.get('/product/themes/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const theme = await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [req.params.id]);
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    theme.insights = await queryAll(db,
      `SELECT i.id, i.title, i.origin_kind, i.origin_excerpt, i.source, i.created_at
       FROM pb_insight_themes it JOIN pb_insights i ON it.insight_id = i.id
       WHERE it.theme_id = ? ORDER BY i.created_at DESC`, [req.params.id]);
    res.json(theme);
  } catch (e) { serverError(res, e); }
});

// PUT /api/product/themes/:id
router.put('/product/themes/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM pb_themes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Theme not found' });
    const { name, summary } = req.body;
    await run(db, 'UPDATE pb_themes SET name = ?, summary = ? WHERE id = ?',
      [name !== undefined ? name : existing.name,
       summary !== undefined ? summary : existing.summary,
       req.params.id]);
    res.json(await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [req.params.id]));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/themes/:id — drops the grouping, never the insights.
router.delete('/product/themes/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_insight_themes WHERE theme_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_themes WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// POST /api/product/themes/:id/insights
router.post('/product/themes/:id/insights', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const theme = await queryOne(db, 'SELECT id FROM pb_themes WHERE id = ?', [req.params.id]);
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    await addMembers(db, req.params.id, req.body.insight_ids);
    res.json(await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [req.params.id]));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/themes/:id/insights/:insightId
router.delete('/product/themes/:id/insights/:insightId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_insight_themes WHERE theme_id = ? AND insight_id = ?',
      [req.params.id, req.params.insightId]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
```

- [ ] **Step 4: Mount it in BOTH places**

In `backend/server.js`, beside the other product route requires:

```javascript
const productThemesRoutes = require('./routes/product-themes');
```

and beside the other product mounts (**after** `app.use('/api', blockClients)`):

```javascript
app.use('/api', productThemesRoutes);
```

In `backend/tests/backend/setup.js`, beside the other product mounts:

```javascript
  testApp.use('/api', require('../../routes/product-themes'));
```

A route mounted in only one place passes tests and 404s in production, or the
reverse.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/insight-themes.test.js --runInBand --forceExit`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/product-themes.js backend/server.js backend/tests/backend/setup.js backend/tests/backend/insight-themes.test.js
git commit -m "feat(product): theme CRUD and membership (ATLAS-49)"
```

---

## Task 3: Promote a theme to a feature

**Files:**
- Modify: `backend/routes/product-themes.js`
- Test: `backend/tests/backend/insight-themes.test.js`

**Interfaces:**
- Produces: `POST /api/product/themes/:id/promote` `{project_id}` → 201 with the
  created feature.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/insight-themes.test.js`:

```javascript
describe('promotion', () => {
  test('promoting creates a feature linked to every insight in the theme', async () => {
    const a = await newInsight('Wants SSO');
    const b = await newInsight('Blocked without SSO');
    const theme = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Single sign-on', summary: 'Enterprise auth', insight_ids: [a, b] });

    const projects = await request(app).get('/api/projects').set(headers);
    const promoted = await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers)
      .send({ project_id: projects.body[0].id });

    expect(promoted.status).toBe(201);
    expect(promoted.body.name).toBe('Single sign-on');

    const feature = await request(app).get(`/api/product/features/${promoted.body.id}`).set(headers);
    expect(feature.body.insight_count).toBe(2);
  });

  test('the theme survives promotion — it records how the feature was arrived at', async () => {
    const a = await newInsight('Keeps the receipt');
    const theme = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Receipts', insight_ids: [a] });
    const projects = await request(app).get('/api/projects').set(headers);

    await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers)
      .send({ project_id: projects.body[0].id });

    const still = await request(app).get(`/api/product/themes/${theme.body.id}`).set(headers);
    expect(still.status).toBe(200);
    expect(still.body.insights).toHaveLength(1);
  });

  test('promoting an empty theme is a 400 rather than an orphan feature', async () => {
    const theme = await request(app).post('/api/product/themes').set(headers).send({ name: 'Empty' });
    const projects = await request(app).get('/api/projects').set(headers);
    const res = await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers)
      .send({ project_id: projects.body[0].id });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/insight-themes.test.js --runInBand --forceExit`
Expected: FAIL — 404 on promote.

- [ ] **Step 3: Implement**

Add to `backend/routes/product-themes.js`, before `module.exports`:

```javascript
// POST /api/product/themes/:id/promote — turn a theme into a feature, carrying
// its evidence across. The theme is left intact: it is the record of how the
// feature was arrived at, and consuming it would destroy that.
router.post('/product/themes/:id/promote', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const theme = await queryOne(db, 'SELECT * FROM pb_themes WHERE id = ?', [req.params.id]);
    if (!theme) return res.status(404).json({ error: 'Theme not found' });

    const members = await queryAll(db,
      'SELECT insight_id FROM pb_insight_themes WHERE theme_id = ?', [req.params.id]);
    if (members.length === 0) {
      return res.status(400).json({ error: 'Theme has no insights to promote' });
    }

    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [project_id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const featureId = uuidv4();
    await run(db,
      `INSERT INTO pb_features (id, project_id, name, description, status, created_by)
       VALUES (?, ?, ?, ?, 'idea', ?)`,
      [featureId, project_id, theme.name, theme.summary || '', req.userId]);

    // Importance 1: the grouping says these are the same ask, not how loudly
    // each was made. A PM grades individual evidence afterwards.
    for (const m of members) {
      await run(db,
        `INSERT INTO pb_insight_links (id, insight_id, feature_id, importance, created_by)
         VALUES (?, ?, ?, 1, ?)`,
        [uuidv4(), m.insight_id, featureId, req.userId]);
      await run(db, 'UPDATE pb_insights SET processed = 1 WHERE id = ?', [m.insight_id]);
    }

    res.status(201).json({ id: featureId, name: theme.name, insight_count: members.length });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/insight-themes.test.js --runInBand --forceExit`
Expected: PASS — 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/product-themes.js backend/tests/backend/insight-themes.test.js
git commit -m "feat(product): promote a theme to a feature carrying its evidence (ATLAS-49)"
```

---

## Task 4: AI theme suggestions

**Files:**
- Modify: `backend/routes/ai.js` (export `complete`, `aiEnabled`)
- Modify: `backend/routes/product-themes.js`
- Test: `backend/tests/backend/insight-themes.test.js`

**Interfaces:**
- Consumes: `complete({model, system, user, maxTokens})` and `aiEnabled()` from
  `routes/ai.js`.
- Produces: `POST /api/product/themes/suggest` → `{enabled, suggestions: [{name, summary, insight_ids}]}`.
  **Writes nothing.**

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/insight-themes.test.js`:

```javascript
describe('AI suggestions', () => {
  test('reports disabled and writes nothing when no API key is configured', async () => {
    // The suite runs without ANTHROPIC_API_KEY, so this is the real path for
    // any deployment that has not configured a key — and it must not 500.
    const before = await request(app).get('/api/product/themes').set(headers);

    const res = await request(app).post('/api/product/themes/suggest').set(headers).send({});
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.suggestions).toEqual([]);

    const after = await request(app).get('/api/product/themes').set(headers);
    expect(after.body.length).toBe(before.body.length);
  });

  test('a client cannot reach the suggest endpoint', async () => {
    const res = await request(app).post('/api/product/themes/suggest').set(clientHeaders).send({});
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/insight-themes.test.js --runInBand --forceExit`
Expected: FAIL — 404 on suggest.

- [ ] **Step 3: Export the AI helpers**

At the bottom of `backend/routes/ai.js`, replace `module.exports = router;` with:

```javascript
module.exports = router;
// Exported for routes that need a model call without duplicating the client,
// refusal handling, or model selection. Same shape as routes/wiki.js exporting
// pageAccess and routes/workflows.js exporting projectStatuses.
module.exports.complete = complete;
module.exports.aiEnabled = () => config.ai.enabled();
module.exports.MODELS = MODELS;
```

- [ ] **Step 4: Implement the suggest endpoint**

In `backend/routes/product-themes.js`, add the require at the top:

```javascript
const { complete, aiEnabled, MODELS } = require('./ai');
```

and this route **before** `router.get('/product/themes/:id', ...)`, or `:id`
will match `suggest`:

```javascript
// How many insights one suggest call may consider. A bounded batch keeps the
// prompt bounded — an inbox with two thousand rows must not build a two
// thousand row prompt.
const SUGGEST_BATCH = 40;
const SUGGEST_EXCERPT = 240;

// POST /api/product/themes/suggest — proposes groupings over untriaged
// insights. Writes NOTHING: the PM edits and confirms through POST
// /product/themes, which is the only path that creates a theme.
router.post('/product/themes/suggest', requireAuth, async (req, res) => {
  try {
    if (!aiEnabled()) return res.json({ enabled: false, suggestions: [] });

    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT id, title, origin_excerpt, content FROM pb_insights
       WHERE processed = 0 AND dismissed_at IS NULL
       ORDER BY created_at DESC LIMIT ?`, [SUGGEST_BATCH]);
    if (rows.length < 2) return res.json({ enabled: true, suggestions: [] });

    const catalogue = rows.map((r) =>
      `${r.id} :: ${r.title} :: ${String(r.origin_excerpt || r.content || '').slice(0, SUGGEST_EXCERPT)}`
    ).join('\n');

    const raw = await complete({
      model: MODELS.summary,
      maxTokens: 1500,
      system: 'You group customer feedback into themes. Reply with JSON only: '
        + '{"themes":[{"name":"...","summary":"...","insight_ids":["..."]}]}. '
        + 'Use only ids from the input. Omit an insight rather than forcing it into a theme. '
        + 'A theme needs at least two insights. No preamble, no code fences.',
      user: `Group these insights. Each line is "id :: title :: excerpt".\n\n${catalogue}`,
    });

    // The model's output is untrusted: parse defensively, keep only ids that
    // were in the batch, and drop anything malformed rather than 500ing.
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
    } catch {
      return res.json({ enabled: true, suggestions: [], error: 'Could not parse the suggestion' });
    }

    const valid = new Set(rows.map((r) => r.id));
    const suggestions = (Array.isArray(parsed.themes) ? parsed.themes : [])
      .map((t) => ({
        name: String(t.name || '').slice(0, 200),
        summary: String(t.summary || '').slice(0, 1000),
        insight_ids: (Array.isArray(t.insight_ids) ? t.insight_ids : []).filter((id) => valid.has(id)),
      }))
      .filter((t) => t.name && t.insight_ids.length >= 2);

    res.json({ enabled: true, suggestions });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/insight-themes.test.js --runInBand --forceExit`
Expected: PASS — 11 tests.

- [ ] **Step 6: Run the full suite**

Run: `cd backend && npm test`
Expected: all green, `ai.test.js` included.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/ai.js backend/routes/product-themes.js backend/tests/backend/insight-themes.test.js
git commit -m "feat(product): AI theme suggestions that propose and never write (ATLAS-49)"
```

---

## Task 5: Spec assembly

**Files:**
- Create: `backend/utils/spec-draft.js`
- Test: `backend/tests/backend/feature-spec.test.js`

**Interfaces:**
- Produces: `buildSpecBody({feature, objectives, evidence, demandBreakdown})` → HTML string.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/feature-spec.test.js`:

```javascript
/**
 * FEATURE SPEC DRAFTING — Epic 50
 * Assembly is pure and works with no API key; the model only adds prose.
 */
const { buildSpecBody } = require('../../utils/spec-draft');

describe('spec assembly', () => {
  const feature = { name: 'Bulk CSV export', description: 'Export issues in bulk.' };

  test('includes the feature name, description, evidence and demand', () => {
    const html = buildSpecBody({
      feature,
      objectives: [{ name: 'Reduce churn' }],
      evidence: [{ quote: 'exporting by hand every Monday', importance: 3, company_name: 'Acme Corp' }],
      demandBreakdown: [{ company_name: 'Acme Corp', contribution: 750000, estimated: false }],
    });

    expect(html).toContain('Bulk CSV export');
    expect(html).toContain('Export issues in bulk.');
    expect(html).toContain('Reduce churn');
    expect(html).toContain('exporting by hand every Monday');
    expect(html).toContain('Acme Corp');
  });

  test('escapes evidence so a quote cannot inject markup', () => {
    const html = buildSpecBody({
      feature,
      objectives: [],
      evidence: [{ quote: '<img src=x onerror=alert(1)>', importance: 1, company_name: null }],
      demandBreakdown: [],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('a feature with no evidence still produces a usable skeleton', () => {
    const html = buildSpecBody({ feature, objectives: [], evidence: [], demandBreakdown: [] });
    expect(html).toContain('Bulk CSV export');
    expect(html).toContain('No evidence linked yet');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/feature-spec.test.js --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../utils/spec-draft'`

- [ ] **Step 3: Implement**

Create `backend/utils/spec-draft.js`:

```javascript
// ===== FEATURE SPEC ASSEMBLY =====
// Turns what the database already knows about a feature into a wiki page body.
// Deliberately pure and model-free: assembly is the part that always works, and
// a deployment with no ANTHROPIC_API_KEY still gets a spec worth editing. The
// AI draft in routes/product-features.js layers prose on top of this.

// Evidence is customer-authored text arriving from insights and quotes. It goes
// into a wiki page that renders HTML, so it is escaped here rather than trusted.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

function buildSpecBody({ feature, objectives = [], evidence = [], demandBreakdown = [] }) {
  const parts = [];

  parts.push(`<h1>${esc(feature.name)}</h1>`);
  if (feature.description) parts.push(`<p>${esc(feature.description)}</p>`);

  parts.push('<h2>Problem</h2>');
  parts.push('<p><em>What is broken today, in the customer\'s terms.</em></p>');

  parts.push('<h2>Evidence</h2>');
  if (evidence.length === 0) {
    parts.push('<p>No evidence linked yet — link insights to this feature and regenerate.</p>');
  } else {
    parts.push('<ul>');
    for (const e of evidence) {
      const who = e.company_name ? ` — ${esc(e.company_name)}` : '';
      parts.push(`<li>“${esc(e.quote || '')}”${who} <em>(importance ${Number(e.importance) || 1})</em></li>`);
    }
    parts.push('</ul>');
  }

  if (demandBreakdown.length > 0) {
    parts.push('<h2>Demand</h2><ul>');
    for (const d of demandBreakdown) {
      const est = d.estimated ? ' (estimated)' : '';
      parts.push(`<li>${esc(d.company_name || 'Unknown')} — ${money(d.contribution)}${est}</li>`);
    }
    parts.push('</ul>');
  }

  if (objectives.length > 0) {
    parts.push('<h2>Objectives</h2><ul>');
    for (const o of objectives) parts.push(`<li>${esc(o.name)}</li>`);
    parts.push('</ul>');
  }

  parts.push('<h2>Proposed solution</h2>');
  parts.push('<p><em>How this gets solved.</em></p>');
  parts.push('<h2>Open questions</h2>');
  parts.push('<ul><li><em>What still needs deciding?</em></li></ul>');

  return parts.join('\n');
}

module.exports = { buildSpecBody, esc, money };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/feature-spec.test.js --runInBand --forceExit`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/spec-draft.js backend/tests/backend/feature-spec.test.js
git commit -m "feat(product): assemble a feature spec body from stored data (ATLAS-50)"
```

---

## Task 6: Migration 017 and the spec endpoint

**Files:**
- Modify: `backend/migrations.js`, `backend/database.js`, `backend/routes/product-features.js`
- Test: `backend/tests/backend/feature-spec.test.js`

**Interfaces:**
- Consumes: `buildSpecBody` (Task 5), `complete`/`aiEnabled` (Task 4).
- Produces: `pb_features.spec_page_id`; `POST /api/product/features/:id/spec` `{space_id}` → 201 `{page_id, url_slug}`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/feature-spec.test.js`:

```javascript
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

describe('spec endpoint', () => {
  let app, headers, featureId, spaceId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    const features = await request(app).get('/api/product/features').set(headers);
    featureId = features.body[0].id;
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    spaceId = spaces.body[0].id;
  });

  test('creates a wiki page and links it both ways', async () => {
    const res = await request(app).post(`/api/product/features/${featureId}/spec`).set(headers)
      .send({ space_id: spaceId });
    expect(res.status).toBe(201);
    expect(res.body.page_id).toBeTruthy();

    const page = await request(app).get(`/api/wiki/pages/${res.body.page_id}`).set(headers);
    expect(page.status).toBe(200);
    expect(page.body.body).toContain('<h2>Evidence</h2>');

    const feature = await request(app).get(`/api/product/features/${featureId}`).set(headers);
    expect(feature.body.spec_page_id).toBe(res.body.page_id);
  });

  test('a second call returns the existing page rather than duplicating it', async () => {
    const again = await request(app).post(`/api/product/features/${featureId}/spec`).set(headers)
      .send({ space_id: spaceId });
    expect(again.status).toBe(200);

    const feature = await request(app).get(`/api/product/features/${featureId}`).set(headers);
    expect(again.body.page_id).toBe(feature.body.spec_page_id);
  });

  test('requires a space', async () => {
    const features = await request(app).get('/api/product/features').set(headers);
    const other = features.body.find((f) => f.id !== featureId);
    const res = await request(app).post(`/api/product/features/${other.id}/spec`).set(headers).send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest tests/backend/feature-spec.test.js --runInBand --forceExit`
Expected: FAIL — 404 on the spec route.

- [ ] **Step 3: Add migration 017 and the base-schema column**

In `backend/migrations.js`, after `016_insight_themes`:

```javascript
  {
    id: '017_feature_spec_pages',
    description: 'Link a feature to its spec page in the wiki',
    steps: [{
      addColumn: {
        table: 'pb_features', column: 'spec_page_id',
        sqlite: 'ALTER TABLE pb_features ADD COLUMN spec_page_id TEXT',
        mysql: 'ALTER TABLE pb_features ADD COLUMN spec_page_id VARCHAR(36) NULL',
      },
    }],
  },
```

In `backend/database.js`, add `spec_page_id TEXT` (SQLite) and
`spec_page_id VARCHAR(36)` (MySQL) to both `pb_features` blocks.

- [ ] **Step 4: Implement the endpoint**

In `backend/routes/product-features.js`, add requires:

```javascript
const { buildSpecBody } = require('../utils/spec-draft');
const { complete, aiEnabled, MODELS } = require('./ai');
```

Then add the route. Read how `routes/wiki.js` inserts a page (`POST
/wiki/spaces/:spaceId/pages`) and reuse the same column set and slug derivation
rather than inventing one — grep `INSERT INTO wiki_pages` and match it exactly.

```javascript
// POST /api/product/features/:id/spec — draft a spec page in the wiki from what
// the database already knows. Idempotent: a feature has one spec page, and a
// second call returns it rather than making another.
//
// Assembly always works. The model, when configured, adds prose on top — and if
// it fails the page is still created, because a spec skeleton beats an error.
router.post('/product/features/:id/spec', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });

    if (feature.spec_page_id) {
      const existing = await queryOne(db, 'SELECT id FROM wiki_pages WHERE id = ?', [feature.spec_page_id]);
      if (existing) return res.json({ page_id: feature.spec_page_id, created: false });
    }

    const { space_id } = req.body;
    if (!space_id) return res.status(400).json({ error: 'space_id required' });
    const space = await queryOne(db, 'SELECT id FROM wiki_spaces WHERE id = ?', [space_id]);
    if (!space) return res.status(404).json({ error: 'Space not found' });

    const objectives = await queryAll(db,
      `SELECT o.name FROM pb_feature_objectives fo JOIN pb_objectives o ON fo.objective_id = o.id
       WHERE fo.feature_id = ?`, [req.params.id]);
    const evidence = await queryAll(db,
      `SELECT il.quote, il.importance, co.name as company_name
       FROM pb_insight_links il
       JOIN pb_insights ins ON il.insight_id = ins.id
       LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
       LEFT JOIN pb_companies co ON cu.company_id = co.id
       WHERE il.feature_id = ? ORDER BY il.importance DESC`, [req.params.id]);
    const demandMap = await demandForFeatures(db, [req.params.id]);

    let body = buildSpecBody({
      feature,
      objectives,
      evidence,
      demandBreakdown: demandMap.get(req.params.id).breakdown,
    });

    if (aiEnabled()) {
      try {
        const drafted = await complete({
          model: MODELS.write,
          maxTokens: 2000,
          system: 'You draft product specs. Given an assembled spec skeleton, rewrite the '
            + 'Problem, Proposed solution and Open questions sections using the evidence '
            + 'present. Keep every heading and the Evidence, Demand and Objectives sections '
            + 'exactly as given. Reply with HTML only, no code fences.',
          user: body,
        });
        if (drafted && drafted.includes('<h1>')) body = drafted;
      } catch {
        // Model unavailable or refused — keep the assembled skeleton. A spec
        // you can edit beats an error, and the caller never asked for AI.
      }
    }

    const pageId = uuidv4();
    const slug = String(feature.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await run(db,
      `INSERT INTO wiki_pages (id, space_id, title, slug, body, body_format, status, author_id)
       VALUES (?, ?, ?, ?, ?, 'html', 'current', ?)`,
      [pageId, space_id, `Spec: ${feature.name}`, `spec-${slug}`, body, req.userId]);
    await run(db, 'UPDATE pb_features SET spec_page_id = ? WHERE id = ?', [pageId, req.params.id]);

    res.status(201).json({ page_id: pageId, created: true });
  } catch (e) { serverError(res, e); }
});
```

**Before running:** confirm the `wiki_pages` column list above matches the real
schema (`grep -A 20 "CREATE TABLE IF NOT EXISTS wiki_pages" backend/database.js`).
If the table requires columns this insert omits, add them — do not drop the
NOT NULL ones.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backend/feature-spec.test.js --runInBand --forceExit`
Expected: PASS — 6 tests.

- [ ] **Step 6: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations.js backend/database.js backend/routes/product-features.js backend/tests/backend/feature-spec.test.js
git commit -m "feat(product): draft a feature spec page in the wiki (ATLAS-50)"
```

---

## Task 7: Frontend — themes and the spec chip

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`
- Modify: `frontend/src/screens/product-insights.tsx`
- Modify: `frontend/src/components/app/feature-detail-sheet.tsx`

- [ ] **Step 1: Types and client**

Add to `types.ts`:

```typescript
export interface PbTheme {
  id: string;
  name: string;
  summary: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
  insight_count: number;
  insights?: Pick<PbInsight, 'id' | 'title' | 'origin_kind' | 'origin_excerpt' | 'source' | 'created_at'>[];
}

export interface PbThemeSuggestion {
  name: string;
  summary: string;
  insight_ids: string[];
}
```

Add `spec_page_id: string | null;` to `PbFeature`.

Add to the `product` block of `api.ts`:

```typescript
    themes: () => get<PbTheme[]>('/product/themes'),
    theme: (id: string) => get<PbTheme>(`/product/themes/${id}`),
    createTheme: (body: { name: string; summary?: string; insight_ids?: string[] }) =>
      post<PbTheme>('/product/themes', body),
    removeTheme: (id: string) => del<{ ok: boolean }>(`/product/themes/${id}`),
    addToTheme: (id: string, insight_ids: string[]) =>
      post<PbTheme>(`/product/themes/${id}/insights`, { insight_ids }),
    promoteTheme: (id: string, project_id: string) =>
      post<{ id: string; name: string; insight_count: number }>(`/product/themes/${id}/promote`, { project_id }),
    suggestThemes: () =>
      post<{ enabled: boolean; suggestions: PbThemeSuggestion[] }>('/product/themes/suggest', {}),
    draftSpec: (featureId: string, space_id: string) =>
      post<{ page_id: string; created: boolean }>(`/product/features/${featureId}/spec`, { space_id }),
```

- [ ] **Step 2: Themes tab on the insights screen**

Add a fourth tab, **Themes**, listing themes with their insight counts. Each row
opens the theme in the existing right-hand detail panel, showing its member
insights and two actions: **Promote to feature** (project picker, reuses
`useProjects`) and **Remove**.

In the Inbox tab, add multi-select checkboxes and a **Group into theme** action
that opens a dialog for name and summary, calling `createTheme` with the
selected ids. This is the manual path and must work with no API key.

Add a **Suggest themes** button that calls `suggestThemes()`. When
`enabled === false`, do not render the button at all — an always-disabled
control is worse than no control. When suggestions come back, show each as an
editable proposal the PM confirms into `createTheme`; nothing is written until
they do.

- [ ] **Step 3: Spec chip on the feature sheet**

In `feature-detail-sheet.tsx`, add a **Spec** row: when `feature.spec_page_id`
is set, a chip linking to `/wiki/pages/:id`; when it is not, a **Draft spec**
button that asks for a space (reuse the wiki space list) and calls `draftSpec`.

- [ ] **Step 4: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit` then `npm run build > /dev/null 2>&1; echo $?`
Expected: `0` from both. `tsc -b` inside `npm run build` is the stricter check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(product): themes tab, suggestions and the spec chip (ATLAS-49/50)"
```

---

## Task 8: Seed and roadmap

**Files:**
- Modify: `backend/database.js`, `backend/tests/backend/epics.test.js`

- [ ] **Step 1: Bump the epic count**

In `backend/tests/backend/epics.test.js`, change both assertions from 43 to 45.
Read the file first — do not assume the current number.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/backend/epics.test.js --runInBand --forceExit`
Expected: FAIL — received 43, expected 45.

- [ ] **Step 3: Seed the epics**

Follow the `discoveryEpics` block added in epic 47/48 exactly — same shape, same
`forEach`, `epicWindow(43 + i)`, `board_order: 43 + i`:

```javascript
  const discoverySlice2Epics = [
    { title: 'Theme clustering', color: 'blue',
      desc: 'A named grouping of insights between feedback and features, so two hundred insights stop being two hundred rows. Grouping is manual and works with no API key; the model only ever proposes.',
      children: [
        { title: 'Migration 016: theme tables', type: 'task' },
        { title: 'Theme CRUD and membership', type: 'story' },
        { title: 'Promote a theme to a feature carrying its evidence', type: 'story' },
        { title: 'AI suggestions that propose and never write', type: 'task' },
      ] },
    { title: 'Spec drafting', color: 'orange',
      desc: 'Turn a feature and its evidence into a draft spec page in the wiki. Assembly is pure and always works; the model adds prose when configured, and a model failure still leaves an editable skeleton.',
      children: [
        { title: 'Spec assembly from stored data', type: 'task' },
        { title: 'Migration 017 and the spec endpoint', type: 'story' },
        { title: 'Spec chip on the feature detail sheet', type: 'task' },
      ] },
  ];
```

- [ ] **Step 4: Seed a demo theme**

Group the two seeded export-related insights into a "Bulk export" theme so the
Themes tab is not empty on a fresh database. Behind `SEED_DEMO_DATA`.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/database.js backend/tests/backend/epics.test.js
git commit -m "feat(product): seed epics 49-50 and a demo theme (ATLAS-49/50)"
```

---

## Self-Review

**Spec coverage.** §49.1 migration → Task 1. §49.2 manual-first grouping →
Task 2 (CRUD) and Task 7 step 2 (multi-select); AI suggest → Task 4. Theme
promotion → Task 3. §50.1 `spec_page_id` → Task 6. §50.2 assembly → Task 5;
AI drafting and the two-way link → Tasks 6 and 7 step 3. Seeding → Task 8.

**Gaps, accepted deliberately:**

- **§49.3 trends** (theme volume over time) is not built. It needs a chart
  surface and is worth nothing until themes have accumulated history, which a
  fresh install does not have. Deferred rather than shipped empty.
- **Spec regeneration.** The endpoint is idempotent — a second call returns the
  existing page. Regenerating after new evidence arrives would mean overwriting
  a page a human has since edited, which needs its own decision about version
  history. Out of scope here.

**Type consistency check.** `buildSpecBody({feature, objectives, evidence,
demandBreakdown})` is called with exactly those four keys in Task 6.
`complete({model, system, user, maxTokens})` matches `routes/ai.js:59`.
`demandForFeatures(db, ids)` returns a `Map`, and Task 6 calls `.get(id).breakdown`
— matching `utils/demand.js`.
