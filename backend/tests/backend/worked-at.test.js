// When the work happened, as distinct from when the entry was written.
//
// work_logs carried only created_at, so a session was attributed to the moment
// it was RECORDED. A timer started at 23:00 and paused at 01:00 committed onto
// the following day, and a Monday session logged on Tuesday counted as Tuesday.
// worked_at carries the real day; created_at stays as the audit fact.
const { createTestApp, getApp, adminHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryOne, run } = require('../../database');
const { commitTimer } = require('../../utils/timers');
const { v4: uuidv4 } = require('uuid');

let headers, db, projectId, adminId;

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  adminId = (await request(getApp()).get('/api/auth/me').set(headers)).body.id;
  await run(db, "UPDATE users SET timezone = 'UTC' WHERE id = ?", [adminId]);
});

async function mkIssue(title) {
  return (await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers).send({ title, type: 'task' })).body;
}

const myTime = (from, to) =>
  request(getApp()).get(`/api/me/time?from=${from}&to=${to}`).set(headers);

describe('work_logs.worked_at', () => {
  test('defaults to the moment the entry was written', async () => {
    const issue = await mkIssue('Default worked_at');

    const res = await request(getApp())
      .post(`/api/issues/${issue.id}/worklogs`).set(headers).send({ minutes: 30 });

    const row = await queryOne(db, 'SELECT worked_at, created_at FROM work_logs WHERE id = ?', [res.body.id]);
    expect(row.worked_at).toBeTruthy();
    expect(String(row.worked_at).slice(0, 10)).toBe(String(row.created_at).slice(0, 10));
  });

  test('accepts an explicit day for work done earlier', async () => {
    const issue = await mkIssue('Backdated entry');

    const res = await request(getApp())
      .post(`/api/issues/${issue.id}/worklogs`).set(headers)
      .send({ minutes: 60, worked_at: '2026-07-06' });

    expect(res.status).toBe(201);
    const row = await queryOne(db, 'SELECT worked_at FROM work_logs WHERE id = ?', [res.body.id]);
    expect(String(row.worked_at).slice(0, 10)).toBe('2026-07-06');
  });

  test('rejects a malformed day rather than silently using today', async () => {
    const issue = await mkIssue('Bad worked_at');

    const res = await request(getApp())
      .post(`/api/issues/${issue.id}/worklogs`).set(headers)
      .send({ minutes: 60, worked_at: 'last tuesday' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/worked_at/);
  });

  test('a committed timer is dated when the session started, not when it was committed', async () => {
    // The case that motivated this: a session across midnight committed wholly
    // onto the following day.
    const issue = await mkIssue('Overnight session');
    await run(db,
      'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), issue.id, adminId, '2026-07-06 23:00:00', '2026-07-07 01:00:00', '2026-07-06 23:00:00']);

    await commitTimer(db, issue.id, adminId);

    const row = await queryOne(db,
      "SELECT worked_at FROM work_logs WHERE issue_id = ? AND source = 'timer'", [issue.id]);
    expect(String(row.worked_at).slice(0, 10)).toBe('2026-07-06');
  });

  test('My time buckets by the day worked, not the day recorded', async () => {
    const issue = await mkIssue('Bucketed by worked_at');
    await request(getApp())
      .post(`/api/issues/${issue.id}/worklogs`).set(headers)
      .send({ minutes: 90, worked_at: '2026-07-20' });

    const res = await myTime('2026-07-20', '2026-07-21');

    expect(res.body.total_minutes).toBe(90);
    expect(res.body.by_day[0]).toEqual({ date: '2026-07-20', minutes: 90 });
  });

  test('an entry recorded later still falls outside a range it was not worked in', async () => {
    const issue = await mkIssue('Outside the range');
    await request(getApp())
      .post(`/api/issues/${issue.id}/worklogs`).set(headers)
      .send({ minutes: 45, worked_at: '2026-07-27' });

    const res = await myTime('2026-08-03', '2026-08-10');

    expect(res.body.entries.map((e) => e.issue_id)).not.toContain(issue.id);
  });
});
