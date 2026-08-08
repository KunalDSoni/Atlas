# Issue Stopwatch (Explicit Start/Pause Time Tracking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user explicitly start, pause, and resume a per-issue stopwatch, have that tracked time take precedence over the existing status-derived auto-calculation, and surface both on web and mobile.

**Architecture:** An append-only `timer_segments` table is the source of truth — one row per start→pause interval, never mutated after close. Totals are always derived by summing segments, so there is no accumulator to corrupt. On reaching a `done`-category status, `backend/routes/issues.js` closes open segments and commits them to `work_logs` with `source='timer'`, skipping `applyAutoWorklog` entirely for that issue. Abandoned timers are repaired lazily on read/write, never by a cron.

**Tech Stack:** Node.js/Express, sql.js (dev) / MySQL (prod) via the `queryAll`/`queryOne`/`run` wrappers in `backend/database.js`, Jest + Supertest, React 18 (`frontend/`), React Native + React Query (`mobile/`).

**Reference spec:** `docs/superpowers/specs/2026-08-08-issue-stopwatch-timer-design.md`

## Global Constraints

- Every schema change goes through `backend/migrations.js`'s ordered, append-only `MIGRATIONS` array. **Never edit a shipped migration id.** The last shipped id is `028_feature_impact_metrics_table`.
- Every migration step must name **both** a `sqlite` and a `mysql` form — the same list runs against both drivers. Where a statement applies to only one driver, the other form is `'SELECT 1'` (see `028`'s index steps for the precedent).
- New tables go in `migrations.js` **only**, not in `database.js`'s base schema arrays. `feature_impact_metrics` is the precedent.
- **No cron, no scheduler, no background timers.** Everything is computed from timestamps on read/write. This is the codebase's stated philosophy (`backend/utils/sla.js` header).
- **Stopwatch segments are never business-hours clipped.** Business-hours clipping exists to stop wall-clock *inference* overcounting; it must not override explicit human action. Durations are raw wall-clock.
- **Never fabricate an implicit business-hours default.** Inherited from `docs/superpowers/specs/2026-07-29-auto-time-tracking-business-hours-design.md`. When no profile is configured, degrade to the runaway warning path — never invent a cutoff.
- Datetime values written from JS use the existing project format: `new Date().toISOString().slice(0, 19).replace('T', ' ')` (see `backend/utils/auto-worklog.js`).
- `work_logs.source` accepts exactly `'manual'`, `'auto'`, `'timer'`. There is no CHECK constraint (deliberately omitted at migration `024`); the allowed set is enforced in application code.
- Runaway threshold: **720 minutes (12 hours)**. It only ever drives a UI warning — it never changes stored data.

---

### Task 1: Schema migration for `timer_segments`

**Files:**
- Modify: `backend/migrations.js` (append to `MIGRATIONS`, after the `028_feature_impact_metrics_table` object, before the closing `];`)

**Interfaces:**
- Produces: the `timer_segments` table used by every later task:
  - `id` TEXT PK, `issue_id` TEXT NOT NULL, `user_id` TEXT NOT NULL, `started_at` DATETIME NOT NULL, `ended_at` DATETIME NULL (NULL = running), `created_at` DATETIME

- [ ] **Step 1: Append the migration entry**

Open `backend/migrations.js`. Find the last element of `MIGRATIONS` (the `028_feature_impact_metrics_table` object) and add this new object immediately after it, still inside the array:

```js
  {
    id: '029_issue_timers',
    description: 'Append-only stopwatch segments per issue and user',
    steps: [
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS timer_segments (
            id TEXT PRIMARY KEY,
            issue_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            -- Append-only: started_at is written once, ended_at once on pause,
            -- and neither is ever updated again. Totals are summed on read, so
            -- there is no stored accumulator that a crash can desynchronise.
            started_at DATETIME NOT NULL,
            ended_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS timer_segments (
            id VARCHAR(36) PRIMARY KEY,
            issue_id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            started_at DATETIME NOT NULL,
            ended_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            -- MySQL declares indexes inline; the SQLite side gets its own
            -- statements below. Names match so the two schemas stay comparable.
            KEY idx_timer_segments_issue (issue_id),
            KEY idx_timer_segments_user_open (user_id, ended_at)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        // "One running timer per user" is enforced in application code, not by a
        // partial unique index: MySQL has no partial indexes and this same list
        // runs against both drivers.
        sql: {
          sqlite: `CREATE INDEX IF NOT EXISTS idx_timer_segments_issue ON timer_segments(issue_id)`,
          mysql: `SELECT 1`,
        },
      },
      {
        sql: {
          sqlite: `CREATE INDEX IF NOT EXISTS idx_timer_segments_user_open ON timer_segments(user_id, ended_at)`,
          mysql: `SELECT 1`,
        },
      },
    ],
  },
```

- [ ] **Step 2: Verify the migration applies cleanly**

```bash
cd backend && rm -f data.db && node -e "require('./database').initDb().then(() => process.exit(0))"
```

Expected: no errors printed.

- [ ] **Step 3: Verify the table and columns exist**

```bash
cd backend && node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');
(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('./data.db'));
  console.log(db.exec(\"PRAGMA table_info(timer_segments)\")[0].values.map(r => r[1]));
})();
"
```

Expected: `[ 'id', 'issue_id', 'user_id', 'started_at', 'ended_at', 'created_at' ]`

- [ ] **Step 4: Run the full backend suite to confirm nothing broke**

```bash
cd backend && npm run test:backend
```

Expected: PASS. This migration only adds a new table, so no existing test should be affected.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations.js
git commit -m "feat(backend): add timer_segments table for issue stopwatch"
```

---

### Task 2: Export two date helpers from `flow.js`

**Files:**
- Modify: `backend/utils/flow.js` (the `module.exports` line at the end of the file)
- Test: `backend/tests/backend/flow.test.js`

**Interfaces:**
- Produces (used by Task 3):
  - `localMidnightUtc(date: Date, timezone: string): Date` — UTC instant of local midnight for the calendar day (in `timezone`) that `date` falls on. **Already implemented** in `flow.js`; currently private.
  - `isoWeekdayInTz(date: Date, timezone: string): number` — ISO weekday 1=Monday..7=Sunday in `timezone`. **Already implemented**; currently private.

Both functions already exist and are correct — including half-hour timezone handling (`Asia/Kolkata`). This task only widens their visibility, so it is deliberately small.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/flow.test.js`:

```js
describe('localMidnightUtc / isoWeekdayInTz (exported for utils/timers.js)', () => {
  const { localMidnightUtc, isoWeekdayInTz } = require('../../utils/flow');

  test('localMidnightUtc resolves local midnight for a whole-hour timezone', () => {
    // 2026-07-06 14:00 UTC is 2026-07-06 in UTC; local midnight is 00:00 UTC.
    const d = new Date('2026-07-06T14:00:00Z');
    expect(localMidnightUtc(d, 'UTC').toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  test('localMidnightUtc handles a half-hour offset timezone', () => {
    // Asia/Kolkata is UTC+5:30. 2026-07-06 14:00 UTC = 19:30 IST on 2026-07-06,
    // so local midnight is 2026-07-05 18:30 UTC.
    const d = new Date('2026-07-06T14:00:00Z');
    expect(localMidnightUtc(d, 'Asia/Kolkata').toISOString()).toBe('2026-07-05T18:30:00.000Z');
  });

  test('isoWeekdayInTz returns 1 for Monday', () => {
    // 2026-07-06 is a Monday.
    expect(isoWeekdayInTz(new Date('2026-07-06T12:00:00Z'), 'UTC')).toBe(1);
  });

  test('isoWeekdayInTz returns 7 for Sunday', () => {
    // 2026-07-05 is a Sunday.
    expect(isoWeekdayInTz(new Date('2026-07-05T12:00:00Z'), 'UTC')).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx jest tests/backend/flow.test.js -t "exported for utils/timers.js" --verbose
```

Expected: FAIL — `localMidnightUtc is not a function` (not yet exported).

- [ ] **Step 3: Widen the exports**

In `backend/utils/flow.js`, replace the final `module.exports` line:

```js
module.exports = { categoryOf, statusTimeline, hoursBetween, percentile, businessMinutesBetween, resolveBusinessHours };
```

with:

```js
// localMidnightUtc / isoWeekdayInTz are exported for utils/timers.js, which
// needs the same timezone-aware calendar-day math to decide whether an
// abandoned stopwatch segment started on an earlier local day.
module.exports = {
  categoryOf, statusTimeline, hoursBetween, percentile,
  businessMinutesBetween, resolveBusinessHours,
  localMidnightUtc, isoWeekdayInTz,
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx jest tests/backend/flow.test.js --verbose
```

Expected: PASS, every test in the file including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/flow.js backend/tests/backend/flow.test.js
git commit -m "feat(backend): export calendar-day helpers from flow for timer math"
```

---

### Task 3: Timer core helpers (`backend/utils/timers.js`)

**Files:**
- Create: `backend/utils/timers.js`
- Test: `backend/tests/backend/timers.test.js` (new)

**Interfaces:**
- Consumes: `queryAll`, `queryOne`, `run` from `../database` (signatures `(database, sql, params)`); `resolveBusinessHours`, `localMidnightUtc`, `isoWeekdayInTz` from `./flow` (Task 2); `recomputeTimeSpent` from `./worklog-sync` (existing, `(db, issueId) => Promise<number>`); `v4 as uuidv4` from `uuid`.
- Produces (used by Tasks 4 and 5):
  - `RUNAWAY_MINUTES: number` — the constant `720`.
  - `nowStamp(): string` — current time as `'YYYY-MM-DD HH:MM:SS'`.
  - `async closeStaleSegments(db, { userId?, issueId? }): Promise<number>` — repairs abandoned open segments; returns how many it closed. `issueId` scope closes **unconditionally** (the Done path); `userId` scope closes only segments that started on an earlier local calendar day, and only when a business-hours profile is configured.
  - `async startTimer(db, issueId, userId): Promise<{ paused_issue: { id, issue_key } | null }>` — opens a segment, first closing the user's open segment on any other issue.
  - `async pauseTimer(db, issueId, userId): Promise<void>` — closes the user's open segment on this issue. No-op when none is open.
  - `async timerState(db, issueId, userId): Promise<{ running, started_at, elapsed_minutes, runaway, by_user }>`
  - `async commitTimer(db, issueId, userId): Promise<number>` — pauses, rolls that user's segments into one `source='timer'` work log, sets `issues.auto_worklog_locked = 1`, recomputes `time_spent`. Returns minutes committed.
  - `async issueTimerUserIds(db, issueId): Promise<string[]>` — distinct user ids with segments on the issue.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/backend/timers.test.js`:

```js
const { createTestApp, getApp, adminHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryOne, queryAll, run } = require('../../database');
const {
  closeStaleSegments, startTimer, pauseTimer, timerState, commitTimer, issueTimerUserIds,
} = require('../../utils/timers');
const { v4: uuidv4 } = require('uuid');

let headers, db, projectId, adminId;

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  const me = await request(getApp()).get('/api/auth/me').set(headers);
  adminId = me.body.id;
});

async function mkIssue(title) {
  const res = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title, type: 'task' });
  return res.body;
}

async function addSegment(issueId, userId, startedAt, endedAt = null) {
  const id = uuidv4();
  await run(db, 'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, issueId, userId, startedAt, endedAt, startedAt]);
  return id;
}

function stampAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

describe('segment summing', () => {
  test('elapsed_minutes sums closed segments across pause/resume cycles', async () => {
    const issue = await mkIssue('Sum closed segments');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00'); // 60
    await addSegment(issue.id, adminId, '2026-07-06 11:00:00', '2026-07-06 11:30:00'); // 30

    const state = await timerState(db, issue.id, adminId);
    expect(state.running).toBe(false);
    expect(state.elapsed_minutes).toBe(90);
  });

  test('an open segment is measured against now', async () => {
    const issue = await mkIssue('Open segment to now');
    await addSegment(issue.id, adminId, stampAgo(45));

    const state = await timerState(db, issue.id, adminId);
    expect(state.running).toBe(true);
    expect(state.elapsed_minutes).toBeGreaterThanOrEqual(44);
    expect(state.elapsed_minutes).toBeLessThanOrEqual(46);
  });

  test('stopwatch time is NOT business-hours clipped', async () => {
    // A 2-hour segment at 10pm-midnight, entirely outside a 9-18 profile.
    // Explicit human action must never be clipped away (spec section 2).
    const issue = await mkIssue('No clipping');
    await run(db, 'UPDATE projects SET business_hours = ? WHERE id = ?',
      [JSON.stringify({ timezone: 'UTC', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 }), projectId]);
    await addSegment(issue.id, adminId, '2026-07-06 22:00:00', '2026-07-07 00:00:00');

    const state = await timerState(db, issue.id, adminId);
    expect(state.elapsed_minutes).toBe(120);

    await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
  });

  test('a second user tracks time independently on the same issue', async () => {
    const issue = await mkIssue('Two users');
    const otherUserId = uuidv4();
    await run(db, 'INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [otherUserId, `t-${otherUserId}@example.com`, 'Other Tester', 'x', 'user']);
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');    // 60
    await addSegment(issue.id, otherUserId, '2026-07-06 09:00:00', '2026-07-06 09:15:00'); // 15

    const mine = await timerState(db, issue.id, adminId);
    expect(mine.elapsed_minutes).toBe(60);
    const theirs = await timerState(db, issue.id, otherUserId);
    expect(theirs.elapsed_minutes).toBe(15);
    expect(mine.by_user.find((u) => u.user_id === otherUserId).minutes).toBe(15);
  });
});

describe('closeStaleSegments', () => {
  test('closes a previous-day segment at that day business-day end when a profile is set', async () => {
    const issue = await mkIssue('Stale previous day');
    await run(db, 'UPDATE projects SET business_hours = ? WHERE id = ?',
      [JSON.stringify({ timezone: 'UTC', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 }), projectId]);
    // Monday 2026-07-06 14:00, left running. Far in the past, so "now" is a
    // later calendar day and the segment is genuinely abandoned.
    const segId = await addSegment(issue.id, adminId, '2026-07-06 14:00:00');

    const closed = await closeStaleSegments(db, { userId: adminId });
    expect(closed).toBeGreaterThanOrEqual(1);

    const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE id = ?', [segId]);
    expect(seg.ended_at).toBe('2026-07-06 18:00:00'); // that day's end_hour, not now

    await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
  });

  test('does NOT truncate a same-day segment still running past business hours', async () => {
    // Regression guard: auto-close must never kill a live, in-progress timer.
    const issue = await mkIssue('Same day still running');
    await run(db, 'UPDATE projects SET business_hours = ? WHERE id = ?',
      [JSON.stringify({ timezone: 'UTC', work_days: [1, 2, 3, 4, 5, 6, 7], start_hour: 0, end_hour: 1 }), projectId]);
    // Started 30 minutes ago (today), profile closes at 01:00 — almost certainly
    // already past, but the day has not rolled over, so it must stay open.
    const segId = await addSegment(issue.id, adminId, stampAgo(30));

    await closeStaleSegments(db, { userId: adminId });

    const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE id = ?', [segId]);
    expect(seg.ended_at).toBeNull();

    await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
  });

  test('leaves a segment open and flags runaway when no profile is configured', async () => {
    const issue = await mkIssue('Runaway no profile');
    const segId = await addSegment(issue.id, adminId, stampAgo(60 * 20)); // 20 hours

    await closeStaleSegments(db, { userId: adminId });
    const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE id = ?', [segId]);
    expect(seg.ended_at).toBeNull(); // never fabricate a cutoff

    const state = await timerState(db, issue.id, adminId);
    expect(state.runaway).toBe(true);
  });

  test('issueId scope closes every open segment unconditionally, including same-day', async () => {
    const issue = await mkIssue('Done path closes all');
    const otherUserId = uuidv4();
    await run(db, 'INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [otherUserId, `t-${otherUserId}@example.com`, 'Other Tester 2', 'x', 'user']);
    await addSegment(issue.id, adminId, stampAgo(10));
    await addSegment(issue.id, otherUserId, stampAgo(10));

    const closed = await closeStaleSegments(db, { issueId: issue.id });
    expect(closed).toBe(2);

    const open = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [issue.id]);
    expect(open).toHaveLength(0);
  });
});

describe('startTimer / pauseTimer', () => {
  test('starting a timer on a second issue pauses the first', async () => {
    const first = await mkIssue('First timer');
    const second = await mkIssue('Second timer');

    await startTimer(db, first.id, adminId);
    const result = await startTimer(db, second.id, adminId);

    expect(result.paused_issue.id).toBe(first.id);
    const firstOpen = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [first.id]);
    expect(firstOpen).toHaveLength(0);
    const secondOpen = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [second.id]);
    expect(secondOpen).toHaveLength(1);

    await pauseTimer(db, second.id, adminId);
  });

  test('starting an already-running timer is a no-op, not a duplicate segment', async () => {
    const issue = await mkIssue('Double start');
    await startTimer(db, issue.id, adminId);
    const before = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ?', [issue.id]);
    await startTimer(db, issue.id, adminId);
    const after = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ?', [issue.id]);

    expect(after).toHaveLength(before.length);
    await pauseTimer(db, issue.id, adminId);
  });

  test('pausing with nothing running is a no-op', async () => {
    const issue = await mkIssue('Pause nothing');
    await expect(pauseTimer(db, issue.id, adminId)).resolves.toBeUndefined();
    const segs = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ?', [issue.id]);
    expect(segs).toHaveLength(0);
  });

  test('resume after pause creates a second segment and totals accumulate', async () => {
    const issue = await mkIssue('Resume accumulates');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 09:20:00'); // 20
    await startTimer(db, issue.id, adminId);
    await pauseTimer(db, issue.id, adminId);

    const segs = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ?', [issue.id]);
    expect(segs).toHaveLength(2);
    const state = await timerState(db, issue.id, adminId);
    expect(state.running).toBe(false);
    expect(state.elapsed_minutes).toBeGreaterThanOrEqual(20);
  });
});

describe('commitTimer', () => {
  test('rolls segments into one source=timer work log and locks the issue', async () => {
    const issue = await mkIssue('Commit basic');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:30:00'); // 90

    const minutes = await commitTimer(db, issue.id, adminId);
    expect(minutes).toBe(90);

    const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(logs).toHaveLength(1);
    expect(Number(logs[0].minutes)).toBe(90);
    expect(logs[0].user_id).toBe(adminId);

    const updated = await queryOne(db, 'SELECT time_spent, auto_worklog_locked FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.time_spent)).toBe(90);
    expect(Number(updated.auto_worklog_locked)).toBe(1);
  });

  test('committing twice yields one row, not two', async () => {
    const issue = await mkIssue('Commit idempotent');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');

    await commitTimer(db, issue.id, adminId);
    await commitTimer(db, issue.id, adminId);

    const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(logs).toHaveLength(1);
    expect(Number(logs[0].minutes)).toBe(60);
  });

  test('commit closes an open segment before summing', async () => {
    const issue = await mkIssue('Commit closes open');
    await addSegment(issue.id, adminId, stampAgo(30));

    const minutes = await commitTimer(db, issue.id, adminId);
    expect(minutes).toBeGreaterThanOrEqual(29);

    const open = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [issue.id]);
    expect(open).toHaveLength(0);
  });

  test('a zero-minute total writes no work log row', async () => {
    const issue = await mkIssue('Commit zero');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 09:00:00');

    const minutes = await commitTimer(db, issue.id, adminId);
    expect(minutes).toBe(0);
    const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(logs).toHaveLength(0);
  });

  test('manual work logs are untouched by commitTimer', async () => {
    const issue = await mkIssue('Commit preserves manual');
    await request(getApp()).post(`/api/issues/${issue.id}/worklogs`).set(headers).send({ minutes: 25 });
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');

    await commitTimer(db, issue.id, adminId);

    const manual = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'manual'", [issue.id]);
    expect(manual).toHaveLength(1);
    expect(Number(manual[0].minutes)).toBe(25);
    const updated = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.time_spent)).toBe(85); // 25 manual + 60 timer
  });

  test('issueTimerUserIds returns each distinct tracker once', async () => {
    const issue = await mkIssue('Distinct trackers');
    const otherUserId = uuidv4();
    await run(db, 'INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [otherUserId, `t-${otherUserId}@example.com`, 'Other Tester 3', 'x', 'user']);
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');
    await addSegment(issue.id, adminId, '2026-07-06 11:00:00', '2026-07-06 11:30:00');
    await addSegment(issue.id, otherUserId, '2026-07-06 09:00:00', '2026-07-06 09:30:00');

    const ids = await issueTimerUserIds(db, issue.id);
    expect(ids.sort()).toEqual([adminId, otherUserId].sort());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npx jest tests/backend/timers.test.js --verbose
```

Expected: FAIL — `Cannot find module '../../utils/timers'`.

- [ ] **Step 3: Implement `backend/utils/timers.js`**

```js
// ===== ISSUE STOPWATCH =====
// Explicit start/pause time tracking, stored as append-only segments in
// timer_segments. A segment's started_at is written once and its ended_at once
// on pause; nothing is ever updated after that, so totals are always summed on
// read and there is no accumulator a crash can desynchronise.
//
// Unlike utils/auto-worklog.js, segment durations are RAW WALL-CLOCK and are
// never business-hours clipped. Clipping exists to stop wall-clock *inference*
// from overcounting a weekend; it has no business overriding a human who
// explicitly pressed Start at 9pm.
//
// No cron. Abandoned segments are repaired lazily by closeStaleSegments on the
// next read or write, matching the philosophy in utils/sla.js.

const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, run } = require('../database');
const { resolveBusinessHours, localMidnightUtc, isoWeekdayInTz } = require('./flow');
const { recomputeTimeSpent } = require('./worklog-sync');

// A running segment past this many minutes is surfaced to the user as
// suspicious. It drives a UI warning only and never changes stored data, so it
// is safe to tune without a migration.
const RUNAWAY_MINUTES = 720;

/** Current time in the project's stored datetime format. */
function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Parse a stored datetime string ('YYYY-MM-DD HH:MM:SS' or ISO) as a UTC Date. */
function parseUtc(s) {
  return new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));
}

/** Raw wall-clock minutes of a segment; an open segment is measured to `now`. */
function segmentMinutes(seg, now) {
  const start = parseUtc(seg.started_at);
  const end = seg.ended_at ? parseUtc(seg.ended_at) : now;
  return Math.max(0, (end - start) / 60_000);
}

async function profileForIssue(db, issueId, userId) {
  const issue = await queryOne(db, 'SELECT project_id FROM issues WHERE id = ?', [issueId]);
  if (!issue) return null;
  const [project, user] = await Promise.all([
    queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [issue.project_id]),
    queryOne(db, 'SELECT business_hours FROM users WHERE id = ?', [userId]),
  ]);
  return resolveBusinessHours(project?.business_hours, user?.business_hours);
}

/**
 * The UTC instant at which the working day containing `startedAt` ends, or
 * null when no defensible boundary exists — because no profile is configured,
 * because that day is not a work day, or because the segment started after
 * close. Returning null is deliberate: the business-hours spec forbids
 * fabricating an implicit default, so an unjustifiable boundary must degrade
 * to the runaway warning rather than invent a cutoff.
 */
function workdayEndFor(startedAt, profile) {
  if (!profile) return null;
  const start = parseUtc(startedAt);
  const midnight = localMidnightUtc(start, profile.timezone);
  if (!profile.work_days.includes(isoWeekdayInTz(start, profile.timezone))) return null;
  const end = new Date(midnight.getTime() + profile.end_hour * 3_600_000);
  if (end <= start) return null;
  return end;
}

/**
 * Repair abandoned open segments.
 *
 * `{ issueId }` — closes every open segment on the issue at `now`,
 * unconditionally. Used by the Done path: reaching a done-category status is
 * positive evidence the work stopped.
 *
 * `{ userId }` — closes only segments that started on an EARLIER local
 * calendar day, at that day's business-day end. The earlier-day condition is
 * essential: without it, someone who starts at 4pm under a 9-6 profile and is
 * still working at 7pm would have their live, actively running timer truncated
 * to 6pm the moment they loaded the page. A same-day timer running past
 * business hours means the person is still working.
 *
 * Returns the number of segments closed.
 */
async function closeStaleSegments(db, { userId, issueId } = {}) {
  if (issueId) {
    const open = await queryAll(db,
      'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [issueId]);
    for (const seg of open) {
      await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?', [nowStamp(), seg.id]);
    }
    return open.length;
  }

  if (!userId) return 0;
  const open = await queryAll(db,
    'SELECT * FROM timer_segments WHERE user_id = ? AND ended_at IS NULL', [userId]);

  let closed = 0;
  const now = new Date();
  for (const seg of open) {
    const profile = await profileForIssue(db, seg.issue_id, userId);
    if (!profile) continue; // no profile: leave open, surface as runaway instead

    const startMidnight = localMidnightUtc(parseUtc(seg.started_at), profile.timezone);
    const nowMidnight = localMidnightUtc(now, profile.timezone);
    if (startMidnight.getTime() >= nowMidnight.getTime()) continue; // same local day: still working

    const end = workdayEndFor(seg.started_at, profile);
    if (!end) continue; // no defensible boundary; runaway warning covers it

    await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?',
      [end.toISOString().slice(0, 19).replace('T', ' '), seg.id]);
    closed += 1;
  }
  return closed;
}

/** Open a segment, first closing this user's open segment on any other issue. */
async function startTimer(db, issueId, userId) {
  await closeStaleSegments(db, { userId });

  const existing = await queryOne(db,
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ? AND ended_at IS NULL',
    [issueId, userId]);
  if (existing) return { paused_issue: null }; // already running here; no duplicate

  // One running timer per user, globally. Enforced here rather than by a
  // partial unique index because MySQL has no partial indexes.
  const otherOpen = await queryOne(db,
    'SELECT * FROM timer_segments WHERE user_id = ? AND ended_at IS NULL', [userId]);
  let pausedIssue = null;
  if (otherOpen) {
    await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?', [nowStamp(), otherOpen.id]);
    pausedIssue = await queryOne(db, 'SELECT id, issue_key FROM issues WHERE id = ?', [otherOpen.issue_id]);
  }

  const stamp = nowStamp();
  await run(db,
    'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    [uuidv4(), issueId, userId, stamp, stamp]);

  return { paused_issue: pausedIssue || null };
}

/** Close this user's open segment on the issue. No-op when none is open. */
async function pauseTimer(db, issueId, userId) {
  const open = await queryOne(db,
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ? AND ended_at IS NULL',
    [issueId, userId]);
  if (!open) return;
  await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?', [nowStamp(), open.id]);
}

/** Distinct users who have tracked any time on the issue. */
async function issueTimerUserIds(db, issueId) {
  const rows = await queryAll(db,
    'SELECT DISTINCT user_id FROM timer_segments WHERE issue_id = ?', [issueId]);
  return rows.map((r) => r.user_id);
}

/** Timer state for one user on one issue, plus per-user totals for everyone. */
async function timerState(db, issueId, userId) {
  await closeStaleSegments(db, { userId });

  const segments = await queryAll(db,
    `SELECT t.*, u.name AS user_name FROM timer_segments t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.issue_id = ? ORDER BY t.started_at`, [issueId]);

  const now = new Date();
  const mine = segments.filter((s) => s.user_id === userId);
  const open = mine.find((s) => !s.ended_at) || null;

  const byUser = new Map();
  for (const seg of segments) {
    if (!byUser.has(seg.user_id)) {
      byUser.set(seg.user_id, { user_id: seg.user_id, name: seg.user_name || 'Unknown', minutes: 0 });
    }
    byUser.get(seg.user_id).minutes += segmentMinutes(seg, now);
  }

  return {
    running: !!open,
    started_at: open ? open.started_at : null,
    elapsed_minutes: Math.round(mine.reduce((sum, s) => sum + segmentMinutes(s, now), 0)),
    runaway: !!open && segmentMinutes(open, now) > RUNAWAY_MINUTES,
    by_user: [...byUser.values()].map((u) => ({ ...u, minutes: Math.round(u.minutes) })),
  };
}

/**
 * Roll this user's segments on the issue into a single source='timer' work log
 * and lock the issue against the status-derived recompute.
 *
 * Idempotent: the existing timer row for this user is replaced, not appended
 * to — the same pattern applyAutoWorklog uses for its auto row.
 */
async function commitTimer(db, issueId, userId) {
  await pauseTimer(db, issueId, userId);

  const segments = await queryAll(db,
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ?', [issueId, userId]);
  const now = new Date();
  const total = Math.round(segments.reduce((sum, s) => sum + segmentMinutes(s, now), 0));

  await run(db, "DELETE FROM work_logs WHERE issue_id = ? AND user_id = ? AND source = 'timer'",
    [issueId, userId]);
  if (total > 0) {
    await run(db,
      "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'timer')",
      [uuidv4(), issueId, userId, total, 'Tracked with timer']);
  }

  // Tracked time is authoritative: skip the status-derived calculation for this
  // issue from now on (read by utils/auto-worklog.js's applyAutoWorklog).
  await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [issueId]);
  await recomputeTimeSpent(db, issueId);
  return total;
}

module.exports = {
  RUNAWAY_MINUTES, nowStamp, closeStaleSegments, startTimer, pauseTimer,
  timerState, commitTimer, issueTimerUserIds,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest tests/backend/timers.test.js --verbose
```

Expected: PASS, all 17 tests.

If "closes a previous-day segment" fails with `ended_at` equal to `now` rather than `2026-07-06 18:00:00`, check that `closeStaleSegments` compares **local midnights** rather than raw timestamps — comparing `started_at < now` directly would match same-day segments too and reintroduce the live-timer truncation bug.

- [ ] **Step 5: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS. Nothing else imports `utils/timers.js` yet, so this is purely additive.

- [ ] **Step 6: Commit**

```bash
git add backend/utils/timers.js backend/tests/backend/timers.test.js
git commit -m "feat(backend): issue stopwatch segment helpers"
```

---

### Task 4: Timer routes

**Files:**
- Create: `backend/routes/timers.js`
- Modify: `backend/server.js` (add a mount next to `worklogsRoutes`, currently line 193)
- Modify: `backend/tests/backend/setup.js` (add the same mount next to the worklogs mount, currently line 89)
- Test: `backend/tests/backend/timers.test.js` (append route tests)

**Interfaces:**
- Consumes: `startTimer`, `pauseTimer`, `timerState`, `commitTimer`, `closeStaleSegments` from `../utils/timers` (Task 3); `getDb`, `queryOne` from `../database`; `requireAuth` from `../middleware/auth`; `serverError` from `../utils/errors`.
- Produces: five endpoints consumed by Tasks 7 and 9.
  - `POST /api/issues/:issueId/timer/start` → `{ running, started_at, elapsed_minutes, runaway, by_user, paused_issue }`
  - `POST /api/issues/:issueId/timer/pause` → timer state
  - `POST /api/issues/:issueId/timer/commit` → `{ ok: true, minutes }`
  - `GET /api/issues/:issueId/timer` → timer state
  - `GET /api/me/timer` → `{ issue_id, issue_key, title, started_at, elapsed_minutes, runaway } | null`

- [ ] **Step 1: Write the failing route tests**

Append to `backend/tests/backend/timers.test.js`:

```js
describe('timer routes', () => {
  test('POST start then GET returns a running timer', async () => {
    const issue = await mkIssue('Route start');
    const startRes = await request(getApp()).post(`/api/issues/${issue.id}/timer/start`).set(headers);
    expect(startRes.status).toBe(200);
    expect(startRes.body.running).toBe(true);
    expect(startRes.body.started_at).toBeTruthy();

    const getRes = await request(getApp()).get(`/api/issues/${issue.id}/timer`).set(headers);
    expect(getRes.body.running).toBe(true);

    await request(getApp()).post(`/api/issues/${issue.id}/timer/pause`).set(headers);
  });

  test('POST pause stops the timer', async () => {
    const issue = await mkIssue('Route pause');
    await request(getApp()).post(`/api/issues/${issue.id}/timer/start`).set(headers);
    const pauseRes = await request(getApp()).post(`/api/issues/${issue.id}/timer/pause`).set(headers);

    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.running).toBe(false);
  });

  test('starting on a second issue reports the issue it paused', async () => {
    const first = await mkIssue('Route displace first');
    const second = await mkIssue('Route displace second');
    await request(getApp()).post(`/api/issues/${first.id}/timer/start`).set(headers);
    const res = await request(getApp()).post(`/api/issues/${second.id}/timer/start`).set(headers);

    expect(res.body.paused_issue.id).toBe(first.id);
    expect(res.body.paused_issue.issue_key).toBe(first.issue_key);

    await request(getApp()).post(`/api/issues/${second.id}/timer/pause`).set(headers);
  });

  test('start on a nonexistent issue is 404', async () => {
    const res = await request(getApp()).post('/api/issues/does-not-exist/timer/start').set(headers);
    expect(res.status).toBe(404);
  });

  test('timer endpoints require auth', async () => {
    const issue = await mkIssue('Route auth');
    const res = await request(getApp()).post(`/api/issues/${issue.id}/timer/start`);
    expect(res.status).toBe(401);
  });

  test('GET /api/me/timer returns the running timer, then null after pause', async () => {
    const issue = await mkIssue('Route me timer');
    await request(getApp()).post(`/api/issues/${issue.id}/timer/start`).set(headers);

    const running = await request(getApp()).get('/api/me/timer').set(headers);
    expect(running.body.issue_id).toBe(issue.id);
    expect(running.body.issue_key).toBe(issue.issue_key);

    await request(getApp()).post(`/api/issues/${issue.id}/timer/pause`).set(headers);
    const stopped = await request(getApp()).get('/api/me/timer').set(headers);
    expect(stopped.body).toBeNull();
  });

  test('POST commit writes a timer work log and reports minutes', async () => {
    const issue = await mkIssue('Route commit');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');

    const res = await request(getApp()).post(`/api/issues/${issue.id}/timer/commit`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.minutes).toBe(60);

    const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(logs).toHaveLength(1);
  });

  test('a user cannot pause another user is timer', async () => {
    // Each route acts on req.userId only, so a second user pausing sees a
    // no-op on their own (nonexistent) segment rather than stopping the first.
    const issue = await mkIssue('Route isolation');
    await request(getApp()).post(`/api/issues/${issue.id}/timer/start`).set(headers);

    const otherHeaders = await require('./setup').userHeaders();
    await request(getApp()).post(`/api/issues/${issue.id}/timer/pause`).set(otherHeaders);

    const stillRunning = await request(getApp()).get(`/api/issues/${issue.id}/timer`).set(headers);
    expect(stillRunning.body.running).toBe(true);

    await request(getApp()).post(`/api/issues/${issue.id}/timer/pause`).set(headers);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npx jest tests/backend/timers.test.js -t "timer routes" --verbose
```

Expected: FAIL — 404 responses, because no timer routes are mounted yet.

- [ ] **Step 3: Create `backend/routes/timers.js`**

```js
// ===== ISSUE STOPWATCH MODULE =====
// POST /api/issues/:issueId/timer/start  - Start/resume; pauses the caller's
//                                          timer on any other issue first
// POST /api/issues/:issueId/timer/pause  - Pause; no-op when nothing running
// POST /api/issues/:issueId/timer/commit - Roll segments into a source='timer'
//                                          work log and lock the issue
// GET  /api/issues/:issueId/timer        - Timer state for the caller + per-user totals
// GET  /api/me/timer                     - The caller's running timer, if any
//
// Every route acts on req.userId: a user can only drive their own timer.

const express = require('express');
const { getDb, queryOne } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const {
  startTimer, pauseTimer, timerState, commitTimer, closeStaleSegments, RUNAWAY_MINUTES,
} = require('../utils/timers');

const router = express.Router();

async function requireIssue(db, issueId, res) {
  const issue = await queryOne(db, 'SELECT id FROM issues WHERE id = ?', [issueId]);
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' });
    return null;
  }
  return issue;
}

// POST /api/issues/:issueId/timer/start
router.post('/issues/:issueId/timer/start', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    const { paused_issue } = await startTimer(db, req.params.issueId, req.userId);
    const state = await timerState(db, req.params.issueId, req.userId);
    res.json({ ...state, paused_issue });
  } catch (e) { serverError(res, e); }
});

// POST /api/issues/:issueId/timer/pause
router.post('/issues/:issueId/timer/pause', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    await pauseTimer(db, req.params.issueId, req.userId);
    res.json(await timerState(db, req.params.issueId, req.userId));
  } catch (e) { serverError(res, e); }
});

// POST /api/issues/:issueId/timer/commit
router.post('/issues/:issueId/timer/commit', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    const minutes = await commitTimer(db, req.params.issueId, req.userId);
    res.json({ ok: true, minutes });
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/:issueId/timer
router.get('/issues/:issueId/timer', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    res.json(await timerState(db, req.params.issueId, req.userId));
  } catch (e) { serverError(res, e); }
});

// GET /api/me/timer — lets a running timer survive a refresh and follow the
// user between web and mobile.
router.get('/me/timer', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await closeStaleSegments(db, { userId: req.userId });

    const open = await queryOne(db, `
      SELECT t.issue_id, t.started_at, i.issue_key, i.title
      FROM timer_segments t JOIN issues i ON i.id = t.issue_id
      WHERE t.user_id = ? AND t.ended_at IS NULL`, [req.userId]);
    if (!open) return res.json(null);

    const elapsed = Math.round(
      (Date.now() - new Date(String(open.started_at).replace(' ', 'T') + 'Z')) / 60_000
    );
    res.json({
      issue_id: open.issue_id,
      issue_key: open.issue_key,
      title: open.title,
      started_at: open.started_at,
      elapsed_minutes: elapsed,
      runaway: elapsed > RUNAWAY_MINUTES,
    });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
```

- [ ] **Step 4: Mount the router in `backend/server.js`**

Find the worklogs mount (currently line 193):

```js
app.use('/api', worklogsRoutes);
```

Add immediately after it:

```js
app.use('/api', timersRoutes);
```

Then add the require alongside the other route requires near the top of the file, matching the existing style (find `const worklogsRoutes = require('./routes/worklogs');` and add after it):

```js
const timersRoutes = require('./routes/timers');
```

- [ ] **Step 5: Mount the router in `backend/tests/backend/setup.js`**

Find the worklogs mount (currently line 89):

```js
  testApp.use('/api', require('../../routes/worklogs'));
```

Add immediately after it:

```js
  testApp.use('/api', require('../../routes/timers'));
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && npx jest tests/backend/timers.test.js --verbose
```

Expected: PASS, all tests in the file (helpers + routes).

- [ ] **Step 7: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/timers.js backend/server.js backend/tests/backend/setup.js backend/tests/backend/timers.test.js
git commit -m "feat(backend): issue stopwatch start/pause/commit routes"
```

---

### Task 5: Timer precedence on the Done transition

**Files:**
- Modify: `backend/routes/issues.js` (the status-change block, currently lines 485-491)
- Test: `backend/tests/backend/auto-worklog.test.js` (append)

**Interfaces:**
- Consumes: `closeStaleSegments`, `commitTimer`, `issueTimerUserIds` from `../utils/timers` (Task 3).
- Produces: no new exports. Behavior change only: an issue with timer segments commits them on Done and skips `applyAutoWorklog`.

- [ ] **Step 1: Write the failing integration tests**

Append to `backend/tests/backend/auto-worklog.test.js`:

```js
describe('timer precedence over the status-derived calculation', () => {
  const { v4: uuid4 } = require('uuid');

  async function addTimerSegment(issueId, userId, startedAt, endedAt) {
    await run(db, 'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid4(), issueId, userId, startedAt, endedAt, startedAt]);
  }

  test('Done with timer segments writes a timer row and no auto row', async () => {
    const issue = await mkIssue('Timer wins on done');
    const me = await request(getApp()).get('/api/auth/me').set(headers);
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await run(db, "UPDATE activity_log SET created_at = '2026-07-06 09:00:00' WHERE issue_id = ? AND field = 'status' AND new_value = 'in_progress'", [issue.id]);
    await addTimerSegment(issue.id, me.body.id, '2026-07-06 09:00:00', '2026-07-06 09:45:00');

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const timerLogs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(timerLogs).toHaveLength(1);
    expect(Number(timerLogs[0].minutes)).toBe(45);

    const autoLogs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
    expect(autoLogs).toHaveLength(0);
  });

  test('Done with no timer segments still runs the auto calculation unchanged', async () => {
    const issue = await mkIssue('Auto still works');
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await run(db, "UPDATE activity_log SET created_at = '2026-07-06 09:00:00' WHERE issue_id = ? AND field = 'status' AND new_value = 'in_progress'", [issue.id]);

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const autoLogs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
    expect(autoLogs).toHaveLength(1);
  });

  test('Done closes an open segment rather than leaving it running', async () => {
    const issue = await mkIssue('Done closes open timer');
    await request(getApp()).post(`/api/issues/${issue.id}/timer/start`).set(headers);

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const open = await queryAll(db, 'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [issue.id]);
    expect(open).toHaveLength(0);
  });

  test('each tracker gets their own timer work log', async () => {
    const issue = await mkIssue('Two trackers on done');
    const me = await request(getApp()).get('/api/auth/me').set(headers);
    const otherId = uuid4();
    await run(db, 'INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [otherId, `d-${otherId}@example.com`, 'Done Tester', 'x', 'user']);
    await addTimerSegment(issue.id, me.body.id, '2026-07-06 09:00:00', '2026-07-06 10:00:00');
    await addTimerSegment(issue.id, otherId, '2026-07-06 09:00:00', '2026-07-06 09:30:00');

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer' ORDER BY minutes DESC", [issue.id]);
    expect(logs).toHaveLength(2);
    expect(Number(logs[0].minutes)).toBe(60);
    expect(Number(logs[1].minutes)).toBe(30);
  });

  test('moving back to todo clears the lock but preserves committed timer work logs', async () => {
    const issue = await mkIssue('Todo preserves timer log');
    const me = await request(getApp()).get('/api/auth/me').set(headers);
    await addTimerSegment(issue.id, me.body.id, '2026-07-06 09:00:00', '2026-07-06 10:00:00');
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'todo' });

    const updated = await queryOne(db, 'SELECT auto_worklog_locked FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.auto_worklog_locked)).toBe(0);
    const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(logs).toHaveLength(1); // the time was really worked; it stays
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js -t "timer precedence" --verbose
```

Expected: FAIL — no `source='timer'` rows are written, because `issues.js` does not call the timer helpers yet.

- [ ] **Step 3: Wire the timer helpers into `backend/routes/issues.js`**

Add the require alongside the existing `require('../utils/auto-worklog')` line near the top of the file:

```js
const { closeStaleSegments, commitTimer, issueTimerUserIds } = require('../utils/timers');
```

Then find this existing block (currently lines 485-491):

```js
      const statuses = await projectStatuses(db, updated.project_id);
      const newCategory = categoryOf(updated.status, statuses);
      if (newCategory === 'done') {
        await applyAutoWorklog(db, updated, statuses, req.userId);
      } else if (newCategory === 'todo') {
        await run(db, 'UPDATE issues SET auto_worklog_locked = 0 WHERE id = ?', [updated.id]);
      }
```

Replace it with:

```js
      const statuses = await projectStatuses(db, updated.project_id);
      const newCategory = categoryOf(updated.status, statuses);
      if (newCategory === 'done') {
        // Reaching done is positive evidence the work stopped, so close every
        // user's running segment — not just the actor's.
        await closeStaleSegments(db, { issueId: updated.id });

        // Explicitly tracked time is authoritative. When anyone ran a stopwatch
        // on this issue, commit per tracker and skip the status-derived
        // calculation entirely; committing sets auto_worklog_locked, so a later
        // reopen -> redo -> done will not overwrite it.
        const trackers = await issueTimerUserIds(db, updated.id);
        if (trackers.length > 0) {
          for (const trackerId of trackers) {
            await commitTimer(db, updated.id, trackerId);
          }
        } else {
          await applyAutoWorklog(db, updated, statuses, req.userId);
        }
      } else if (newCategory === 'todo') {
        // A genuine restart gives the derived calculation a clean slate.
        // Timer segments and their committed work logs are deliberately kept:
        // that time was really worked.
        await run(db, 'UPDATE issues SET auto_worklog_locked = 0 WHERE id = ?', [updated.id]);
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest tests/backend/auto-worklog.test.js --verbose
```

Expected: PASS, all tests in the file. The pre-existing auto-worklog tests must still pass unchanged — they are the regression guard proving issues without timers behave exactly as before.

- [ ] **Step 5: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/issues.js backend/tests/backend/auto-worklog.test.js
git commit -m "feat(backend): tracked timer time takes precedence over derived time on done"
```

---

### Task 6: Three-way rollup split in reports

**Files:**
- Modify: `backend/routes/reports.js` (JSON endpoint around lines 602-620; CSV endpoint around lines 640-651)
- Test: `backend/tests/backend/timers.test.js` (append)

**Interfaces:**
- Produces: `GET /api/projects/:projectId/reports/time-tracking` response objects gain `timer_minutes`; `total_minutes` sums auto + manual + timer.

This is a **bug fix, not an enhancement**. Both endpoints currently bucket with `r.source === 'auto' ? 'auto_minutes' : 'manual_minutes'` — a ternary, so `'timer'` rows silently report as manual time.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/timers.test.js`:

```js
describe('time-tracking rollup splits timer time separately', () => {
  test('a timer work log lands in timer_minutes, not manual_minutes', async () => {
    const issue = await mkIssue('Rollup split');
    const me = await request(getApp()).get('/api/auth/me').set(headers);
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers)
      .send({ assignee_id: me.body.id });

    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, 'timer')",
      [uuidv4(), issue.id, me.body.id, 42]);

    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/time-tracking`).set(headers);
    expect(res.status).toBe(200);

    const mine = res.body.by_user.find((u) => u.user_id === me.body.id);
    expect(mine.timer_minutes).toBeGreaterThanOrEqual(42);
    expect(mine.total_minutes).toBe(mine.auto_minutes + mine.manual_minutes + mine.timer_minutes);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx jest tests/backend/timers.test.js -t "rollup splits timer" --verbose
```

Expected: FAIL — `mine.timer_minutes` is `undefined`.

- [ ] **Step 3: Fix the JSON endpoint**

In `backend/routes/reports.js`, inside `GET /projects/:projectId/reports/time-tracking`, replace this block:

```js
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
```

with:

```js
      // Three-way, not a ternary: work_logs.source is 'manual' | 'auto' |
      // 'timer', and an else-branch would silently report tracked stopwatch
      // time as manual time.
      const bucket = r.source === 'auto' ? 'auto_minutes'
        : r.source === 'timer' ? 'timer_minutes'
        : 'manual_minutes';

      const sprintKey = r.sprint_id || 'backlog';
      if (!bySprint.has(sprintKey)) {
        bySprint.set(sprintKey, { sprint_id: r.sprint_id, sprint_name: r.sprint_name || 'Backlog', auto_minutes: 0, manual_minutes: 0, timer_minutes: 0 });
      }
      bySprint.get(sprintKey)[bucket] += minutes;

      const userKey = r.user_id || 'unassigned';
      if (!byUser.has(userKey)) {
        byUser.set(userKey, { user_id: r.user_id, name: r.name || 'Unassigned', auto_minutes: 0, manual_minutes: 0, timer_minutes: 0 });
      }
      byUser.get(userKey)[bucket] += minutes;
```

Then replace the `finalize` line:

```js
    const finalize = (m) => [...m.values()].map((v) => ({ ...v, total_minutes: v.auto_minutes + v.manual_minutes }));
```

with:

```js
    const finalize = (m) => [...m.values()].map((v) => ({
      ...v, total_minutes: v.auto_minutes + v.manual_minutes + v.timer_minutes,
    }));
```

- [ ] **Step 4: Fix the CSV endpoint**

In the same file, inside `GET /projects/:projectId/reports/time-tracking/export/csv`, replace:

```js
      const sprintKey = r.sprint_id || 'backlog';
      if (!bySprint.has(sprintKey)) bySprint.set(sprintKey, { name: r.sprint_name || 'Backlog', auto: 0, manual: 0 });
      bySprint.get(sprintKey)[r.source === 'auto' ? 'auto' : 'manual'] += minutes;
      const userKey = r.user_id || 'unassigned';
      if (!byUser.has(userKey)) byUser.set(userKey, { name: r.name || 'Unassigned', auto: 0, manual: 0 });
      byUser.get(userKey)[r.source === 'auto' ? 'auto' : 'manual'] += minutes;
```

with:

```js
      // Same three-way split as the JSON endpoint above.
      const bucket = r.source === 'auto' ? 'auto' : r.source === 'timer' ? 'timer' : 'manual';
      const sprintKey = r.sprint_id || 'backlog';
      if (!bySprint.has(sprintKey)) bySprint.set(sprintKey, { name: r.sprint_name || 'Backlog', auto: 0, manual: 0, timer: 0 });
      bySprint.get(sprintKey)[bucket] += minutes;
      const userKey = r.user_id || 'unassigned';
      if (!byUser.has(userKey)) byUser.set(userKey, { name: r.name || 'Unassigned', auto: 0, manual: 0, timer: 0 });
      byUser.get(userKey)[bucket] += minutes;
```

- [ ] **Step 5: Update the CSV column output**

Still in the CSV endpoint, read the lines below the aggregation that build the CSV rows. Wherever a header row names `auto` and `manual` columns, add a `Timer Minutes` column, and wherever a data row emits `v.auto` and `v.manual`, emit `v.timer` alongside — keeping `Total` as the sum of all three. Match the file's existing quoting/escaping helper rather than introducing a new one.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd backend && npx jest tests/backend/timers.test.js --verbose
```

Expected: PASS.

- [ ] **Step 7: Verify the CSV endpoint still returns valid output**

```bash
cd backend && npx jest tests/backend --verbose -t "time-tracking"
```

Expected: PASS — including any pre-existing report tests covering these two endpoints.

- [ ] **Step 8: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/routes/reports.js backend/tests/backend/timers.test.js
git commit -m "fix(backend): report timer time separately instead of as manual time"
```

---

### Task 7: Web API client and types

**Files:**
- Modify: `frontend/src/lib/types.ts` (`WorkLog` at line 341; add `TimerState`)
- Modify: `frontend/src/lib/api.ts` (add a `timers` group after the `worklogs` group at line 306)
- Modify: `frontend/src/components/app/issue-detail/use-issue-detail.ts`

**Interfaces:**
- Consumes: the endpoints from Task 4.
- Produces (used by Task 8):
  - `TimerState` type: `{ running: boolean; started_at: string | null; elapsed_minutes: number; runaway: boolean; by_user: { user_id: string; name: string; minutes: number }[]; paused_issue?: { id: string; issue_key: string } | null }`
  - `api.timers.get(issueId)`, `api.timers.start(issueId)`, `api.timers.pause(issueId)`, `api.timers.commit(issueId)`, `api.timers.mine()`
  - From `use-issue-detail`: `timer: TimerState | null`, `timerBusy: boolean`, `pausedNotice: string | null`, `startTimer()`, `pauseTimer()`

- [ ] **Step 1: Add the types**

In `frontend/src/lib/types.ts`, widen `WorkLog.source` (line 350):

```ts
  source: 'manual' | 'auto';
```

to:

```ts
  source: 'manual' | 'auto' | 'timer';
```

Then add these types after the `WorkLog` interface:

```ts
export interface TimerUserTotal {
  user_id: string;
  name: string;
  minutes: number;
}

export interface TimerState {
  running: boolean;
  started_at: string | null;
  elapsed_minutes: number;
  /** Open for more than 12h — surfaced as a warning, never auto-corrected. */
  runaway: boolean;
  by_user: TimerUserTotal[];
  /** Set on a start response when it displaced a timer on another issue. */
  paused_issue?: { id: string; issue_key: string } | null;
}

export interface MyTimer {
  issue_id: string;
  issue_key: string;
  title: string;
  started_at: string;
  elapsed_minutes: number;
  runaway: boolean;
}
```

- [ ] **Step 2: Add the API group**

In `frontend/src/lib/api.ts`, find the `worklogs` group (line 306) and add this group immediately after its closing brace, matching the surrounding style:

```ts
  timers: {
    get: (issueId: string) => get<TimerState>(`/issues/${issueId}/timer`),
    start: (issueId: string) => post<TimerState>(`/issues/${issueId}/timer/start`, {}),
    pause: (issueId: string) => post<TimerState>(`/issues/${issueId}/timer/pause`, {}),
    commit: (issueId: string) => post<{ ok: boolean; minutes: number }>(`/issues/${issueId}/timer/commit`, {}),
    mine: () => get<MyTimer | null>('/me/timer'),
  },
```

Add `TimerState` and `MyTimer` to the existing `import type { ... } from './types'` statement at the top of the file.

- [ ] **Step 3: Load and drive timer state in `use-issue-detail.ts`**

Add `TimerState` to the file's existing `import type { ... } from '@/lib/types'` statement.

Add this state declaration next to the existing `const [worklogs, setWorklogs] = useState<WorkLog[]>([]);` (line 44):

```ts
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [timerBusy, setTimerBusy] = useState(false);
  const [pausedNotice, setPausedNotice] = useState<string | null>(null);
```

In the same `Promise.all` that loads worklogs (line 74, `api.worklogs.list(issueId).catch(() => [])`), add a parallel fetch:

```ts
        api.timers.get(issueId).catch(() => null),
```

Destructure the extra result alongside the existing ones and call `setTimer(...)` with it. Follow the exact destructuring shape already used in that block — add the new entry in the same position in both the `Promise.all` array and the destructuring target.

Then add these two functions next to `logWork` (line 147):

```ts
  async function startTimer() {
    if (!issue) return;
    setTimerBusy(true);
    try {
      const state = await api.timers.start(issue.id);
      setTimer(state);
      // Only one timer runs per user, so starting here may have stopped one
      // elsewhere. Say so rather than letting time silently move.
      setPausedNotice(state.paused_issue ? `Paused your timer on ${state.paused_issue.issue_key}` : null);
    } finally {
      setTimerBusy(false);
    }
  }

  async function pauseTimer() {
    if (!issue) return;
    setTimerBusy(true);
    try {
      setTimer(await api.timers.pause(issue.id));
      setPausedNotice(null);
    } finally {
      setTimerBusy(false);
    }
  }
```

Finally, add `timer`, `timerBusy`, `pausedNotice`, `startTimer`, and `pauseTimer` to the object returned at the end of the hook (line 252).

- [ ] **Step 4: Verify the frontend still typechecks and builds**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Expected: no type errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts frontend/src/components/app/issue-detail/use-issue-detail.ts
git commit -m "feat(frontend): timer API client, types, and issue-detail wiring"
```

---

### Task 8: Web timer UI

**Files:**
- Modify: `frontend/src/components/app/issue-detail/issue-fields.tsx` (Time section; the `auto` badge is at line 287)

**Interfaces:**
- Consumes: `timer`, `timerBusy`, `pausedNotice`, `startTimer`, `pauseTimer` from `use-issue-detail` (Task 7); `issue.in_progress_minutes_live` (already returned by the API and declared at `types.ts:190`, currently unread by any component).

- [ ] **Step 1: Destructure the new values**

In `issue-fields.tsx`, add `timer`, `timerBusy`, `pausedNotice`, `startTimer`, `pauseTimer` to the existing destructuring of `detail` at line 25.

- [ ] **Step 2: Add the React hooks import**

This file currently has **no React import at all** — it relies on the automatic
JSX transform and uses no hooks. The timer display needs two, so add this line
at the top of the import block (above the `lucide-react` import at line 9):

```tsx
import { useEffect, useState } from 'react';
```

Use the bare `useEffect` / `useState` names throughout — there is no `React`
namespace binding in this file, so `React.useState` would be a reference error.

- [ ] **Step 3: Render the timer control and the live in-progress value**

In the Time section, immediately above the "Log work" block (line 250), add:

```tsx
                  {issue.in_progress_minutes_live !== null && (
                    <p className="text-xs text-muted-foreground">
                      In progress: {formatDuration(issue.in_progress_minutes_live)}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant={timer?.running ? 'secondary' : 'default'}
                      onClick={timer?.running ? pauseTimer : startTimer}
                      disabled={timerBusy}
                      aria-label={timer?.running ? 'Pause timer' : 'Start timer'}
                    >
                      {timerBusy
                        ? <Loader2 className="size-4 animate-spin" />
                        : timer?.running ? 'Pause' : 'Start timer'}
                    </Button>
                    {timer && (timer.running || timer.elapsed_minutes > 0) && (
                      <span className="text-sm tabular-nums">
                        {formatDuration(liveElapsed)}
                      </span>
                    )}
                  </div>

                  {pausedNotice && (
                    <p className="text-xs text-muted-foreground">{pausedNotice}</p>
                  )}

                  {timer?.runaway && (
                    <p className="text-xs text-destructive">
                      Timer has been running over 12 hours — still working?{' '}
                      <button className="underline" onClick={pauseTimer}>Pause it</button>
                    </p>
                  )}
```

Add this to the component body, immediately after the destructuring from Step 1:

```tsx
  // The server is only contacted on start/pause/commit — never polled. The
  // display advances locally from the server's elapsed_minutes, which already
  // includes the open segment as of the last fetch; the tick extends that
  // value rather than recomputing from started_at, which would double-count.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (!timer?.running) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [timer?.running, timer?.started_at]);
  const liveElapsed = (timer?.elapsed_minutes ?? 0) + (timer?.running ? tick : 0);
```

Resetting `tick` to 0 inside the effect matters: without it, pausing and
restarting would carry the previous run's tick count into the new total.

- [ ] **Step 4: Add the `timer` badge to work log rows**

Find the `auto` badge at line 287:

```tsx
                              {wlog.source === 'auto' && (
                                <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                                  auto
                                </span>
                              )}
```

Replace it with:

```tsx
                              {wlog.source !== 'manual' && (
                                <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                                  {wlog.source}
                                </span>
                              )}
```

- [ ] **Step 5: Verify typecheck and build**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Expected: no type errors, build succeeds.

- [ ] **Step 6: Verify in the running app**

```bash
npm run dev
```

Open an issue, click **Start timer**, confirm the elapsed value appears and advances, click **Pause**, confirm it stops. Open a second issue, start its timer, and confirm the "Paused your timer on ATLAS-N" notice appears. Move an issue with tracked time to Done and confirm a work log row appears with a `timer` badge.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/app/issue-detail/issue-fields.tsx
git commit -m "feat(frontend): issue stopwatch control and live in-progress value"
```

---

### Task 9: Mobile timer UI

**Files:**
- Create: `mobile/src/api/timers.ts`
- Modify: `mobile/src/api/issues.ts` (the `Issue` type)
- Modify: `mobile/src/screens/IssueDetailScreen.tsx`
- Test: `mobile/src/__tests__/IssueDetailScreen.test.tsx` (append)

**Interfaces:**
- Consumes: the endpoints from Task 4; `apiFetch` from `./client`.
- Produces: `fetchTimer`, `startTimer`, `pauseTimer` from `mobile/src/api/timers.ts`.

- [ ] **Step 1: Write the failing test**

Append to `mobile/src/__tests__/IssueDetailScreen.test.tsx`, matching the file's existing render helper and mock style:

```tsx
describe('IssueDetailScreen time section', () => {
  test('shows the in-progress value and a Start timer control', async () => {
    // Follow this file's existing mocking approach for fetchIssue: return an
    // issue with in_progress_minutes_live set and no running timer.
    const { findByText } = renderScreen({
      issue: { in_progress_minutes_live: 90, time_spent: 0 },
      timer: { running: false, started_at: null, elapsed_minutes: 0, runaway: false, by_user: [] },
    });

    expect(await findByText(/In progress/)).toBeTruthy();
    expect(await findByText('Start timer')).toBeTruthy();
  });

  test('shows Pause while a timer is running', async () => {
    const { findByText } = renderScreen({
      issue: { in_progress_minutes_live: null, time_spent: 0 },
      timer: { running: true, started_at: '2026-07-06 09:00:00', elapsed_minutes: 30, runaway: false, by_user: [] },
    });

    expect(await findByText('Pause')).toBeTruthy();
  });
});
```

Adapt `renderScreen` to this file's existing helper — read the top of the file first and reuse whatever it already does to mock `fetchIssue`, `fetchProjectStatuses`, and `fetchProjectMembers`, adding `fetchTimer` to the same mock block.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd mobile && npx jest src/__tests__/IssueDetailScreen.test.tsx --verbose
```

Expected: FAIL — no "Start timer" text is rendered.

- [ ] **Step 3: Create `mobile/src/api/timers.ts`**

```ts
import { apiFetch } from './client';

export type TimerUserTotal = { user_id: string; name: string; minutes: number };

export type TimerState = {
  running: boolean;
  started_at: string | null;
  elapsed_minutes: number;
  /** Open for more than 12h — a warning only, never auto-corrected. */
  runaway: boolean;
  by_user: TimerUserTotal[];
  paused_issue?: { id: string; issue_key: string } | null;
};

export function fetchTimer(issueId: string): Promise<TimerState> {
  return apiFetch<TimerState>(`/issues/${issueId}/timer`);
}

export function startTimer(issueId: string): Promise<TimerState> {
  return apiFetch<TimerState>(`/issues/${issueId}/timer/start`, { method: 'POST', body: {} });
}

export function pauseTimer(issueId: string): Promise<TimerState> {
  return apiFetch<TimerState>(`/issues/${issueId}/timer/pause`, { method: 'POST', body: {} });
}
```

- [ ] **Step 4: Extend the `Issue` type**

In `mobile/src/api/issues.ts`, add these fields to the `Issue` type, after `project_id`:

```ts
  time_spent: number | null;
  in_progress_minutes_live: number | null;
```

- [ ] **Step 5: Add the Time section to `IssueDetailScreen.tsx`**

Add the imports:

```tsx
import { fetchTimer, startTimer, pauseTimer } from '../api/timers';
```

Add the query and mutations next to the existing `updateMutation`:

```tsx
  const timerQuery = useQuery({ queryKey: ['timer', issueId], queryFn: () => fetchTimer(issueId) });

  const timerMutation = useMutation({
    mutationFn: (action: 'start' | 'pause') =>
      action === 'start' ? startTimer(issueId) : pauseTimer(issueId),
    onSuccess: (state) => {
      queryClient.setQueryData(['timer', issueId], state);
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    },
  });
```

Add this section at the end of the `ScrollView`, after the `AssigneePicker`:

```tsx
      <Text style={styles.sectionLabel}>Time</Text>
      {issue.in_progress_minutes_live !== null && (
        <Text style={styles.timeValue}>
          In progress: {formatMinutes(issue.in_progress_minutes_live)}
        </Text>
      )}
      {!!timerQuery.data && timerQuery.data.elapsed_minutes > 0 && (
        <Text style={styles.timeValue}>
          Tracked: {formatMinutes(timerQuery.data.elapsed_minutes)}
        </Text>
      )}
      <Button
        title={timerQuery.data?.running ? 'Pause' : 'Start timer'}
        disabled={timerMutation.isPending}
        onPress={() => timerMutation.mutate(timerQuery.data?.running ? 'pause' : 'start')}
      />
      {timerQuery.data?.runaway && (
        <Text style={styles.warning}>Timer running over 12 hours — still working?</Text>
      )}
```

Add this helper above the component:

```tsx
function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

Add the two styles to the `StyleSheet.create` block:

```tsx
  timeValue: { fontSize: 14, color: '#333', marginBottom: 8 },
  warning: { fontSize: 12, color: '#b91c1c', marginTop: 8 },
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd mobile && npx jest src/__tests__/IssueDetailScreen.test.tsx --verbose
```

Expected: PASS.

- [ ] **Step 7: Typecheck and run the full mobile suite**

```bash
cd mobile && npx tsc --noEmit && npx jest
```

Expected: no type errors; all mobile tests pass.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/timers.ts mobile/src/api/issues.ts mobile/src/screens/IssueDetailScreen.tsx mobile/src/__tests__/IssueDetailScreen.test.tsx
git commit -m "feat(mobile): issue time section with stopwatch control"
```

---

### Task 10: Full verification

**Files:** none modified — this task only runs and reports.

- [ ] **Step 1: Run the full backend suite**

```bash
cd backend && npm run test:backend
```

Expected: PASS. Record the exact suite/test counts from the output — do not paraphrase or estimate them.

- [ ] **Step 2: Run the frontend typecheck and build**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Expected: no type errors, build succeeds.

- [ ] **Step 3: Run the mobile typecheck and tests**

```bash
cd mobile && npx tsc --noEmit && npx jest
```

Expected: no type errors, tests pass.

- [ ] **Step 4: Verify the two behaviors that most easily regress**

Confirm from the test output, naming the specific tests:

1. An issue with **no** timer segments still gets a `source='auto'` work log on Done — the pre-existing auto-calculation is untouched.
2. `closeStaleSegments` does **not** truncate a same-day running segment — live timers are never destroyed.

- [ ] **Step 5: Commit any incidental fixes**

```bash
git add -A
git commit -m "test: verify stopwatch feature end to end"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Schema (`timer_segments`, `source='timer'`) | 1 |
| §2 Raw wall-clock, no clipping | 3 (test: "NOT business-hours clipped") |
| §2 Auto-close on earlier calendar day only | 3 (`closeStaleSegments` + regression test) |
| §2 Runaway flag, never fabricate a cutoff | 3 (`workdayEndFor` returns null), 8, 9 |
| §2 Helpers (`closeStaleSegments`, `timerState`, `issueTimerTotals`, `commitTimer`) | 3 |
| §3 Five endpoints | 4 |
| §3 One running timer per user, global | 3 (`startTimer`), 4 (route test) |
| §4 Done precedence + auto-stop | 5 |
| §5 Three-way rollup split | 6 |
| §6 Web UI, live counter, `in_progress_minutes_live`, `timer` badge | 7, 8 |
| §7 Mobile UI | 9 |
| §8 Testing | 3, 4, 5, 6, 9, 10 |

`issueTimerTotals` from the spec is delivered as `timerState`'s `by_user` field rather than a separate export — one fewer function for the same data. `issueTimerUserIds` was added because Task 5 needs the distinct tracker list.

**Placeholder scan:** Task 6 Step 5 and Task 9 Step 1 direct the implementer to match existing file conventions they must read first, because the exact surrounding code (the CSV row builder, the RN test's render helper) is style-dependent rather than specifiable in advance. Every other step carries its literal code.

**Verified against the codebase while writing:**

- `users` has a `password` column, **not** `password_hash`, and its `role` CHECK accepts `('admin','board_admin','client','user')` — **not** `'member'`. Test fixtures use the real column and a valid role.
- `frontend/src/components/app/issue-detail/issue-fields.tsx` has **no React import**; Task 8 Step 2 adds the named hook imports rather than assuming a `React` namespace binding.
- `GET /api/auth/me` exists (`backend/routes/auth.js:68`) and is used to resolve the acting user id in tests.
- `api.ts`'s helpers are `get<T>(path)` and `post<T>(path, body?)`, matching the Task 7 call shapes.
- New tables belong in `migrations.js` only, not `database.js`'s base schema arrays (`feature_impact_metrics` is the precedent).

**Type consistency:** `TimerState` has identical field names in `frontend/src/lib/types.ts` (Task 7) and `mobile/src/api/timers.ts` (Task 9), both matching `timerState`'s return shape in Task 3. `commitTimer(db, issueId, userId)` is called with that signature in Tasks 4 and 5. `closeStaleSegments(db, { userId, issueId })` takes an options object at every call site.
