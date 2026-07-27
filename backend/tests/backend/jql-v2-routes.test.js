const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((project) => project.key === 'HD').id;
});

async function search(q) {
  return request(app).get('/api/search').set(headers).query({ q, project_id: projectId });
}

describe('JQL v2 through search and queues', () => {
  test('OR, grouping and IN execute with the documented precedence', async () => {
    const res = await search('type = request AND (status = todo OR priority IN (high, urgent))');
    expect(res.status).toBe(200);
    expect(res.body.jql).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    for (const issue of res.body.issues) {
      expect(issue.type).toBe('request');
      expect(issue.status === 'todo' || ['high', 'urgent'].includes(issue.priority)).toBe(true);
    }
  });

  test('request_type and category resolve through service desk metadata', async () => {
    const typed = await search('request_type = "Hardware problem"');
    expect(typed.status).toBe(200);
    expect(typed.body.issues.map((issue) => issue.issue_key)).toContain('HD-1');

    const done = await search('category = done');
    expect(done.status).toBe(200);
    expect(done.body.issues.every((issue) => issue.status === 'done')).toBe(true);
  });

  test('the seeded Needs attention queue is non-empty and its count equals its rows', async () => {
    const list = await request(app).get(`/api/projects/${projectId}/queues`).set(headers);
    expect(list.status).toBe(200);
    const queue = list.body.find((item) => item.name === 'Needs attention');
    expect(queue).toBeDefined();
    expect(queue.invalid).toBeNull();
    expect(queue.count).toBeGreaterThan(0);

    const rows = await request(app).get(`/api/queues/${queue.id}/issues`).set(headers);
    expect(rows.status).toBe(200);
    expect(rows.body).toHaveLength(queue.count);
    expect(rows.body.map((issue) => issue.issue_key)).toContain('HD-1');
  });

  test('stopped clocks are history and leave active breach searches', async () => {
    const before = await search('first_response = breached');
    expect(before.body.issues.map((issue) => issue.issue_key)).toContain('HD-1');

    const issues = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
    const target = issues.body.find((issue) => issue.issue_key === 'HD-1');
    const reply = await request(app).post(`/api/issues/${target.id}/comments`).set(headers)
      .send({ body: 'Public response stops the active clock', visibility: 'public' });
    expect(reply.status).toBe(201);

    const after = await search('first_response = breached');
    expect(after.body.issues.map((issue) => issue.issue_key)).not.toContain('HD-1');
  });

  test('paused is a flag and can be combined with the frozen breach state', async () => {
    const { getDb, queryOne, run } = require('../../database');
    const { refreshBoundaries } = require('../../utils/sla-clocks');
    const db = await getDb();
    const issue = await queryOne(db, "SELECT * FROM issues WHERE issue_key = 'HD-2'");
    await run(db,
      "UPDATE sd_sla_clocks SET started_at = '2020-01-01 00:00:00' WHERE issue_id = ? AND metric = 'resolution'",
      [issue.id]);
    await refreshBoundaries(db, issue.id, 'resolution');

    const moved = await request(app).put(`/api/issues/${issue.id}`).set(headers)
      .send({ status: 'waiting_for_customer' });
    expect(moved.status).toBe(200);

    const res = await search('resolution = paused AND resolution = breached');
    expect(res.status).toBe(200);
    expect(res.body.issues.map((row) => row.issue_key)).toContain('HD-2');

    const waiting = await search('waiting_for_customer = true');
    expect(waiting.body.issues.map((row) => row.issue_key)).toContain('HD-2');
  });

  test('parse failures carry a source column through the API', async () => {
    const res = await search('type = request AND sla = brached');
    expect(res.status).toBe(400);
    expect(res.body.jql).toBe(true);
    expect(res.body.error).toMatch(/brached.*column/i);
  });
});
