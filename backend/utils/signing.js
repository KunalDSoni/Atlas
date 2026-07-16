// ===== SIGNED FILE URLS =====
// <img>/<video>/<a href> navigations cannot carry the x-auth-token header, so file
// URLs are authorised with a short-lived HMAC signature instead of being left public.
// The signature is derived from SESSION_SECRET and bound to the attachment id.

const crypto = require('crypto');
const config = require('./../config');

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

function computeSig(id, exp) {
  return crypto
    .createHmac('sha256', config.auth.sessionSecret)
    .update(`${id}.${exp}`)
    .digest('hex');
}

/** Relative URL granting temporary read access to one attachment. */
function signedFileUrl(id, kind = 'preview', ttlSeconds = DEFAULT_TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/attachments/${id}/${kind}?exp=${exp}&sig=${computeSig(id, exp)}`;
}

/** True when `sig` matches `id`+`exp` and the deadline has not passed. */
function verifyFileSig(id, exp, sig) {
  if (!exp || !sig) return false;
  if (!/^\d+$/.test(String(exp))) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;

  const expected = Buffer.from(computeSig(id, exp), 'utf8');
  const actual = Buffer.from(String(sig), 'utf8');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { signedFileUrl, verifyFileSig };
