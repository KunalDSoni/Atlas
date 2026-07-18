/**
 * GENERAL API RATE LIMIT TESTS (ATLAS-27)
 * The middleware is exercised directly (it's not mounted in the test app).
 */
const { apiRateLimit, _reset } = require('../../middleware/ratelimit');

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function call(path, ip) {
  const res = fakeRes();
  let passed = false;
  apiRateLimit({ path, ip }, res, () => { passed = true; });
  return { res, passed };
}

beforeEach(() => _reset());

describe('apiRateLimit', () => {
  test('allows normal traffic and sets rate-limit headers', () => {
    const { res, passed } = call('/issues', '10.0.0.1');
    expect(passed).toBe(true);
    expect(res.headers['X-RateLimit-Limit']).toBe('300');
  });

  test('429s after the per-IP window budget is exhausted', () => {
    let blockedAt = null;
    for (let i = 1; i <= 305 && blockedAt === null; i++) {
      const { res, passed } = call('/issues', '10.0.0.2');
      if (!passed) { blockedAt = i; expect(res.statusCode).toBe(429); expect(res.headers['Retry-After']).toBeDefined(); }
    }
    expect(blockedAt).toBe(301); // 300 allowed, 301st blocked
  });

  test('separate IPs have independent budgets', () => {
    for (let i = 0; i < 305; i++) call('/issues', '10.0.0.3');
    expect(call('/issues', '10.0.0.4').passed).toBe(true);
  });

  test('exempts the SSE stream and health probes', () => {
    for (let i = 0; i < 400; i++) call('/stream', '10.0.0.5');
    expect(call('/stream', '10.0.0.5').passed).toBe(true);
    for (let i = 0; i < 400; i++) call('/health/ready', '10.0.0.5');
    expect(call('/health/ready', '10.0.0.5').passed).toBe(true);
  });
});
