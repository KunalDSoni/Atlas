/**
 * USERS MODULE TESTS
 * Tests: CRUD operations, admin authorization, email uniqueness
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('GET /api/users', () => {
  test('should return list of users', async () => {
    const res = await request(app).get('/api/users').set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('each user should have required fields', async () => {
    const res = await request(app).get('/api/users').set(headers);
    const user = res.body[0];
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('role');
    expect(user).not.toHaveProperty('password');
  });
});

describe('POST /api/users', () => {
  test('admin should create a new user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(headers)
      .send({ name: 'Test User', email: `testuser${Date.now()}@example.com`, role: 'user' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test User');
    expect(res.body.email).toContain('testuser');
  });

  test('should reject duplicate email', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(headers)
      .send({ name: 'Dupe User', email: 'kunal@example.com', role: 'user' });

    expect([400, 409]).toContain(res.status);
  });

  test('should reject missing name', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(headers)
      .send({ email: 'noname@example.com' });

    expect(res.status).toBe(400);
  });

  test('should reject missing email', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(headers)
      .send({ name: 'No Email' });

    expect(res.status).toBe(400);
  });

  test('non-admin should not be able to create users', async () => {
    const uHeaders = await userHeaders();
    const res = await request(app)
      .post('/api/users')
      .set(uHeaders)
      .send({ name: 'Sneaky User', email: 'sneaky@example.com', role: 'user' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/users/:id', () => {
  test('should return a specific user', async () => {
    const list = await request(app).get('/api/users').set(headers);
    const userId = list.body[0].id;

    const res = await request(app).get(`/api/users/${userId}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userId);
  });

  test('should return 404 for non-existent user', async () => {
    const res = await request(app).get('/api/users/nonexistent-id').set(headers);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/users/:id', () => {
  test('admin should update a user', async () => {
    const list = await request(app).get('/api/users').set(headers);
    const userId = list.body[1].id;

    const res = await request(app)
      .put(`/api/users/${userId}`)
      .set(headers)
      .send({ name: 'Updated Name', role: 'user' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });
});

describe('DELETE /api/users/:id (deactivate)', () => {
  test('admin should deactivate a user', async () => {
    // Create a user to deactivate
    const createRes = await request(app)
      .post('/api/users')
      .set(headers)
      .send({ name: 'To Delete', email: `delete${Date.now()}@example.com`, role: 'user' });
    const userId = createRes.body.id;

    const res = await request(app).delete(`/api/users/${userId}`).set(headers);
    expect(res.status).toBe(200);

    // User should now be inactive
    const getRes = await request(app).get(`/api/users/${userId}`).set(headers);
    expect(getRes.body.is_active).toBe(0);
  });
});
