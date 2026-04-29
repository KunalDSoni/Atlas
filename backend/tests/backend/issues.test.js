/**
 * ISSUES MODULE TESTS
 * Tests: CRUD, status transitions, move, filters, labels, due dates, cascade delete
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');

let app, headers, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

describe('GET /api/projects/:id/issues', () => {
  test('should return issues for a project', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/projects/:id/issues', () => {
  test('should create a basic issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Test Issue', type: 'task', priority: 'medium' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test Issue');
    expect(res.body.type).toBe('task');
    expect(res.body.status).toBe('todo');
    expect(res.body).toHaveProperty('issue_key');
  });

  test('should create an issue with all optional fields', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({
        title: 'Full Issue',
        type: 'story',
        priority: 'high',
        description: 'Detailed description',
        story_points: 5,
        labels: '["backend","urgent"]',
        due_date: '2026-12-31',
        original_estimate: 480,
      });

    expect(res.status).toBe(201);
    expect(res.body.story_points).toBe(5);
    expect(res.body.due_date).toBe('2026-12-31');
  });

  test('should reject missing title', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ type: 'task', priority: 'medium' });

    expect(res.status).toBe(400);
  });

  test('should auto-generate sequential issue keys', async () => {
    const res1 = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Key Test 1', type: 'task', priority: 'low' });
    const res2 = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Key Test 2', type: 'task', priority: 'low' });

    const key1Num = parseInt(res1.body.issue_key.split('-')[1]);
    const key2Num = parseInt(res2.body.issue_key.split('-')[1]);
    expect(key2Num).toBe(key1Num + 1);
  });
});

describe('GET /api/issues/:id', () => {
  test('should return enriched issue details', async () => {
    const issues = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
    const issueId = issues.body[0].id;

    const res = await request(app).get(`/api/issues/${issueId}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('assignee_name');
    expect(res.body).toHaveProperty('reporter_name');
    expect(res.body).toHaveProperty('comment_count');
    expect(res.body).toHaveProperty('watcher_count');
    expect(res.body).toHaveProperty('link_count');
  });

  test('should return 404 for non-existent issue', async () => {
    const res = await request(app).get('/api/issues/nonexistent-id').set(headers);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/issues/:id', () => {
  let issueId;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Update Test', type: 'task', priority: 'medium' });
    issueId = res.body.id;
  });

  test('should update title', async () => {
    const res = await request(app)
      .put(`/api/issues/${issueId}`)
      .set(headers)
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
  });

  test('should update status', async () => {
    const res = await request(app)
      .put(`/api/issues/${issueId}`)
      .set(headers)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  test('should update priority', async () => {
    const res = await request(app)
      .put(`/api/issues/${issueId}`)
      .set(headers)
      .send({ priority: 'highest' });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('highest');
  });

  test('should update labels', async () => {
    const res = await request(app)
      .put(`/api/issues/${issueId}`)
      .set(headers)
      .send({ labels: '["bug","critical"]' });

    expect(res.status).toBe(200);
  });

  test('should update time tracking', async () => {
    const res = await request(app)
      .put(`/api/issues/${issueId}`)
      .set(headers)
      .send({ original_estimate: 240, time_spent: 60 });

    expect(res.status).toBe(200);
  });

  test('should create activity log on field change', async () => {
    // Change status, then check activity
    await request(app)
      .put(`/api/issues/${issueId}`)
      .set(headers)
      .send({ status: 'done' });

    const actRes = await request(app)
      .get(`/api/issues/${issueId}/activity`)
      .set(headers);

    expect(actRes.status).toBe(200);
    expect(Array.isArray(actRes.body)).toBe(true);
    expect(actRes.body.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/issues/:id/move', () => {
  test('should move issue to different status', async () => {
    const createRes = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Move Test', type: 'task', priority: 'medium' });

    const res = await request(app)
      .put(`/api/issues/${createRes.body.id}/move`)
      .set(headers)
      .send({ status: 'in_review', board_order: 0 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_review');
  });
});

describe('DELETE /api/issues/:id', () => {
  test('should delete issue and cascade', async () => {
    const createRes = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Delete Me', type: 'task', priority: 'low' });
    const issueId = createRes.body.id;

    // Add a comment
    await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .set(headers)
      .send({ body: 'Test comment' });

    // Delete
    const delRes = await request(app).delete(`/api/issues/${issueId}`).set(headers);
    expect(delRes.status).toBe(200);

    // Should be gone
    const getRes = await request(app).get(`/api/issues/${issueId}`).set(headers);
    expect(getRes.status).toBe(404);
  });
});
