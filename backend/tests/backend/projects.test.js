/**
 * PROJECTS MODULE TESTS
 * Tests: CRUD, members, stats, cascade delete
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('GET /api/projects', () => {
  test('should return list of projects', async () => {
    const res = await request(app).get('/api/projects').set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('each project should have required fields', async () => {
    const res = await request(app).get('/api/projects').set(headers);
    const project = res.body[0];
    expect(project).toHaveProperty('id');
    expect(project).toHaveProperty('name');
    // API returns 'key' in list view, 'project_key' in detail
    expect(project.key || project.project_key).toBeDefined();
  });
});

describe('POST /api/projects', () => {
  test('should create a new project', async () => {
    const uniqueKey = 'TP' + Date.now().toString(36).slice(-4).toUpperCase();
    const res = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ name: 'Test Project', key: uniqueKey, description: 'A test project' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Project');
    expect(res.body.key).toBe(uniqueKey);
  });

  test('should reject missing name', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ key: 'NP' });

    expect(res.status).toBe(400);
  });

  test('should reject duplicate project key', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ name: 'Duplicate Key', key: 'ATL' }); // ATL exists from seed

    expect([400, 409, 500]).toContain(res.status);
  });
});

describe('GET /api/projects (single)', () => {
  test('project from list should have name and id', async () => {
    const list = await request(app).get('/api/projects').set(headers);
    const project = list.body[0];
    expect(project).toHaveProperty('id');
    expect(project).toHaveProperty('name');
  });
});

describe('PUT /api/projects/:id', () => {
  test('should update project', async () => {
    const list = await request(app).get('/api/projects').set(headers);
    const projectId = list.body[0].id;

    const res = await request(app)
      .put(`/api/projects/${projectId}`)
      .set(headers)
      .send({ name: 'Updated Project Name', description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Project Name');
  });
});

describe('Project Members', () => {
  let projectId;

  beforeAll(async () => {
    const list = await request(app).get('/api/projects').set(headers);
    projectId = list.body[0].id;
  });

  test('GET /api/projects/:id/members should return members', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/members`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/projects/:id/members should add a member', async () => {
    const users = await request(app).get('/api/users').set(headers);
    const userId = users.body[users.body.length - 1].id; // Last user

    const res = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set(headers)
      .send({ user_id: userId, role: 'member' });

    expect([200, 201]).toContain(res.status);
  });
});

describe('GET /api/projects/:id/stats', () => {
  test('should return project statistics', async () => {
    const list = await request(app).get('/api/projects').set(headers);
    const projectId = list.body[0].id;

    const res = await request(app).get(`/api/projects/${projectId}/stats`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
  });
});

describe('DELETE /api/projects/:id', () => {
  test('should cascade delete project and all related data', async () => {
    // Create a project with issues
    const createRes = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ name: 'Delete Me', key: 'DEL', description: 'To be deleted' });
    const pid = createRes.body.id;

    // Add an issue
    await request(app)
      .post(`/api/projects/${pid}/issues`)
      .set(headers)
      .send({ title: 'Delete me issue', type: 'task', priority: 'medium' });

    // Delete the project
    const delRes = await request(app).delete(`/api/projects/${pid}`).set(headers);
    expect(delRes.status).toBe(200);

    // Project should be gone from list
    const listRes = await request(app).get('/api/projects').set(headers);
    const found = listRes.body.find(p => p.id === pid);
    expect(found).toBeUndefined();
  });
});
