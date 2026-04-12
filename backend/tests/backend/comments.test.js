/**
 * COMMENTS MODULE TESTS
 * Tests: CRUD, author authorization
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');

let app, headers, issueId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  const projectId = projects.body[0].id;
  const issue = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(headers)
    .send({ title: 'Comment Test Issue', type: 'task', priority: 'medium' });
  issueId = issue.body.id;
});

describe('POST /api/issues/:id/comments', () => {
  test('should create a comment', async () => {
    const res = await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .set(headers)
      .send({ body: 'This is a test comment' });

    expect(res.status).toBe(201);
    expect(res.body.body).toBe('This is a test comment');
    expect(res.body).toHaveProperty('author_id');
  });

  test('should reject empty body', async () => {
    const res = await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .set(headers)
      .send({ body: '' });

    expect(res.status).toBe(400);
  });

  test('should reject missing body', async () => {
    const res = await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .set(headers)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /api/issues/:id/comments', () => {
  test('should return comments list', async () => {
    const res = await request(app)
      .get(`/api/issues/${issueId}/comments`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('author_name');
  });
});

describe('PUT /api/comments/:id', () => {
  test('author should be able to edit own comment', async () => {
    const comments = await request(app).get(`/api/issues/${issueId}/comments`).set(headers);
    const commentId = comments.body[0].id;

    const res = await request(app)
      .put(`/api/comments/${commentId}`)
      .set(headers)
      .send({ body: 'Updated comment' });

    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Updated comment');
  });
});

describe('DELETE /api/comments/:id', () => {
  test('should delete a comment', async () => {
    // Create then delete
    const createRes = await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .set(headers)
      .send({ body: 'Delete me' });

    const res = await request(app)
      .delete(`/api/comments/${createRes.body.id}`)
      .set(headers);

    expect(res.status).toBe(200);
  });
});
