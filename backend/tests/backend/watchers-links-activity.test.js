/**
 * WATCHERS, LINKS & ACTIVITY MODULE TESTS
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');

let app, headers, projectId, issueId1, issueId2;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;

  const i1 = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title: 'Watcher Issue', type: 'task', priority: 'medium' });
  issueId1 = i1.body.id;

  const i2 = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title: 'Link Target', type: 'bug', priority: 'high' });
  issueId2 = i2.body.id;
});

describe('Watchers', () => {
  test('GET should return empty watchers initially', async () => {
    const res = await request(app).get(`/api/issues/${issueId1}/watchers`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST should add a watcher', async () => {
    const users = await request(app).get('/api/users').set(headers);
    const userId = users.body[0].id;

    const res = await request(app)
      .post(`/api/issues/${issueId1}/watchers`)
      .set(headers)
      .send({ user_id: userId });

    expect([200, 201]).toContain(res.status);
  });

  test('GET should return added watcher', async () => {
    const res = await request(app).get(`/api/issues/${issueId1}/watchers`).set(headers);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name');
  });

  test('DELETE should remove a watcher', async () => {
    const users = await request(app).get('/api/users').set(headers);
    const userId = users.body[0].id;

    const res = await request(app)
      .delete(`/api/issues/${issueId1}/watchers/${userId}`)
      .set(headers);

    expect(res.status).toBe(200);
  });
});

describe('Issue Links', () => {
  test('POST should create a link between issues', async () => {
    const res = await request(app)
      .post(`/api/issues/${issueId1}/links`)
      .set(headers)
      .send({ target_issue_id: issueId2, link_type: 'blocks' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.link_type).toBe('blocks');
  });

  test('GET should return issue links', async () => {
    const res = await request(app).get(`/api/issues/${issueId1}/links`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('DELETE should remove a link', async () => {
    const links = await request(app).get(`/api/issues/${issueId1}/links`).set(headers);
    const linkId = links.body[0].id;

    const res = await request(app).delete(`/api/issue-links/${linkId}`).set(headers);
    expect(res.status).toBe(200);
  });
});

describe('Activity Log', () => {
  test('should return activity after field changes', async () => {
    // Create a fresh issue and make changes
    const issue = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Activity Test', type: 'task', priority: 'low' });
    const aid = issue.body.id;

    // Make multiple changes to ensure activity
    await request(app).put(`/api/issues/${aid}`).set(headers).send({ status: 'in_progress' });
    await request(app).put(`/api/issues/${aid}`).set(headers).send({ priority: 'high' });

    const res = await request(app).get(`/api/issues/${aid}/activity`).set(headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('field');
    expect(res.body[0]).toHaveProperty('user_name');
  });
});
