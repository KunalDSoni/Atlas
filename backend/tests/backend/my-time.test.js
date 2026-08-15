// "What did I work on this week?" — across every project, which no existing
// report answers: they are all scoped to one project.
// See docs/superpowers/specs/2026-08-15-my-time-design.md
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');
const request = require('supertest');
const { getDb, run } = require('../../database');
const { v4: uuidv4 } = require('uuid');

let headers, otherHeaders, db, projectId, otherProjectId, adminId, otherId;

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  otherHeaders = await userHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  otherProjectId = projects.body[1].id;
  adminId = (await request(getApp()).get('/api/auth/me').set(headers)).body.id;
  otherId = (await request(getApp()).get('/api/auth/me').set(otherHeaders)).body.id;
  await run(db, "UPDATE users SET timezone = 'UTC' WHERE id = ?", [adminId]);
});

async function mkIssue(pid, title) {
  return (await request(getApp())
    .post(`/api/projects/${pid}/issues`).set(headers).send({ title, type: 'task' })).body;
}

async function logAt(issueId, userId, minutes, createdAt, source = 'manual') {
  const id = uuidv4();
  await run(db,
    'INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, issueId, userId, minutes, null, source, createdAt]);
  return id;
}

const myTime = (h, from, to) =>
  request(getApp()).get(`/api/me/time?from=${from}&to=${to}`).set(h);

describe('GET /api/me/time', () => {
  test('totals only the caller\'s own logs', async () => {
    const issue = await mkIssue(projectId, 'Shared issue');
    await logAt(issue.id, adminId, 60, '2026-06-01 10:00:00');
    await logAt(issue.id, otherId, 999, '2026-06-01 10:00:00');

    const res = await myTime(headers, '2026-06-01', '2026-06-02');

    expect(res.status).toBe(200);
    expect(res.body.total_minutes).toBe(60);
    expect(res.body.entries.every((e) => e.minutes !== 999)).toBe(true);
  });

  test('the range is half-open: `from` is included, `to` is not', async () => {
    const issue = await mkIssue(projectId, 'Boundaries');
    await logAt(issue.id, adminId, 30, '2026-06-08 00:00:00'); // from
    await logAt(issue.id, adminId, 45, '2026-06-15 00:00:00'); // to — excluded

    const res = await myTime(headers, '2026-06-08', '2026-06-15');

    expect(res.body.total_minutes).toBe(30);
  });

  test('by_day covers every date in the range, zeros included', async () => {
    // A caller that has to reconstruct missing days to draw a week will get it
    // wrong; the server knows the range and says so completely.
    const issue = await mkIssue(projectId, 'Sparse week');
    await logAt(issue.id, adminId, 120, '2026-06-23 09:00:00');

    const res = await myTime(headers, '2026-06-22', '2026-06-29');

    expect(res.body.by_day).toHaveLength(7);
    expect(res.body.by_day[0]).toEqual({ date: '2026-06-22', minutes: 0 });
    expect(res.body.by_day[1]).toEqual({ date: '2026-06-23', minutes: 120 });
  });

  test('spans projects, naming each entry\'s project', async () => {
    const a = await mkIssue(projectId, 'In project A');
    const b = await mkIssue(otherProjectId, 'In project B');
    await logAt(a.id, adminId, 30, '2026-07-01 09:00:00');
    await logAt(b.id, adminId, 45, '2026-07-01 11:00:00');

    const res = await myTime(headers, '2026-07-01', '2026-07-02');

    expect(res.body.total_minutes).toBe(75);
    const keys = res.body.entries.map((e) => e.project_key);
    expect(new Set(keys).size).toBe(2);
  });

  test('keeps the source, so measured time is distinguishable from inferred', async () => {
    const issue = await mkIssue(projectId, 'Sources');
    await logAt(issue.id, adminId, 30, '2026-07-08 09:00:00', 'timer');
    await logAt(issue.id, adminId, 20, '2026-07-08 10:00:00', 'auto');

    const res = await myTime(headers, '2026-07-08', '2026-07-09');

    expect(res.body.entries.map((e) => e.source).sort()).toEqual(['auto', 'timer']);
  });

  test('entries carry the issue they belong to', async () => {
    const issue = await mkIssue(projectId, 'Linkable');
    await logAt(issue.id, adminId, 30, '2026-07-15 09:00:00');

    const res = await myTime(headers, '2026-07-15', '2026-07-16');

    expect(res.body.entries[0]).toMatchObject({ issue_id: issue.id, issue_key: issue.issue_key, title: 'Linkable' });
  });

  test('rejects a missing range', async () => {
    expect((await request(getApp()).get('/api/me/time').set(headers)).status).toBe(400);
  });

  test('rejects a malformed date', async () => {
    const res = await myTime(headers, 'last-tuesday', '2026-07-16');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from/);
  });

  test('rejects a range longer than 31 days rather than streaming it', async () => {
    const res = await myTime(headers, '2026-01-01', '2026-06-01');
    expect(res.status).toBe(400);
  });

  test('rejects a range that ends before it starts', async () => {
    expect((await myTime(headers, '2026-07-10', '2026-07-01')).status).toBe(400);
  });
});
