/**
 * PAGINATION TESTS (ATLAS-28)
 * The issues list gains opt-in pagination that stays backward-compatible: with
 * no `limit`, the full set is returned (the board depends on this); with
 * `limit`, results are paged and the total is exposed via X-Total-Count.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
  // Create enough issues to page through.
  for (let i = 0; i < 7; i++) {
    await request(app).post(`/api/projects/${projectId}/issues`).set(headers).send({ title: `Paged ${i}`, type: 'task' });
  }
});

describe('issues list pagination', () => {
  test('no limit returns the full set (board-compatible)', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(7);
    expect(res.headers['x-total-count']).toBeUndefined(); // header only when paginating
  });

  test('limit pages the results and exposes the total', async () => {
    const first = await request(app).get(`/api/projects/${projectId}/issues?limit=3&offset=0`).set(headers);
    expect(first.body.length).toBe(3);
    const total = Number(first.headers['x-total-count']);
    expect(total).toBeGreaterThanOrEqual(7);

    const second = await request(app).get(`/api/projects/${projectId}/issues?limit=3&offset=3`).set(headers);
    expect(second.body.length).toBe(3);
    // Different page ⇒ different issues.
    expect(second.body[0].id).not.toBe(first.body[0].id);
  });

  test('limit is clamped to a sane maximum', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/issues?limit=99999`).set(headers);
    expect(res.status).toBe(200); // clamped to 200, no error
  });
});
