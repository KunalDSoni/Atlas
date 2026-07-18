/**
 * API TOKENS + WEBHOOKS TESTS (ATLAS-23)
 */
const crypto = require('crypto');
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { sign } = require('../../utils/webhooks');

let app, headers, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
});

describe('personal API tokens', () => {
  test('create returns the plaintext once, then authenticates the API', async () => {
    const created = await request(app).post('/api/tokens').set(headers).send({ name: 'CI token' });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^atlas_pat_[a-f0-9]{48}$/);
    expect(created.body.prefix).toMatch(/^atlas_pat_/);

    // The token authenticates the existing API as its owner via Bearer auth.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${created.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('kunal@example.com');
  });

  test('list never exposes the token value', async () => {
    const res = await request(app).get('/api/tokens').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.every((t) => t.token === undefined && t.token_hash === undefined)).toBe(true);
  });

  test('an invalid bearer token is not authenticated', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer atlas_pat_deadbeef');
    expect(res.status).toBe(401);
  });

  test('revoke disables the token', async () => {
    const created = await request(app).post('/api/tokens').set(headers).send({ name: 'temp' });
    await request(app).delete(`/api/tokens/${created.body.id}`).set(headers);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${created.body.token}`);
    expect(me.status).toBe(401);
  });
});

describe('webhooks', () => {
  test('register returns the signing secret once and hides it afterward', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/webhooks`).set(headers)
      .send({ url: 'https://example.com/hook', events: ['issue.created'] });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    expect(created.body.events).toEqual(['issue.created']);

    const list = await request(app).get(`/api/projects/${projectId}/webhooks`).set(headers);
    expect(list.body[0].secret).toBeUndefined();
  });

  test('rejects a non-http url', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/webhooks`).set(headers).send({ url: 'ftp://x' });
    expect(res.status).toBe(400);
  });

  test('HMAC signing is stable and verifiable', () => {
    const body = JSON.stringify({ event: 'issue.created' });
    const secret = 'whsec_test';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(sign(secret, body)).toBe(expected);
  });
});
