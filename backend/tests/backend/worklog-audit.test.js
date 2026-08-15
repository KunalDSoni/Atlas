// Changes to recorded time leave a trail.
//
// Tracked time is the one thing in Atlas that is a claim about what a person
// did, and every path that alters it — editing, deleting, or the conversions
// that fire underneath — was previously invisible after the fact. Reuses the
// existing audit_log table and its admin viewer rather than inventing a second
// history.
const { createTestApp, getApp, adminHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryAll, run } = require('../../database');
const { v4: uuidv4 } = require('uuid');

let headers, db, projectId, adminId;

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  adminId = (await request(getApp()).get('/api/auth/me').set(headers)).body.id;
});

async function mkIssue(title) {
  return (await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers).send({ title, type: 'task' })).body;
}

const logWork = (issueId, minutes) =>
  request(getApp()).post(`/api/issues/${issueId}/worklogs`).set(headers).send({ minutes });

async function auditFor(entityId) {
  const rows = await queryAll(db,
    "SELECT * FROM audit_log WHERE entity_type = 'work_log' AND entity_id = ? ORDER BY id", [entityId]);
  return rows;
}

describe('work log changes are auditable', () => {
  test('editing the minutes records the before and after', async () => {
    const issue = await mkIssue('Edited entry');
    const log = (await logWork(issue.id, 60)).body;

    await request(getApp()).patch(`/api/worklogs/${log.id}`).set(headers).send({ minutes: 30 });

    const [entry] = await auditFor(log.id);
    expect(entry).toBeTruthy();
    expect(entry.action).toMatch(/work log/i);
    const details = JSON.parse(entry.details);
    expect(details.minutes_before).toBe(60);
    expect(details.minutes_after).toBe(30);
  });

  test('deleting records what was removed, since the row will not survive to say so', async () => {
    const issue = await mkIssue('Deleted entry');
    const log = (await logWork(issue.id, 45)).body;

    await request(getApp()).delete(`/api/worklogs/${log.id}`).set(headers);

    const [entry] = await auditFor(log.id);
    expect(entry.action).toMatch(/deleted/i);
    expect(JSON.parse(entry.details).minutes_before).toBe(45);
  });

  test('records the conversion when a timer entry is corrected by hand', async () => {
    // The source change is the consequential part: it takes the stopwatch out
    // of the loop for good, and nothing recorded that it had happened.
    const issue = await mkIssue('Corrected timer entry');
    const id = uuidv4();
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'timer')",
      [id, issue.id, adminId, 120, 'Tracked with timer']);

    await request(getApp()).patch(`/api/worklogs/${id}`).set(headers).send({ minutes: 90 });

    const details = JSON.parse((await auditFor(id))[0].details);
    expect(details.source_before).toBe('timer');
    expect(details.source_after).toBe('manual');
  });

  test('names the issue the time belongs to', async () => {
    const issue = await mkIssue('Named issue');
    const log = (await logWork(issue.id, 15)).body;

    await request(getApp()).patch(`/api/worklogs/${log.id}`).set(headers).send({ minutes: 20 });

    expect((await auditFor(log.id))[0].entity_name).toBe(issue.issue_key);
  });

  test('a rejected edit writes no audit entry', async () => {
    // Only real changes belong in the trail; a 400 changed nothing.
    const issue = await mkIssue('Rejected edit');
    const log = (await logWork(issue.id, 60)).body;

    await request(getApp()).patch(`/api/worklogs/${log.id}`).set(headers).send({ minutes: -5 });

    expect(await auditFor(log.id)).toHaveLength(0);
  });

  test('creating a work log is not audited as a change', async () => {
    // The entry itself is the record of its own creation; auditing it too
    // would double every row in the trail for no added accountability.
    const issue = await mkIssue('Created only');
    const log = (await logWork(issue.id, 25)).body;

    expect(await auditFor(log.id)).toHaveLength(0);
  });
});
