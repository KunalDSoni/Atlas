// ===== RATE LIMITING =====
// Small in-memory fixed-window limiter. Adequate for a single-process deployment;
// use a shared store (Redis) if Atlas is ever run behind multiple instances.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

const buckets = new Map(); // key -> { count, resetAt }

// Bound memory: drop expired buckets periodically.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, WINDOW_MS);
if (sweeper.unref) sweeper.unref();

function keyFor(req) {
  const email = (req.body && typeof req.body.email === 'string') ? req.body.email.toLowerCase() : '';
  return `${req.ip}|${email}`;
}

/** Blocks after MAX_ATTEMPTS failed logins per IP+email within the window. */
function loginRateLimit(req, res, next) {
  const key = keyFor(req);
  const now = Date.now();
  let b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }

  if (b.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((b.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  b.count += 1;
  next();
}

/** Called on successful login so a legitimate user isn't penalised. */
function clearRateLimit(req) {
  buckets.delete(keyFor(req));
}

// General per-IP API throttle — a coarse safety net against abuse/runaway
// clients. Generous so normal interactive use never trips it. Read-heavy GETs
// and the SSE stream are exempt (long-lived / high-frequency by design).
const API_WINDOW_MS = 60 * 1000;
const API_MAX = Number(process.env.API_RATE_MAX) || 300; // requests / IP / minute
const apiBuckets = new Map();
const apiSweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of apiBuckets) if (b.resetAt <= now) apiBuckets.delete(key);
}, API_WINDOW_MS);
if (apiSweeper.unref) apiSweeper.unref();

function apiRateLimit(req, res, next) {
  // Don't throttle the event stream (one long-lived connection) or health probes.
  if (req.path === '/stream' || req.path.startsWith('/health')) return next();
  const now = Date.now();
  const key = req.ip || 'unknown';
  let b = apiBuckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + API_WINDOW_MS }; apiBuckets.set(key, b); }
  b.count += 1;
  res.setHeader('X-RateLimit-Limit', String(API_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, API_MAX - b.count)));
  if (b.count > API_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
  }
  next();
}

function _reset() { buckets.clear(); apiBuckets.clear(); }

module.exports = { loginRateLimit, clearRateLimit, apiRateLimit, _reset };
