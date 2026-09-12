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
  // Explicitly an open one. Sprints are scheduled on a calendar now, so the list
  // holds completed windows too — and an issue cannot be moved into a completed
  // sprint, which would leave this suite asserting against an empty activity log.
  sprintId = sprints.body.find((s) => s.status !== 'completed').id;
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
