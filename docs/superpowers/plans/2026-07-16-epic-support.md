# Epic Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `epic` a first-class issue type in Atlas — hierarchy via the existing `parent_id` column, a new Epics screen, epic badges on board/backlog, and a seeded "Atlas Development" project dogfooding the 12-epic parity roadmap.

**Architecture:** An epic is a regular row in `issues` with `type='epic'`; children link via `issues.parent_id`. Validation lives in the API (`backend/routes/issues.js`), not the DB. All issue reads funnel through `enrichIssue()`, so joining the parent epic there propagates `epic_key/epic_title/epic_badge_color` to every endpoint at once. The frontend picks up the new type automatically through the shared registries in `lib/domain.tsx`.

**Tech Stack:** Express 5 + sql.js (SQLite) / mysql2, Jest + supertest, Vite + React 18 + TypeScript + Tailwind v4 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-16-epic-support-design.md`

## Global Constraints

- Hierarchy rule: `parent_id` may only point to an issue of type `epic` in the same project; epics themselves may not have a `parent_id` or a `sprint_id`.
- Deleting an epic orphans its children (`parent_id → NULL`), never cascade-deletes them.
- Epic badge colors are the 8 named colors: `purple, blue, teal, green, yellow, orange, red, pink`; DB default `'purple'`.
- Epics never appear as board cards, backlog rows, or sprint members.
- Backend tests run from `backend/`: `npm run test:backend`. Frontend has no unit-test harness — verify with `npm run lint` (tsc) from `frontend/`, plus the end-to-end check in Task 9.
- Every backend change must work on both drivers: SQLite schema block AND MySQL schema block in `backend/database.js`, with idempotent ALTERs for existing databases (the codebase has no migration framework).
- Commit after every task. Do not commit `backend/data.db`; `frontend/build/` is committed only in Task 9.
- Naming note (deliberate deviation from the spec): the parent epic's color joins onto child issues as `epic_badge_color`, not `epic_color` — `epic_color` is the issue's OWN column (meaningful on epics). Do not rename either.

---

### Task 1: Backend — `epic_color` column, hierarchy validation, parent join

**Files:**
- Modify: `backend/database.js` (SQLite issues schema ~line 82–104, MySQL issues schema ~line 325–347, `initSqlite()` ~line 495, `initMysqlSchema()` ~line 559)
- Modify: `backend/routes/issues.js` (whole file is 182 lines; touch `enrichIssue`, POST, PUT, move)
- Test: `backend/tests/backend/epics.test.js` (new)

**Interfaces:**
- Consumes: existing `queryOne/queryAll/run` helpers from `../database`; existing test helpers `createTestApp, adminHeaders` from `./setup`.
- Produces: every issue payload now carries `epic_key: string|null`, `epic_title: string|null`, `epic_badge_color: string|null` (from the parent epic) and its own `epic_color` column. `POST /api/projects/:projectId/issues` and `PUT /api/issues/:id` accept `parent_id` and `epic_color`. Internal helper `validateHierarchy(db, { id, projectId, type, parentId, sprintId }) → string|null` (error message or null).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/backend/epics.test.js`:

```js
/**
 * EPIC SUPPORT TESTS — hierarchy validation, parent join, epic_color
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId, otherProjectId;

async function createIssue(body, pid = projectId) {
  const res = await request(app).post(`/api/projects/${pid}/issues`).set(headers).send(body);
  return res;
}

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  // Select by key, not index: the projects list is ORDER BY created_at and all
  // seed rows share one timestamp, so index order is not guaranteed once the
  // ATLAS project is seeded (Task 3). ATL also has the sprint these tests need.
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
  otherProjectId = projects.body.find((p) => p.key === 'MOB').id;
});

describe('creating epics', () => {
  test('creates an epic with a color', async () => {
    const res = await createIssue({ title: 'Big Epic', type: 'epic', epic_color: 'teal' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('epic');
    expect(res.body.epic_color).toBe('teal');
  });

  test('epic_color defaults to purple', async () => {
    const res = await createIssue({ title: 'Default Color Epic', type: 'epic' });
    expect(res.status).toBe(201);
    expect(res.body.epic_color).toBe('purple');
  });

  test('rejects an epic with a sprint', async () => {
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const res = await createIssue({ title: 'Bad Epic', type: 'epic', sprint_id: sprints.body[0].id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sprint/i);
  });

  test('rejects an epic with a parent', async () => {
    const epic = await createIssue({ title: 'Parent Epic A', type: 'epic' });
    const res = await createIssue({ title: 'Nested Epic', type: 'epic', parent_id: epic.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });
});

describe('assigning issues to epics', () => {
  let epicId;
  beforeAll(async () => {
    const epic = await createIssue({ title: 'Container Epic', type: 'epic' });
    epicId = epic.body.id;
  });

  test('creates a story under an epic and returns join fields', async () => {
    const res = await createIssue({ title: 'Child Story', type: 'story', parent_id: epicId });
    expect(res.status).toBe(201);
    expect(res.body.parent_id).toBe(epicId);
    expect(res.body.epic_title).toBe('Container Epic');
    expect(res.body.epic_badge_color).toBe('purple');
    expect(res.body.epic_key).toMatch(/-\d+$/);
  });

  test('assigns an existing issue to an epic via PUT', async () => {
    const issue = await createIssue({ title: 'Adopt Me', type: 'task' });
    const res = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ parent_id: epicId });
    expect(res.status).toBe(200);
    expect(res.body.parent_id).toBe(epicId);
    expect(res.body.epic_title).toBe('Container Epic');
  });

  test('clears the epic link with parent_id null', async () => {
    const issue = await createIssue({ title: 'Leave Me', type: 'task', parent_id: epicId });
    const res = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ parent_id: null });
    expect(res.status).toBe(200);
    expect(res.body.parent_id).toBeNull();
    expect(res.body.epic_key).toBeNull();
  });

  test('rejects a parent that is not an epic', async () => {
    const story = await createIssue({ title: 'Not An Epic', type: 'story' });
    const res = await createIssue({ title: 'Bad Child', type: 'task', parent_id: story.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/epic/i);
  });

  test('rejects a missing parent', async () => {
    const res = await createIssue({ title: 'Orphan', type: 'task', parent_id: 'no-such-id' });
    expect(res.status).toBe(400);
  });

  test('rejects a parent epic from another project', async () => {
    const foreignEpic = await createIssue({ title: 'Foreign Epic', type: 'epic' }, otherProjectId);
    const res = await createIssue({ title: 'Cross Child', type: 'task', parent_id: foreignEpic.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project/i);
  });
});

describe('type-change guards', () => {
  test('cannot convert an epic with children to a story', async () => {
    const epic = await createIssue({ title: 'Guarded Epic', type: 'epic' });
    await createIssue({ title: 'Its Child', type: 'task', parent_id: epic.body.id });
    const res = await request(app).put(`/api/issues/${epic.body.id}`).set(headers).send({ type: 'story' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/child/i);
  });

  test('cannot convert an issue in a sprint to an epic', async () => {
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const issue = await createIssue({ title: 'Sprinted', type: 'task', sprint_id: sprints.body[0].id });
    const res = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ type: 'epic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sprint/i);
  });

  test('cannot move an epic into a sprint via /move', async () => {
    const epic = await createIssue({ title: 'Unmovable Epic', type: 'epic' });
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const res = await request(app)
      .put(`/api/issues/${epic.body.id}/move`)
      .set(headers)
      .send({ sprint_id: sprints.body[0].id });
    expect(res.status).toBe(400);
  });

  test('epic status can still change via /move (board excludes epics, API stays generic)', async () => {
    const epic = await createIssue({ title: 'Progressing Epic', type: 'epic' });
    const res = await request(app)
      .put(`/api/issues/${epic.body.id}/move`)
      .set(headers)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  test('records an "epic" activity entry when parent changes', async () => {
    const epic = await createIssue({ title: 'Activity Epic', type: 'epic' });
    const issue = await createIssue({ title: 'Activity Child', type: 'task' });
    await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ parent_id: epic.body.id });
    const act = await request(app).get(`/api/issues/${issue.body.id}/activity`).set(headers);
    expect(act.status).toBe(200);
    expect(act.body.some((a) => a.field === 'epic')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm run test:backend -- --testPathPatterns=tests/backend/epics.test.js`
Expected: FAIL — epic_color assertions get `undefined` (column missing), validation tests get 201 where 400 expected.

- [ ] **Step 3: Add the `epic_color` column to both schemas + idempotent migrations**

In `backend/database.js`, SQLite `issues` table (inside `SCHEMA_SQL`), add after `time_spent TEXT,`:

```sql
    time_spent TEXT,
    epic_color TEXT DEFAULT 'purple',
```

MySQL `issues` table (inside `MYSQL_SCHEMA_SQL`), add after the `time_spent` line:

```sql
    epic_color VARCHAR(20) DEFAULT 'purple',
```

In `initSqlite()`, right after `SCHEMA_SQL.forEach(sql => db.run(sql));` and before `saveDb();`:

```js
  // CREATE TABLE IF NOT EXISTS won't add columns to an existing data.db — patch in place.
  try { db.run("ALTER TABLE issues ADD COLUMN epic_color TEXT DEFAULT 'purple'"); } catch (e) { /* column already exists */ }
```

In `initMysqlSchema()`, right after the `for (const sql of MYSQL_SCHEMA_SQL)` loop:

```js
  const [epicCol] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'issues' AND column_name = 'epic_color'"
  );
  if (epicCol.length === 0) {
    await pool.query("ALTER TABLE issues ADD COLUMN epic_color VARCHAR(20) DEFAULT 'purple'");
  }
```

- [ ] **Step 4: Implement validation + parent join in `backend/routes/issues.js`**

Add the helper below `requireBoardAdmin` (line ~16):

```js
// Hierarchy rules: an issue's parent must be an epic in the same project;
// epics themselves take no parent and no sprint. Returns an error message or null.
async function validateHierarchy(db, { id, projectId, type, parentId, sprintId }) {
  if (type === 'epic') {
    if (parentId) return 'An epic cannot have a parent';
    if (sprintId) return 'An epic cannot be assigned to a sprint';
    if (id) return null;
  }
  if (id && type !== 'epic') {
    const children = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE parent_id = ?', [id]);
    if (children.count > 0) return 'Cannot change type: this epic still has child issues';
  }
  if (parentId) {
    const parent = await queryOne(db, 'SELECT id, type, project_id FROM issues WHERE id = ?', [parentId]);
    if (!parent) return 'Parent issue not found';
    if (parent.type !== 'epic') return 'Parent must be an epic';
    if (parent.project_id !== projectId) return 'Parent epic must be in the same project';
  }
  return null;
}
```

In `enrichIssue`, add after the `reporter` lookup:

```js
  const parent = issue.parent_id
    ? await queryOne(db, 'SELECT issue_key, title, epic_color FROM issues WHERE id = ?', [issue.parent_id])
    : null;
```

and add to the returned object (next to the other joined fields):

```js
    epic_key: parent?.issue_key || null,
    epic_title: parent?.title || null,
    epic_badge_color: parent?.epic_color || null,
```

In the POST handler, replace the destructure + title check (lines ~75–76) with:

```js
    const { title, description, type, priority, assignee_id, reporter_id, sprint_id, story_points, due_date, labels, original_estimate, parent_id, epic_color } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const hierarchyError = await validateHierarchy(db, {
      projectId: req.params.projectId,
      type: type || 'task',
      parentId: parent_id || null,
      sprintId: sprint_id || null,
    });
    if (hierarchyError) return res.status(400).json({ error: hierarchyError });
```

and extend the INSERT to include the new columns:

```js
    await run(db, `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, assignee_id, reporter_id, sprint_id, story_points, due_date, labels, original_estimate, parent_id, epic_color, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, req.params.projectId, `${project.key}-${issueNumber}`, issueNumber,
       title, description || '', type || 'task', priority || 'medium',
       assignee_id || null, reporter_id || req.userId, sprint_id || null,
       story_points || null, due_date || null, labels || '[]', original_estimate || null,
       parent_id || null, epic_color || 'purple']);
```

In the PUT handler, insert the guard right after the 404 check (line ~106):

```js
    const nextType = req.body.type !== undefined ? req.body.type : issue.type;
    const nextParent = req.body.parent_id !== undefined ? req.body.parent_id : issue.parent_id;
    const nextSprint = req.body.sprint_id !== undefined ? req.body.sprint_id : issue.sprint_id;
    const hierarchyError = await validateHierarchy(db, {
      id: issue.id,
      projectId: issue.project_id,
      type: nextType,
      parentId: nextParent,
      sprintId: nextSprint,
    });
    if (hierarchyError) return res.status(400).json({ error: hierarchyError });
```

Extend the allowed list (line ~108):

```js
    const allowed = ['title', 'description', 'type', 'status', 'priority', 'assignee_id', 'sprint_id', 'story_points', 'board_order', 'labels', 'due_date', 'original_estimate', 'time_spent', 'parent_id', 'epic_color'];
```

In the activity-entry push inside the same loop, log `parent_id` under the friendlier field name `epic` — replace:

```js
          activityEntries.push({ field: key, old_value: oldVal, new_value: String(newVal) });
```

with:

```js
          activityEntries.push({ field: key === 'parent_id' ? 'epic' : key, old_value: oldVal, new_value: String(newVal) });
```

In the `/move` handler, add after the 404 check (line ~164):

```js
    if (issue.type === 'epic' && req.body.sprint_id) {
      return res.status(400).json({ error: 'An epic cannot be assigned to a sprint' });
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npm run test:backend -- --testPathPatterns=tests/backend/epics.test.js`
Expected: PASS (all tests in epics.test.js).

Then run the full backend suite to check for regressions:
Run: `cd backend && npm run test:backend`
Expected: PASS — existing suites unaffected (issues.test.js etc.).

- [ ] **Step 6: Commit**

```bash
git add backend/database.js backend/routes/issues.js backend/tests/backend/epics.test.js
git commit -m "feat(epics): epic_color column, hierarchy validation, parent epic join"
```

---

### Task 2: Backend — epics rollup endpoint, children endpoint, delete-orphans

**Files:**
- Modify: `backend/routes/issues.js` (add two routes; extend DELETE handler)
- Modify: `README.md` (Issues section of the API reference table)
- Test: `backend/tests/backend/epics.test.js` (append a describe block)

**Interfaces:**
- Consumes: `validateHierarchy`/`enrichIssue` from Task 1.
- Produces: `GET /api/projects/:projectId/epics` → array of epic rows each with `child_count: number, done_count: number, total_points: number, done_points: number, assignee_name, assignee_color`. `GET /api/issues/:id/children` → enriched issue array. `DELETE /api/issues/:id` now nulls children's `parent_id` first.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/epics.test.js`:

```js
describe('epic rollup + children endpoints', () => {
  let epicId;

  beforeAll(async () => {
    const epic = await createIssue({ title: 'Rollup Epic', type: 'epic', epic_color: 'green' });
    epicId = epic.body.id;
    await createIssue({ title: 'Rollup Child 1', type: 'story', parent_id: epicId, story_points: 5 });
    const c2 = await createIssue({ title: 'Rollup Child 2', type: 'task', parent_id: epicId, story_points: 3 });
    await request(app).put(`/api/issues/${c2.body.id}`).set(headers).send({ status: 'done' });
  });

  test('GET /projects/:id/epics returns rollup counts and points', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/epics`).set(headers);
    expect(res.status).toBe(200);
    const epic = res.body.find((e) => e.id === epicId);
    expect(epic).toBeDefined();
    expect(epic.child_count).toBe(2);
    expect(epic.done_count).toBe(1);
    expect(epic.total_points).toBe(8);
    expect(epic.done_points).toBe(3);
    expect(res.body.every((e) => e.type === 'epic')).toBe(true);
  });

  test('GET /issues/:id/children lists the epic children enriched', async () => {
    const res = await request(app).get(`/api/issues/${epicId}/children`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toHaveProperty('assignee_name');
    expect(res.body.map((c) => c.title).sort()).toEqual(['Rollup Child 1', 'Rollup Child 2']);
  });

  test('deleting an epic orphans its children instead of deleting them', async () => {
    const epic = await createIssue({ title: 'Doomed Epic', type: 'epic' });
    const child = await createIssue({ title: 'Survivor', type: 'task', parent_id: epic.body.id });

    const del = await request(app).delete(`/api/issues/${epic.body.id}`).set(headers);
    expect(del.status).toBe(200);

    const survivor = await request(app).get(`/api/issues/${child.body.id}`).set(headers);
    expect(survivor.status).toBe(200);
    expect(survivor.body.parent_id).toBeNull();
    expect(survivor.body.epic_key).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm run test:backend -- --testPathPatterns=tests/backend/epics.test.js`
Expected: FAIL — 404 on `/epics` and `/children` (routes missing); survivor 404s after epic delete (child not orphaned; note: current DELETE does not cascade to children, so the child survives but keeps a dangling parent_id — the `epic_key` assertion fails).

- [ ] **Step 3: Implement the routes and the orphan step**

In `backend/routes/issues.js`, add after the GET list route (line ~62). Register it BEFORE the existing routes if any path could shadow it — here `/projects/:projectId/epics` and `/issues/:id/children` collide with nothing:

```js
// GET /api/projects/:projectId/epics — epics with child rollups (Epics screen)
router.get('/projects/:projectId/epics', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const epics = await queryAll(db, `
      SELECT e.*, u.name AS assignee_name, u.avatar_color AS assignee_color,
        (SELECT COUNT(*) FROM issues c WHERE c.parent_id = e.id) AS child_count,
        (SELECT COUNT(*) FROM issues c WHERE c.parent_id = e.id AND c.status = 'done') AS done_count,
        (SELECT COALESCE(SUM(c.story_points), 0) FROM issues c WHERE c.parent_id = e.id) AS total_points,
        (SELECT COALESCE(SUM(c.story_points), 0) FROM issues c WHERE c.parent_id = e.id AND c.status = 'done') AS done_points
      FROM issues e
      LEFT JOIN users u ON u.id = e.assignee_id
      WHERE e.project_id = ? AND e.type = 'epic'
      ORDER BY e.board_order, e.created_at`, [req.params.projectId]);
    res.json(epics);
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/:id/children — child issues of an epic
router.get('/issues/:id/children', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const children = await queryAll(db, 'SELECT * FROM issues WHERE parent_id = ? ORDER BY created_at', [req.params.id]);
    res.json(await Promise.all(children.map(c => enrichIssue(db, c))));
  } catch (e) { serverError(res, e); }
});
```

In the DELETE handler, add before `DELETE FROM issues WHERE id = ?` (line ~153):

```js
    // Orphan children rather than cascade — matches Jira semantics.
    await run(db, 'UPDATE issues SET parent_id = NULL WHERE parent_id = ?', [req.params.id]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm run test:backend -- --testPathPatterns=tests/backend/epics.test.js`
Expected: PASS.

- [ ] **Step 5: Document the new endpoints in README.md**

In the README "API Reference" Issues section, add two rows to the issues table:

```markdown
| GET | `/api/projects/:id/epics` | List epics with child rollups (counts + points) |
| GET | `/api/issues/:id/children` | List an epic's child issues |
```

(Find the issues table with the existing `/api/issues/:id/move` row and append these rows to it. Also update the `routes/issues.js` line in the Project Structure comment from "CRUD issues + move (drag & drop)" to "CRUD issues + move + epics".)

- [ ] **Step 6: Commit**

```bash
git add backend/routes/issues.js backend/tests/backend/epics.test.js README.md
git commit -m "feat(epics): rollup + children endpoints, orphan children on epic delete"
```

---

### Task 3: Backend — seed "Atlas Development" project with the 12 roadmap epics

**Files:**
- Modify: `backend/database.js` (`seedDemoData()`, insert after the `mobIssues.forEach(...)` block ~line 720, and the final `console.log` at ~line 793)
- Test: `backend/tests/backend/epics.test.js` (append a describe block)

**Interfaces:**
- Consumes: seed-scope variables already defined in `seedDemoData()`: `uuid`, `userIds`, `db`.
- Produces: seeded project key `ATLAS` named "Atlas Development" with issues `ATLAS-1`…`ATLAS-12`, all `type='epic'`; `ATLAS-1` status `done`, rest `todo`. Tests (and any fresh demo DB) can rely on this.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/epics.test.js`:

```js
describe('Atlas Development dogfood seed', () => {
  test('seeds the ATLAS project with 12 roadmap epics, Epic support done', async () => {
    const projects = await request(app).get('/api/projects').set(headers);
    const atlas = projects.body.find((p) => p.key === 'ATLAS');
    expect(atlas).toBeDefined();
    expect(atlas.name).toBe('Atlas Development');

    const epics = await request(app).get(`/api/projects/${atlas.id}/epics`).set(headers);
    expect(epics.status).toBe(200);
    expect(epics.body.length).toBe(12);

    const first = epics.body.find((e) => e.issue_key === 'ATLAS-1');
    expect(first.title).toBe('Epic support');
    expect(first.status).toBe('done');
    expect(epics.body.filter((e) => e.status === 'todo').length).toBe(11);
  });
});
```

Note: this suite gets a fresh app per file via `createTestApp()`, so the seed change is picked up automatically.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run test:backend -- --testPathPatterns=tests/backend/epics.test.js`
Expected: FAIL — `atlas` is `undefined` (project not seeded).

- [ ] **Step 3: Add the seed block**

In `backend/database.js`, `seedDemoData()`, insert directly after the `mobIssues.forEach(...)` block (before the `// ===== CONFLUENCE SEED DATA =====` comment):

```js
  // ===== DOGFOOD: Atlas tracks its own Jira/Confluence parity roadmap =====
  const projId3 = uuid();
  db.run("INSERT INTO projects (id, name, key, description, lead_id) VALUES (?, ?, ?, ?, ?)",
    [projId3, 'Atlas Development', 'ATLAS', 'Atlas building Atlas — the Jira/Confluence parity roadmap, tracked as epics', userIds[0]]);
  [0, 1, 2].forEach(i => {
    db.run("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)",
      [uuid(), projId3, userIds[i], i === 0 ? 'lead' : 'member']);
  });

  const roadmapEpics = [
    { title: 'Epic support', status: 'done', color: 'purple',
      desc: 'Add epic as a first-class issue type: hierarchy via parent_id, Epics screen with progress rollups, epic badges on board and backlog, epic picker in the issue detail sheet.' },
    { title: 'Subtasks', status: 'todo', color: 'blue',
      desc: 'Child issues under stories, tasks, and bugs using the same parent_id column, with progress rollup on the parent issue.' },
    { title: 'Global search & filters', status: 'todo', color: 'teal',
      desc: 'Quick search across issues and wiki pages, JQL-lite filter bar (assignee, type, label, status), and saved filters.' },
    { title: 'Notifications & @mentions', status: 'todo', color: 'yellow',
      desc: 'In-app notification inbox, @mentions in comments, wiki page watching — wiring up the existing notification settings toggles.' },
    { title: 'Time tracking', status: 'todo', color: 'orange',
      desc: 'Original estimates, work logs, and remaining-time display on issues, building on the original_estimate and time_spent columns.' },
    { title: 'Releases & components', status: 'todo', color: 'red',
      desc: 'Fix versions and components on issues, plus a release hub screen with per-version progress.' },
    { title: 'Roadmap / timeline', status: 'todo', color: 'pink',
      desc: 'Gantt-style timeline view of epics and sprints across time.' },
    { title: 'Board power-ups', status: 'todo', color: 'green',
      desc: 'Swimlanes (by assignee/epic), per-column WIP limits, and multi-select bulk edit on the board.' },
    { title: 'Custom workflows', status: 'todo', color: 'purple',
      desc: 'Configurable statuses and board columns per project instead of the fixed four-status workflow.' },
    { title: 'Automation rules', status: 'todo', color: 'blue',
      desc: 'Trigger → condition → action rules, e.g. "when all subtasks done, move parent to done".' },
    { title: 'Wiki: collaboration', status: 'todo', color: 'teal',
      desc: 'Inline comments on wiki page text and page-level restrictions/permissions.' },
    { title: 'Wiki: publishing', status: 'todo', color: 'orange',
      desc: 'Page export (PDF/Markdown), macros (table of contents, status badges, issue embeds), and blog posts per space.' },
  ];

  roadmapEpics.forEach((epic, i) => {
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, epic_color, board_order)
      VALUES (?, ?, ?, ?, ?, ?, 'epic', ?, 'high', ?, ?, ?)`,
      [uuid(), projId3, `ATLAS-${i + 1}`, i + 1, epic.title, epic.desc, epic.status, userIds[0], epic.color, i]);
  });
```

Update the closing log line of `seedDemoData()` to:

```js
  console.log('\n  ✓ Demo data seeded (5 users, 3 projects, 25 issues incl. 12 roadmap epics, 2 wiki spaces, 7 pages)\n');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm run test:backend -- --testPathPatterns=tests/backend/epics.test.js`
Expected: PASS.

Full suite regression check:
Run: `cd backend && npm run test:backend`
Expected: PASS. Caution: several existing suites grab `projects.body[0]` and the list is `ORDER BY created_at` with identical seed timestamps, so adding a third project can in principle reorder it. If any pre-existing suite fails on a project-shaped assertion, fix that suite to select its project by key (`.find((p) => p.key === 'ATL')`) rather than by index — do not change the seed order to paper over it.

- [ ] **Step 5: Commit**

```bash
git add backend/database.js backend/tests/backend/epics.test.js
git commit -m "feat(epics): seed Atlas Development project with 12-epic parity roadmap"
```

---

### Task 4: Frontend — shared vocabulary: types, domain registries, api client, EpicBadge

**Files:**
- Modify: `frontend/src/lib/types.ts` (IssueType line 5, Issue interface lines 59–88, add EpicSummary)
- Modify: `frontend/src/lib/domain.tsx` (TYPE_LABEL/TYPE_ICON/TYPE_COLOR ~lines 26–42, add EPIC_COLORS)
- Modify: `frontend/src/lib/api.ts` (issues section ~line 142, imports line 6)
- Modify: `frontend/src/components/app/primitives.tsx` (add EpicBadge)

**Interfaces:**
- Consumes: backend fields from Tasks 1–2.
- Produces (used by Tasks 5–9):
  - `IssueType` now includes `'epic'`; `Issue` gains `epic_color: string | null; epic_key: string | null; epic_title: string | null; epic_badge_color: string | null` (`parent_id` already exists).
  - `EpicSummary` type.
  - `EPIC_COLORS: Record<string, { label: string; chip: string; swatch: string }>`, `DEFAULT_EPIC_COLOR = 'purple'`, `epicColor(name?: string | null)` helper in `domain.tsx`.
  - `api.epics.list(projectId: string): Promise<EpicSummary[]>` and `api.epics.children(issueId: string): Promise<Issue[]>`.
  - `EpicBadge({ name, color, className })` component in `primitives.tsx`.

- [ ] **Step 1: Extend `types.ts`**

Change line 5:

```ts
export type IssueType = 'story' | 'bug' | 'task' | 'epic';
```

In `interface Issue`, add after `link_count: number;`:

```ts
  epic_color: string | null;
  epic_key: string | null;
  epic_title: string | null;
  epic_badge_color: string | null;
```

Add after the `Issue` interface:

```ts
/** Epic row with child rollups, from GET /projects/:id/epics. */
export interface EpicSummary extends Issue {
  child_count: number;
  done_count: number;
  total_points: number;
  done_points: number;
}
```

- [ ] **Step 2: Extend `domain.tsx`**

Add `Zap` to the lucide import on line 4. Extend the three type registries:

```ts
export const TYPE_LABEL: Record<IssueType, string> = {
  story: 'Story',
  bug: 'Bug',
  task: 'Task',
  epic: 'Epic',
};

export const TYPE_ICON: Record<IssueType, typeof Bug> = {
  story: Bookmark,
  bug: Bug,
  task: CheckSquare,
  epic: Zap,
};

export const TYPE_COLOR: Record<IssueType, string> = {
  story: 'text-success',
  bug: 'text-destructive',
  task: 'text-primary',
  epic: 'text-purple-500',
};
```

Add at the end of the file:

```ts
/** Named epic badge colors. Full literal class strings so Tailwind's scanner sees them. */
export const EPIC_COLORS: Record<string, { label: string; chip: string; swatch: string }> = {
  purple: { label: 'Purple', chip: 'bg-purple-500/15 text-purple-700 dark:text-purple-300', swatch: 'bg-purple-500' },
  blue:   { label: 'Blue',   chip: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',       swatch: 'bg-blue-500' },
  teal:   { label: 'Teal',   chip: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',       swatch: 'bg-teal-500' },
  green:  { label: 'Green',  chip: 'bg-green-500/15 text-green-700 dark:text-green-300',    swatch: 'bg-green-500' },
  yellow: { label: 'Yellow', chip: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300', swatch: 'bg-yellow-500' },
  orange: { label: 'Orange', chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', swatch: 'bg-orange-500' },
  red:    { label: 'Red',    chip: 'bg-red-500/15 text-red-700 dark:text-red-300',          swatch: 'bg-red-500' },
  pink:   { label: 'Pink',   chip: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',       swatch: 'bg-pink-500' },
};

export const DEFAULT_EPIC_COLOR = 'purple';

export function epicColor(name?: string | null) {
  return EPIC_COLORS[name ?? ''] ?? EPIC_COLORS[DEFAULT_EPIC_COLOR];
}
```

- [ ] **Step 3: Extend `api.ts`**

Add `EpicSummary` to the type import block (line 6–11). Add after the `issues` object (line ~151):

```ts
  epics: {
    list: (projectId: string) => get<EpicSummary[]>(`/projects/${projectId}/epics`),
    children: (issueId: string) => get<Issue[]>(`/issues/${issueId}/children`),
  },
```

- [ ] **Step 4: Add `EpicBadge` to `primitives.tsx`**

Add `epicColor` to the existing `@/lib/domain` import. Add the component after `StatusPill`:

```tsx
/** Tinted epic chip shown on board cards and backlog rows. */
export function EpicBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('max-w-32 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold', epicColor(color).chip, className)}>
      {name}
    </span>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run lint`
Expected: PASS — the `Record<IssueType, …>` registries force the compiler to prove every screen handles `'epic'`; fix any missed switch/record if errors appear (there should be none: all rendering goes through the registries).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/domain.tsx frontend/src/lib/api.ts frontend/src/components/app/primitives.tsx
git commit -m "feat(epics): frontend vocabulary — epic type, colors, api client, EpicBadge"
```

---

### Task 5: Frontend — create-issue dialog supports epics

**Files:**
- Modify: `frontend/src/components/app/create-issue-dialog.tsx`

**Interfaces:**
- Consumes: `TYPE_LABEL` (now with epic), `IssueType` with `'epic'`.
- Produces: new optional prop `defaultType?: IssueType` on `CreateIssueDialog` (Task 6's Epics screen passes `defaultType="epic"`). When type is `epic`, the Sprint select is hidden and `sprint_id` is sent as `null`.

- [ ] **Step 1: Implement**

In `create-issue-dialog.tsx`:

1. Line 19: `const TYPES: IssueType[] = ['story', 'task', 'bug', 'epic'];`
2. Add the prop — extend the component signature:

```tsx
export function CreateIssueDialog({
  open,
  onOpenChange,
  projectId,
  sprints,
  defaultSprintId,
  defaultType = 'task',
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  sprints: Sprint[];
  defaultSprintId?: string | null;
  defaultType?: IssueType;
  onCreated?: () => void;
}) {
```

3. In the open-reset effect, replace `setType('task');` with `setType(defaultType);` and add `defaultType` to the dependency array: `}, [open, defaultSprintId, defaultType]);`
4. In `onSubmit`, replace the `sprint_id` line with:

```ts
        sprint_id: type === 'epic' || sprintId === NO_SPRINT ? null : sprintId,
```

5. Wrap the Sprint select block (the last `<div className="space-y-2">` containing the Sprint label) so it disappears for epics:

```tsx
              {type !== 'epic' && (
                <div className="space-y-2">
                  <Label>Sprint</Label>
                  <Select value={sprintId} onValueChange={setSprintId}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SPRINT}>Backlog</SelectItem>
                      {sprints.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/app/create-issue-dialog.tsx
git commit -m "feat(epics): create-issue dialog — epic type option, no sprint for epics"
```

---

### Task 6: Frontend — Epics screen, route, sidebar entry

**Files:**
- Create: `frontend/src/screens/epics.tsx`
- Modify: `frontend/src/App.tsx` (lazy import ~line 14, route ~line 60)
- Modify: `frontend/src/components/app/app-shell.tsx` (PROJECT_NAV ~line 29, lucide import)

**Interfaces:**
- Consumes: `api.epics.list`, `EpicSummary`, `EpicBadge`, `epicColor`, `CreateIssueDialog` with `defaultType="epic"`, `IssueDetailSheet`, `useProjects`, `canCreateIssues`, shadcn `Progress`.
- Produces: route `/epics`; default export `EpicsScreen`.

- [ ] **Step 1: Create the screen**

Create `frontend/src/screens/epics.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { canCreateIssues, epicColor } from '@/lib/domain';
import type { EpicSummary } from '@/lib/types';
import {
  EmptyState, ErrorState, PageHeader, RowsSkeleton, StatusPill, UserAvatar,
} from '@/components/app/primitives';
import { IssueDetailSheet } from '@/components/app/issue-detail-sheet';
import { CreateIssueDialog } from '@/components/app/create-issue-dialog';
import { cn } from '@/lib/utils';

function EpicRow({ epic, onOpen }: { epic: EpicSummary; onOpen: () => void }) {
  const issuePct = epic.child_count === 0 ? 0 : Math.round((epic.done_count / epic.child_count) * 100);

  return (
    <button
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/60"
    >
      <span className={cn('size-3 shrink-0 rounded-sm', epicColor(epic.epic_color).swatch)} aria-hidden />
      <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{epic.issue_key}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{epic.title}</span>

      <span className="hidden w-44 shrink-0 items-center gap-2 sm:flex">
        <Progress value={issuePct} className="h-1.5" />
        <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
          {epic.done_count}/{epic.child_count}
        </span>
      </span>

      <span className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground md:block">
        {epic.done_points}/{epic.total_points} pts
      </span>

      <StatusPill status={epic.status} className="shrink-0" />
      {epic.assignee_name ? (
        <UserAvatar name={epic.assignee_name} color={epic.assignee_color} />
      ) : (
        <span className="size-6 shrink-0 rounded-full border border-dashed border-border" />
      )}
    </button>
  );
}

export default function EpicsScreen() {
  const { user } = useAuth();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [epics, setEpics] = useState<EpicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      setEpics(await api.epics.list(currentProjectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load epics');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Epics" />
        <RowsSkeleton />
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Epics" />
        <EmptyState icon={Zap} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Epics" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  const done = epics.filter((e) => e.status === 'done').length;

  return (
    <>
      <PageHeader
        title="Epics"
        description={`${epics.length} epic${epics.length === 1 ? '' : 's'} · ${done} done in ${currentProject?.name ?? 'this project'}`}
        actions={
          canCreateIssues(user?.role) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create epic
            </Button>
          )
        }
      />

      {epics.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No epics yet"
          description="Epics group related issues into larger bodies of work."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {epics.map((epic) => (
              <li key={epic.id}>
                <EpicRow epic={epic} onOpen={() => setOpenIssueId(epic.id)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <IssueDetailSheet
        issueId={openIssueId}
        onOpenChange={(o) => !o && setOpenIssueId(null)}
        onChanged={load}
        onOpenIssue={setOpenIssueId}
      />
      <CreateIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={currentProjectId}
        sprints={[]}
        defaultType="epic"
        onCreated={load}
      />
    </>
  );
}
```

- [ ] **Step 2: Register the route**

In `frontend/src/App.tsx`, add with the other lazy imports (line ~14):

```ts
const Epics = lazy(() => import('@/screens/epics'));
```

and add the route after the `/backlog` route (line 60):

```tsx
              <Route path="/epics" element={<Epics />} />
```

- [ ] **Step 3: Add the sidebar entry**

In `frontend/src/components/app/app-shell.tsx`, add `Zap` to the lucide import (line 3–6) and insert into `PROJECT_NAV` between Backlog and Sprints:

```ts
const PROJECT_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/board', label: 'Board', icon: Columns3 },
  { to: '/backlog', label: 'Backlog', icon: ListTodo },
  { to: '/epics', label: 'Epics', icon: Zap },
  { to: '/sprints', label: 'Sprints', icon: Rocket },
  { to: '/reports', label: 'Reports', icon: Gauge },
];
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/epics.tsx frontend/src/App.tsx frontend/src/components/app/app-shell.tsx
git commit -m "feat(epics): Epics screen with progress rollups, route, sidebar entry"
```

---

### Task 7: Frontend — issue detail sheet: epic picker, color picker, child issues

**Files:**
- Modify: `frontend/src/components/app/issue-detail-sheet.tsx`

**Interfaces:**
- Consumes: `api.epics.list/children`, `api.issues.list/update`, `EPIC_COLORS`, `epicColor`, `EpicSummary`, `TypeIcon`, `StatusPill`, shadcn `Progress`.
- Produces: for non-epics an "Epic" select in the field rail; for epics a color picker in the rail plus a "Child issues" section in the main column. No signature changes — Tasks 6/8 keep using the sheet as-is.

- [ ] **Step 1: Add state + data loading**

New imports (merge into existing import lines):

```ts
import { Progress } from '@/components/ui/progress';
import { EPIC_COLORS, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, TYPE_LABEL, canCreateIssues, isAdmin } from '@/lib/domain';
import type { ActivityEntry, Attachment, Comment, EpicSummary, Issue, IssueStatus, Priority, Sprint, User } from '@/lib/types';
import { PriorityIcon, StatusPill, TypeIcon, UserAvatar } from './primitives';
```

Add a sentinel next to the existing ones (line ~26):

```ts
const NO_EPIC = '__no_epic__';
```

Add state after the `sprints` state (line ~47):

```ts
  const [epics, setEpics] = useState<EpicSummary[]>([]);
  const [children, setChildren] = useState<Issue[]>([]);
  const [candidates, setCandidates] = useState<Issue[]>([]);
```

In `load()`, replace the existing `Promise.all` destructure and the six `set...` calls with:

```ts
      const [c, a, act, w, u, sp, ep, ch, all] = await Promise.all([
        api.comments.list(issueId).catch(() => []),
        api.attachments.list(issueId).catch(() => []),
        api.activity.list(issueId).catch(() => []),
        api.watchers.list(issueId).catch(() => []),
        api.users.list().catch(() => []),
        api.sprints.list(detail.project_id).catch(() => []),
        api.epics.list(detail.project_id).catch(() => []),
        detail.type === 'epic' ? api.epics.children(detail.id).catch(() => []) : Promise.resolve([]),
        detail.type === 'epic' ? api.issues.list(detail.project_id).catch(() => []) : Promise.resolve([]),
      ]);
      setComments(c);
      setAttachments(a);
      setActivity(act);
      setWatchers(w);
      setMembers(u.filter((x) => x.is_active));
      setSprints(sp);
      setEpics(ep.filter((e) => e.id !== detail.id));
      setChildren(ch);
      setCandidates(all.filter((i) => i.type !== 'epic' && !i.parent_id));
```

- [ ] **Step 2: Field rail — Epic picker for non-epics, color picker for epics**

Replace the Sprint block (the `<div className="space-y-1.5">` containing the Sprint label, lines ~397–412) with a conditional pair:

```tsx
                {issue.type !== 'epic' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Sprint</Label>
                    <Select
                      value={issue.sprint_id ?? NO_SPRINT}
                      onValueChange={(v) => patch({ sprint_id: v === NO_SPRINT ? null : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SPRINT}>Backlog</SelectItem>
                        {sprints.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {issue.type !== 'epic' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Epic</Label>
                    <Select
                      value={issue.parent_id ?? NO_EPIC}
                      onValueChange={(v) => patch({ parent_id: v === NO_EPIC ? null : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_EPIC}>No epic</SelectItem>
                        {epics.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            <span className="flex items-center gap-2">
                              <span className={cn('size-2.5 rounded-sm', epicColor(e.epic_color).swatch)} />
                              {e.title}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {issue.type === 'epic' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Epic color</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(EPIC_COLORS).map(([name, c]) => (
                        <button
                          key={name}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => patch({ epic_color: name })}
                          aria-label={c.label}
                          className={cn(
                            'size-5 rounded-full transition-transform hover:scale-110',
                            c.swatch,
                            issue.epic_color === name && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}
```

This requires `cn` and `epicColor` — add to imports:

```ts
import { cn } from '@/lib/utils';
import { epicColor } from '@/lib/domain';
```

(merge `epicColor` into the existing `@/lib/domain` import line rather than duplicating it).

- [ ] **Step 3: Main column — child issues section for epics**

Add after the Description `</section>` (line ~211), before the Labels section:

```tsx
                {issue.type === 'epic' && (
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Child issues ({children.length})
                    </h3>
                    {children.length > 0 && (
                      <div className="mb-2 flex items-center gap-2">
                        <Progress
                          value={children.length === 0 ? 0 : Math.round((children.filter((c) => c.status === 'done').length / children.length) * 100)}
                          className="h-1.5"
                        />
                        <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                          {children.filter((c) => c.status === 'done').length}/{children.length} done
                        </span>
                      </div>
                    )}
                    <ul className="divide-y divide-border-light rounded-md border border-border">
                      {children.map((c) => (
                        <li key={c.id}>
                          <button
                            onClick={() => onOpenIssue?.(c.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                          >
                            <TypeIcon type={c.type} />
                            <span className="font-mono text-xs text-muted-foreground">{c.issue_key}</span>
                            <span className="min-w-0 flex-1 truncate">{c.title}</span>
                            <StatusPill status={c.status} className="shrink-0" />
                            {c.assignee_name && <UserAvatar name={c.assignee_name} color={c.assignee_color} className="size-5" />}
                          </button>
                        </li>
                      ))}
                      {children.length === 0 && (
                        <li className="px-3 py-3 text-sm text-muted-foreground">No child issues yet.</li>
                      )}
                    </ul>
                    {canEdit && candidates.length > 0 && (
                      <div className="mt-2">
                        <Select
                          value=""
                          onValueChange={async (childId) => {
                            try {
                              await api.issues.update(childId, { parent_id: issue.id });
                              onChanged?.();
                              void load();
                            } catch (e) {
                              toast.error('Could not add issue to epic', { description: e instanceof Error ? e.message : undefined });
                            }
                          }}
                        >
                          <SelectTrigger className="w-full text-muted-foreground">
                            <SelectValue placeholder="Add an existing issue…" />
                          </SelectTrigger>
                          <SelectContent>
                            {candidates.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-2">
                                  <TypeIcon type={c.type} />
                                  <span className="font-mono text-xs">{c.issue_key}</span> {c.title}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </section>
                )}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/app/issue-detail-sheet.tsx
git commit -m "feat(epics): issue detail — epic picker, color picker, child issues section"
```

---

### Task 8: Frontend — board & backlog: epic badges, exclude epics

**Files:**
- Modify: `frontend/src/screens/board.tsx` (visible filter line ~145–153, IssueCard meta row ~line 74)
- Modify: `frontend/src/screens/backlog.tsx` (backlog filter line ~53–59, row ~line 145)

**Interfaces:**
- Consumes: `EpicBadge` from `primitives.tsx`, `epic_key/epic_title/epic_badge_color` on `Issue`.
- Produces: user-visible only; no new exports.

- [ ] **Step 1: Board — exclude epics + badge**

In `board.tsx`, add `EpicBadge` to the primitives import (line 15). In the `visible` memo, add the epic exclusion as the first filter line:

```ts
    return issues.filter((i) => {
      if (i.type === 'epic') return false;
      if (sprintFilter === 'backlog' && i.sprint_id) return false;
```

In `IssueCard`, add the badge above the meta row — insert before `<div className="flex items-center gap-1.5">` (line ~74):

```tsx
      {issue.epic_key && (
        <div className={compact ? 'mb-1' : 'mb-1.5'}>
          <EpicBadge name={issue.epic_title ?? issue.epic_key} color={issue.epic_badge_color} />
        </div>
      )}
```

- [ ] **Step 2: Backlog — exclude epics + badge**

In `backlog.tsx`, add `EpicBadge` to the primitives import (lines 13–15). In the `backlog` memo, add the exclusion:

```ts
    return issues
      .filter((i) => i.type !== 'epic')
      .filter((i) => !i.sprint_id)
```

In the row, add the badge after the title span (line ~147):

```tsx
                  {issue.epic_key && (
                    <span className="hidden md:block">
                      <EpicBadge name={issue.epic_title ?? issue.epic_key} color={issue.epic_badge_color} />
                    </span>
                  )}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/board.tsx frontend/src/screens/backlog.tsx
git commit -m "feat(epics): board and backlog — epic badges on cards, exclude epic rows"
```

---

### Task 9: Full verification + rebuild

**Files:**
- Modify: `frontend/build/*` (Vite output, regenerated)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm run test:backend`
Expected: ALL suites PASS.

- [ ] **Step 2: Production build**

Run: `cd frontend && npm install && npm run build`
Expected: `tsc -b` clean, Vite build succeeds, output in `frontend/build/`.

- [ ] **Step 3: Reseed the dev database and run the app end-to-end**

The dev `data.db` predates the seed change; the ALTER migration adds `epic_color` but the ATLAS project only seeds into an empty DB. Move it aside (demo data only — confirm with the user if in doubt):

```bash
mv backend/data.db backend/data.db.bak 2>/dev/null || true
cd backend && node server.js
```

Then verify in the browser at `http://localhost:3001` (login `kunal@example.com` / `password123`):

1. Sidebar shows **Epics** between Backlog and Sprints; project switcher shows **Atlas Development**.
2. Switch to Atlas Development → Epics screen lists 12 epics; ATLAS-1 "Epic support" shows status Done; each row has a color dot and progress bar.
3. Open ATLAS-2 → color picker renders; pick a different color → badge dot updates.
4. In any project: create a story, assign it to an epic via the detail sheet's Epic select → board card and backlog row show the tinted epic badge.
5. Epic does NOT appear as a card on the Board or a row in the Backlog.
6. On an epic, "Add an existing issue…" adopts an issue; the child list and progress bar update; clicking a child navigates the sheet to it.
7. Delete a test epic (admin) → its former children survive with no epic badge.

- [ ] **Step 4: Commit the rebuilt frontend**

The repo tracks `frontend/build/` (the backend serves it). Restore the dev DB backup decision to the user; commit only the build:

```bash
git add frontend/build
git commit -m "build(frontend): rebuild with epic support"
```

- [ ] **Step 5: Mark the dogfood epic done**

ATLAS-1 is already seeded as Done — verify it reads Done on the Epics screen (step 3.2 above). Nothing further to do; later epics will be worked as child issues under ATLAS-2…ATLAS-12.
