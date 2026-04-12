/**
 * ADMIN & AUDIT LOG MODULE TESTS
 * Tests: Admin stats, audit log queries, permission checks
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('GET /api/admin/stats', () => {
  test('admin should see stats', async () => {
    const res = await request(app).get('/api/admin/stats').set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('projects');
    expect(res.body).toHaveProperty('issues');
  });

  test('non-admin should be rejected', async () => {
    const uHeaders = await userHeaders();
    const res = await request(app).get('/api/admin/stats').set(uHeaders);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/audit-log', () => {
  test('admin should access audit log', async () => {
    // Generate audit entries by doing mutations
    await request(app).post('/api/auth/login').send({ email: 'kunal@example.com', password: 'password123' });
    // Also do a mutation that the logger will capture
    const users = await request(app).get('/api/users').set(headers);

    const res = await request(app).get('/api/admin/audit-log').set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.entries)).toBe(true);
    // total might be 0 if logger hasn't captured yet, that's ok for structure test
    expect(typeof res.body.total).toBe('number');
  });

  test('should support pagination', async () => {
    const res = await request(app)
      .get('/api/admin/audit-log?page=1&limit=5')
      .set(headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeLessThanOrEqual(5);
  });

  test('non-admin should be rejected', async () => {
    const uHeaders = await userHeaders();
    const res = await request(app).get('/api/admin/audit-log').set(uHeaders);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/audit-log/stats', () => {
  test('admin should see audit stats', async () => {
    const res = await request(app).get('/api/admin/audit-log/stats').set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
  });

  test('non-admin should be rejected', async () => {
    const uHeaders = await userHeaders();
    const res = await request(app).get('/api/admin/audit-log/stats').set(uHeaders);
    expect(res.status).toBe(403);
  });
});
