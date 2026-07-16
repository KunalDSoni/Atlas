/**
 * SECURITY REGRESSION TESTS
 * Each test here corresponds to a vulnerability that was found and fixed.
 * They are written to fail against the vulnerable implementations.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

// Required lazily inside tests: importing backend modules at the top level loads
// config.js (and therefore dotenv) before setup.js can point the DB at :memory:,
// which makes the suite write to the real dev database.
let hashPassword, verifyPassword, isHashed, signedFileUrl, verifyFileSig;

let app;

beforeAll(async () => {
  app = await createTestApp();
  ({ hashPassword, verifyPassword, isHashed } = require('../../utils/password'));
  ({ signedFileUrl, verifyFileSig } = require('../../utils/signing'));
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

describe('Wiki HTML sanitisation', () => {
  const { sanitizeRichText } = require('../../utils/sanitize');

  test('strips <script> tags', () => {
    expect(sanitizeRichText('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>');
  });

  test('strips inline event handlers', () => {
    const out = sanitizeRichText('<img src="x" onerror="steal()">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('steal');
  });

  test('strips javascript: URLs', () => {
    const out = sanitizeRichText('<a href="javascript:evil()">click</a>');
    expect(out).not.toContain('javascript:');
  });

  test('strips javascript inside inline styles', () => {
    const out = sanitizeRichText('<div style="background:url(javascript:x);color:#0c66e4">hi</div>');
    expect(out).not.toContain('javascript');
    expect(out).toContain('color');
  });

  test('keeps legitimate formatting', () => {
    const out = sanitizeRichText('<h2>Title</h2><p><strong>bold</strong> <em>italic</em></p><ul><li>item</li></ul>');
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<li>item</li>');
  });

  test('keeps external links but adds rel=noopener', () => {
    const out = sanitizeRichText('<a href="https://example.com">link</a>');
    expect(out).toContain('https://example.com');
    expect(out).toContain('noopener');
  });

  test('handles empty and non-string input', () => {
    expect(sanitizeRichText('')).toBe('');
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
  });

  test('a page body is sanitised on write, not just on render', async () => {
    const headers = await adminHeaders();
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    const spaceId = spaces.body[0]?.id;
    if (!spaceId) return;

    const created = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set(headers)
      .send({ title: 'XSS test', body: '<p>hi</p><script>alert(1)</script><img src=x onerror=go()>' });

    expect(created.status).toBe(201);

    const page = await request(app).get(`/api/wiki/pages/${created.body.id}`).set(headers);
    expect(page.body.body).not.toContain('<script');
    expect(page.body.body).not.toContain('onerror');
    expect(page.body.body).toContain('<p>hi</p>');
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
