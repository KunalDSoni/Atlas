/**
 * AI ASSISTANT TESTS (ATLAS-20)
 * Verifies the proxy is wired and degrades gracefully when no ANTHROPIC_API_KEY
 * is configured — the app must stay fully usable and the UI must be able to
 * detect the unconfigured state. Live model calls are not exercised in CI.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers;

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // ensure the unconfigured path
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('AI status', () => {
  test('reports disabled when no API key is configured', async () => {
    const res = await request(app).get('/api/ai/status').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.model).toBeNull();
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/ai/status');
    expect(res.status).toBe(401);
  });
});

describe('AI endpoints degrade gracefully without a key', () => {
  test('summarize returns 503 with ai_unconfigured flag', async () => {
    const res = await request(app).post('/api/ai/summarize').set(headers).send({ text: 'x'.repeat(100) });
    expect(res.status).toBe(503);
    expect(res.body.ai_unconfigured).toBe(true);
  });

  test('write returns 503 when unconfigured', async () => {
    const res = await request(app).post('/api/ai/write').set(headers).send({ action: 'improve', text: 'hello world' });
    expect(res.status).toBe(503);
  });

  test('ask returns 503 when unconfigured', async () => {
    const res = await request(app).post('/api/ai/ask').set(headers).send({ question: 'what is atlas?' });
    expect(res.status).toBe(503);
  });
});
