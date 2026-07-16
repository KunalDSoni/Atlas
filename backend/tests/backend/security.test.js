/**
 * SECURITY REGRESSION TESTS
 * Each test here corresponds to a vulnerability that was found and fixed.
 * They are written to fail against the vulnerable implementations.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { hashPassword, verifyPassword, isHashed } = require('../../utils/password');
const { signedFileUrl, verifyFileSig } = require('../../utils/signing');

let app;

beforeAll(async () => {
  app = await createTestApp();
});

describe('Unauthenticated access', () => {
  test('GET /api/users requires authentication', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  test('GET /api/users does not leak the user directory to anonymous callers', async () => {
    const res = await request(app).get('/api/users');
    expect(Array.isArray(res.body)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('@example.com');
  });

  test('an authenticated user can still list users', async () => {
    const res = await request(app).get('/api/users').set(await adminHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Password hashing', () => {
  test('hashes are salted — same input yields different hashes', async () => {
    const a = await hashPassword('password123');
    const b = await hashPassword('password123');
    expect(a).not.toBe(b);
    expect(isHashed(a)).toBe(true);
  });

  test('verifies a correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse');
    expect((await verifyPassword('correct horse', stored)).ok).toBe(true);
    expect((await verifyPassword('wrong horse', stored)).ok).toBe(false);
  });

  test('legacy plaintext credentials verify but are flagged for rehash', async () => {
    const res = await verifyPassword('password123', 'password123');
    expect(res.ok).toBe(true);
    expect(res.needsRehash).toBe(true);
  });

  test('does not crash on null/undefined stored credentials', async () => {
    expect((await verifyPassword('x', null)).ok).toBe(false);
    expect((await verifyPassword('x', undefined)).ok).toBe(false);
  });
});

describe('Signed file URLs', () => {
  test('a freshly signed URL verifies', () => {
    const url = signedFileUrl('abc', 'preview');
    const { exp, sig } = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
    expect(verifyFileSig('abc', exp, sig)).toBe(true);
  });

  test('a signature is bound to its attachment id', () => {
    const url = signedFileUrl('abc', 'preview');
    const { exp, sig } = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
    expect(verifyFileSig('a-different-id', exp, sig)).toBe(false);
  });

  test('forged and expired signatures are rejected', () => {
    expect(verifyFileSig('abc', 99999999999, 'deadbeef')).toBe(false);
    const past = Math.floor(Date.now() / 1000) - 10;
    const url = signedFileUrl('abc', 'preview', -10);
    const { sig } = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
    expect(verifyFileSig('abc', past, sig)).toBe(false);
  });

  test('missing signature params are rejected', () => {
    expect(verifyFileSig('abc', undefined, undefined)).toBe(false);
  });
});

describe('Attachment access control', () => {
  test('preview without a signature or session is rejected', async () => {
    const res = await request(app).get('/api/attachments/some-id/preview');
    expect(res.status).toBe(401);
  });

  test('download without a signature or session is rejected', async () => {
    const res = await request(app).get('/api/attachments/some-id/download');
    expect(res.status).toBe(401);
  });
});

describe('Login rate limiting', () => {
  test('repeated failed logins are eventually blocked with 429', async () => {
    const { _reset } = require('../../middleware/ratelimit');
    _reset();

    let sawTooMany = false;
    for (let i = 0; i < 15; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ratelimit@example.com', password: 'wrong' });
      if (res.status === 429) { sawTooMany = true; break; }
    }
    expect(sawTooMany).toBe(true);
    _reset();
  });
});
