/**
 * DEMO LOGIN TESTS
 * Tests: POST /api/auth/demo — gating, session issuance, role, seeding, reset.
 */
const request = require('supertest');
const { createTestApp } = require('./setup');

let app;

beforeAll(async () => {
  app = await createTestApp();
});

afterEach(() => {
  delete process.env.DEMO_EMAIL;
  delete process.env.DEMO_NAME;
});

describe('POST /api/auth/demo', () => {
  test('returns 404 when DEMO_EMAIL is unset', async () => {
    const res = await request(app).post('/api/auth/demo');
    expect(res.status).toBe(404);
  });

  test('issues a working session when DEMO_EMAIL is set', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    const res = await request(app).post('/api/auth/demo');

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.email).toBe('demo@example.com');
    expect(res.body).not.toHaveProperty('password');

    // The token must actually authenticate.
    const me = await request(app).get('/api/auth/me').set({ 'x-auth-token': res.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('demo@example.com');
  });

  test('the demo account is role user, never admin', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    const res = await request(app).post('/api/auth/demo');
    expect(res.body.role).toBe('user');

    // And the server must actually refuse admin endpoints for it.
    const admin = await request(app).get('/api/admin/stats').set({ 'x-auth-token': res.body.token });
    expect(admin.status).toBe(403);
  });

  test('seeding twice produces one demo user, not two', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    await request(app).post('/api/auth/demo');
    await request(app).post('/api/auth/demo');

    const { getDb, queryAll } = require('../../database');
    const db = await getDb();
    const users = await queryAll(db, 'SELECT id FROM users WHERE email = ?', ['demo@example.com']);
    expect(users).toHaveLength(1);
  });

  test('a fresh demo project is not re-seeded on the next visit', async () => {
    process.env.DEMO_EMAIL = 'demo@example.com';

    const first = await request(app).post('/api/auth/demo');
    expect(first.status).toBe(200);

    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const before = await queryOne(db, 'SELECT id FROM projects WHERE key = ?', ['DEMO']);

    await request(app).post('/api/auth/demo');
    const after = await queryOne(db, 'SELECT id FROM projects WHERE key = ?', ['DEMO']);

    // Same row id means the project was reused, not dropped and recreated.
    expect(after.id).toBe(before.id);
  });
});

// The demo route is rate limited and, by design, never clears the bucket on
// success (see routes/auth.js) — every request shares one key because the
// request carries no email. That means this assertion cannot depend on how
// much budget earlier tests in this file happened to consume.
//
// A second createTestApp() does NOT give a fresh rate limiter here: Jest's
// require.cache does not behave like plain Node's, and manually deleting
// keys from it (as setup.js does to force a fresh DB) does not reliably
// evict a singleton module like middleware/ratelimit.js — its buckets Map
// was observed to persist across createTestApp() calls in this suite.
// Use the module's own `_reset()` export instead, which resets the exact
// state the shared `app` is using, regardless of require-cache quirks.
describe('POST /api/auth/demo rate limiting', () => {
  test('allows MAX_ATTEMPTS requests then blocks with 429', async () => {
    const { _reset } = require('../../middleware/ratelimit');
    _reset();
    process.env.DEMO_EMAIL = 'demo@example.com';

    const MAX_ATTEMPTS = 10;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await request(app).post('/api/auth/demo');
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post('/api/auth/demo');
    expect(blocked.status).toBe(429);

    _reset(); // leave a clean bucket for any test file that runs after this one
  });
});
