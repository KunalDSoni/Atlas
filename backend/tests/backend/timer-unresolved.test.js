// An abandoned timer credits nothing, so the only way its time is ever
// recorded is for the person to answer "how long did you work?". Until this
// existed that question was reachable only from the issue it happened on —
// and forgetting the timer and forgetting the issue are the same act.
// See docs/superpowers/specs/2026-08-15-recovering-unresolved-time-design.md
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryOne, queryAll, run } = require('../../database');
const { v4: uuidv4 } = require('uuid');

let headers, otherHeaders, db, projectId, adminId, otherId;

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  otherHeaders = await userHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  adminId = (await request(getApp()).get('/api/auth/me').set(headers)).body.id;
  otherId = (await request(getApp()).get('/api/auth/me').set(otherHeaders)).body.id;
});

async function mkIssue(title) {
  return (await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers).send({ title, type: 'task' })).body;
}

function stampAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

/** A segment the server closed, with the reason it closed it. */
async function addClosedSegment(issueId, userId, { startedAgo, stoppedAgo, reason, settled = false }) {
  const id = uuidv4();
  await run(db,
    'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, auto_stopped, settled_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, issueId, userId, stampAgo(startedAgo), stampAgo(stoppedAgo), reason,
      settled ? stampAgo(1) : null, stampAgo(startedAgo)]);
  return id;
}

const unresolvedFor = async (h) => (await request(getApp()).get('/api/me/timer/unresolved').set(h)).body;

describe('GET /api/me/timer/unresolved', () => {
  test('lists an abandoned segment with the issue it happened on', async () => {
    const issue = await mkIssue('Unresolved one');
    const segId = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });

    const body = await unresolvedFor(headers);

    const mine = body.find((s) => s.id === segId);
    expect(mine).toMatchObject({ issue_id: issue.id, issue_key: issue.issue_key, title: 'Unresolved one' });
    expect(mine.started_at).toBeTruthy();
  });

  test('a settled segment is resolved and does not appear', async () => {
    const issue = await mkIssue('Already settled');
    const segId = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned', settled: true });

    expect((await unresolvedFor(headers)).map((s) => s.id)).not.toContain(segId);
  });

  test('a workday-end close is not unresolved — it credited its time', async () => {
    const issue = await mkIssue('Closed at workday end');
    const segId = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 40, reason: 'workday_end' });

    expect((await unresolvedFor(headers)).map((s) => s.id)).not.toContain(segId);
  });

  test('excludes anything older than 30 days', async () => {
    // An unresolved list that grows without limit becomes a second thing to
    // ignore, and month-old time will not be remembered accurately anyway.
    const issue = await mkIssue('Ancient');
    const segId = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 24 * 40, stoppedAgo: 60 * 24 * 39, reason: 'abandoned' });

    expect((await unresolvedFor(headers)).map((s) => s.id)).not.toContain(segId);
  });

  test("never shows another person's segment", async () => {
    const issue = await mkIssue('Someone else forgot');
    const segId = await addClosedSegment(issue.id, otherId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });

    expect((await unresolvedFor(headers)).map((s) => s.id)).not.toContain(segId);
  });
});

describe('logging work answers the question', () => {
  test('logging work on the issue settles my abandoned segments there', async () => {
    const issue = await mkIssue('Answered by logging');
    const segId = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });

    await request(getApp())
      .post(`/api/issues/${issue.id}/worklogs`).set(headers).send({ minutes: 90 });

    expect((await unresolvedFor(headers)).map((s) => s.id)).not.toContain(segId);
    const seg = await queryOne(db, 'SELECT settled_at FROM timer_segments WHERE id = ?', [segId]);
    expect(seg.settled_at).toBeTruthy();
  });

  test("my logging does not settle someone else's segment on the same issue", async () => {
    const issue = await mkIssue('Two forgetters');
    const mine = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });
    const theirs = await addClosedSegment(issue.id, otherId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });

    await request(getApp())
      .post(`/api/issues/${issue.id}/worklogs`).set(headers).send({ minutes: 30 });

    expect((await queryOne(db, 'SELECT settled_at FROM timer_segments WHERE id = ?', [mine])).settled_at).toBeTruthy();
    expect((await queryOne(db, 'SELECT settled_at FROM timer_segments WHERE id = ?', [theirs])).settled_at).toBeNull();
  });
});

describe('POST /api/timer-segments/:id/resolve', () => {
  test('dismissing settles it without writing a work log', async () => {
    // "I did not really work on that" is a legitimate answer and must not
    // require logging a lie to clear.
    const issue = await mkIssue('Dismissed');
    const segId = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });

    const res = await request(getApp()).post(`/api/timer-segments/${segId}/resolve`).set(headers);

    expect(res.status).toBe(200);
    expect((await unresolvedFor(headers)).map((s) => s.id)).not.toContain(segId);
    expect(await queryAll(db, 'SELECT * FROM work_logs WHERE issue_id = ?', [issue.id])).toHaveLength(0);
  });

  test('dismissing twice is harmless', async () => {
    const issue = await mkIssue('Dismissed twice');
    const segId = await addClosedSegment(issue.id, adminId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });

    await request(getApp()).post(`/api/timer-segments/${segId}/resolve`).set(headers);
    const second = await request(getApp()).post(`/api/timer-segments/${segId}/resolve`).set(headers);

    expect(second.status).toBe(200);
  });

  test("cannot dismiss another person's segment", async () => {
    const issue = await mkIssue('Not mine to dismiss');
    const segId = await addClosedSegment(issue.id, otherId,
      { startedAgo: 60 * 50, stoppedAgo: 60 * 26, reason: 'abandoned' });

    // 404 rather than 403: the existence of someone else's segment is not the
    // caller's business.
    const res = await request(getApp()).post(`/api/timer-segments/${segId}/resolve`).set(headers);

    expect(res.status).toBe(404);
    expect((await queryOne(db, 'SELECT settled_at FROM timer_segments WHERE id = ?', [segId])).settled_at).toBeNull();
  });
});
