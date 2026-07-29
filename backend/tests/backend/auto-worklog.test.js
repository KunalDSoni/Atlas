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
  await applyAutoWorklog(db, fresh, statuses);

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
  await applyAutoWorklog(db, { ...issue, status: 'done' }, statuses);
  let logs = await queryAll(db, "SELECT * FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  expect(Number(logs[0].minutes)).toBe(60);

  // Reopen and redo for two more hours, then complete again.
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('reopen-a3', ?, ?, 'update', 'status', 'done', 'in_progress', '2026-07-07 09:00:00')`, [issue.id, issue.reporter_id]);
  await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
    VALUES ('reopen-a4', ?, ?, 'update', 'status', 'in_progress', 'done', '2026-07-07 11:00:00')`, [issue.id, issue.reporter_id]);
  await applyAutoWorklog(db, { ...issue, status: 'done' }, statuses);

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
  await applyAutoWorklog(db, freshIssue, statuses);

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
