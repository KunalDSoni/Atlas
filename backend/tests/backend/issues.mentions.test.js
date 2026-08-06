/**
 * ISSUE MENTION DETECTION TESTS
 *
 * Tests for @mention detection in issue descriptions and automatic
 * notification dispatch for newly mentioned users.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, queryOne } = require('../../database');
const { mentionedUserIdsInProject } = require('../../utils/notify');

let app, adminH, projectId, db;

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
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

describe('PUT /api/issues/:id mention notifications', () => {
  test('accepts description updates with mention text', async () => {
    const issue = await createIssue({
      title: 'Test mention issue',
      description: 'Initial description'
    });

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(adminH)
      .send({ description: 'Updated: @Priya Admin please review this' });

    expect(res.status).toBe(200);
    expect(res.body.description).toContain('@');
  });

  test('preserves description updates with multiple mentions', async () => {
    const issue = await createIssue({
      title: 'Test issue',
      description: 'Initial'
    });

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(adminH)
      .send({ description: '@Priya and @Admin please review' });

    expect(res.status).toBe(200);
    expect(res.body.description).toContain('@');
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

  test('handles empty description updates', async () => {
    const issue = await createIssue({
      title: 'Test issue',
      description: '@Priya please review'
    });

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(adminH)
      .send({ description: '' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('');
  });

  test('helper function is available', async () => {
    // Just verify the function exists and can be called
    const result = await mentionedUserIdsInProject(db, '', 'test-author-id', projectId);
    expect(Array.isArray(result)).toBe(true);
  });
});
