const { createTestApp, getApp, adminHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryOne, queryAll, run } = require('../../database');
const {
  closeStaleSegments, startTimer, pauseTimer, timerState, commitTimer, issueTimerUserIds, issueTimerTotals,
  RUNAWAY_MINUTES, findTimerOvercounts, settleSegments,
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

/**
 * A user of their own, for tests that assert on closeStaleSegments' treatment
 * of ONE open segment.
 *
 * closeStaleSegments enforces "at most one running timer per user" across every
 * issue, so a segment left open by an earlier test in this file is not inert
 * background state — it competes with the fixture, and the newest start wins.
 * Sharing adminId made those assertions depend on the order and timing of
 * unrelated tests.
 */
async function freshUser(name) {
  const id = uuidv4();
  await run(db, 'INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
    [id, `t-${id}@example.com`, name, 'x', 'user']);
  return id;
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
    //
    // This fixture deliberately pins "now" with fake timers instead of using
    // stampAgo(). A profile with normal hours (9-18) and a segment started
    // earlier TODAY, well inside business hours, means workdayEndFor() would
    // happily compute a valid, non-null boundary (18:00) for this segment if
    // the earlier-calendar-day check in closeStaleSegments were removed — so
    // this fixture actually exercises that check. (An earlier version of this
    // test used a start_hour:0/end_hour:1 profile with stampAgo(30); that
    // fixture passed even with the earlier-day check deleted, because
    // workdayEndFor's own `end <= start` guard independently caught it —
    // masking the very regression this test exists to catch.)
    jest.useFakeTimers({
      doNotFake: [
        'hrtime', 'nextTick', 'performance', 'queueMicrotask',
        'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
        'cancelIdleCallback', 'setImmediate', 'clearImmediate',
        'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      ],
    });
    jest.setSystemTime(new Date('2026-07-06T14:00:00Z')); // Monday, 2pm UTC

    try {
      const issue = await mkIssue('Same day still running');
      const userId = await freshUser('Same day tester');
      await run(db, 'UPDATE projects SET business_hours = ? WHERE id = ?',
        [JSON.stringify({ timezone: 'UTC', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 }), projectId]);
      // Started 10am "today" (per the pinned clock) — same local calendar day
      // as "now", well before the 18:00 close.
      const segId = await addSegment(issue.id, userId, '2026-07-06 10:00:00');

      await closeStaleSegments(db, { userId });

      const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE id = ?', [segId]);
      expect(seg.ended_at).toBeNull();

      await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('leaves a segment open and flags runaway when no profile is configured', async () => {
    const issue = await mkIssue('Runaway no profile');
    const userId = await freshUser('Runaway tester');
    const segId = await addSegment(issue.id, userId, stampAgo(60 * 20)); // 20 hours

    await closeStaleSegments(db, { userId });
    const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE id = ?', [segId]);
    expect(seg.ended_at).toBeNull(); // never fabricate a cutoff

    const state = await timerState(db, issue.id, userId);
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

describe('issueTimerTotals aggregates per-user cumulative time', () => {
  test('returns per-user minute totals across all segments', async () => {
    const issue = await mkIssue('Timer totals');
    const otherUserRes = await require('./setup').userHeaders();
    const otherUser = await request(getApp()).get('/api/auth/me').set(otherUserRes);
    const otherUserId = otherUser.body.id;

    // Admin: two segments totaling 90 minutes
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00'); // 60
    await addSegment(issue.id, adminId, '2026-07-06 11:00:00', '2026-07-06 11:30:00'); // 30

    // Other user: one segment of 45 minutes
    await addSegment(issue.id, otherUserId, '2026-07-06 14:00:00', '2026-07-06 14:45:00');

    const totals = await issueTimerTotals(db, issue.id);
    expect(totals.length).toBe(2);

    const adminTotal = totals.find((u) => u.user_id === adminId);
    expect(adminTotal.minutes).toBe(90);

    const otherTotal = totals.find((u) => u.user_id === otherUserId);
    expect(otherTotal.minutes).toBe(45);
  });

  test('omits users with no segments', async () => {
    const issue = await mkIssue('Timer totals exclude');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');

    const totals = await issueTimerTotals(db, issue.id);
    expect(totals.length).toBe(1);
    expect(totals[0].user_id).toBe(adminId);
  });

  test('includes user names from the users table', async () => {
    const issue = await mkIssue('Timer totals names');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');

    const totals = await issueTimerTotals(db, issue.id);
    expect(totals[0].name).toBeDefined();
    expect(totals[0].name).not.toBe('Unknown');
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

describe('closeStaleSegments west of Greenwich', () => {
  // localMidnightUtc used to land a full calendar day early for every negative
  // UTC offset, which made workdayEndFor's `end <= start` guard reject every
  // boundary it computed. The visible effect was not a wrong number but a
  // missing action: no segment belonging to a user in the Americas was ever
  // auto-closed, so abandoned timers accrued for weeks and then committed the
  // lot. Every other fixture in this file uses timezone 'UTC', where a
  // sign-flipped offset is indistinguishable from a correct one.
  const NEW_YORK = JSON.stringify({
    timezone: 'America/New_York', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18,
  });

  test('closes an abandoned segment at that day business-day end', async () => {
    const issue = await mkIssue('NY abandoned');
    await run(db, 'UPDATE projects SET business_hours = ? WHERE id = ?', [NEW_YORK, projectId]);
    // Monday 2026-07-06 14:00Z == 10:00 New York, inside hours, long abandoned.
    const segId = await addSegment(issue.id, adminId, '2026-07-06 14:00:00');

    await closeStaleSegments(db, { userId: adminId });

    const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE id = ?', [segId]);
    await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
    expect(seg.ended_at).toBe('2026-07-06 22:00:00'); // 18:00 New York
    expect(seg.auto_stopped).toBe('workday_end');
  });
});

describe('an abandoned segment credits nothing', () => {
  // The server may BOUND a timer using evidence (a configured workday end). It
  // may never INVENT a duration. Crediting the largest plausible session put
  // hours nobody worked into work_logs, which is worse than an obviously-wrong
  // open segment: it looks right.
  // See docs/superpowers/specs/2026-08-15-abandoned-timer-credits-zero-design.md
  test('credits 0 minutes when no profile can bound the segment', async () => {
    const issue = await mkIssue('No profile abandoned');
    const user = await freshUser('No profile');
    await addSegment(issue.id, user, stampAgo(60 * 30)); // 30h

    await closeStaleSegments(db, { userId: user });

    expect((await timerState(db, issue.id, user)).elapsed_minutes).toBe(0);
  });

  test('writes no work log for an abandoned segment', async () => {
    const issue = await mkIssue('Abandoned logs nothing');
    const user = await freshUser('Logs nothing');
    await addSegment(issue.id, user, stampAgo(60 * 30));

    await closeStaleSegments(db, { userId: user });

    const logs = await queryAll(db, 'SELECT * FROM work_logs WHERE issue_id = ?', [issue.id]);
    expect(logs).toHaveLength(0);
    const fresh = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
    expect(Number(fresh.time_spent || 0)).toBe(0);
  });

  test('records when the segment was found, so the stop can still be explained', async () => {
    // recentAutoStop drops stops older than a day and the rail renders
    // timeAgo(stopped_at). Back-dating ended_at to force a zero credit would
    // silence the explanation exactly when the user most needs it.
    const issue = await mkIssue('Abandoned still explained');
    const user = await freshUser('Still explained');
    await addSegment(issue.id, user, stampAgo(60 * 30));

    await closeStaleSegments(db, { userId: user });

    const state = await timerState(db, issue.id, user);
    expect(state.auto_stopped).toMatchObject({ reason: 'abandoned' });
    const stoppedAgo = (Date.now() - new Date(`${state.auto_stopped.stopped_at.replace(' ', 'T')}Z`)) / 60_000;
    expect(stoppedAgo).toBeLessThan(5); // found just now, not 30h ago
  });

  test('credits 0 for a Saturday start even with a business-hours profile', async () => {
    // The mitigation KNOWN-ISSUES.md recommended. workdayEndFor returns null on
    // a non-work day, so this fell through to the invented cap with a profile
    // fully configured.
    const issue = await mkIssue('Weekend start');
    const user = await freshUser('Weekend');
    await run(db, 'UPDATE projects SET business_hours = ? WHERE id = ?',
      [JSON.stringify({ timezone: 'UTC', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 }), projectId]);
    try {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 2);
      while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() - 1);
      d.setUTCHours(15, 0, 0, 0);
      await addSegment(issue.id, user, d.toISOString().slice(0, 19).replace('T', ' '));

      await closeStaleSegments(db, { userId: user });

      expect((await timerState(db, issue.id, user)).elapsed_minutes).toBe(0);
    } finally {
      await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
    }
  });

  test('a real tracked segment on the same issue still commits its own minutes', async () => {
    const issue = await mkIssue('Real work beside abandoned');
    const user = await freshUser('Real work');
    await addSegment(issue.id, user, '2026-07-06 09:00:00', '2026-07-06 09:45:00'); // 45m worked
    await addSegment(issue.id, user, stampAgo(60 * 30)); // and one abandoned

    await closeStaleSegments(db, { userId: user });

    expect((await timerState(db, issue.id, user)).elapsed_minutes).toBe(45);
  });

  test('leaves a segment under the cap open so the runaway warning stays actionable', async () => {
    // The warning exists to give the user a chance to pause the timer
    // themselves and keep their real elapsed time. A cap at the same threshold
    // as the warning would close the segment on the very read that would have
    // reported it, and the warning could never fire at all.
    const issue = await mkIssue('Under the cap');
    const segId = await addSegment(issue.id, adminId, stampAgo(60 * 20)); // 20h

    await closeStaleSegments(db, { userId: adminId });

    const seg = await queryOne(db, 'SELECT * FROM timer_segments WHERE id = ?', [segId]);
    expect(seg.ended_at).toBeNull();
    expect((await timerState(db, issue.id, adminId)).runaway).toBe(true);
  });
});

describe('a stop the user did not ask for is explained', () => {
  test('timerState reports why the server closed the segment', async () => {
    const issue = await mkIssue('Explain the stop');
    await addSegment(issue.id, adminId, stampAgo(60 * 30));

    await closeStaleSegments(db, { userId: adminId });
    const state = await timerState(db, issue.id, adminId);

    expect(state.running).toBe(false);
    expect(state.auto_stopped).toMatchObject({ reason: 'abandoned' });
  });

  test('a user-initiated pause is not reported as an auto-stop', async () => {
    const issue = await mkIssue('User paused');
    await startTimer(db, issue.id, adminId);
    await pauseTimer(db, issue.id, adminId);

    expect((await timerState(db, issue.id, adminId)).auto_stopped).toBeNull();
  });

  test('switching issues records why the displaced timer stopped', async () => {
    const first = await mkIssue('Displaced by a switch');
    const second = await mkIssue('Took over');
    await startTimer(db, first.id, adminId);
    await startTimer(db, second.id, adminId);

    expect((await timerState(db, first.id, adminId)).auto_stopped)
      .toMatchObject({ reason: 'switched_issue' });
    await pauseTimer(db, second.id, adminId);
  });
});

describe('commitTimer does not double count', () => {
  test('drops a pre-existing auto row when tracked time supersedes it', async () => {
    // auto_worklog_locked only stops FUTURE derived recomputes; an 'auto' row
    // written by an earlier pass survived it and was summed into time_spent
    // alongside the timer row, counting the same work twice — once as inferred
    // in-progress time and once as tracked time.
    const issue = await mkIssue('No double count');
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'auto')",
      [uuidv4(), issue.id, adminId, 300, 'Auto-logged: time in progress']);
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00'); // 60m

    await commitTimer(db, issue.id, adminId);

    const logs = await queryAll(db, 'SELECT source FROM work_logs WHERE issue_id = ?', [issue.id]);
    expect(logs.map((l) => l.source)).toEqual(['timer']);
    const updated = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
    expect(Number(updated.time_spent)).toBe(60);
  });
});

describe('pause survives a lost start race', () => {
  test('closes every open segment, not just the first', async () => {
    // startTimer's check-then-insert is not atomic, so a web and a phone start
    // landing together can leave two open rows. Both were measured to `now`,
    // so elapsed ran at double speed and a single-row pause left one running.
    const issue = await mkIssue('Raced start');
    await addSegment(issue.id, adminId, stampAgo(30));
    await addSegment(issue.id, adminId, stampAgo(30));

    await pauseTimer(db, issue.id, adminId);

    const open = await queryAll(db,
      'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [issue.id]);
    expect(open).toHaveLength(0);
  });
});

describe('tracked time reaches work_logs without waiting for Done', () => {
  // The commit endpoint was the only writer of source='timer' work logs and no
  // client ever called it, so tracked time lived in timer_segments alone:
  // absent from issues.time_spent, from the time-tracking report, and from the
  // rail's own "logged" line — which sat directly above a stopwatch reading
  // 2h 30m. An issue that never reached a done status never reported it at all.
  test('pausing commits the session', async () => {
    const issue = await mkIssue('Pause commits');
    const userId = await freshUser('Pause committer');
    await addSegment(issue.id, userId, '2026-07-06 09:00:00', '2026-07-06 10:00:00'); // 60m

    await commitTimer(db, issue.id, userId); // what the pause route now does

    const fresh = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
    expect(Number(fresh.time_spent)).toBe(60);
  });

  test('the pause route commits, so time_spent is right before Done', async () => {
    const issue = await mkIssue('Pause route commits');
    await request(getApp()).post(`/api/issues/${issue.id}/timer/start`).set(headers).expect(200);
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 09:45:00'); // 45m
    await request(getApp()).post(`/api/issues/${issue.id}/timer/pause`).set(headers).expect(200);

    const fresh = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
    expect(Number(fresh.time_spent)).toBeGreaterThanOrEqual(45);
  });

  test('switching issues commits the timer it displaced', async () => {
    const first = await mkIssue('Displaced commits');
    const second = await mkIssue('New focus');
    const userId = await freshUser('Switcher');
    // Running on `first` — only an OPEN segment can be displaced.
    await addSegment(first.id, userId, stampAgo(90));

    await startTimer(db, second.id, userId);

    const fresh = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [first.id]);
    expect(Number(fresh.time_spent)).toBeGreaterThanOrEqual(89);
    expect(Number(fresh.time_spent)).toBeLessThanOrEqual(91);
    await pauseTimer(db, second.id, userId);
  });
});

describe('a human correction to tracked time is final', () => {
  // commitTimer re-derives its row from timer_segments on every pause and every
  // done transition. Without settling the segments, an edit was overwritten and
  // a deletion undid itself the next time the issue moved — silently, and only
  // some time later, which is the worst possible way for a number to change.
  test('an edited timer entry is not rebuilt from the segments', async () => {
    const issue = await mkIssue('Edit is final');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 12:00:00'); // 180m
    await commitTimer(db, issue.id, adminId);
    const log = await queryOne(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);

    await request(getApp()).patch(`/api/worklogs/${log.id}`).set(headers).send({ minutes: 45 }).expect(200);
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' }).expect(200);

    const after = await queryAll(db, 'SELECT minutes, source FROM work_logs WHERE issue_id = ?', [issue.id]);
    expect(after.reduce((sum, r) => sum + Number(r.minutes), 0)).toBe(45);
    expect(after.map((r) => r.source)).toEqual(['manual']); // ownership moved to the human
  });

  test('a deleted timer entry does not come back', async () => {
    const issue = await mkIssue('Delete is final');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 12:00:00');
    await commitTimer(db, issue.id, adminId);
    const log = await queryOne(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);

    await request(getApp()).delete(`/api/worklogs/${log.id}`).set(headers).expect(200);
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ status: 'done' }).expect(200);

    expect(await queryAll(db, 'SELECT id FROM work_logs WHERE issue_id = ?', [issue.id])).toHaveLength(0);
    // The segments are kept as the record of what was tracked, just settled.
    const segs = await queryAll(db, 'SELECT settled_at FROM timer_segments WHERE issue_id = ?', [issue.id]);
    expect(segs.every((s) => s.settled_at)).toBe(true);
  });
});

describe('one running timer per user, however the race lands', () => {
  test('duplicate rows for one session do not double the elapsed time', async () => {
    const issue = await mkIssue('Raced double count');
    const userId = await freshUser('Racer');
    await addSegment(issue.id, userId, stampAgo(60));
    await addSegment(issue.id, userId, stampAgo(60)); // lost race: same session, two rows

    const state = await timerState(db, issue.id, userId);

    expect(state.elapsed_minutes).toBeLessThanOrEqual(61); // not ~120
    expect(state.running).toBe(true); // the earliest row still runs
  });

  test('concurrent starts on two issues collapse to the most recent', async () => {
    const a = await mkIssue('Concurrent A');
    const b = await mkIssue('Concurrent B');
    const userId = await freshUser('Two-device user');
    await addSegment(a.id, userId, stampAgo(90));
    await addSegment(b.id, userId, stampAgo(30));

    await closeStaleSegments(db, { userId });

    const open = await queryAll(db,
      'SELECT issue_id FROM timer_segments WHERE user_id = ? AND ended_at IS NULL', [userId]);
    expect(open).toHaveLength(1);
    expect(open[0].issue_id).toBe(b.id); // newest intent wins, matching startTimer
  });

  test('a de-duplicated row is not reported to the user as a stop', async () => {
    // It credits zero time and repairs an internal invariant; there is nothing
    // for the user to act on, so it must not appear as "your timer stopped".
    const issue = await mkIssue('Silent dedupe');
    const userId = await freshUser('Dedupe user');
    await addSegment(issue.id, userId, stampAgo(60));
    await addSegment(issue.id, userId, stampAgo(60));

    await closeStaleSegments(db, { userId });
    await pauseTimer(db, issue.id, userId);

    expect((await timerState(db, issue.id, userId)).auto_stopped).toBeNull();
  });
});

describe('deleting an issue takes its time tracking with it', () => {
  test('work logs and timer segments do not outlive the issue', async () => {
    const issue = await mkIssue('Delete cascade');
    await addSegment(issue.id, adminId, '2026-07-06 09:00:00', '2026-07-06 10:00:00');
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, 'manual')",
      [uuidv4(), issue.id, adminId, 30]);

    await request(getApp()).delete(`/api/issues/${issue.id}`).set(headers).expect(200);

    expect(await queryAll(db, 'SELECT id FROM work_logs WHERE issue_id = ?', [issue.id])).toHaveLength(0);
    expect(await queryAll(db, 'SELECT id FROM timer_segments WHERE issue_id = ?', [issue.id])).toHaveLength(0);
  });
});

describe('repairing historical over-counts', () => {
  // Segments closed before the abandonment cap existed keep their inflated
  // span: the live rules only cap segments that are still open. findTimerOvercounts
  // is the one-time pass that rewrites them, exposed through
  // scripts/repair-timer-overcounts.js.
  const THREE_WEEKS_MINUTES = 21 * 24 * 60;

  async function seedOvercount(title) {
    const issue = await mkIssue(title);
    const userId = await freshUser(`Forgetter ${title}`);
    // A stopwatch forgotten on a Friday afternoon, closed at Done three weeks later.
    await addSegment(issue.id, userId, '2026-07-03 16:00:00', '2026-07-24 16:00:00');
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'timer')",
      [uuidv4(), issue.id, userId, THREE_WEEKS_MINUTES, 'Tracked with timer']);
    await run(db, 'UPDATE issues SET time_spent = ? WHERE id = ?', [THREE_WEEKS_MINUTES, issue.id]);
    return { issue, userId };
  }

  test('a dry run reports the damage and writes nothing', async () => {
    const { issue } = await seedOvercount('Dry run');

    const report = await findTimerOvercounts(db);

    const mine = report.segments.filter((s) => s.issue_id === issue.id);
    expect(mine).toHaveLength(1);
    expect(Math.round(mine[0].minutes)).toBe(THREE_WEEKS_MINUTES);
    expect(mine[0].credited_minutes).toBe(0);
    expect(report.applied).toBe(false);

    const untouched = await queryOne(db, "SELECT minutes FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(Number(untouched.minutes)).toBe(THREE_WEEKS_MINUTES);
  });

  test('applying removes the fabricated time rather than re-capping it', async () => {
    const { issue } = await seedOvercount('Applied');

    await findTimerOvercounts(db, { apply: true });

    const seg = await queryOne(db, 'SELECT auto_stopped FROM timer_segments WHERE issue_id = ?', [issue.id]);
    expect(seg.auto_stopped).toBe('abandoned');

    // Re-capping to 12h swapped one invented figure for a smaller invented
    // figure. An abandoned segment credits nothing, so the work log goes.
    const logs = await queryAll(db, 'SELECT minutes, source FROM work_logs WHERE issue_id = ?', [issue.id]);
    expect(logs).toHaveLength(0);
    const fresh = await queryOne(db, 'SELECT time_spent FROM issues WHERE id = ?', [issue.id]);
    expect(Number(fresh.time_spent || 0)).toBe(0);
  });

  test('reports a row already capped to exactly 12 hours', async () => {
    // The threshold is ABANDONED_AFTER_MINUTES (24h), but a row the previous
    // rule already capped is exactly RUNAWAY_MINUTES (12h) and slipped
    // underneath it — so the damage the current cap caused was invisible to the
    // very script meant to report it.
    const issue = await mkIssue('Already capped');
    const userId = await freshUser('Already capped user');
    await addSegment(issue.id, userId, '2026-07-03 16:00:00', '2026-07-04 04:00:00');
    await run(db, 'UPDATE timer_segments SET auto_stopped = ? WHERE issue_id = ?', ['abandoned', issue.id]);
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'timer')",
      [uuidv4(), issue.id, userId, RUNAWAY_MINUTES, 'Tracked with timer']);

    const report = await findTimerOvercounts(db);

    const mine = report.segments.filter((s) => s.issue_id === issue.id);
    expect(mine).toHaveLength(1);
    expect(Math.round(mine[0].minutes)).toBe(RUNAWAY_MINUTES);
  });

  test('a second pass finds nothing, and settled segments are never touched', async () => {
    const { issue, userId } = await seedOvercount('Idempotent');
    await findTimerOvercounts(db, { apply: true });
    const after = await findTimerOvercounts(db);
    expect(after.segments.filter((s) => s.issue_id === issue.id)).toHaveLength(0);

    // A human-owned segment stays inflated on purpose: correcting a number by
    // hand is the signal that the machine should stop adjusting it.
    const settled = await mkIssue('Settled overcount');
    await addSegment(settled.id, userId, '2026-07-03 16:00:00', '2026-07-24 16:00:00');
    await settleSegments(db, settled.id, userId);

    const report = await findTimerOvercounts(db);
    expect(report.segments.filter((s) => s.issue_id === settled.id)).toHaveLength(0);
  });
});
