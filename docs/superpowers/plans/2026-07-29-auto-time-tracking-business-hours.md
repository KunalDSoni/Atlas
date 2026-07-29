# Business-Hours-Aware Auto Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically log an issue's in-progress work time when it completes, measured in each assignee's (or project's) configured business hours instead of raw wall-clock time, with a way for a human to correct a wrong auto entry.

**Architecture:** A pure calculation helper (`businessMinutesBetween`) clips `activity_log`-derived in-progress segments to a resolved business-hours profile; a trigger in the existing status-update route inserts/replaces a `work_logs` row with `source='auto'` whenever an issue reaches a `done`-category status, unless a human has locked that issue's auto entry via edit/delete. No new tables, no cron, no timers — everything is derived from `activity_log` on read/write, matching the codebase's existing SLA/flow-metrics philosophy.

**Tech Stack:** Node.js/Express, sql.js (dev) / MySQL (prod) via the existing `queryAll`/`queryOne`/`run` wrappers, Jest + Supertest for backend tests, React (frontend/), React Native (mobile/).

## Global Constraints

- Every schema change is additive (`ALTER TABLE ... ADD COLUMN`, nullable or defaulted) and goes through `backend/migrations.js`'s ordered, append-only `MIGRATIONS` list — never edit a shipped migration id.
- Both a `sqlite` and `mysql` form are required for every schema step (`backend/migrations.js` runs the same list against both drivers).
- No new tables, no cron/background timers. Everything is computed from `activity_log` rows on read/write, per the base spec's non-goals.
- Business-hours profiles are JSON blobs: `{ timezone: string, work_days: number[] (ISO weekday 1-7), start_hour: number, end_hour: number }`. `null` means unconfigured → raw wall-clock fallback, never a fabricated implicit default.
- Attribution uses the issue's assignee **at completion time** — no per-segment assignee history.
- Reference spec: `docs/superpowers/specs/2026-07-29-auto-time-tracking-business-hours-design.md` (and the base spec it revises, `docs/superpowers/specs/2026-07-29-auto-time-tracking-design.md`).

---

### Task 1: Schema migration

**Files:**
- Modify: `backend/migrations.js` (append to `MIGRATIONS` array, after the last entry `022_dashboard_layouts` at the end of the array, before the closing `];`)
- Test: `backend/tests/backend/migrations.test.js` (check if this file exists first; if not, add assertions inline in Task 2's test file instead — see step 3 below for the actual verification approach used)

**Interfaces:**
- Produces: five new nullable/defaulted columns used by every later task:
  - `projects.business_hours` (TEXT/JSON, nullable)
  - `users.business_hours` (TEXT/JSON, nullable)
  - `work_logs.source` (TEXT, NOT NULL DEFAULT `'manual'`, CHECK IN `('manual','auto')`)
  - `work_logs.locked_from_auto` (INTEGER NOT NULL DEFAULT 0)
  - `issues.auto_worklog_locked` (INTEGER NOT NULL DEFAULT 0)

- [ ] **Step 1: Add the migration entry**

Open `backend/migrations.js`. Find the last element of `MIGRATIONS`, the `022_dashboard_layouts` object, and add a new object immediately after it (still inside the array, before the closing `];`):

```js
  {
    id: '023_auto_time_tracking_business_hours',
    description: 'Business-hours profiles for projects/users; work_logs source + lock; issue auto-worklog lock',
    steps: [
      {
        addColumn: {
          table: 'projects', column: 'business_hours',
          sqlite: 'ALTER TABLE projects ADD COLUMN business_hours TEXT',
          mysql: 'ALTER TABLE projects ADD COLUMN business_hours TEXT',
        },
      },
      {
        addColumn: {
          table: 'users', column: 'business_hours',
          sqlite: 'ALTER TABLE users ADD COLUMN business_hours TEXT',
          mysql: 'ALTER TABLE users ADD COLUMN business_hours TEXT',
        },
      },
      {
        addColumn: {
          table: 'work_logs', column: 'source',
          sqlite: "ALTER TABLE work_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
          mysql: "ALTER TABLE work_logs ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual'",
        },
      },
      {
        addColumn: {
          table: 'work_logs', column: 'locked_from_auto',
          sqlite: 'ALTER TABLE work_logs ADD COLUMN locked_from_auto INTEGER NOT NULL DEFAULT 0',
          mysql: 'ALTER TABLE work_logs ADD COLUMN locked_from_auto TINYINT NOT NULL DEFAULT 0',
        },
      },
      {
        addColumn: {
          table: 'issues', column: 'auto_worklog_locked',
          sqlite: 'ALTER TABLE issues ADD COLUMN auto_worklog_locked INTEGER NOT NULL DEFAULT 0',
          mysql: 'ALTER TABLE issues ADD COLUMN auto_worklog_locked TINYINT NOT NULL DEFAULT 0',
        },
      },
    ],
  },
```

Note: the `source` CHECK constraint from the spec (`CHECK(source IN ('manual','auto'))`) is omitted from the `ALTER TABLE ADD COLUMN` form — same reasoning as migration `001_issues_epic_color`'s comment ("ALTER cannot carry the CHECK constraint the CREATE TABLE has"). Enforce the allowed set in application code instead (Task 4/6 only ever write `'manual'` or `'auto'`).

- [ ] **Step 2: Boot the dev server and confirm the migration applies cleanly**

```bash
cd backend && rm -f data.db && node -e "require('./database').initDb().then(() => process.exit(0))"
```

Expected: no errors printed. Then verify the columns exist:

```bash
node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');
(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('./data.db'));
  console.log(db.exec(\"PRAGMA table_info(work_logs)\")[0].values.map(r => r[1]));
  console.log(db.exec(\"PRAGMA table_info(issues)\")[0].values.map(r => r[1]).includes('auto_worklog_locked'));
  console.log(db.exec(\"PRAGMA table_info(projects)\")[0].values.map(r => r[1]).includes('business_hours'));
  console.log(db.exec(\"PRAGMA table_info(users)\")[0].values.map(r => r[1]).includes('business_hours'));
})();
"
```

Expected: `work_logs` columns list includes `source` and `locked_from_auto`; the three booleans print `true`.

- [ ] **Step 3: Run the full existing backend test suite to confirm nothing broke**

```bash
cd backend && npm run test:backend
```

Expected: all existing suites still pass (this migration is purely additive, so no existing test should reference these new columns yet).

- [ ] **Step 4: Commit**

```bash
git add backend/migrations.js
git commit -m "feat(backend): add business-hours and auto-worklog-lock columns"
```

---

### Task 2: Business-hours calculation helpers (pure, unit-tested)

**Files:**
- Modify: `backend/utils/flow.js`
- Test: `backend/tests/backend/flow.test.js`

**Interfaces:**
- Consumes: nothing new (pure date math only).
- Produces (used by Task 4 and Task 7):
  - `businessMinutesBetween(start: string, end: string, profile: {timezone: string, work_days: number[], start_hour: number, end_hour: number} | null): number` — minutes of overlap between `[start, end)` and the profile's recurring weekly window; `null` profile returns raw wall-clock minutes.
  - `resolveBusinessHours(projectBusinessHours: string | null, userBusinessHours: string | null): {timezone, work_days, start_hour, end_hour} | null` — parses whichever JSON string is present, user profile taking precedence over project, `null` if neither is set or both fail to parse.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/backend/flow.test.js`:

```js
const { businessMinutesBetween, resolveBusinessHours } = require('../../utils/flow');

describe('resolveBusinessHours', () => {
  const proj = JSON.stringify({ timezone: 'UTC', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 17 });
  const user = JSON.stringify({ timezone: 'Asia/Kolkata', work_days: [1,2,3,4,5], start_hour: 10, end_hour: 19 });

  test('user override wins over project default', () => {
    expect(resolveBusinessHours(proj, user)).toEqual({ timezone: 'Asia/Kolkata', work_days: [1,2,3,4,5], start_hour: 10, end_hour: 19 });
  });
  test('falls back to project default when no user override', () => {
    expect(resolveBusinessHours(proj, null)).toEqual({ timezone: 'UTC', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 17 });
  });
  test('null when neither is set', () => {
    expect(resolveBusinessHours(null, null)).toBeNull();
  });
  test('null when JSON is malformed', () => {
    expect(resolveBusinessHours('not json', null)).toBeNull();
  });
});

describe('businessMinutesBetween', () => {
  const utc95 = { timezone: 'UTC', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 17 };

  test('null profile falls back to raw wall-clock minutes', () => {
    expect(businessMinutesBetween('2026-07-06 09:00:00', '2026-07-06 17:00:00', null)).toBe(480);
  });

  test('same-day partial overlap within business hours', () => {
    // Monday 2026-07-06, 10:00-14:00 UTC, fully inside 9-17
    expect(businessMinutesBetween('2026-07-06 10:00:00', '2026-07-06 14:00:00', utc95)).toBe(240);
  });

  test('segment entirely outside work hours is zero', () => {
    // Monday 2026-07-06, 20:00-22:00 UTC, after 17:00 close
    expect(businessMinutesBetween('2026-07-06 20:00:00', '2026-07-06 22:00:00', utc95)).toBe(0);
  });

  test('multi-day span crossing a weekend excludes Sat/Sun', () => {
    // Friday 2026-07-03 09:00 through Monday 2026-07-06 17:00, Mon-Fri 9-17 profile.
    // Fri: 8h, Sat/Sun: 0h, Mon: 8h = 16h = 960 minutes.
    expect(businessMinutesBetween('2026-07-03 09:00:00', '2026-07-06 17:00:00', utc95)).toBe(960);
  });

  test('Sun-Thu work week (Gulf-region profile) counts Sunday, excludes Friday', () => {
    const sunThu = { timezone: 'UTC', work_days: [7,1,2,3,4], start_hour: 9, end_hour: 17 };
    // Friday 2026-07-03 09:00 (not a work day) through Sunday 2026-07-05 17:00 (a work day).
    // Fri: 0h, Sat: 0h, Sun: 8h = 480 minutes.
    expect(businessMinutesBetween('2026-07-03 09:00:00', '2026-07-05 17:00:00', sunThu)).toBe(480);
  });

  test('timezone conversion: a segment framed in local time crossing midnight UTC', () => {
    // Asia/Kolkata is UTC+5:30. 2026-07-06 08:00 IST = 2026-07-06 02:30 UTC.
    // Segment 2026-07-06 02:30 UTC to 2026-07-06 06:30 UTC = 08:00-12:00 IST, fully inside a 9-18 IST window? No —
    // 08:00 IST is before a 9am start, so only 09:00-12:00 IST (3h) counts.
    const ist = { timezone: 'Asia/Kolkata', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 18 };
    expect(businessMinutesBetween('2026-07-06 02:30:00', '2026-07-06 06:30:00', ist)).toBe(180);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/backend/flow.test.js -t "businessMinutesBetween|resolveBusinessHours" --verbose
```

Expected: FAIL — `businessMinutesBetween is not a function` / `resolveBusinessHours is not a function` (not yet exported).

- [ ] **Step 3: Implement the helpers in `backend/utils/flow.js`**

Add above the existing `module.exports` line:

```js
/** Parse a business_hours JSON column value; null/invalid => null (unconfigured). */
function parseBusinessHours(json) {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (!p || !Array.isArray(p.work_days) || typeof p.start_hour !== 'number' || typeof p.end_hour !== 'number' || !p.timezone) return null;
    return p;
  } catch { return null; }
}

/**
 * Resolve the effective business-hours profile: user override wins over
 * project default; null when neither is configured (raw wall-clock fallback).
 */
function resolveBusinessHours(projectBusinessHours, userBusinessHours) {
  return parseBusinessHours(userBusinessHours) || parseBusinessHours(projectBusinessHours);
}

/** ISO weekday (1=Monday..7=Sunday) of a Date, in a given IANA timezone. */
function isoWeekdayInTz(date, timezone) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd];
}

/** Hour-of-day (0-23) of a Date, in a given IANA timezone. */
function hourInTz(date, timezone) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(date));
}

/** Parse a stored datetime string ('YYYY-MM-DD HH:MM:SS' or ISO) as a UTC Date. */
function parseUtc(s) {
  return new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));
}

/**
 * Minutes of overlap between [start, end) and a recurring weekly business-hours
 * window. `profile` is `{ timezone, work_days: number[] (ISO 1-7), start_hour,
 * end_hour }` or null. A null profile returns raw wall-clock minutes — the
 * unconfigured fallback is the same code path as "no clipping", not a branch.
 */
function businessMinutesBetween(start, end, profile) {
  const startDate = parseUtc(start);
  const endDate = parseUtc(end);
  if (!profile) return Math.max(0, (endDate - startDate) / 60_000);

  let totalMs = 0;
  // Walk minute-granularity is too slow for multi-day spans; instead walk
  // day-by-day in the profile's timezone and intersect each day's window.
  let cursor = new Date(startDate);
  // Step back to the start of the local calendar day so the loop always
  // begins its intersection check from a day boundary.
  for (let guard = 0; guard < 3650 && cursor < endDate; guard++) {
    const weekday = isoWeekdayInTz(cursor, profile.timezone);
    // Build this local day's work-window as UTC instants by scanning
    // minute-offsets is unnecessary — instead locate local midnight for
    // `cursor` by formatting it, then add hour offsets, relying on the
    // Intl-derived weekday/hour to validate we're still within the same
    // local calendar day as we advance.
    const dayStartLocalHour = hourInTz(cursor, profile.timezone);
    // Find the UTC instant corresponding to `profile.start_hour` and
    // `profile.end_hour` on this local calendar day by binary-searching
    // is overkill; instead derive local Y-M-D via Intl and reconstruct.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(cursor).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    const localMidnightUtcGuess = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
    // localMidnightUtcGuess treats the local Y-M-D as if it were UTC; the
    // actual local midnight is offset from UTC by the timezone's offset at
    // that instant. Compute that offset by comparing the guess's own
    // rendered local hour against 0.
    const guessLocalHour = hourInTz(localMidnightUtcGuess, profile.timezone);
    // guessLocalHour is the local hour that UTC-midnight-of-that-Y-M-D reads
    // as; the true local midnight is `guessLocalHour` hours earlier in UTC.
    const trueLocalMidnightUtc = new Date(localMidnightUtcGuess.getTime() - guessLocalHour * 3_600_000);
    const dayWorkStart = new Date(trueLocalMidnightUtc.getTime() + profile.start_hour * 3_600_000);
    const dayWorkEnd = new Date(trueLocalMidnightUtc.getTime() + profile.end_hour * 3_600_000);

    if (profile.work_days.includes(weekday)) {
      const overlapStart = new Date(Math.max(startDate, dayWorkStart));
      const overlapEnd = new Date(Math.min(endDate, dayWorkEnd));
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
    }

    // Advance to the next local calendar day's midnight.
    cursor = new Date(trueLocalMidnightUtc.getTime() + 24 * 3_600_000);
    void dayStartLocalHour; // computed for guard clarity only, not otherwise used
  }
  return Math.round(totalMs / 60_000);
}

module.exports = { categoryOf, statusTimeline, hoursBetween, percentile, businessMinutesBetween, resolveBusinessHours };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest tests/backend/flow.test.js --verbose
```

Expected: PASS for every test in the file, including the new `businessMinutesBetween`/`resolveBusinessHours` blocks. If the timezone-crossing-midnight test fails, double check the day-walk loop's `trueLocalMidnightUtc` computation against the exact expected minute counts in the test comments — recompute by hand for `Asia/Kolkata` (UTC+5:30) before changing the test's expected value.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/flow.js backend/tests/backend/flow.test.js
git commit -m "feat(backend): add business-hours-aware duration helpers"
```

---

### Task 3: Shared `recomputeTimeSpent` helper + refactor manual worklog routes

**Files:**
- Create: `backend/utils/worklog-sync.js`
- Modify: `backend/routes/worklogs.js`
- Test: `backend/tests/backend/worklog-sync.test.js` (new)

**Interfaces:**
- Consumes: `queryAll`, `run` from `../database` (existing signatures: `queryAll(db, sql, params)`, `run(db, sql, params)`).
- Produces (used by Task 3's own routes and Task 4):
  - `async function recomputeTimeSpent(db, issueId): Promise<number>` — sums `work_logs.minutes` for the issue, writes the sum to `issues.time_spent`, returns the new total.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/worklog-sync.test.js`:

```js
const { createTestApp, getApp, adminHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryOne, run } = require('../../database');
const { recomputeTimeSpent } = require('../../utils/worklog-sync');
const { v4: uuidv4 } = require('uuid');

let headers, db, projectId;

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

test('recomputeTimeSpent sums all work_logs rows and writes issues.time_spent', async () => {
  const created = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title: 'Recompute test', type: 'task' });
  const issueId = created.body.id;

  await run(db, 'INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), issueId, created.body.reporter_id, 30, 'manual']);
  await run(db, 'INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), issueId, created.body.reporter_id, 45, 'auto']);

  const total = await recomputeTimeSpent(db, issueId);
  expect(total).toBe(75);

  const issue = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issueId]);
  expect(Number(issue.time_spent)).toBe(75);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/backend/worklog-sync.test.js --verbose
```

Expected: FAIL — `Cannot find module '../../utils/worklog-sync'`.

- [ ] **Step 3: Implement `backend/utils/worklog-sync.js`**

```js
// ===== WORK LOG SYNC =====
// issues.time_spent is a denormalized rollup of work_logs.minutes. Recomputed
// from scratch (not incremented/decremented) because auto-log rows can be
// replaced wholesale (see utils/auto-worklog.js), so an add/subtract delta is
// not safe here the way it was for manual-only entries.

const { queryAll, run } = require('../database');

async function recomputeTimeSpent(db, issueId) {
  const rows = await queryAll(db, 'SELECT minutes FROM work_logs WHERE issue_id = ?', [issueId]);
  const total = rows.reduce((sum, r) => sum + Number(r.minutes), 0);
  await run(db, "UPDATE issues SET time_spent = ?, updated_at = datetime('now') WHERE id = ?", [total, issueId]);
  return total;
}

module.exports = { recomputeTimeSpent };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/backend/worklog-sync.test.js --verbose
```

Expected: PASS.

- [ ] **Step 5: Refactor `backend/routes/worklogs.js` to use `recomputeTimeSpent`**

Replace the file's contents with:

```js
// ===== TIME TRACKING MODULE =====
// GET    /api/issues/:id/worklogs - Work log entries for an issue (newest first)
// POST   /api/issues/:id/worklogs - Log work { minutes, comment? }; source='manual'
// PATCH  /api/worklogs/:id - Edit a work log (author or admin); auto rows become
//                            manual + locked, so a later auto-recompute won't
//                            silently overwrite the correction (utils/auto-worklog.js)
// DELETE /api/worklogs/:id - Remove a work log (author or admin)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { recomputeTimeSpent } = require('../utils/worklog-sync');

const router = express.Router();

function canEditWorklog(log, req) {
  return log.user_id === req.userId || req.userRole === 'admin';
}

// GET /api/issues/:issueId/worklogs
router.get('/issues/:issueId/worklogs', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const logs = await queryAll(db, `
      SELECT w.*, u.name AS user_name, u.avatar_color AS user_color
      FROM work_logs w LEFT JOIN users u ON u.id = w.user_id
      WHERE w.issue_id = ? ORDER BY w.created_at DESC`, [req.params.issueId]);
    res.json(logs.map((l) => ({ ...l, minutes: Number(l.minutes) })));
  } catch (e) { serverError(res, e); }
});

// POST /api/issues/:issueId/worklogs
router.post('/issues/:issueId/worklogs', requireAuth, async (req, res) => {
  try {
    const minutes = Math.round(Number(req.body.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ error: 'minutes must be a positive number' });
    }
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT id FROM issues WHERE id = ?', [req.params.issueId]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const id = uuidv4();
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'manual')",
      [id, req.params.issueId, req.userId, minutes, req.body.comment || null]);
    await recomputeTimeSpent(db, req.params.issueId);

    const log = await queryOne(db, `
      SELECT w.*, u.name AS user_name, u.avatar_color AS user_color
      FROM work_logs w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?`, [id]);
    res.status(201).json({ ...log, minutes: Number(log.minutes) });
  } catch (e) { serverError(res, e); }
});

// PATCH /api/worklogs/:id
router.patch('/worklogs/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const log = await queryOne(db, 'SELECT * FROM work_logs WHERE id = ?', [req.params.id]);
    if (!log) return res.status(404).json({ error: 'Work log not found' });
    if (!canEditWorklog(log, req)) return res.status(403).json({ error: 'Not your work log' });

    const updates = [];
    const params = [];
    if (req.body.minutes !== undefined) {
      const minutes = Math.round(Number(req.body.minutes));
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ error: 'minutes must be a positive number' });
      }
      updates.push('minutes = ?');
      params.push(minutes);
    }
    if (req.body.comment !== undefined) {
      updates.push('comment = ?');
      params.push(req.body.comment || null);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    // Editing an auto-generated entry converts it to a locked manual entry —
    // see utils/auto-worklog.js: a locked issue is skipped on the next
    // status-completion recompute, so the human correction sticks.
    if (log.source === 'auto') {
      updates.push("source = 'manual'", 'locked_from_auto = 1');
      await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [log.issue_id]);
    }

    params.push(req.params.id);
    await run(db, `UPDATE work_logs SET ${updates.join(', ')} WHERE id = ?`, params);
    await recomputeTimeSpent(db, log.issue_id);

    const updated = await queryOne(db, `
      SELECT w.*, u.name AS user_name, u.avatar_color AS user_color
      FROM work_logs w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?`, [req.params.id]);
    res.json({ ...updated, minutes: Number(updated.minutes) });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/worklogs/:id
router.delete('/worklogs/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const log = await queryOne(db, 'SELECT * FROM work_logs WHERE id = ?', [req.params.id]);
    if (!log) return res.status(404).json({ error: 'Work log not found' });
    if (!canEditWorklog(log, req)) return res.status(403).json({ error: 'Not your work log' });

    // Deleting an auto entry is "I don't want this counted" — lock the issue
    // so the next completion doesn't regenerate it (utils/auto-worklog.js).
    if (log.source === 'auto') {
      await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [log.issue_id]);
    }

    await run(db, 'DELETE FROM work_logs WHERE id = ?', [req.params.id]);
    await recomputeTimeSpent(db, log.issue_id);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
```

- [ ] **Step 6: Add a PATCH test to `worklog-sync.test.js`** (append to the same file from Step 1)

```js
test('PATCH /api/worklogs/:id edits minutes and recomputes time_spent', async () => {
  const created = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title: 'Patch test', type: 'task' });
  const issueId = created.body.id;

  const logRes = await request(getApp())
    .post(`/api/issues/${issueId}/worklogs`).set(headers)
    .send({ minutes: 30, comment: 'initial' });
  const logId = logRes.body.id;

  const patchRes = await request(getApp())
    .patch(`/api/worklogs/${logId}`).set(headers)
    .send({ minutes: 50 });
  expect(patchRes.status).toBe(200);
  expect(patchRes.body.minutes).toBe(50);

  const issue = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issueId]);
  expect(Number(issue.time_spent)).toBe(50);
});

test('editing an auto work log locks the issue against future auto-recompute', async () => {
  const created = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title: 'Auto lock test', type: 'task' });
  const issueId = created.body.id;

  const autoId = uuidv4();
  await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, 'auto')",
    [autoId, issueId, created.body.reporter_id, 60]);

  await request(getApp()).patch(`/api/worklogs/${autoId}`).set(headers).send({ minutes: 90 });

  const issue = await queryOne(db, 'SELECT auto_worklog_locked FROM issues WHERE id = ?', [issueId]);
  expect(Number(issue.auto_worklog_locked)).toBe(1);
  const log = await queryOne(db, 'SELECT source, locked_from_auto FROM work_logs WHERE id = ?', [autoId]);
  expect(log.source).toBe('manual');
  expect(Number(log.locked_from_auto)).toBe(1);
});
```

- [ ] **Step 7: Run the full worklog-sync test file**

```bash
cd backend && npx jest tests/backend/worklog-sync.test.js --verbose
```

Expected: PASS, all 4 tests.

- [ ] **Step 8: Run the full backend suite to confirm no regressions in other worklog-dependent tests**

```bash
cd backend && npm run test:backend
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/utils/worklog-sync.js backend/routes/worklogs.js backend/tests/backend/worklog-sync.test.js
git commit -m "feat(backend): shared time_spent recompute + editable/lockable work logs"
```

---

### Task 4: Auto-log-on-completion helper

**Files:**
- Create: `backend/utils/auto-worklog.js`
- Test: `backend/tests/backend/auto-worklog.test.js` (new)

**Interfaces:**
- Consumes: `queryAll`, `queryOne`, `run` from `../database`; `categoryOf`, `statusTimeline`, `businessMinutesBetween`, `resolveBusinessHours` from `./flow`; `recomputeTimeSpent` from `./worklog-sync`; `v4 as uuidv4` from `uuid`.
- Produces (used by Task 5 and Task 7):
  - `async function inProgressSegments(db, issue, statuses): Promise<{from: string, to: string|null}[]>` — this issue's status-transition segments (via `activity_log`) filtered to those whose `categoryOf(segment.status, statuses) === 'in_progress'`.
  - `async function applyAutoWorklog(db, issue, statuses): Promise<void>` — computes business-hours-clipped total across `inProgressSegments`, and unless `issue.auto_worklog_locked` is truthy, deletes any existing `source='auto'` row for the issue and inserts a fresh one (skips insert entirely if total is 0), then calls `recomputeTimeSpent`.
  - `async function liveInProgressMinutes(db, issue, statuses): Promise<number|null>` — same segment math as `applyAutoWorklog` but with the final open segment's `to` treated as `now`, returning `null` when the issue's current status category is not `in_progress`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/backend/auto-worklog.test.js`:

```js
const { createTestApp, getApp, adminHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryOne, queryAll, run } = require('../../database');
const { applyAutoWorklog, liveInProgressMinutes } = require('../../utils/auto-worklog');
const { projectStatuses } = require('../../routes/workflows');

let headers, db, projectId;

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

async function mkIssue(title) {
  const res = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title, type: 'task' });
  return res.body;
}

test('applyAutoWorklog sums in-progress segments (raw wall-clock, no business_hours configured) into a fresh auto row', async () => {
  const issue = await mkIssue('Auto worklog basic');
  const actId1 = 'a1', actId2 = 'a2';
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES (?, ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [actId1, issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES (?, ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 11:00:00')`, [actId2, issue.id, issue.reporter_id]);
  await run(db, "UPDATE issues SET status = 'done' WHERE id = ?", [issue.id]);

  const statuses = await projectStatuses(db, projectId);
  const fresh = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  await applyAutoWorklog(db, fresh, statuses);

  const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(logs).toHaveLength(1);
  expect(Number(logs[0].minutes)).toBe(120);
  const updatedIssue = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
  expect(Number(updatedIssue.time_spent)).toBe(120);
});

test('applyAutoWorklog replaces the prior auto row on re-completion (reopen -> redo -> done)', async () => {
  const issue = await mkIssue('Auto worklog reopen');
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
  const statuses = await projectStatuses(db, projectId);
  await applyAutoWorklog(db, { ...issue, status: 'done' }, statuses);
  let logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(Number(logs[0].minutes)).toBe(60);

  // Reopen and redo for two more hours, then complete again.
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a3', ?, ?, 'update', 'status', 'done', 'in_progress', '2026-07-07 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a4', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-07 11:00:00')`, [issue.id, issue.reporter_id]);
  await applyAutoWorklog(db, { ...issue, status: 'done' }, statuses);

  logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(logs).toHaveLength(1); // replaced, not duplicated
  expect(Number(logs[0].minutes)).toBe(180); // 60 + 120, cumulative total
});

test('applyAutoWorklog falls back to the actor when the issue is unassigned', async () => {
  const issue = await mkIssue('Auto worklog unassigned');
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
  const statuses = await projectStatuses(db, projectId);
  const freshIssue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  expect(freshIssue.assignee_id).toBeNull();
  await applyAutoWorklog(db, freshIssue, statuses, issue.reporter_id);

  const log = await queryOne(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(log.user_id).toBe(issue.reporter_id);
});

test('applyAutoWorklog skips regeneration when issues.auto_worklog_locked is set', async () => {
  const issue = await mkIssue('Auto worklog locked');
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [issue.id]);
  const statuses = await projectStatuses(db, projectId);
  const freshIssue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  await applyAutoWorklog(db, freshIssue, statuses);

  const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(logs).toHaveLength(0);
});

test('manual work logs are untouched by applyAutoWorklog', async () => {
  const issue = await mkIssue('Manual untouched');
  await request(getApp()).post(`/api/issues/${issue.id}/worklogs`).set(headers).send({ minutes: 15, comment: 'manual entry' });
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
  const statuses = await projectStatuses(db, projectId);
  const freshIssue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  await applyAutoWorklog(db, freshIssue, statuses);

  const manualLogs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'manual'", [issue.id]);
  expect(manualLogs).toHaveLength(1);
  expect(Number(manualLogs[0].minutes)).toBe(15);
  const issueRow = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
  expect(Number(issueRow.time_spent)).toBe(15 + 60); // manual + auto
});

test('liveInProgressMinutes returns null when the issue is not in an in_progress-category status', async () => {
  const issue = await mkIssue('Live value todo');
  const statuses = await projectStatuses(db, projectId);
  const freshIssue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  expect(await liveInProgressMinutes(db, freshIssue, statuses)).toBeNull();
});

test('liveInProgressMinutes measures the open segment against now', async () => {
  const issue = await mkIssue('Live value in progress');
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('a1', ?, ?, 'update', 'status', 'todo', 'in_progress', ?)`, [issue.id, issue.reporter_id, oneHourAgo]);
  await run(db, "UPDATE issues SET status = 'in_progress' WHERE id = ?", [issue.id]);
  const statuses = await projectStatuses(db, projectId);
  const freshIssue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  const minutes = await liveInProgressMinutes(db, freshIssue, statuses);
  expect(minutes).toBeGreaterThanOrEqual(59);
  expect(minutes).toBeLessThanOrEqual(61);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js --verbose
```

Expected: FAIL — `Cannot find module '../../utils/auto-worklog'`.

- [ ] **Step 3: Implement `backend/utils/auto-worklog.js`**

```js
// ===== AUTO WORK LOG =====
// Derives a work_logs 'auto' row from activity_log status transitions instead
// of requiring manual entry. Triggered on completion (utils used by
// routes/issues.js); no timers, no polling — recomputed on write, read the
// same way the cycle-time/time-in-status reports already do
// (routes/reports.js's loadFlowData + utils/flow.js's statusTimeline).

const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, run } = require('../database');
const { categoryOf, statusTimeline, businessMinutesBetween, resolveBusinessHours } = require('./flow');
const { recomputeTimeSpent } = require('./worklog-sync');

async function inProgressSegments(db, issue, statuses) {
  const transitions = await queryAll(db,
    "SELECT old_value, new_value, created_at FROM activity_log WHERE issue_id = ? AND field = 'status' ORDER BY created_at",
    [issue.id]);
  const timeline = statusTimeline(issue, transitions);
  return timeline.filter((seg) => categoryOf(seg.status, statuses) === 'in_progress');
}

async function resolvedProfileFor(db, issue, userId) {
  const [project, user] = await Promise.all([
    queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [issue.project_id]),
    userId ? queryOne(db, 'SELECT business_hours FROM users WHERE id = ?', [userId]) : null,
  ]);
  return resolveBusinessHours(project?.business_hours, user?.business_hours);
}

/**
 * Sums business-hours-clipped in-progress time and (re)writes a single
 * source='auto' work_logs row, unless issue.auto_worklog_locked is set (a
 * human already corrected/deleted the auto entry for this issue — see
 * routes/worklogs.js PATCH/DELETE).
 *
 * `fallbackActorId` is used as the work log's user_id when the issue has no
 * assignee (matches the base spec's unassigned-issue rule).
 */
async function applyAutoWorklog(db, issue, statuses, fallbackActorId) {
  if (Number(issue.auto_worklog_locked)) return;

  const segments = (await inProgressSegments(db, issue, statuses))
    .filter((seg) => seg.to !== null); // completed segments only; the final open segment is handled by liveInProgressMinutes
  const attributedUserId = issue.assignee_id || fallbackActorId;
  const profile = await resolvedProfileFor(db, issue, attributedUserId);

  const totalMinutes = Math.round(
    segments.reduce((sum, seg) => sum + businessMinutesBetween(seg.from, seg.to, profile), 0)
  );

  await run(db, "DELETE FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  if (totalMinutes > 0) {
    await run(db,
      "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'auto')",
      [uuidv4(), issue.id, attributedUserId, totalMinutes, 'Auto-logged: time in progress']);
  }
  await recomputeTimeSpent(db, issue.id);
}

/**
 * Live (uncommitted) in-progress minutes for an issue currently sitting in an
 * in_progress-category status, measured against now. Null when the issue's
 * current status isn't in that category — nothing to show.
 */
async function liveInProgressMinutes(db, issue, statuses) {
  if (categoryOf(issue.status, statuses) !== 'in_progress') return null;

  const segments = await inProgressSegments(db, issue, statuses);
  const openSegment = segments.find((seg) => seg.to === null);
  if (!openSegment) return null;

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const attributedUserId = issue.assignee_id;
  const profile = await resolvedProfileFor(db, issue, attributedUserId);

  const closedTotal = segments
    .filter((seg) => seg.to !== null)
    .reduce((sum, seg) => sum + businessMinutesBetween(seg.from, seg.to, profile), 0);
  const openMinutes = businessMinutesBetween(openSegment.from, now, profile);
  return Math.round(closedTotal + openMinutes);
}

module.exports = { inProgressSegments, applyAutoWorklog, liveInProgressMinutes };
```

Note on `applyAutoWorklog`'s segment sum: it only includes *closed* in-progress segments (`seg.to !== null`) because at the moment this runs, the issue is transitioning *into* `done` — the in-progress segment that just ended is now closed by the very transition that triggered this call (its `to` is the completion timestamp, already present in `activity_log` by the time this function runs — see Task 5's call site, which reads `activity_log` *after* the status-update write).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js --verbose
```

Expected: PASS, all 7 tests. If the "replaces prior auto row" test fails with a doubled total, check that the `DELETE FROM work_logs WHERE issue_id = ? AND source = 'auto'` runs before the new segment sum is computed from `activity_log` (it should be independent — the delete only affects `work_logs`, not `activity_log` — so re-check the segment filter/sum math instead).

- [ ] **Step 5: Commit**

```bash
git add backend/utils/auto-worklog.js backend/tests/backend/auto-worklog.test.js
git commit -m "feat(backend): derive auto work-log entries from in-progress activity_log segments"
```

---

### Task 5: Wire auto-log into the issue status-update route

**Files:**
- Modify: `backend/routes/issues.js`
- Test: `backend/tests/backend/auto-worklog.test.js` (append integration-level tests)

**Interfaces:**
- Consumes: `applyAutoWorklog`, `inProgressSegments` from `../utils/auto-worklog` (Task 4); existing `projectStatuses`, `categoryOf` (already imported/available), `run` from `../database`.
- Produces: no new exports — this task only adds behavior at the existing `PUT /api/issues/:id` route's status-change block (around line 434 in the current file, right after `checkAllSubtasksDone`).

- [ ] **Step 1: Write the failing integration tests**

Append to `backend/tests/backend/auto-worklog.test.js`:

```js
describe('PUT /api/issues/:id triggers auto-worklog on completion', () => {
  test('moving an issue to a done-category status auto-logs its in-progress time', async () => {
    const issue = await mkIssue('Integration auto log');
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    // Backdate the transition so there's a measurable, deterministic span.
    await run(db, "UPDATE activity_log SET created_at = '2026-07-06 09:00:00' WHERE issue_id = ? AND field = 'status' AND new_value = 'in_progress'", [issue.id]);

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
    expect(logs).toHaveLength(1);
    expect(Number(logs[0].minutes)).toBeGreaterThan(0);
  });

  test('moving an issue back to a todo-category status clears auto_worklog_locked', async () => {
    const issue = await mkIssue('Integration lock clear');
    await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [issue.id]);

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'todo' });

    const updated = await queryOne(db, 'SELECT auto_worklog_locked FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.auto_worklog_locked)).toBe(0);
  });

  test('a locked issue does not get its auto row regenerated on re-completion', async () => {
    const issue = await mkIssue('Integration stays locked');
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });
    const [autoLog] = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
    await request(getApp()).patch(`/api/worklogs/${autoLog.id}`).set(headers).send({ minutes: 999 });

    // Reopen straight to in_progress (no todo stop) and complete again.
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const logs = await queryAll(db, 'SELECT * FROM work_logs WHERE issue_id = ?', [issue.id]);
    expect(logs).toHaveLength(1);
    expect(Number(logs[0].minutes)).toBe(999); // human correction survived
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js -t "triggers auto-worklog" --verbose
```

Expected: FAIL — no `work_logs` rows created (route doesn't call `applyAutoWorklog` yet).

- [ ] **Step 3: Wire the calls into `backend/routes/issues.js`**

Add the import near the top, alongside the other `utils/` requires:

```js
const { applyAutoWorklog } = require('../utils/auto-worklog');
```

Then in the `PUT /api/issues/:id` handler, find this existing block (around line 434):

```js
    let updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (req.body.status !== undefined && req.body.status !== issue.status) {
      await sla.onStatusChange(db, updated, updated.status);
      await runAutomation(db, { type: 'status_changed', issue: updated, actorId: req.userId });
      await checkAllSubtasksDone(db, updated, req.userId);
      updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    }
```

Replace it with:

```js
    let updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (req.body.status !== undefined && req.body.status !== issue.status) {
      await sla.onStatusChange(db, updated, updated.status);
      await runAutomation(db, { type: 'status_changed', issue: updated, actorId: req.userId });
      await checkAllSubtasksDone(db, updated, req.userId);

      const statuses = await projectStatuses(db, updated.project_id);
      const newCategory = categoryOf(updated.status, statuses);
      if (newCategory === 'done') {
        await applyAutoWorklog(db, updated, statuses, req.userId);
      } else if (newCategory === 'todo') {
        await run(db, 'UPDATE issues SET auto_worklog_locked = 0 WHERE id = ?', [updated.id]);
      }

      updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    }
```

Add `categoryOf` to the existing `require('../utils/flow')` — this file doesn't import `utils/flow` yet, so add a new require line near the other utils imports:

```js
const { categoryOf } = require('../utils/flow');
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js --verbose
```

Expected: PASS, all tests in the file (unit + integration).

- [ ] **Step 5: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS — in particular re-check `tests/backend/move-activity.test.js` (status-move activity logging) still passes unchanged, since this task touches the same code region.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/issues.js backend/tests/backend/auto-worklog.test.js
git commit -m "feat(backend): trigger auto work-log on issue completion"
```

---

### Task 6: Live in-progress value on `GET /api/issues/:id`

**Files:**
- Modify: `backend/routes/issues.js`
- Test: `backend/tests/backend/auto-worklog.test.js` (append)

**Interfaces:**
- Consumes: `liveInProgressMinutes` from `../utils/auto-worklog` (Task 4).
- Produces: `GET /api/issues/:id` response gains `in_progress_minutes_live: number | null`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/auto-worklog.test.js`:

```js
describe('GET /api/issues/:id includes in_progress_minutes_live', () => {
  test('null when the issue is not in progress', async () => {
    const issue = await mkIssue('Live field todo');
    const res = await request(getApp()).get(`/api/issues/${issue.id}`).set(headers);
    expect(res.body.in_progress_minutes_live).toBeNull();
  });

  test('a positive number while the issue is in progress', async () => {
    const issue = await mkIssue('Live field in progress');
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await run(db, "UPDATE activity_log SET created_at = datetime('now', '-30 minutes') WHERE issue_id = ? AND field = 'status'", [issue.id]);

    const res = await request(getApp()).get(`/api/issues/${issue.id}`).set(headers);
    expect(res.body.in_progress_minutes_live).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js -t "in_progress_minutes_live" --verbose
```

Expected: FAIL — `in_progress_minutes_live` is `undefined` in the response body.

- [ ] **Step 3: Update the `GET /api/issues/:id` handler**

Find (near the top of the file, per the earlier read):

```js
// GET /api/issues/:id
router.get('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(await enrichIssue(db, issue));
  } catch (e) { serverError(res, e); }
});
```

Replace with:

```js
// GET /api/issues/:id
router.get('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    const enriched = await enrichIssue(db, issue);
    const statuses = await projectStatuses(db, issue.project_id);
    enriched.in_progress_minutes_live = await liveInProgressMinutes(db, issue, statuses);
    res.json(enriched);
  } catch (e) { serverError(res, e); }
});
```

Add `liveInProgressMinutes` to the existing Task 5 import line:

```js
const { applyAutoWorklog, liveInProgressMinutes } = require('../utils/auto-worklog');
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js --verbose
```

Expected: PASS, all tests.

- [ ] **Step 5: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/issues.js backend/tests/backend/auto-worklog.test.js
git commit -m "feat(backend): expose live in-progress minutes on GET /api/issues/:id"
```

---

### Task 7: Sprint/user rollup endpoint + CSV exports

**Files:**
- Modify: `backend/routes/reports.js`
- Test: `backend/tests/backend/flow-reports.test.js`

**Interfaces:**
- Consumes: `queryAll` (existing).
- Produces: `GET /api/projects/:projectId/reports/time-tracking` → `{ by_sprint: [...], by_user: [...] }`; `GET /api/projects/:projectId/reports/time-tracking/export/csv`; the existing `GET /api/projects/:id/reports/export/csv` gains a `Time Spent (min)` column.

- [ ] **Step 1: Write the failing tests**

Check the existing test file's setup pattern first:

```bash
cd backend && head -30 tests/backend/flow-reports.test.js
```

Append tests matching that file's existing style (same `createTestApp`/`adminHeaders`/`projectId` setup already present in that file — reuse it, do not redeclare `beforeAll`):

```js
describe('GET /reports/time-tracking', () => {
  test('splits minutes by sprint and by user, by source', async () => {
    const issueRes = await request(getApp())
      .post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Rollup test', type: 'task', sprint_id: sprintId });
    const issue = issueRes.body;
    await request(getApp()).post(`/api/issues/${issue.id}/worklogs`).set(headers).send({ minutes: 20, comment: 'manual' });

    const db = await getDb();
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, 'auto')",
      [require('uuid').v4(), issue.id, issue.reporter_id, 40]);

    const res = await request(getApp()).get(`/api/projects/${projectId}/reports/time-tracking`).set(headers);
    expect(res.status).toBe(200);
    const sprintRow = res.body.by_sprint.find((s) => s.sprint_id === sprintId);
    expect(sprintRow.manual_minutes).toBeGreaterThanOrEqual(20);
    expect(sprintRow.auto_minutes).toBeGreaterThanOrEqual(40);
    expect(sprintRow.total_minutes).toBe(sprintRow.manual_minutes + sprintRow.auto_minutes);

    const userRow = res.body.by_user.find((u) => u.user_id === issue.reporter_id);
    expect(userRow.total_minutes).toBeGreaterThanOrEqual(60);
  });
});

describe('GET /reports/time-tracking/export/csv', () => {
  test('returns a CSV with sprint and user breakdown', async () => {
    const res = await request(getApp()).get(`/api/projects/${projectId}/reports/time-tracking/export/csv`).set(headers);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Sprint');
  });
});

describe('GET /reports/export/csv includes time spent', () => {
  test('issue export has a Time Spent column', async () => {
    const res = await request(getApp()).get(`/api/projects/${projectId}/reports/export/csv`).set(headers);
    expect(res.text.split('\n')[0]).toContain('Time Spent');
  });
});
```

Note: this snippet assumes `getDb` and `run` are already imported at the top of `flow-reports.test.js` alongside `queryAll`/`queryOne` — check the file's existing imports first and add whichever of `getDb`/`run` are missing.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/backend/flow-reports.test.js -t "time-tracking|Time Spent" --verbose
```

Expected: FAIL — 404 on the new routes; missing CSV column on the existing one.

- [ ] **Step 3: Add the rollup endpoint and CSV exports to `backend/routes/reports.js`**

Add after the existing `loadFlowData` function (or anywhere before `module.exports = router;`):

```js
router.get('/projects/:projectId/reports/time-tracking', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, `
      SELECT i.sprint_id, s.name AS sprint_name, i.assignee_id AS user_id, u.name,
             w.source, w.minutes
      FROM work_logs w
      JOIN issues i ON i.id = w.issue_id
      LEFT JOIN sprints s ON s.id = i.sprint_id
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.project_id = ?`, [req.params.projectId]);

    const bySprint = new Map();
    const byUser = new Map();
    for (const r of rows) {
      const minutes = Number(r.minutes);
      const sprintKey = r.sprint_id || 'backlog';
      if (!bySprint.has(sprintKey)) {
        bySprint.set(sprintKey, { sprint_id: r.sprint_id, sprint_name: r.sprint_name || 'Backlog', auto_minutes: 0, manual_minutes: 0 });
      }
      bySprint.get(sprintKey)[r.source === 'auto' ? 'auto_minutes' : 'manual_minutes'] += minutes;

      const userKey = r.user_id || 'unassigned';
      if (!byUser.has(userKey)) {
        byUser.set(userKey, { user_id: r.user_id, name: r.name || 'Unassigned', auto_minutes: 0, manual_minutes: 0 });
      }
      byUser.get(userKey)[r.source === 'auto' ? 'auto_minutes' : 'manual_minutes'] += minutes;
    }

    const finalize = (m) => [...m.values()].map((v) => ({ ...v, total_minutes: v.auto_minutes + v.manual_minutes }));
    res.json({ by_sprint: finalize(bySprint), by_user: finalize(byUser) });
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/time-tracking/export/csv', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Reuse the same aggregation as the JSON endpoint above.
    const rows = await queryAll(db, `
      SELECT i.sprint_id, s.name AS sprint_name, i.assignee_id AS user_id, u.name,
             w.source, w.minutes
      FROM work_logs w
      JOIN issues i ON i.id = w.issue_id
      LEFT JOIN sprints s ON s.id = i.sprint_id
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.project_id = ?`, [req.params.projectId]);

    const bySprint = new Map();
    const byUser = new Map();
    for (const r of rows) {
      const minutes = Number(r.minutes);
      const sprintKey = r.sprint_id || 'backlog';
      if (!bySprint.has(sprintKey)) bySprint.set(sprintKey, { name: r.sprint_name || 'Backlog', auto: 0, manual: 0 });
      bySprint.get(sprintKey)[r.source === 'auto' ? 'auto' : 'manual'] += minutes;
      const userKey = r.user_id || 'unassigned';
      if (!byUser.has(userKey)) byUser.set(userKey, { name: r.name || 'Unassigned', auto: 0, manual: 0 });
      byUser.get(userKey)[r.source === 'auto' ? 'auto' : 'manual'] += minutes;
    }

    const lines = ['Sprint,Auto Minutes,Manual Minutes,Total Minutes'];
    for (const s of bySprint.values()) lines.push([s.name, s.auto, s.manual, s.auto + s.manual].join(','));
    lines.push('');
    lines.push('User,Auto Minutes,Manual Minutes,Total Minutes');
    for (const u of byUser.values()) lines.push([u.name, u.auto, u.manual, u.auto + u.manual].join(','));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${project.key}-time-tracking.csv"`);
    res.send(lines.join('\n'));
  } catch (e) { serverError(res, e); }
});
```

Then extend the existing issue CSV export. Find:

```js
    const headers = ['Key', 'Title', 'Type', 'Status', 'Priority', 'Story Points', 'Assignee', 'Reporter', 'Sprint', 'Created', 'Updated'];
```

and its query (a few lines above, `SELECT i.issue_key, i.title, ...`) — add `i.time_spent` to the `SELECT` list, and update both the `headers` array and the row-building `.forEach`:

```js
    const issues = await queryAll(db, `
      SELECT i.issue_key, i.title, i.type, i.status, i.priority, i.story_points, i.time_spent,
        i.created_at, i.updated_at,
        u1.name as assignee, u2.name as reporter,
        s.name as sprint
      FROM issues i
      LEFT JOIN users u1 ON i.assignee_id = u1.id
      LEFT JOIN users u2 ON i.reporter_id = u2.id
      LEFT JOIN sprints s ON i.sprint_id = s.id
      WHERE i.project_id = ?
      ORDER BY i.issue_number
    `, [req.params.projectId]);

    const headers = ['Key', 'Title', 'Type', 'Status', 'Priority', 'Story Points', 'Time Spent (min)', 'Assignee', 'Reporter', 'Sprint', 'Created', 'Updated'];
    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = [headers.join(',')];
    issues.forEach(i => {
      rows.push([
        i.issue_key, escape(i.title), i.type, i.status, i.priority,
        i.story_points || '', i.time_spent || 0, i.assignee || 'Unassigned', i.reporter || '',
        i.sprint || 'Backlog', i.created_at, i.updated_at
      ].join(','));
    });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest tests/backend/flow-reports.test.js --verbose
```

Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/reports.js backend/tests/backend/flow-reports.test.js
git commit -m "feat(backend): time-tracking rollup endpoint and CSV exports"
```

---

### Task 8: Frontend — types, API client, editable/tagged worklog UI

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/app/issue-detail/use-issue-detail.ts`
- Modify: `frontend/src/components/app/issue-detail/issue-fields.tsx`

**Interfaces:**
- Consumes: existing `WorkLog` shape, existing `api.worklogs.*` calls, existing `detail` object returned by `useIssueDetail`.
- Produces: `WorkLog.source: 'manual' | 'auto'`, `WorkLog.locked_from_auto: number`; `api.worklogs.update(id, { minutes?, comment? })`; a visible "auto" tag on auto-sourced rows in the worklog list, editable the same as manual rows.

- [ ] **Step 1: Extend the `WorkLog` type**

In `frontend/src/lib/types.ts`, find:

```ts
/** Work log entry from GET /issues/:id/worklogs. Minutes-based. */
export interface WorkLog {
  id: string;
  issue_id: string;
  user_id: string;
  minutes: number;
  comment: string | null;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
}
```

Replace with:

```ts
/** Work log entry from GET /issues/:id/worklogs. Minutes-based. */
export interface WorkLog {
  id: string;
  issue_id: string;
  user_id: string;
  minutes: number;
  comment: string | null;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
  source: 'manual' | 'auto';
  locked_from_auto: number;
}
```

Also find the `Issue` interface (used by the issue-detail hook) and add the live field. Search for it first:

```bash
grep -n "^export interface Issue " frontend/src/lib/types.ts
```

Add `in_progress_minutes_live: number | null;` and `time_spent: number | null;` to that interface (add whichever of the two fields isn't already present — `time_spent` may already exist since it's an existing `issues` column).

- [ ] **Step 2: Add the update API call**

In `frontend/src/lib/api.ts`, find:

```ts
  worklogs: {
    list: (issueId: string) => get<WorkLog[]>(`/issues/${issueId}/worklogs`),
    create: (issueId: string, minutes: number, comment?: string) =>
      post<WorkLog>(`/issues/${issueId}/worklogs`, { minutes, comment }),
    remove: (id: string) => del<{ ok: boolean }>(`/worklogs/${id}`),
  },
```

Replace with:

```ts
  worklogs: {
    list: (issueId: string) => get<WorkLog[]>(`/issues/${issueId}/worklogs`),
    create: (issueId: string, minutes: number, comment?: string) =>
      post<WorkLog>(`/issues/${issueId}/worklogs`, { minutes, comment }),
    update: (id: string, updates: { minutes?: number; comment?: string }) =>
      patch<WorkLog>(`/worklogs/${id}`, updates),
    remove: (id: string) => del<{ ok: boolean }>(`/worklogs/${id}`),
  },
```

Check whether a `patch` helper already exists in this file (`grep -n "^function patch\|^const patch" frontend/src/lib/api.ts`); if it's missing, add it next to the existing `get`/`post`/`del` helpers following their exact pattern (same signature shape, just `method: 'PATCH'`).

- [ ] **Step 3: Add an edit handler to the issue-detail hook**

In `frontend/src/components/app/issue-detail/use-issue-detail.ts`, find the existing `removeWorkLog` function (referenced in the returned object per the earlier grep) and add a sibling `editWorkLog` function next to it:

```ts
  async function editWorkLog(id: string, minutes: number) {
    await api.worklogs.update(id, { minutes });
    if (issue) setWorklogs(await api.worklogs.list(issue.id));
  }
```

Add `editWorkLog` to the function's final returned object, alongside the existing `removeWorkLog`.

- [ ] **Step 4: Show the auto/manual tag and an edit affordance in the worklog list**

In `frontend/src/components/app/issue-detail/issue-fields.tsx`, find the worklog list rendering block (the `worklogs.map((wlog) => ...)` block) and update the `<p>` that renders `logged {formatDuration(wlog.minutes)}` to show a tag, and add an edit button next to the existing delete button:

```tsx
                      {worklogs.map((wlog) => (
                        <li key={wlog.id} className="flex items-start gap-2.5 text-sm">
                          <UserAvatar name={wlog.user_name} color={wlog.user_color} className="size-6" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs">
                              <span className="font-semibold">{wlog.user_name}</span>{' '}
                              <span className="text-muted-foreground">
                                logged {formatDuration(wlog.minutes)} · {timeAgo(wlog.created_at)}
                              </span>
                              {wlog.source === 'auto' && (
                                <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                                  auto
                                </span>
                              )}
                            </p>
                            {wlog.comment && <p className="mt-0.5 text-sm">{wlog.comment}</p>}
                          </div>
                          {(wlog.user_id === user?.id || isAdmin(user?.role)) && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  const input = window.prompt('Minutes worked:', String(wlog.minutes));
                                  const minutes = input ? Math.round(Number(input)) : NaN;
                                  if (Number.isFinite(minutes) && minutes > 0) editWorkLog(wlog.id, minutes);
                                }}
                                aria-label="Edit work log"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-destructive"
                                onClick={() => removeWorkLog(wlog.id)}
                                aria-label="Delete work log"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
```

Add `editWorkLog` to this component's destructured `detail` props (the line at the top of the file: `const { issue, members, ..., removeWorkLog, saveEstimate } = detail;` — add `editWorkLog` to that list). Add a `Pencil` import from `lucide-react` next to the existing `Trash2` import at the top of the file.

Note: a `window.prompt` is a pragmatic minimal-diff choice here, consistent with "don't add abstractions beyond what the task requires" — if the codebase has an existing inline-edit pattern used elsewhere for a single-number field, prefer that pattern instead; check `grep -rn "window.prompt" frontend/src` first to see if this is already an established convention in this codebase before introducing it fresh.

- [ ] **Step 5: Manually verify in the browser**

```bash
cd frontend && npm run dev
```

Open an issue that has at least one work log (or create one via the "Log" button), confirm:
- Manual entries show no tag.
- After running the backend and completing an issue that passed through "In Progress" (Task 5 wired this up), reload the issue and confirm an "auto" tag appears on the new entry.
- Clicking the edit (pencil) icon on an auto entry, changing the minutes, causes the tag's underlying entry to update and the total at the top of the panel to recompute.

- [ ] **Step 6: Run the frontend's existing test/build check**

```bash
cd frontend && npm run build
```

Expected: build succeeds with no TypeScript errors (this catches the destructured-prop and type-shape changes without needing new component tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts frontend/src/components/app/issue-detail/use-issue-detail.ts frontend/src/components/app/issue-detail/issue-fields.tsx
git commit -m "feat(frontend): show and edit auto-tagged work log entries"
```

---

### Task 9: Mobile — read-only time-tracking section on the issue detail screen

**Files:**
- Modify: `mobile/src/api/issues.ts`
- Modify: `mobile/src/screens/IssueDetailScreen.tsx`
- Modify: `mobile/src/__tests__/IssueDetailScreen.test.tsx`

**Interfaces:**
- Consumes: `Issue` type from `mobile/src/api/issues.ts`, `fetchIssue` (existing).
- Produces: `Issue.time_spent: number | null`, `Issue.in_progress_minutes_live: number | null`; a new read-only section on `IssueDetailScreen`.

- [ ] **Step 1: Extend the `Issue` type**

In `mobile/src/api/issues.ts`, find:

```ts
export type Issue = {
  id: string;
  issue_key: string;
  title: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  project_id: string;
};
```

Replace with:

```ts
export type Issue = {
  id: string;
  issue_key: string;
  title: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  project_id: string;
  time_spent: number | null;
  in_progress_minutes_live: number | null;
};
```

- [ ] **Step 2: Read the current screen structure to place the section correctly**

```bash
grep -n "status\|assignee\|export default function\|return (" mobile/src/screens/IssueDetailScreen.tsx | head -30
```

- [ ] **Step 3: Write the failing test**

Open `mobile/src/__tests__/IssueDetailScreen.test.tsx`, find the mock `fetchIssue` response used by the existing tests (search for `assignee_color` or similar to find the mock issue fixture object), and add `time_spent`/`in_progress_minutes_live` fields to it so existing tests keep passing with the extended type. Then add:

```ts
test('shows a live in-progress badge while the issue is in progress', async () => {
  (fetchIssue as jest.Mock).mockResolvedValue({ ...mockIssue, status: 'in_progress', in_progress_minutes_live: 95, time_spent: null });
  const { findByText } = render(<IssueDetailScreen route={mockRoute} navigation={mockNavigation} />);
  expect(await findByText(/In progress: 1h 35m/)).toBeTruthy();
});

test('shows the logged total once the issue is done', async () => {
  (fetchIssue as jest.Mock).mockResolvedValue({ ...mockIssue, status: 'done', in_progress_minutes_live: null, time_spent: 120 });
  const { findByText } = render(<IssueDetailScreen route={mockRoute} navigation={mockNavigation} />);
  expect(await findByText(/Logged: 2h 0m/)).toBeTruthy();
});

test('hides the section when the issue never entered in progress', async () => {
  (fetchIssue as jest.Mock).mockResolvedValue({ ...mockIssue, status: 'todo', in_progress_minutes_live: null, time_spent: null });
  const { queryByText } = render(<IssueDetailScreen route={mockRoute} navigation={mockNavigation} />);
  await new Promise((r) => setTimeout(r, 0)); // let the initial fetch resolve
  expect(queryByText(/In progress:/)).toBeNull();
  expect(queryByText(/Logged:/)).toBeNull();
});
```

Adjust `mockRoute`/`mockNavigation`/import names to match whatever this test file already uses for its other tests (read the file's existing imports/mocks before adding these — do not introduce a second mocking convention).

- [ ] **Step 4: Run test to verify it fails**

```bash
cd mobile && npx jest IssueDetailScreen -t "in-progress|Logged|never entered" --verbose
```

Expected: FAIL — the badge/logged text doesn't exist yet.

- [ ] **Step 5: Add the section to `IssueDetailScreen.tsx`**

Add a small formatting helper near the top of the file (or reuse one if the screen already has a duration formatter — check first with `grep -n "formatDuration\|Math.floor.*60" mobile/src/screens/IssueDetailScreen.tsx`):

```tsx
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}
```

In the component's render, below wherever the status/assignee pickers are rendered, add:

```tsx
      {issue.in_progress_minutes_live != null && (
        <Text style={styles.timeTracking}>In progress: {formatMinutes(issue.in_progress_minutes_live)}</Text>
      )}
      {issue.in_progress_minutes_live == null && issue.time_spent != null && issue.time_spent > 0 && (
        <Text style={styles.timeTracking}>Logged: {formatMinutes(issue.time_spent)}</Text>
      )}
```

Add a `timeTracking` entry to the screen's existing `StyleSheet.create({...})` block, matching the styling convention of a nearby existing text style (check an adjacent style like the one used for the assignee label and mirror its `fontSize`/`color` values rather than inventing new ones).

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd mobile && npx jest IssueDetailScreen --verbose
```

Expected: PASS, all tests in the file (existing + new 3).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/api/issues.ts mobile/src/screens/IssueDetailScreen.tsx mobile/src/__tests__/IssueDetailScreen.test.tsx
git commit -m "feat(mobile): show in-progress/logged time on the issue detail screen"
```

---

### Task 10: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS.

- [ ] **Step 2: Run the frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run the mobile test suite**

```bash
cd mobile && npm test
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test against a running dev server**

```bash
cd backend && rm -f data.db && node server.js
```

In another terminal or the browser: log in as `kunal@example.com` / `password123` (seeded demo credential), move a seeded issue to "In Progress" then to "Done" via the board, and confirm a work log tagged "auto" appears on the issue with a non-zero, sensible minute count. Then set a `business_hours` value directly for a user via a raw API call or DB write, repeat the cycle, and confirm the number changes to reflect business-hours clipping.

This step has no code artifact to commit — it's the final human-in-the-loop confirmation that the whole chain (migration → helpers → trigger → display) works end-to-end on a real running instance, not just under mocked test data.
