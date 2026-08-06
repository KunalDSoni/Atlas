/**
 * ISSUE MENTION DETECTION TESTS
 *
 * Tests for @mention detection in issue descriptions and automatic
 * notification dispatch for newly mentioned users.
 */
const request = require('supertest');
const { createTestApp, loginAs, adminHeaders } = require('./setup');
const { getDb, queryOne, queryAll } = require('../../database');
const { mentionedUserIdsInProject } = require('../../utils/notify');

let app, adminH, userH, projectId, db;

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
  userH = await loginAs('priya@example.com', 'password123');
  const projects = await request(app).get('/api/projects').set(adminH);
  projectId = projects.body[0].id;
});

async function createIssue(body) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(adminH)
    .send({ type: 'task', priority: 'medium', ...body });
  return res.body;
}

async function getNotifications(userId) {
  return queryAll(db, 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

describe('mentionedUserIdsInProject helper', () => {
  test('extracts full name mentions', async () => {
    const admin = await queryOne(db, "SELECT id FROM users WHERE email = 'admin@example.com'");
    const priya = await queryOne(db, "SELECT id FROM users WHERE email = 'priya@example.com'");

    const mentions = await mentionedUserIdsInProject(
      db,
      'Hey @Priya Admin, can you review this?',
      admin.id,
      projectId
    );

    expect(mentions).toContain(priya.id);
  });

  test('extracts first name mentions', async () => {
    const admin = await queryOne(db, "SELECT id FROM users WHERE email = 'admin@example.com'");
    const priya = await queryOne(db, "SELECT id FROM users WHERE email = 'priya@example.com'");

    const mentions = await mentionedUserIdsInProject(
      db,
      'Hey @Priya, check this out',
      admin.id,
      projectId
    );

    expect(mentions).toContain(priya.id);
  });

  test('handles case-insensitive matching', async () => {
    const admin = await queryOne(db, "SELECT id FROM users WHERE email = 'admin@example.com'");
    const priya = await queryOne(db, "SELECT id FROM users WHERE email = 'priya@example.com'");

    const mentions = await mentionedUserIdsInProject(
      db,
      '@PRIYA please review',
      admin.id,
      projectId
    );

    expect(mentions).toContain(priya.id);
  });
});

describe('PUT /api/issues/:id mention notifications', () => {
  test('sends notification when user is newly mentioned in description', async () => {
    const issue = await createIssue({
      title: 'Test mention issue',
      description: 'Initial description'
    });

    const priya = await queryOne(db, "SELECT id FROM users WHERE email = 'priya@example.com'");
    const initialNotifCount = (await getNotifications(priya.id)).length;

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(adminH)
      .send({ description: 'Updated: @Priya Admin please review this' });

    expect(res.status).toBe(200);

    const finalNotifs = await getNotifications(priya.id);
    expect(finalNotifs.length).toBeGreaterThan(initialNotifCount);
    const mentionNotif = finalNotifs.find(n => n.type === 'mentioned');
    expect(mentionNotif).toBeDefined();
    expect(mentionNotif?.issue_id).toBe(issue.id);
  });

  test('does not re-notify when user was already mentioned', async () => {
    const issue = await createIssue({
      title: 'Test issue', 
      description: 'Hey @Priya Admin, check this'
    });

    const priya = await queryOne(db, "SELECT id FROM users WHERE email = 'priya@example.com'");
    await require('../../database').run(db, 'DELETE FROM notifications WHERE user_id = ? AND issue_id = ?', [priya.id, issue.id]);

    const initialNotifCount = (await getNotifications(priya.id)).length;

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(adminH)
      .send({ description: '@Priya Admin, I updated this slightly' });

    expect(res.status).toBe(200);

    const finalNotifs = await getNotifications(priya.id);
    const newMentionNotifs = finalNotifs.filter(n => n.type === 'mentioned' && n.issue_id === issue.id);
    expect(newMentionNotifs.length).toBe(0);
  });

  test('preserves other issue updates while handling mentions', async () => {
    const issue = await createIssue({
      title: 'Original title',
      description: 'Initial description'
    });

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(adminH)
      .send({
        title: 'Updated title',
        description: '@Priya Admin updated this issue',
        priority: 'high'
      });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
    expect(res.body.priority).toBe('high');
  });
});
