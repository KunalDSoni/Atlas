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
  await applyAutoWorklog(db, fresh, statuses, issue.reporter_id);

  const logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(logs).toHaveLength(1);
  expect(Number(logs[0].minutes)).toBe(120);
  const updatedIssue = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
  expect(Number(updatedIssue.time_spent)).toBe(120);
});

test('applyAutoWorklog replaces the prior auto row on re-completion (reopen -> redo -> done)', async () => {
  const issue = await mkIssue('Auto worklog reopen');
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('reopen-a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('reopen-a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
  const statuses = await projectStatuses(db, projectId);
  await applyAutoWorklog(db, { ...issue, status: 'done' }, statuses, issue.reporter_id);
  let logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(Number(logs[0].minutes)).toBe(60);

  // Reopen and redo for two more hours, then complete again.
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('reopen-a3', ?, ?, 'update', 'status', 'done', 'in_progress', '2026-07-07 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('reopen-a4', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-07 11:00:00')`, [issue.id, issue.reporter_id]);
  await applyAutoWorklog(db, { ...issue, status: 'done' }, statuses, issue.reporter_id);

  logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(logs).toHaveLength(1); // replaced, not duplicated
  expect(Number(logs[0].minutes)).toBe(180); // 60 + 120, cumulative total
});

test('applyAutoWorklog falls back to the actor when the issue is unassigned', async () => {
  const issue = await mkIssue('Auto worklog unassigned');
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('unassigned-a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('unassigned-a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
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
    VALUES ('locked-a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('locked-a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
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
    VALUES ('manual-a1', ?, ?, 'update', 'status', 'todo', 'in_progress', '2026-07-06 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('manual-a2', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-06 10:00:00')`, [issue.id, issue.reporter_id]);
  const statuses = await projectStatuses(db, projectId);
  const freshIssue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  await applyAutoWorklog(db, freshIssue, statuses, issue.reporter_id);

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
    VALUES ('live-a1', ?, ?, 'update', 'status', 'todo', 'in_progress', ?)`, [issue.id, issue.reporter_id, oneHourAgo]);
  await run(db, "UPDATE issues SET status = 'in_progress' WHERE id = ?", [issue.id]);
  const statuses = await projectStatuses(db, projectId);
  const freshIssue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issue.id]);
  const minutes = await liveInProgressMinutes(db, freshIssue, statuses);
  expect(minutes).toBeGreaterThanOrEqual(59);
  expect(minutes).toBeLessThanOrEqual(61);
});

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
    // mkIssue's default status is already 'todo' — move away first so the
    // subsequent transition back to 'todo' is a real status change.
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [issue.id]);

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'todo' });

    const updated = await queryOne(db, 'SELECT auto_worklog_locked FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.auto_worklog_locked)).toBe(0);
  });

  test('a locked issue does not get its auto row regenerated on re-completion', async () => {
    const issue = await mkIssue('Integration stays locked');
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    // Backdate so the in_progress segment has a measurable span (activity_log
    // timestamps are second-granularity; two rapid PUTs land in the same
    // second and would otherwise round down to a 0-minute, unlogged segment).
    await run(db, "UPDATE activity_log SET created_at = '2026-07-06 09:00:00' WHERE issue_id = ? AND field = 'status' AND new_value = 'in_progress'", [issue.id]);
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

  test('a stale auto row from a completion before any timer was used is removed once a later done commits tracked time', async () => {
    // Regression guard: a PRIOR done-transition (no timer involved yet)
    // writes a source='auto' row. commitTimer only ever deletes its own
    // source='timer' rows for its own user — it never touches source='auto'
    // — so without an explicit cleanup, reopening and completing again with
    // the stopwatch used this time leaves BOTH rows behind and double-counts.
    const issue = await mkIssue('Auto then timer replaces it, not adds to it');
    const me = await request(getApp()).get('/api/auth/me').set(headers);

    // First completion with no timer at all: produces a real auto row.
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await run(db, "UPDATE activity_log SET created_at = '2026-07-06 09:00:00' WHERE issue_id = ? AND field = 'status' AND new_value = 'in_progress'", [issue.id]);
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const firstAuto = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
    expect(firstAuto).toHaveLength(1);
    expect(Number(firstAuto[0].minutes)).toBeGreaterThan(0);

    // Reopen, track real time with the stopwatch this time, complete again.
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'todo' });
    await addTimerSegment(issue.id, me.body.id, '2026-07-08 09:00:00', '2026-07-08 09:30:00'); // 30
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const logs = await queryAll(db, 'SELECT * FROM work_logs WHERE issue_id = ?', [issue.id]);
    expect(logs).toHaveLength(1); // exactly one row survives, not two
    expect(logs[0].source).toBe('timer');
    expect(Number(logs[0].minutes)).toBe(30);

    const updated = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.time_spent)).toBe(30); // not the stale auto minutes plus 30
  });

  test('a zero-minute timer session does not lock the issue out of the derived calculation', async () => {
    // Regression guard: starting and immediately pausing a timer rounds to 0
    // minutes. commitTimer must not lock the issue against applyAutoWorklog
    // for a session that logged nothing, and the Done handler must fall
    // through to the derived calculation rather than getting permanently
    // stuck with neither auto nor timer time logged.
    const issue = await mkIssue('Zero-minute timer falls through to auto');
    const me = await request(getApp()).get('/api/auth/me').set(headers);
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'in_progress' });
    await run(db, "UPDATE activity_log SET created_at = '2026-07-06 09:00:00' WHERE issue_id = ? AND field = 'status' AND new_value = 'in_progress'", [issue.id]);
    // Started and immediately paused: identical start/end, exactly 0 elapsed.
    await addTimerSegment(issue.id, me.body.id, '2026-07-06 09:00:00', '2026-07-06 09:00:00');

    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

    const timerLogs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(timerLogs).toHaveLength(0);
    const autoLogs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
    expect(autoLogs).toHaveLength(1);
    expect(Number(autoLogs[0].minutes)).toBeGreaterThan(0);

    const updated = await queryOne(db, 'SELECT time_spent, auto_worklog_locked FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.time_spent)).toBeGreaterThan(0);
    expect(Number(updated.auto_worklog_locked)).toBe(0); // not locked; a real reopen->done cycle can regenerate it
  });

  test('a segment abandoned days ago is clipped to its workday end on Done, not committed at the full wall-clock span', async () => {
    // Regression guard: closeStaleSegments's issueId-scoped branch (used by
    // the Done handler) used to close every open segment at `now`
    // unconditionally, with none of the earlier-day/workday-end clipping the
    // userId-scoped branch already applies on every read. A segment
    // abandoned for days would then be committed as tracked time across the
    // full multi-day span, including nights and weekends.
    jest.useFakeTimers({
      doNotFake: [
        'hrtime', 'nextTick', 'performance', 'queueMicrotask',
        'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
        'cancelIdleCallback', 'setImmediate', 'clearImmediate',
        'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      ],
    });
    jest.setSystemTime(new Date('2026-07-06T14:00:00Z')); // Monday, 2pm UTC — "now"

    try {
      await run(db, 'UPDATE projects SET business_hours = ? WHERE id = ?',
        [JSON.stringify({ timezone: 'UTC', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 }), projectId]);

      const issue = await mkIssue('Stale timer clipped on done');
      const me = await request(getApp()).get('/api/auth/me').set(headers);
      // Started Friday 09:30 (3 days before the pinned "now"), never paused —
      // abandoned over the weekend. Friday is a work day, so the workday-end
      // clip should stop it at Friday 18:00 (510 minutes), not the ~4,470
      // wall-clock minutes to Monday 2pm.
      await addTimerSegment(issue.id, me.body.id, '2026-07-03 09:30:00', null);

      await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' });

      const timerLogs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
      expect(timerLogs).toHaveLength(1);
      expect(Number(timerLogs[0].minutes)).toBe(510); // Friday 09:30 -> Friday 18:00, not to Monday 14:00

      const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE issue_id = ?', [issue.id]);
      expect(seg.ended_at).toBe('2026-07-03 18:00:00');

      await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
    } finally {
      jest.useRealTimers();
    }
  });
});
