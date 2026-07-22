/**
 * USERS MODULE TESTS
 * Tests: CRUD operations, admin authorization, email uniqueness
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, userHeaders, loginAs } = require('./setup');

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

// ===== ADMIN EDITS EVERY FIELD =====
// The admin Users screen could only change a role and deactivate. An admin
// managing an org needs to fix a misspelled name, correct an email, and set the
// department and job title that the directory and profile screens display —
// none of which the user themselves may be around to do.

describe('PUT /api/users/:id — the full profile', () => {
  let target;

  beforeEach(async () => {
    const created = await request(app).post('/api/users').set(headers)
      .send({ name: 'Editable Person', email: `edit-${Date.now()}@example.com`, role: 'user' });
    target = created.body;
  });

  test('an admin edits every profile field in one call', async () => {
    const res = await request(app).put(`/api/users/${target.id}`).set(headers).send({
      name: 'Corrected Name',
      department: 'Support',
      job_title: 'Service Desk Lead',
      phone: '+1-555-0199',
      bio: 'Runs the help desk.',
      timezone: 'Europe/Berlin',
      avatar_color: '#22a06b',
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Corrected Name');
    expect(res.body.department).toBe('Support');
    expect(res.body.job_title).toBe('Service Desk Lead');

    // Read it back — the response must not be the only place it appears.
    const fetched = await request(app).get(`/api/users/${target.id}`).set(headers);
    expect(fetched.body.phone).toBe('+1-555-0199');
    expect(fetched.body.bio).toBe('Runs the help desk.');
    expect(fetched.body.timezone).toBe('Europe/Berlin');
    expect(fetched.body.avatar_color).toBe('#22a06b');
  });

  test('a field left out is left alone', async () => {
    await request(app).put(`/api/users/${target.id}`).set(headers).send({ department: 'Support' });
    await request(app).put(`/api/users/${target.id}`).set(headers).send({ job_title: 'Agent' });
    const fetched = await request(app).get(`/api/users/${target.id}`).set(headers);
    expect(fetched.body.department).toBe('Support');
    expect(fetched.body.job_title).toBe('Agent');
  });

  test('a field can be cleared back to empty', async () => {
    await request(app).put(`/api/users/${target.id}`).set(headers).send({ department: 'Support' });
    await request(app).put(`/api/users/${target.id}`).set(headers).send({ department: '' });
    const fetched = await request(app).get(`/api/users/${target.id}`).set(headers);
    expect(fetched.body.department).toBeFalsy();
  });

  test('an email already taken is refused, not 500', async () => {
    const res = await request(app).put(`/api/users/${target.id}`).set(headers)
      .send({ email: 'kunal@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('keeping the same email is not a conflict with itself', async () => {
    const res = await request(app).put(`/api/users/${target.id}`).set(headers)
      .send({ email: target.email, name: 'Same Email' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Same Email');
  });

  test('a malformed email is refused', async () => {
    const res = await request(app).put(`/api/users/${target.id}`).set(headers)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('an empty name is refused — the directory renders it everywhere', async () => {
    const res = await request(app).put(`/api/users/${target.id}`).set(headers).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  test('an unknown role is refused', async () => {
    const res = await request(app).put(`/api/users/${target.id}`).set(headers).send({ role: 'superuser' });
    expect(res.status).toBe(400);
  });

  test('a deactivated user can be reactivated', async () => {
    await request(app).delete(`/api/users/${target.id}`).set(headers);
    const res = await request(app).put(`/api/users/${target.id}`).set(headers).send({ is_active: true });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(1);
  });

  test('a non-admin cannot edit anybody', async () => {
    const user = await loginAs('priya@example.com', 'password123');
    const res = await request(app).put(`/api/users/${target.id}`).set(user).send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  test('the edit is written to the audit log', async () => {
    await request(app).put(`/api/users/${target.id}`).set(headers).send({ department: 'Support' });
    const log = await request(app).get('/api/admin/audit-log?category=users').set(headers);
    expect(log.body.entries.some((e) => e.entity_id === target.id && /updated/i.test(e.action))).toBe(true);
  });
});

describe('PUT /api/users/:id — the lockout guard', () => {
  // Nothing stopped the last admin demoting or deactivating themselves, which
  // leaves an instance with no one able to administer it and no way back in
  // through the UI.
  test('the last active admin cannot demote themselves', async () => {
    const me = await request(app).get('/api/auth/me').set(headers);
    const res = await request(app).put(`/api/users/${me.body.id}`).set(headers).send({ role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last admin/i);
  });

  test('the last active admin cannot deactivate themselves', async () => {
    const me = await request(app).get('/api/auth/me').set(headers);
    const res = await request(app).put(`/api/users/${me.body.id}`).set(headers).send({ is_active: false });
    expect(res.status).toBe(400);
  });

  test('with a second admin, demotion is allowed again', async () => {
    const second = await request(app).post('/api/users').set(headers)
      .send({ name: 'Second Admin', email: `admin2-${Date.now()}@example.com`, role: 'admin' });
    const res = await request(app).put(`/api/users/${second.body.id}`).set(headers).send({ role: 'user' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('user');
  });

  test('DELETE cannot deactivate the last admin either', async () => {
    const me = await request(app).get('/api/auth/me').set(headers);
    const res = await request(app).delete(`/api/users/${me.body.id}`).set(headers);
    expect(res.status).toBe(400);
  });
});
