/**
 * SPRINTS MODULE TESTS
 * Tests: CRUD, status transitions, issue assignment
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

describe('GET /api/projects/:id/sprints', () => {
  test('should return sprints for project', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/projects/:id/sprints', () => {
  test('should create a sprint', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: 'Test Sprint', goal: 'Finish tests', start_date: '2026-04-01', end_date: '2026-04-14' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Sprint');
    expect(res.body.status).toBe('planning');
  });

  test('should reject missing name', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ goal: 'No name sprint' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/sprints/:id', () => {
  let sprintId;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: 'Update Sprint' });
    sprintId = res.body.id;
  });

  test('should update sprint name', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ name: 'Updated Sprint Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Sprint Name');
  });

  test('should activate sprint', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  test('should complete sprint', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });
});

describe('DELETE /api/sprints/:id', () => {
  test('should delete sprint and move issues to backlog', async () => {
    // Create sprint with an issue
    const sprint = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: 'Delete Sprint' });

    const issue = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Sprint Issue', type: 'task', priority: 'medium', sprint_id: sprint.body.id });

    // Delete sprint
    const res = await request(app).delete(`/api/sprints/${sprint.body.id}`).set(headers);
    expect(res.status).toBe(200);

    // Issue should have null sprint_id (in backlog)
    const issueRes = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(issueRes.body.sprint_id).toBeNull();
  });
});
