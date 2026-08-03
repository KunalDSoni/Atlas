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

test('DELETE /api/worklogs/:id of an auto work log locks the issue against future auto-recompute', async () => {
  const created = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title: 'Auto delete lock test', type: 'task' });
  const issueId = created.body.id;

  const autoId = uuidv4();
  await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, 'auto')",
    [autoId, issueId, created.body.reporter_id, 60]);

  const delRes = await request(getApp()).delete(`/api/worklogs/${autoId}`).set(headers);
  expect(delRes.status).toBe(200);

  const issue = await queryOne(db, 'SELECT auto_worklog_locked FROM issues WHERE id = ?', [issueId]);
  expect(Number(issue.auto_worklog_locked)).toBe(1);
});
