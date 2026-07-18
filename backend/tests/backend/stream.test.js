/**
 * REAL-TIME SSE TESTS (ATLAS-24)
 * The event bus is unit-tested directly; the SSE endpoint is checked for its
 * auth gate (a live SSE connection is not exercised in supertest).
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const events = require('../../utils/events');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('event bus', () => {
  test('publish reaches subscribers and unsubscribe stops delivery', () => {
    const seen = [];
    const off = events.subscribe((e) => seen.push(e));
    events.publish({ type: 'issue', action: 'created' });
    expect(seen).toHaveLength(1);
    expect(seen[0].action).toBe('created');
    off();
    events.publish({ type: 'issue', action: 'updated' });
    expect(seen).toHaveLength(1); // no further delivery after unsubscribe
  });
});

describe('SSE endpoint', () => {
  test('rejects a connection with no token', async () => {
    const res = await request(app).get('/api/stream');
    expect(res.status).toBe(401);
  });

  test('rejects an invalid token', async () => {
    const res = await request(app).get('/api/stream?token=not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('publishing an issue event does not throw', () => {
    expect(() => events.publish({ type: 'issue', action: 'moved', projectId: 'p1', issueId: 'i1' })).not.toThrow();
  });
});
