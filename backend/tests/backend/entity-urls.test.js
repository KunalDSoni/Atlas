/**
 * ENTITY URL TESTS
 * Tests: issue lookup by human-readable key, notification link format,
 * project key immutability. These back the permanent-URL scheme
 * (/atlas/ATLAS-3) — see docs/superpowers/specs/2026-07-22-entity-urls-design.md
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId, seeded;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  const issues = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
  seeded = issues.body[0];
});

describe('GET /api/issues/by-key/:key', () => {
  test('returns the issue for a human-readable key', async () => {
    const res = await request(app).get(`/api/issues/by-key/${seeded.issue_key}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seeded.id);
    expect(res.body.issue_key).toBe(seeded.issue_key);
  });

  test('matches the key case-insensitively', async () => {
    const res = await request(app)
      .get(`/api/issues/by-key/${seeded.issue_key.toLowerCase()}`)
      .set(headers);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seeded.id);
  });

  test('returns the same body as the by-id endpoint', async () => {
    const byKey = await request(app).get(`/api/issues/by-key/${seeded.issue_key}`).set(headers);
    const byId = await request(app).get(`/api/issues/${seeded.id}`).set(headers);
    expect(byKey.body).toEqual(byId.body);
  });

  test('404s for an unknown key', async () => {
    const res = await request(app).get('/api/issues/by-key/NOPE-9999').set(headers);
    expect(res.status).toBe(404);
  });

  test('401s without a session', async () => {
    const res = await request(app).get(`/api/issues/by-key/${seeded.issue_key}`);
    expect(res.status).toBe(401);
  });
});

describe('issueLink', () => {
  const { issueLink } = require('../../utils/links');

  test('builds the permanent path for an issue key', () => {
    expect(issueLink('ATLAS-3')).toBe('/atlas/ATLAS-3');
  });

  test('splits on the last hyphen so hyphenated project keys survive', () => {
    expect(issueLink('MY-TEAM-42')).toBe('/my-team/MY-TEAM-42');
  });

  test('tolerates a key with no number suffix rather than throwing', () => {
    expect(issueLink('WEIRD')).toBe('/weird/WEIRD');
  });
});

describe('notification links', () => {
  test('an assignment notification links to the permanent issue URL', async () => {
    const { userHeaders } = require('./setup');
    const assigneeHeaders = await userHeaders();
    const me = await request(app).get('/api/auth/me').set(assigneeHeaders);

    const created = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Notify me', type: 'task' });

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .set(headers)
      .send({ assignee_id: me.body.id });

    const notifications = await request(app).get('/api/notifications').set(assigneeHeaders);
    const hit = notifications.body.find((n) => n.issue_id === created.body.id);
    expect(hit).toBeDefined();
    expect(hit.link).toBe(`/${created.body.issue_key.split('-')[0].toLowerCase()}/${created.body.issue_key}`);
    expect(hit.link).not.toContain('?issue=');
  });
});
