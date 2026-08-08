// ===== AUTH MODULE =====
// POST /api/auth/login - Login with email/password
// POST /api/auth/logout - Logout (invalidate session)
// GET  /api/auth/me - Get current user from session

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { auditLog } = require('../middleware/logger');
const { verifyPassword, hashPassword } = require('../utils/password');
const { loginRateLimit, clearRateLimit } = require('../middleware/ratelimit');
const { serverError } = require('../utils/errors');
const { seedDemo, isDemoStale } = require('../seed-demo');

const router = express.Router();

// POST /api/auth/login
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const db = await getDb();
    const user = await queryOne(db, 'SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const { ok, needsRehash } = await verifyPassword(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Upgrade legacy plaintext credentials to a hash on first successful login.
    if (needsRehash) {
      await run(db, 'UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), user.id]);
    }

    clearRateLimit(req);

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    await run(db, "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))", [uuidv4(), user.id, token]);
    await run(db, "UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);

    auditLog({ userId: user.id, action: 'User logged in', category: 'auth', entityType: 'user', entityId: user.id, entityName: user.name });
    res.json({
      id: user.id, name: user.name, email: user.email, role: user.role,
      avatar_color: user.avatar_color, avatar_url: user.avatar_url,
      phone: user.phone, department: user.department, job_title: user.job_title,
      bio: user.bio, timezone: user.timezone, is_active: user.is_active,
      last_login: new Date().toISOString(), created_at: user.created_at, token
    });
  } catch (e) { serverError(res, e); }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    if (token) {
      const db = await getDb();
      await run(db, 'DELETE FROM sessions WHERE token = ?', [token]);
    }
    auditLog({ userId: req.userId, action: 'User logged out', category: 'auth', entityType: 'user', entityId: req.userId });
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const user = await queryOne(db, 'SELECT id, name, email, role, avatar_color, avatar_url, phone, department, job_title, bio, timezone, is_active, last_login, created_at FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { serverError(res, e); }
});

// POST /api/auth/demo
//
// Hands an anonymous visitor a session on the demo account. Deliberately
// credential-free — that is the entire point — so the guards matter:
//   1. Off unless DEMO_EMAIL is configured.
//   2. Rate limited, and NOT cleared on success. Every request shares the
//      bucket key `ip|` (no email in the body), so calling clearRateLimit
//      here would make the cap unreachable.
//   3. The seeded account is role `user`; the server's own middleware refuses
//      admin endpoints for it.
router.post('/demo', loginRateLimit, async (req, res) => {
  try {
    if (!process.env.DEMO_EMAIL) {
      return res.status(404).json({ error: 'Demo is not enabled' });
    }

    const db = await getDb();

    // Lazy reset: re-seed only when the workspace has gone stale. Runs when
    // someone actually visits, so there is no scheduler to drift or fail.
    if (await isDemoStale(db)) {
      await seedDemo(db);
    }

    const user = await queryOne(
      db,
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [process.env.DEMO_EMAIL]
    );
    if (!user) return res.status(500).json({ error: 'Demo account is unavailable' });

    const token = crypto.randomBytes(32).toString('hex');
    await run(db, "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))", [uuidv4(), user.id, token]);
    await run(db, "UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);

    auditLog({ userId: user.id, action: 'Demo session started', category: 'auth', entityType: 'user', entityId: user.id, entityName: user.name });

    res.json({
      id: user.id, name: user.name, email: user.email, role: user.role,
      avatar_color: user.avatar_color, avatar_url: user.avatar_url,
      phone: user.phone, department: user.department, job_title: user.job_title,
      bio: user.bio, timezone: user.timezone, is_active: user.is_active,
      last_login: new Date().toISOString(), created_at: user.created_at, token
    });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
