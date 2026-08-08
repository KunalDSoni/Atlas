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
