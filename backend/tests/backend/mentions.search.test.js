/**
 * MENTION SEARCH ENDPOINT TESTS
 *
 * GET /api/mentions/search backs the @ picker. Project members rank first, but
 * everyone reachable stays searchable — the caller sees is_member so it can warn
 * that a non-member may not be able to open the issue.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');
const { getDb, queryOne, run } = require('../../database');

let app, adminH, userH, db, atlasId;

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
  userH = await userHeaders();
  const projects = await request(app).get('/api/projects').set(adminH);
  atlasId = projects.body.find((p) => p.key === 'ATL').id;
});

function search(query, headers = adminH) {
  return request(app).get(`/api/mentions/search?${query}`).set(headers);
}

describe('GET /api/mentions/search', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/mentions/search?q=a');
    expect(res.status).toBe(401);
  });

  test('returns the fields the picker renders', async () => {
    const res = await search(`q=Sarah&projectId=${atlasId}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      name: 'Sarah Chen',
      email: 'sarah@example.com',
      is_member: true,
    });
    expect(res.body[0].id).toBeTruthy();
    expect(res.body[0].avatar_color).toBeTruthy();
    // The picker has no use for these and they must not leak.
    expect(res.body[0].password).toBeUndefined();
  });

  test('flags a user who is not a member of the project', async () => {
    // James Wilson belongs to Mobile App, not Atlas Platform.
    const res = await search(`q=James&projectId=${atlasId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'James Wilson', is_member: false });
  });

  test('ranks members above non-members', async () => {
    // 'a' matches most seeded names, across both membership groups.
    const res = await search(`q=a&projectId=${atlasId}`);
    expect(res.status).toBe(200);
    const flags = res.body.map((u) => u.is_member);
    expect(flags).toEqual([...flags].sort((x, y) => Number(y) - Number(x)));
    expect(flags).toContain(true);
    expect(flags).toContain(false);
  });

  test('matches on email as well as name', async () => {
    const res = await search(`q=alex@example&projectId=${atlasId}`);
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.name)).toContain('Alex Rivera');
  });

  test('an empty query returns project members', async () => {
    const res = await search(`q=&projectId=${atlasId}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((u) => u.is_member)).toBe(true);
  });

  test('excludes deactivated users', async () => {
    const james = await queryOne(db, 'SELECT id FROM users WHERE email = ?', ['james@example.com']);
    await run(db, 'UPDATE users SET is_active = 0 WHERE id = ?', [james.id]);
    try {
      const res = await search(`q=James&projectId=${atlasId}`);
      expect(res.body).toHaveLength(0);
    } finally {
      await run(db, 'UPDATE users SET is_active = 1 WHERE id = ?', [james.id]);
    }
  });

  test('excludes client-role users, who cannot open internal issues', async () => {
    const res = await search(`q=Dana&projectId=${atlasId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('caps results at ten', async () => {
    const ids = [];
    for (let i = 0; i < 14; i++) {
      const res = await request(app).post('/api/users').set(adminH).send({
        name: `Zeta Filler ${i}`, email: `zeta${i}@example.com`, role: 'user',
      });
      ids.push(res.body.id);
    }
    try {
      const res = await search(`q=Zeta&projectId=${atlasId}`);
      expect(res.body).toHaveLength(10);
    } finally {
      for (const id of ids) await run(db, 'DELETE FROM users WHERE id = ?', [id]);
    }
  });

  test('works without a projectId, marking everyone a non-member', async () => {
    const res = await search('q=Sarah');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ name: 'Sarah Chen', is_member: false });
  });

  test('is available to ordinary users, not just admins', async () => {
    const res = await search(`q=Sarah&projectId=${atlasId}`, userH);
    expect(res.status).toBe(200);
  });
});
