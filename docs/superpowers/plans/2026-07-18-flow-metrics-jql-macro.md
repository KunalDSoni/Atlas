# Flow Metrics & JQL Table Macro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cycle-time, time-in-status, and cumulative-flow reports mined from `activity_log` (after fixing the move endpoint that never wrote to it), plus a `[jql: …]` macro that renders a live issue table inside a wiki page.

**Architecture:** Epic 33 is read-side: a pure `utils/flow.js` module (category mapping, timeline replay, percentiles) feeds three new routes in `reports.js`, each holding to a fixed query count; the move-endpoint fix is the write-side prerequisite. Epic 34 is client-side: `applyMacros` detects `[jql:]` paragraphs post-sanitize and swaps in tables fetched from the existing search endpoint — no new backend endpoint, one added column in the search SELECT.

**Tech Stack:** Node.js + Express 5, sql.js/MySQL, Jest + Supertest, React 18 + TS, existing `charts.tsx` primitives, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-18-flow-metrics-jql-macro-design.md`

## Global Constraints

- Backend commands run from `backend/`. Test: `npx jest <path> --runInBand --forceExit`.
- Fixed query counts on all report endpoints: one `issues` read + one `activity_log` read per request, everything else in JS.
- Do **not** modify `backend/utils/sanitize.js` or `PURIFY_CONFIG` in `rich-text.tsx`. Macros build from `textContent` post-sanitize.
- No synthetic backfill of transitions — metrics compute only from recorded rows, with `created_at` as entry into the first observed status.
- `ATLAS-NN` in commits = roadmap epic ordinal.
- Commit after every task; never with failing tests.

---

### Task 1: Move endpoint writes activity_log (the prerequisite fix)

**Files:**
- Modify: `backend/routes/issues.js` — inside `PUT /issues/:id/move`, after the `UPDATE issues` statement
- Test: `backend/tests/backend/move-activity.test.js`

**Interfaces:**
- Consumes: existing `activity_log` schema (`action, field, old_value, new_value`).
- Produces: move-driven rows identical in shape to the general PUT's (`action='update'`, `field='status'|'sprint'`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/move-activity.test.js`:

```js
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb, queryAll } = require('../../database');

let headers, db, projectId, sprintId;

async function activityFor(issueId) {
  return queryAll(db,
    'SELECT field, old_value, new_value FROM activity_log WHERE issue_id = ? ORDER BY created_at, field', [issueId]);
}

async function mkIssue(title) {
  const res = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title, type: 'task' });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  const sprints = await request(getApp()).get(`/api/projects/${projectId}/sprints`).set(headers);
  sprintId = sprints.body[0].id;
});

describe('board moves are recorded in activity_log', () => {
  test('a status move logs old and new status', async () => {
    const issue = await mkIssue('Move status');
    await request(getApp()).put(`/api/issues/${issue.id}/move`).set(headers)
      .send({ status: 'in_progress' });
    const rows = await activityFor(issue.id);
    expect(rows).toContainEqual({ field: 'status', old_value: 'todo', new_value: 'in_progress' });
  });

  test('a sprint move logs old and new sprint ids', async () => {
    const issue = await mkIssue('Move sprint');
    await request(getApp()).put(`/api/issues/${issue.id}/move`).set(headers)
      .send({ status: issue.status, sprint_id: sprintId });
    const rows = await activityFor(issue.id);
    expect(rows).toContainEqual({ field: 'sprint', old_value: null, new_value: sprintId });
  });

  test('a pure reorder logs nothing', async () => {
    const issue = await mkIssue('Reorder only');
    const before = (await activityFor(issue.id)).length;
    await request(getApp()).put(`/api/issues/${issue.id}/move`).set(headers)
      .send({ board_order: 7 });
    expect((await activityFor(issue.id)).length).toBe(before);
  });

  test('moving to the same status logs nothing', async () => {
    const issue = await mkIssue('Same status');
    const before = (await activityFor(issue.id)).length;
    await request(getApp()).put(`/api/issues/${issue.id}/move`).set(headers)
      .send({ status: issue.status });
    expect((await activityFor(issue.id)).length).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/move-activity.test.js --runInBand --forceExit`
Expected: FAIL — status and sprint tests find no matching rows

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/issues.js`, in the move handler, immediately after
`await run(db, \`UPDATE issues SET ${updates.join(', ')} WHERE id = ?\`, params);`:

```js
    // Board moves are status history too — the flow reports replay these rows.
    // Same shape the general PUT writes, so consumers can't tell them apart.
    if (status !== undefined && status !== issue.status) {
      await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, 'update', 'status', ?, ?)`,
        [uuidv4(), req.params.id, req.userId, issue.status, status]);
    }
    if (sprint_id !== undefined && String(sprint_id) !== String(issue.sprint_id)) {
      await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, 'update', 'sprint', ?, ?)`,
        [uuidv4(), req.params.id, req.userId, issue.sprint_id, sprint_id]);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/move-activity.test.js --runInBand --forceExit`
Expected: PASS — 4 tests

- [ ] **Step 5: Regression check on issue suites**

Run: `npx jest tests/backend/issues.test.js tests/backend/watchers-links-activity.test.js --runInBand --forceExit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routes/issues.js backend/tests/backend/move-activity.test.js
git commit -m "fix(issues): board moves record status/sprint history (ATLAS-33)"
```

---

### Task 2: Flow helpers — categories, timelines, percentiles

**Files:**
- Create: `backend/utils/flow.js`
- Test: `backend/tests/backend/flow.test.js`

**Interfaces:**
- Consumes: `projectStatuses(db, projectId)` from `backend/routes/workflows.js` (returns `[{ key, label, category, position }]`).
- Produces:
  - `categoryOf(statusKey, statuses) → 'todo'|'in_progress'|'done'` — looks up the status list; unknown keys → `'todo'`; falls back to built-ins (`in_progress`/`in_review` → in_progress, `done` → done).
  - `statusTimeline(issue, transitions) → [{ status, from, to }]` — `transitions` are `activity_log` rows (`field='status'`) for this issue sorted ascending by `created_at`. First segment starts at `issue.created_at` in `transitions[0]?.old_value ?? issue.status`; each transition closes a segment; the last segment has `to: null` (still current).
  - `hoursBetween(a, b) → number` — fractional hours between two SQLite/MySQL datetime strings, treating them as UTC.
  - `percentile(sortedNumbers, p) → number|null` — nearest-rank; `null` for empty input.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/flow.test.js`:

```js
const { categoryOf, statusTimeline, hoursBetween, percentile } = require('../../utils/flow');

const STATUSES = [
  { key: 'todo', category: 'todo' },
  { key: 'in_progress', category: 'in_progress' },
  { key: 'qa', category: 'in_progress' },
  { key: 'done', category: 'done' },
];

describe('categoryOf', () => {
  test('uses the project status list', () => {
    expect(categoryOf('qa', STATUSES)).toBe('in_progress');
    expect(categoryOf('done', STATUSES)).toBe('done');
  });
  test('falls back to built-ins for keys missing from the list', () => {
    expect(categoryOf('in_review', STATUSES)).toBe('in_progress');
  });
  test('unknown keys are todo', () => {
    expect(categoryOf('someday', STATUSES)).toBe('todo');
  });
});

describe('statusTimeline', () => {
  const issue = { created_at: '2026-07-01 09:00:00', status: 'done' };

  test('replays transitions into contiguous segments', () => {
    const t = statusTimeline(issue, [
      { old_value: 'todo', new_value: 'in_progress', created_at: '2026-07-02 09:00:00' },
      { old_value: 'in_progress', new_value: 'done', created_at: '2026-07-04 09:00:00' },
    ]);
    expect(t).toEqual([
      { status: 'todo', from: '2026-07-01 09:00:00', to: '2026-07-02 09:00:00' },
      { status: 'in_progress', from: '2026-07-02 09:00:00', to: '2026-07-04 09:00:00' },
      { status: 'done', from: '2026-07-04 09:00:00', to: null },
    ]);
  });

  test('no transitions: one open segment in the current status', () => {
    expect(statusTimeline(issue, [])).toEqual([
      { status: 'done', from: '2026-07-01 09:00:00', to: null },
    ]);
  });

  test('first segment status comes from the first transition, not current status', () => {
    const t = statusTimeline({ ...issue, status: 'in_progress' }, [
      { old_value: 'todo', new_value: 'in_progress', created_at: '2026-07-03 09:00:00' },
    ]);
    expect(t[0].status).toBe('todo');
  });
});

describe('hoursBetween', () => {
  test('whole and fractional hours', () => {
    expect(hoursBetween('2026-07-01 09:00:00', '2026-07-01 12:30:00')).toBeCloseTo(3.5);
  });
  test('ISO-with-T inputs also parse', () => {
    expect(hoursBetween('2026-07-01T09:00:00', '2026-07-01T10:00:00')).toBeCloseTo(1);
  });
});

describe('percentile', () => {
  test('nearest-rank on sorted input', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.85)).toBe(40);
  });
  test('empty input is null, single element is itself', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.85)).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/flow.test.js --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../utils/flow'`

- [ ] **Step 3: Write minimal implementation**

Create `backend/utils/flow.js`:

```js
// ===== FLOW METRICS HELPERS =====
// Pure functions for the cycle-time / time-in-status / cumulative-flow
// reports. Everything here operates on plain rows so it is unit-testable
// without a database.

// Built-in categories, used when a status key is absent from the project's
// configured workflow (matching DEFAULT_STATUSES in routes/workflows.js).
const BUILTIN_CATEGORY = {
  todo: 'todo',
  in_progress: 'in_progress',
  in_review: 'in_progress',
  done: 'done',
};

/** Category for a status key, given the project's status list. Unknown → todo. */
function categoryOf(statusKey, statuses) {
  const hit = statuses.find((s) => s.key === statusKey);
  if (hit) return hit.category;
  return BUILTIN_CATEGORY[statusKey] || 'todo';
}

/**
 * Replays an issue's status transitions into contiguous segments.
 * `transitions` are activity_log rows (field='status') sorted ascending.
 * The first segment starts at created_at in the first observed status —
 * the earliest transition's old_value, or the current status when the issue
 * has no recorded transitions (the data-honesty rule: no fabricated history).
 * The final segment is open (`to: null`).
 */
function statusTimeline(issue, transitions) {
  const first = transitions[0] ? transitions[0].old_value : issue.status;
  const segments = [];
  let current = { status: first, from: issue.created_at, to: null };
  for (const t of transitions) {
    current.to = t.created_at;
    segments.push(current);
    current = { status: t.new_value, from: t.created_at, to: null };
  }
  segments.push(current);
  return segments;
}

/** Fractional hours between two datetime strings ('YYYY-MM-DD HH:MM:SS' or ISO). */
function hoursBetween(a, b) {
  const parse = (s) => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime();
  return (parse(b) - parse(a)) / 3_600_000;
}

/** Nearest-rank percentile of an ascending-sorted array. Empty → null. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

module.exports = { categoryOf, statusTimeline, hoursBetween, percentile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/flow.test.js --runInBand --forceExit`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add backend/utils/flow.js backend/tests/backend/flow.test.js
git commit -m "feat(reports): flow helpers — categories, timeline replay, percentiles (ATLAS-33)"
```

---

### Task 3: Report endpoints — cycle time, time-in-status, cumulative flow

**Files:**
- Modify: `backend/routes/reports.js` — three routes appended before the CSV export route
- Test: `backend/tests/backend/flow-reports.test.js`

**Interfaces:**
- Consumes: Task 2 helpers; `projectStatuses` (already imported patterns exist in `issues.js` — reports.js must import it: `const { projectStatuses } = require('./workflows');`).
- Produces (exact response shapes the frontend consumes in Task 4):
  - `GET /projects/:projectId/reports/cycle-time` → `{ issues: [{ id, issue_key, title, type, completed_at, lead_time_h, cycle_time_h }], avg_cycle_h, p50_cycle_h, p85_cycle_h, avg_lead_h, count }`
  - `GET /projects/:projectId/reports/time-in-status` → `{ statuses: [{ status, avg_h, total_h, issues }] }`
  - `GET /projects/:projectId/reports/cumulative-flow?days=N` → `{ days: [{ date, todo, in_progress, done }] }` (N clamped to 1–90, default 30)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/flow-reports.test.js`. The fixture writes
transitions directly with controlled timestamps, so expected values are exact:

```js
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb, run } = require('../../database');

let headers, db, projectId;

// Insert an issue with a fixed created_at, then hand-written status rows.
async function seedIssue({ title, createdAt, status, transitions }) {
  const res = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title, type: 'task' });
  expect(res.status).toBe(201);
  const id = res.body.id;
  await run(db, 'UPDATE issues SET created_at = ?, status = ? WHERE id = ?', [createdAt, status, id]);
  // The route API stamps 'now'; write history rows directly for determinism.
  await run(db, 'DELETE FROM activity_log WHERE issue_id = ?', [id]);
  for (const t of transitions) {
    await run(db,
      `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
       VALUES (?, ?, ?, 'update', 'status', ?, ?, ?)`,
      [uuidv4(), id, headers['x-user-id'], t.from, t.to, t.at]);
  }
  return id;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  // A fresh project so seeded demo issues don't pollute the numbers.
  const proj = await request(getApp()).post('/api/projects').set(headers)
    .send({ name: 'Flow Fixtures', key: 'FLW' });
  expect(proj.status).toBe(201);
  projectId = proj.body.id;

  // Issue A: todo 1d → in_progress 2d → done. Lead 72h, cycle 48h.
  await seedIssue({
    title: 'A', createdAt: '2026-07-01 00:00:00', status: 'done',
    transitions: [
      { from: 'todo', to: 'in_progress', at: '2026-07-02 00:00:00' },
      { from: 'in_progress', to: 'done', at: '2026-07-04 00:00:00' },
    ],
  });
  // Issue B: todo 12h → in_progress 12h → done. Lead 24h, cycle 12h.
  await seedIssue({
    title: 'B', createdAt: '2026-07-01 00:00:00', status: 'done',
    transitions: [
      { from: 'todo', to: 'in_progress', at: '2026-07-01 12:00:00' },
      { from: 'in_progress', to: 'done', at: '2026-07-02 00:00:00' },
    ],
  });
  // Issue C: done with NO recorded transitions (legacy) — excluded from cycle time.
  await seedIssue({ title: 'C', createdAt: '2026-07-01 00:00:00', status: 'done', transitions: [] });
  // Issue D: still in progress — not completed, excluded from cycle time.
  await seedIssue({
    title: 'D', createdAt: '2026-07-01 00:00:00', status: 'in_progress',
    transitions: [{ from: 'todo', to: 'in_progress', at: '2026-07-03 00:00:00' }],
  });
});

describe('cycle-time report', () => {
  test('computes lead and cycle hours from recorded transitions only', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/cycle-time`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2); // A and B; C has no transitions, D not done
    const a = res.body.issues.find(i => i.title === 'A');
    expect(a.lead_time_h).toBeCloseTo(72);
    expect(a.cycle_time_h).toBeCloseTo(48);
    expect(res.body.avg_cycle_h).toBeCloseTo(30); // (48+12)/2
    expect(res.body.p50_cycle_h).toBeCloseTo(12); // nearest-rank of [12,48]
    expect(res.body.p85_cycle_h).toBeCloseTo(48);
  });

  test('a project with no history returns nulls and zero count, never NaN', async () => {
    const empty = await request(getApp()).post('/api/projects').set(headers)
      .send({ name: 'Empty Flow', key: 'EFW' });
    const res = await request(getApp())
      .get(`/api/projects/${empty.body.id}/reports/cycle-time`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.avg_cycle_h).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/NaN/);
  });
});

describe('time-in-status report', () => {
  test('sums hours per status across issues', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/time-in-status`).set(headers);
    expect(res.status).toBe(200);
    const todo = res.body.statuses.find(s => s.status === 'todo');
    // A: 24h todo, B: 12h todo, C: none recorded (open segment in done), D: 48h todo.
    expect(todo.total_h).toBeCloseTo(84);
    expect(todo.issues).toBe(3);
    const inProg = res.body.statuses.find(s => s.status === 'in_progress');
    expect(inProg.total_h).toBeGreaterThanOrEqual(60); // A 48h + B 12h + D open ≥ 0
  });
});

describe('cumulative-flow report', () => {
  test('reconstructs daily category counts', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/cumulative-flow?days=30`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.days.length).toBe(30);
    for (const d of res.body.days) {
      expect(d).toHaveProperty('date');
      expect(typeof d.todo).toBe('number');
      expect(typeof d.in_progress).toBe('number');
      expect(typeof d.done).toBe('number');
    }
    // The final day reflects current reality: A,B,C done; D in progress.
    const last = res.body.days[res.body.days.length - 1];
    expect(last.done).toBe(3);
    expect(last.in_progress).toBe(1);
  });

  test('days param is clamped to 90', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/cumulative-flow?days=500`).set(headers);
    expect(res.body.days.length).toBe(90);
  });
});

describe('query discipline', () => {
  test('cycle-time query count stays flat as issues grow', async () => {
    const measure = async () => {
      const original = db.prepare.bind(db);
      let n = 0;
      db.prepare = (...a) => { n += 1; return original(...a); };
      await request(getApp()).get(`/api/projects/${projectId}/reports/cycle-time`).set(headers);
      db.prepare = original;
      return n;
    };
    const small = await measure();
    for (let i = 0; i < 10; i++) {
      await seedIssue({
        title: `Bulk ${i}`, createdAt: '2026-07-01 00:00:00', status: 'done',
        transitions: [
          { from: 'todo', to: 'in_progress', at: '2026-07-02 00:00:00' },
          { from: 'in_progress', to: 'done', at: '2026-07-03 00:00:00' },
        ],
      });
    }
    const large = await measure();
    expect(large - small).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/flow-reports.test.js --runInBand --forceExit`
Expected: FAIL — all report requests 404

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/reports.js`, add to the imports at the top:

```js
const { projectStatuses } = require('./workflows');
const { categoryOf, statusTimeline, hoursBetween, percentile } = require('../utils/flow');
```

Add immediately before the CSV export route:

```js
// ===== FLOW METRICS (ATLAS-33) =====
// All three endpoints share the same two reads: the project's issues and their
// status transitions. History predating move-logging is sparse; metrics use
// created_at as entry into the first observed status and never fabricate rows.

async function loadFlowData(db, projectId) {
  const issues = await queryAll(db,
    'SELECT id, issue_key, title, type, status, created_at FROM issues WHERE project_id = ?', [projectId]);
  const transitions = issues.length === 0 ? [] : await queryAll(db, `
    SELECT a.issue_id, a.old_value, a.new_value, a.created_at
    FROM activity_log a JOIN issues i ON i.id = a.issue_id
    WHERE i.project_id = ? AND a.field = 'status'
    ORDER BY a.created_at`, [projectId]);
  const byIssue = new Map(issues.map((i) => [i.id, []]));
  for (const t of transitions) byIssue.get(t.issue_id)?.push(t);
  return { issues, byIssue };
}

router.get('/projects/:projectId/reports/cycle-time', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const { issues, byIssue } = await loadFlowData(db, req.params.projectId);

    const rows = [];
    for (const issue of issues) {
      if (categoryOf(issue.status, statuses) !== 'done') continue;
      const trans = byIssue.get(issue.id) || [];
      const doneEntry = trans.find((t) => categoryOf(t.new_value, statuses) === 'done');
      if (!doneEntry) continue; // legacy issue with no recorded completion
      const progressEntry = trans.find((t) => categoryOf(t.new_value, statuses) === 'in_progress');
      rows.push({
        id: issue.id,
        issue_key: issue.issue_key,
        title: issue.title,
        type: issue.type,
        completed_at: doneEntry.created_at,
        lead_time_h: hoursBetween(issue.created_at, doneEntry.created_at),
        cycle_time_h: progressEntry && hoursBetween(progressEntry.created_at, doneEntry.created_at) >= 0
          ? hoursBetween(progressEntry.created_at, doneEntry.created_at)
          : null,
      });
    }

    const cycles = rows.map((r) => r.cycle_time_h).filter((c) => c !== null).sort((a, b) => a - b);
    const leads = rows.map((r) => r.lead_time_h).sort((a, b) => a - b);
    const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    res.json({
      issues: rows.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1)).slice(0, 50),
      avg_cycle_h: avg(cycles),
      p50_cycle_h: percentile(cycles, 0.5),
      p85_cycle_h: percentile(cycles, 0.85),
      avg_lead_h: avg(leads),
      count: rows.length,
    });
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/time-in-status', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const { issues, byIssue } = await loadFlowData(db, req.params.projectId);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const acc = new Map(); // status -> { total_h, issues:Set }
    for (const issue of issues) {
      const timeline = statusTimeline(issue, byIssue.get(issue.id) || []);
      for (const seg of timeline) {
        // Open segments in a done-category status are excluded: time after
        // completion is not time "in" the workflow.
        const isOpenDone = seg.to === null && categoryOf(seg.status, statuses) === 'done';
        if (isOpenDone) continue;
        const h = hoursBetween(seg.from, seg.to ?? now);
        if (h <= 0) continue;
        if (!acc.has(seg.status)) acc.set(seg.status, { total_h: 0, issues: new Set() });
        const slot = acc.get(seg.status);
        slot.total_h += h;
        slot.issues.add(issue.id);
      }
    }

    const order = new Map(statuses.map((s, i) => [s.key, i]));
    res.json({
      statuses: [...acc.entries()]
        .map(([status, v]) => ({
          status,
          total_h: Math.round(v.total_h * 10) / 10,
          avg_h: Math.round((v.total_h / v.issues.size) * 10) / 10,
          issues: v.issues.size,
        }))
        .sort((a, b) => (order.get(a.status) ?? 99) - (order.get(b.status) ?? 99)),
    });
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/cumulative-flow', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const { issues, byIssue } = await loadFlowData(db, req.params.projectId);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);

    const timelines = issues.map((i) => ({
      created: i.created_at,
      segments: statusTimeline(i, byIssue.get(i.id) || []),
    }));

    const out = [];
    for (let d = days - 1; d >= 0; d--) {
      const day = new Date(Date.now() - d * 86_400_000);
      // Count state at end-of-day so today's moves are visible today.
      const stamp = day.toISOString().slice(0, 10) + ' 23:59:59';
      const counts = { todo: 0, in_progress: 0, done: 0 };
      for (const t of timelines) {
        if (t.created > stamp) continue; // not created yet on this day
        const seg = t.segments.find((s) => s.from <= stamp && (s.to === null || s.to > stamp));
        if (seg) counts[categoryOf(seg.status, statuses)] += 1;
      }
      out.push({ date: day.toISOString().slice(0, 10), ...counts });
    }
    res.json({ days: out });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/flow-reports.test.js --runInBand --forceExit`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add backend/routes/reports.js backend/tests/backend/flow-reports.test.js
git commit -m "feat(reports): cycle-time, time-in-status, cumulative-flow endpoints (ATLAS-33)"
```

---

### Task 4: Reports screen — three flow panels

**Files:**
- Modify: `frontend/src/lib/api.ts` — three methods in `reports`
- Modify: `frontend/src/screens/reports.tsx` — response interfaces, loader entries, three `Card` panels

**Interfaces:**
- Consumes: Task 3 response shapes, `charts.tsx` (`HBarChart` takes `data: { label, value }[]`; `LineChart` takes `points: { label, values: (number|null)[] }[]` + `series: string[]`; `DataTable` renders column defs), `Card`/`CardHeader`/`CardTitle`/`CardContent`.
- Produces: nothing consumed later; terminal UI task for epic 33.

- [ ] **Step 1: Add API methods**

In `frontend/src/lib/api.ts`, inside the `reports` object before `csvUrl`:

```ts
    cycleTime: (projectId: string) => get<CycleTimeResponse>(`/projects/${projectId}/reports/cycle-time`),
    timeInStatus: (projectId: string) => get<TimeInStatusResponse>(`/projects/${projectId}/reports/time-in-status`),
    cumulativeFlow: (projectId: string, days = 30) => get<CumulativeFlowResponse>(`/projects/${projectId}/reports/cumulative-flow?days=${days}`),
```

Add to `frontend/src/lib/types.ts` (and import the three names in `api.ts`):

```ts
export interface CycleTimeResponse {
  issues: { id: string; issue_key: string; title: string; type: string; completed_at: string; lead_time_h: number; cycle_time_h: number | null }[];
  avg_cycle_h: number | null;
  p50_cycle_h: number | null;
  p85_cycle_h: number | null;
  avg_lead_h: number | null;
  count: number;
}

export interface TimeInStatusResponse {
  statuses: { status: string; avg_h: number; total_h: number; issues: number }[];
}

export interface CumulativeFlowResponse {
  days: { date: string; todo: number; in_progress: number; done: number }[];
}
```

- [ ] **Step 2: Wire the loader**

In `frontend/src/screens/reports.tsx`: add state and extend the existing
`Promise.all` (the `[v, w, t, p, sr, bd, rs]` destructure) with three more
entries. Import the three response types from `@/lib/types`.

```ts
  const [cycle, setCycle] = useState<CycleTimeResponse | null>(null);
  const [tis, setTis] = useState<TimeInStatusResponse | null>(null);
  const [cfd, setCfd] = useState<CumulativeFlowResponse | null>(null);
```

In the loader, change the destructure to
`const [v, w, t, p, sr, bd, rs, ct, ts, cf] = await Promise.all([` and append:

```ts
        api.reports.cycleTime(projectId).catch(() => null),
        api.reports.timeInStatus(projectId).catch(() => null),
        api.reports.cumulativeFlow(projectId).catch(() => null),
```

then after the existing `set*` calls:

```ts
      setCycle(ct);
      setTis(ts);
      setCfd(cf);
```

- [ ] **Step 3: Render the panels**

Append after the last existing report `Card` (inside the same grid/stack), with
an hours formatter shared by all three:

```tsx
      {/* ===== Flow metrics (since tracking began) ===== */}
      {(() => {
        const fmtH = (h: number | null) =>
          h === null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(1)}h`;
        return (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Cycle time</CardTitle>
                <p className="text-xs text-muted-foreground">Completed issues, since tracking began.</p>
              </CardHeader>
              <CardContent>
                {!cycle || cycle.count === 0 ? (
                  <EmptyState title="No completed issues with recorded history yet." />
                ) : (
                  <>
                    <div className="mb-4 grid grid-cols-4 gap-3 text-center">
                      {[
                        ['Avg cycle', cycle.avg_cycle_h], ['P50', cycle.p50_cycle_h],
                        ['P85', cycle.p85_cycle_h], ['Avg lead', cycle.avg_lead_h],
                      ].map(([label, val]) => (
                        <div key={label as string} className="rounded-md border border-border p-2">
                          <p className="text-lg font-semibold">{fmtH(val as number | null)}</p>
                          <p className="text-xs text-muted-foreground">{label}</p>
                        </div>
                      ))}
                    </div>
                    <DataTable
                      caption="Recently completed issues with cycle and lead times"
                      columns={['Key', 'Title', 'Cycle', 'Lead']}
                      rows={cycle.issues.slice(0, 10).map((i) => [
                        i.issue_key, i.title, fmtH(i.cycle_time_h), fmtH(i.lead_time_h),
                      ])}
                    />
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Clock className="size-4" /> Time in status</CardTitle>
                <p className="text-xs text-muted-foreground">Average hours per status, since tracking began.</p>
              </CardHeader>
              <CardContent>
                {!tis || tis.statuses.length === 0 ? (
                  <EmptyState title="No status history recorded yet." />
                ) : (
                  <HBarChart
                    data={tis.statuses.map((s) => ({
                      label: STATUS_LABEL[s.status as IssueStatus] ?? s.status,
                      value: s.avg_h,
                    }))}
                    formatValue={(n) => fmtH(n)}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Cumulative flow (30 days)</CardTitle>
                <p className="text-xs text-muted-foreground">Issues per category per day, since tracking began.</p>
              </CardHeader>
              <CardContent>
                {!cfd || cfd.days.length < 2 ? (
                  <EmptyState title="Not enough history yet." />
                ) : (
                  <>
                    <LineChart
                      points={cfd.days.map((d) => ({
                        label: d.date.slice(5),
                        values: [d.todo, d.in_progress, d.done],
                      }))}
                      series={['To Do', 'In Progress', 'Done']}
                    />
                    <div className="mt-2">
                      <Legend items={['To Do', 'In Progress', 'Done'].map((label, i) => ({ label, color: seriesColor(i) }))} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        );
      })()}
```

Signatures verified against the source: `DataTable` takes
`{ caption: string; columns: string[]; rows: (string|number)[][] }`;
`EmptyState` takes `{ title: string; description?; icon?; action? }`. Both are
already imported by this screen.

- [ ] **Step 4: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(reports): cycle time, time-in-status and CFD panels (ATLAS-33)"
```

---

### Task 5: Search returns assignee; extractor skips [jql:] blocks

**Files:**
- Modify: `backend/routes/search.js` — JQL branch SELECT
- Modify: `backend/utils/issue-keys.js` — strip `[jql: …]` before matching
- Test: `backend/tests/backend/issue-keys.test.js` (extend) and `backend/tests/backend/wiki-issue-links.test.js` (extend)

**Interfaces:**
- Consumes: existing search route and extractor.
- Produces: JQL search rows gain `assignee_name: string|null`; `extractIssueKeys` ignores text inside `[jql: …]` spans.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/issue-keys.test.js`:

```js
  test('ignores keys inside [jql:] macro blocks', () => {
    expect(extractIssueKeys('<p>[jql: project = ATLAS AND key = ATLAS-1]</p>')).toEqual([]);
  });

  test('still finds keys outside a [jql:] block in the same document', () => {
    expect(extractIssueKeys('<p>[jql: type = bug] but ATLAS-2 matters</p>')).toEqual(['ATLAS-2']);
  });
```

Append to `backend/tests/backend/wiki-issue-links.test.js` (inside the
`forward reads` describe):

```js
  test('JQL search rows include assignee_name', async () => {
    const res = await request(getApp())
      .get(`/api/search?q=${encodeURIComponent('type = task')}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.jql).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues[0]).toHaveProperty('assignee_name');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/backend/issue-keys.test.js tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: FAIL — jql-block test extracts `ATLAS-1`; search rows lack `assignee_name`

- [ ] **Step 3: Write minimal implementation**

In `backend/utils/issue-keys.js`, add above `EXCLUDED_BLOCKS_RE`:

```js
// [jql: …] macro blocks are queries, not references — their literal text must
// not create page↔issue links (the rendered table is live, not stored).
const JQL_BLOCK_RE = /\[jql:[^\]]*\]/gi;
```

and change the strip line in `extractIssueKeys` to:

```js
  const text = html.replace(JQL_BLOCK_RE, ' ').replace(EXCLUDED_BLOCKS_RE, ' ').replace(TAG_RE, ' ');
```

In `backend/routes/search.js`, JQL branch, replace the SELECT with:

```js
      const issues = await queryAll(db, `
        SELECT i.id, i.issue_key, i.title, i.type, i.status, i.priority, i.project_id,
               p.key AS project_key, p.name AS project_name,
               u.name AS assignee_name
        FROM issues i JOIN projects p ON p.id = i.project_id
        LEFT JOIN users u ON u.id = i.assignee_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.updated_at DESC LIMIT 50`, params);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/backend/issue-keys.test.js tests/backend/wiki-issue-links.test.js tests/backend/security.test.js --runInBand --forceExit`
Expected: PASS (security suite included because it exercises search)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/search.js backend/utils/issue-keys.js backend/tests/backend/issue-keys.test.js backend/tests/backend/wiki-issue-links.test.js
git commit -m "feat(search): assignee in JQL rows; extractor skips [jql:] blocks (ATLAS-34)"
```

---

### Task 6: JQL macro — detection, fetch, table, errors

**Files:**
- Modify: `frontend/src/components/app/rich-text.tsx` — `applyMacros` detects `[jql:]` paragraphs; `RichTextView` fetches and renders tables
- Modify: `frontend/src/lib/types.ts` — `JqlSearchIssue` type
- Modify: `frontend/src/lib/api.ts` — typed `search.jql` helper

**Interfaces:**
- Consumes: `GET /api/search?q=` (`{ issues, jql }` on 200; `{ error, jql }` on 400 — surfaced via `ApiError.message`).
- Produces: `<div data-jql="…">` placeholders swapped for tables after fetch.

- [ ] **Step 1: Types and API helper**

In `frontend/src/lib/types.ts`:

```ts
/** A row from the JQL branch of /api/search, as rendered by the wiki macro. */
export interface JqlSearchIssue {
  id: string;
  issue_key: string;
  title: string;
  type: string;
  status: IssueStatus;
  priority: string;
  project_id: string;
  project_key: string;
  assignee_name: string | null;
}
```

In `frontend/src/lib/api.ts`, inside the `search` object:

```ts
    jql: (q: string) => get<{ issues: JqlSearchIssue[]; jql?: boolean }>(`/search?q=${encodeURIComponent(q)}`),
```

(add `JqlSearchIssue` to the type import).

- [ ] **Step 2: Detect the macro in applyMacros**

In `rich-text.tsx`, inside `applyMacros`, after the `[toc]` replacement block:

```ts
  // [jql: query] paragraphs become live-table placeholders; RichTextView
  // fetches results after render. Built from textContent, so nothing the
  // author wrote is ever injected as HTML.
  root.querySelectorAll('p, div').forEach((el) => {
    const m = (el.textContent || '').trim().match(/^\[jql:\s*([^\]]+)\]$/i);
    if (!m) return;
    const holder = document.createElement('div');
    holder.setAttribute('data-jql', m[1].trim());
    holder.className = 'wiki-jql-block rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground';
    holder.textContent = `Loading issues for “${m[1].trim()}”…`;
    el.replaceWith(holder);
  });
```

- [ ] **Step 3: Fetch and swap in RichTextView**

Add state and an effect to `RichTextView` (after the `rendered` memo):

```tsx
  // Results per query string; null marks a failed/invalid query with its message.
  const [jqlResults, setJqlResults] = useState<Map<string, JqlSearchIssue[] | { error: string }>>(new Map());

  useEffect(() => {
    if (!macros) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = rendered;
    const queries = [...new Set(
      [...tpl.content.querySelectorAll('div[data-jql]')].map((el) => el.getAttribute('data-jql') || ''),
    )].filter((q) => q && !jqlResults.has(q));
    if (queries.length === 0) return;
    let cancelled = false;
    void Promise.all(queries.map(async (q) => {
      try {
        const { issues } = await api.search.jql(q);
        return [q, issues] as const;
      } catch (e) {
        return [q, { error: e instanceof Error ? e.message : 'Query failed' }] as const;
      }
    })).then((pairs) => {
      if (cancelled) return;
      setJqlResults((prev) => new Map([...prev, ...pairs]));
    });
    return () => { cancelled = true; };
  }, [rendered, macros, jqlResults]);
```

Render tables by walking the container after mount. Replace the rendering
`<div>`'s `dangerouslySetInnerHTML` approach for jql blocks with a
post-render portal-free swap: keep `dangerouslySetInnerHTML`, and in a second
effect populate each placeholder:

```tsx
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll('div[data-jql]').forEach((el) => {
      const q = el.getAttribute('data-jql') || '';
      const result = jqlResults.get(q);
      if (!result) return; // still loading
      if ('error' in result && !Array.isArray(result)) {
        el.className = 'wiki-jql-block rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm';
        el.textContent = `JQL error: ${result.error}`;
        return;
      }
      const issues = result as JqlSearchIssue[];
      el.className = 'wiki-jql-block overflow-x-auto';
      el.textContent = '';
      const table = document.createElement('table');
      table.className = 'w-full text-sm';
      table.innerHTML = '<thead><tr>' +
        ['Key', 'Title', 'Status', 'Assignee'].map((h) =>
          `<th class="border-b border-border px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">${h}</th>`).join('') +
        '</tr></thead>';
      const tbody = document.createElement('tbody');
      for (const issue of issues) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-border/50';
        const key = document.createElement('td');
        key.className = 'px-2 py-1.5';
        const chip = document.createElement('a');
        chip.href = '#';
        chip.setAttribute('data-issue-id', issue.id);
        chip.setAttribute('data-issue-key', issue.issue_key);
        chip.className = 'wiki-issue-chip inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 font-mono text-[11px] font-semibold text-primary no-underline hover:bg-primary/20';
        chip.textContent = issue.issue_key;
        key.appendChild(chip);
        const title = document.createElement('td');
        title.className = 'px-2 py-1.5';
        title.textContent = issue.title;
        const status = document.createElement('td');
        status.className = 'px-2 py-1.5 text-xs text-muted-foreground';
        status.textContent = issue.status;
        const assignee = document.createElement('td');
        assignee.className = 'px-2 py-1.5 text-xs text-muted-foreground';
        assignee.textContent = issue.assignee_name ?? '—';
        tr.append(key, title, status, assignee);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      el.appendChild(table);
      if (issues.length === 50) {
        const note = document.createElement('p');
        note.className = 'mt-1.5 text-xs text-muted-foreground';
        note.textContent = 'Showing 50 — refine your query.';
        el.appendChild(note);
      }
      if (issues.length === 0) {
        el.className = 'wiki-jql-block rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground';
        el.textContent = 'No issues match this query.';
      }
    });
  }, [jqlResults, rendered]);
```

Attach `ref={containerRef}` to the rendering `<div>`. Chip clicks inside
tables already work: the existing `onClick` delegates on `a[data-issue-id]`,
but table chips are NOT in `issueMap` — so extend `onClick`'s navigation to
fall back to `/board?issue=<id>` when the key is missing from the map (the
table row's type is known; treat `type === 'epic'` rows by setting
`data-issue-type` on the chip and reading it in the handler):

In the chip-building code above, add `chip.setAttribute('data-issue-type', issue.type);`
and in `onClick` replace the navigate line with:

```ts
    const type = issueMap.get(key)?.type ?? chip.getAttribute('data-issue-type') ?? '';
    navigate(type === 'epic' ? `/epics?issue=${id}` : `/board?issue=${id}`);
```

Imports: add `useRef`, `useEffect` (already imported), `api` (already
imported), `JqlSearchIssue` to the type import.

- [ ] **Step 4: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(wiki): [jql:] macro renders a live issue table (ATLAS-34)"
```

---

### Task 7: E2E, seed epics 33-34, close-out

**Files:**
- Create: `frontend/e2e/flow-jql.spec.ts`
- Modify: `backend/database.js` — seed epics 33-34 after the `wikiLinkEpics` block
- Modify: `backend/tests/backend/epics.test.js` — expect 34

- [ ] **Step 1: E2E spec**

Create `frontend/e2e/flow-jql.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  expect(token).toBeTruthy();
  return { 'x-auth-token': token as string, 'Content-Type': 'application/json' };
}

test.describe('flow metrics', () => {
  test('reports screen shows the flow panels', async ({ page }) => {
    await login(page);
    await page.goto('/reports');
    await expect(page.getByText('Cycle time').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Time in status').first()).toBeVisible();
    await expect(page.getByText(/Cumulative flow/).first()).toBeVisible();
    await assertNoCrash(page);
  });
});

test.describe('jql macro', () => {
  test('a [jql:] block renders a live issue table', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const spaces = await (await page.request.get('/api/wiki/spaces', { headers })).json();
    const created = await (await page.request.post(`/api/wiki/spaces/${spaces[0].id}/pages`, {
      headers,
      data: { title: 'E2E jql fixture', body: '<p>[jql: type = task]</p>' },
    })).json();

    await page.goto(`/wiki/page/${created.id}`);
    const block = page.locator('.wiki-jql-block');
    await expect(block.locator('table')).toBeVisible({ timeout: 15_000 });
    await expect(block.locator('.wiki-issue-chip').first()).toBeVisible();
    await assertNoCrash(page);

    await page.request.delete(`/api/wiki/pages/${created.id}`, { headers });
  });

  test('a bad query renders an inline error, not silence', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const spaces = await (await page.request.get('/api/wiki/spaces', { headers })).json();
    const created = await (await page.request.post(`/api/wiki/spaces/${spaces[0].id}/pages`, {
      headers,
      data: { title: 'E2E jql error fixture', body: '<p>[jql: nofield = 1]</p>' },
    })).json();

    await page.goto(`/wiki/page/${created.id}`);
    await expect(page.getByText(/JQL error/).first()).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);

    await page.request.delete(`/api/wiki/pages/${created.id}`, { headers });
  });
});
```

- [ ] **Step 2: Seed epics 33-34**

In `backend/database.js`, immediately after the `wikiLinkEpics.forEach(...)`
block, add (same insert pattern, `epicWindow(32 + i)`, `board_order: 32 + i`):

```js
  // ===== Flow metrics & JQL macro wave (epics 33-34) — shipped =====
  const flowEpics = [
    { title: 'Flow metrics', color: 'orange',
      desc: 'Cycle time, time-in-status, and cumulative flow mined from the status history in activity_log — including the fix that made board moves write that history at all.',
      children: [
        { title: 'Board moves record status/sprint history', type: 'bug' },
        { title: 'Flow helpers: categories, timeline replay, percentiles', type: 'task' },
        { title: 'Cycle-time, time-in-status, CFD endpoints', type: 'story' },
        { title: 'Reports screen flow panels', type: 'task' },
      ] },
    { title: 'JQL table macro', color: 'green',
      desc: 'A [jql: …] block in a wiki page renders a live, always-current issue table via the existing search endpoint. Parse errors render inline; query text never creates back-link rows.',
      children: [
        { title: 'Assignee in JQL search rows', type: 'task' },
        { title: 'Macro detection, fetch, table, and error states', type: 'story' },
      ] },
  ];
  flowEpics.forEach((epic, i) => {
    const eid = uuid();
    const num = atlasIssueNumber;
    atlasIssueNumber += 1;
    const [startDate, dueDate] = epicWindow(32 + i);
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, epic_color, start_date, due_date, board_order)
      VALUES (?, ?, ?, ?, ?, ?, 'epic', 'done', 'high', ?, ?, ?, ?, ?)`,
      [eid, projId3, `ATLAS-${num}`, num, epic.title, epic.desc, userIds[0], epic.color, startDate, dueDate, 32 + i]);
    epic.children.forEach((c, ci) => {
      const cnum = atlasIssueNumber;
      atlasIssueNumber += 1;
      db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, assignee_id, reporter_id, parent_id, board_order)
        VALUES (?, ?, ?, ?, ?, ?, 'done', 'high', ?, ?, ?, ?)`,
        [uuid(), projId3, `ATLAS-${cnum}`, cnum, c.title, c.type, userIds[0], userIds[0], eid, ci]);
    });
  });
```

- [ ] **Step 3: Epics test expects 34**

In `backend/tests/backend/epics.test.js`: test name and both count assertions
`32` → `34`; comment gains `+ 2 flow/jql`; add:

```js
    expect(epics.body.some((e) => e.title === 'Flow metrics')).toBe(true);
```

- [ ] **Step 4: Full verification**

```bash
cd backend && npx jest --runInBand --forceExit          # all suites green
cd ../frontend && npm run build && npx playwright test  # all specs green
```
Expected: backend ~330 tests pass; E2E 11 specs pass.

- [ ] **Step 5: Commit, push, merge**

```bash
git add backend/database.js backend/tests/backend/epics.test.js frontend/e2e/flow-jql.spec.ts frontend/build
git commit -m "test(flow-jql): seed epics 33-34, E2E specs; epics test expects 34"
git push -u origin feature/flow-metrics-jql-macro
git checkout dev
git merge --no-ff feature/flow-metrics-jql-macro -m "Merge flow metrics & JQL macro wave (epics 33-34)"
cd backend && npx jest --runInBand --forceExit   # verify merge before pushing
git push origin dev
```

---

## Verification Checklist

- [ ] Full backend suite passes from `backend/`
- [ ] E2E suite passes, including both new spec files
- [ ] Frontend typechecks and builds
- [ ] A board drag in the running app produces an Activity-tab entry (manual or via move-activity tests)
- [ ] Cycle-time endpoint returns nulls (not NaN) for an empty project
- [ ] `[jql:]` literal text creates no `wiki_page_issues` rows
- [ ] `git status` clean, `dev` pushed
