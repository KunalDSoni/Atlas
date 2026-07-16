/**
 * AUTH MODULE TESTS
 * Tests: login, logout, session management, middleware auth
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');

let app;

beforeAll(async () => {
  app = await createTestApp();
});

describe('POST /api/auth/login', () => {
  test('should login with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kunal@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Kunal Soni');
    expect(res.body.role).toBe('admin');
    expect(res.body).not.toHaveProperty('password'); // Should not expose password
  });

  test('should reject invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('should reject invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kunal@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  test('should reject empty body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });

  test('should reject inactive user', async () => {
    // First deactivate a user
    const headers = await adminHeaders();
    const users = await request(app).get('/api/users').set(headers);
    const regularUser = users.body.find(u => u.role === 'user' && u.email !== 'kunal@example.com');

    if (regularUser) {
      await request(app).delete(`/api/users/${regularUser.id}`).set(headers);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: regularUser.email, password: 'password123' });
      expect(res.status).toBe(401);
    }
  });
});

describe('Security — identity headers are not trusted', () => {
  test('should NOT authenticate from x-user-id / x-user-role alone', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set({ 'x-user-id': 'anything', 'x-user-role': 'admin' });

    expect(res.status).toBe(401);
  });

  test('should NOT grant admin access to a forged role header', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set({ 'x-user-id': 'forged', 'x-user-role': 'admin' });

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('users');
  });

  test('should NOT let a real non-admin escalate via x-user-role', async () => {
    const headers = await userHeaders();
    const res = await request(app)
      .get('/api/admin/stats')
      .set({ ...headers, 'x-user-role': 'admin' });

    expect(res.status).toBe(403);
  });

  test('should reject an invalid session token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set({ 'x-auth-token': 'not-a-real-token' });

    expect(res.status).toBe(401);
  });
});

describe('Security — password storage', () => {
  test('should never store the password in plaintext', async () => {
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const row = await queryOne(db, 'SELECT password FROM users WHERE email = ?', ['kunal@example.com']);

    expect(row.password).not.toBe('password123');
    expect(row.password.startsWith('scrypt$')).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  test('should return current user with valid token', async () => {
    const headers = await adminHeaders();
    const res = await request(app).get('/api/auth/me').set(headers);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('email');
  });

  test('should reject invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set({ 'x-auth-token': 'invalid-token-12345' });

    expect(res.status).toBe(401);
  });

  test('should reject request with no auth headers', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  test('should logout and invalidate token', async () => {
    // Login first
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kunal@example.com', password: 'password123' });
    const token = loginRes.body.token;

    // Logout
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set({ 'x-auth-token': token });
    expect(logoutRes.status).toBe(200);

    // Token should now be invalid
    const meRes = await request(app)
      .get('/api/auth/me')
      .set({ 'x-auth-token': token });
    expect(meRes.status).toBe(401);
  });
});
