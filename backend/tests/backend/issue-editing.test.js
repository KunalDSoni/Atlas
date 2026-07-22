/**
 * ISSUE EDITING TESTS
 *
 * The UI gained an edit dialog covering title, description and type for every
 * issue type. These cover the contract it depends on: the fields round-trip,
 * and the route is closed to clients — hiding the button in the frontend is
 * cosmetic while PUT accepts any authenticated session.
 */
const request = require('supertest');
const { createTestApp, loginAs, adminHeaders } = require('./setup');

let app, adminH, userH, clientH, projectId;

beforeAll(async () => {
  app = await createTestApp();
  adminH = await adminHeaders();
  // Priya is seeded as 'user'; Dana is the only seeded 'client'.
  userH = await loginAs('priya@example.com', 'password123');
  clientH = await loginAs('dana@customer.example.com', 'password123');
  const projects = await request(app).get('/api/projects').set(adminH);
  projectId = projects.body[0].id;
});

async function createIssue(body) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(adminH)
    .send({ type: 'task', priority: 'medium', ...body });
  return res.body;
}

describe('PUT /api/issues/:id content fields', () => {
  test('updates title and description', async () => {
    const issue = await createIssue({ title: 'Original title', description: 'Original body' });

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(adminH)
      .send({ title: 'Edited title', description: 'Edited body' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Edited title');
    expect(res.body.description).toBe('Edited body');
  });

  test('converts a task to a story', async () => {
    const issue = await createIssue({ title: 'Convert me' });

    const res = await request(app).put(`/api/issues/${issue.id}`).set(adminH).send({ type: 'story' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('story');
  });

  test('refuses to retype an epic that still has children', async () => {
    const epic = await createIssue({ title: 'Epic with kids', type: 'epic' });
    await createIssue({ title: 'A child', parent_id: epic.id });

    const res = await request(app).put(`/api/issues/${epic.id}`).set(adminH).send({ type: 'task' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/child issues/i);
  });
});

describe('PUT /api/issues/:id permissions', () => {
  test('an ordinary user may edit', async () => {
    const issue = await createIssue({ title: 'User editable' });

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(userH)
      .send({ title: 'Edited by a user' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Edited by a user');
  });

  test('a client may not edit', async () => {
    const issue = await createIssue({ title: 'Client must not touch this' });

    const res = await request(app)
      .put(`/api/issues/${issue.id}`)
      .set(clientH)
      .send({ title: 'Edited by a client' });

    expect(res.status).toBe(403);

    const after = await request(app).get(`/api/issues/${issue.id}`).set(adminH);
    expect(after.body.title).toBe('Client must not touch this');
  });
});
