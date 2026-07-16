// ===== PASSWORD HASHING =====
// Uses scrypt from Node's built-in crypto — no external dependency.
// Stored format: scrypt$N$r$p$saltHex$keyHex

const crypto = require('crypto');

const SCHEME = 'scrypt';
const N = 16384;   // CPU/memory cost — 128 * N * r = 16MB per hash
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALTLEN = 16;

function encode(salt, key) {
  return [SCHEME, N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
}

/** True if `stored` is in our hashed format (vs. a legacy plaintext password). */
function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(SCHEME + '$');
}

function hashPasswordSync(plain) {
  const salt = crypto.randomBytes(SALTLEN);
  const key = crypto.scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return encode(salt, key);
}

function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALTLEN);
    crypto.scrypt(plain, salt, KEYLEN, { N, r: R, p: P }, (err, key) => {
      if (err) return reject(err);
      resolve(encode(salt, key));
    });
  });
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  // timingSafeEqual throws on length mismatch, so compare digests of equal length.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/**
 * Verify `plain` against a stored credential.
 * Returns { ok, needsRehash }. `needsRehash` is true when the stored value was a
 * legacy plaintext password, so the caller can transparently upgrade it on login.
 */
async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string' || !stored) {
    return { ok: false, needsRehash: false };
  }

  if (!isHashed(stored)) {
    const ok = timingSafeEqualStr(plain, stored);
    return { ok, needsRehash: ok };
  }

  const parts = stored.split('$');
  if (parts.length !== 6) return { ok: false, needsRehash: false };
  const [, n, r, p, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');

  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(plain, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) }, (err, key) => {
      if (err) return reject(err);
      resolve(key);
    });
  });

  if (actual.length !== expected.length) return { ok: false, needsRehash: false };
  return { ok: crypto.timingSafeEqual(actual, expected), needsRehash: false };
}

module.exports = { hashPassword, hashPasswordSync, verifyPassword, isHashed };
