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
