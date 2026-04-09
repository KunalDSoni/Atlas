// ===== AUTH MODULE =====
// POST /api/auth/login - Login with email/password
// POST /api/auth/logout - Logout (invalidate session)
// GET  /api/auth/me - Get current user from session

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const db = await getDb();
    const user = queryOne(db, 'SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Simple password check (plain text for demo)
    if (user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

    // Create session
    const token = uuidv4() + '-' + uuidv4();
    run(db, "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))", [uuidv4(), user.id, token]);
    run(db, "UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);

    res.json({
      id: user.id, name: user.name, email: user.email, role: user.role,
      avatar_color: user.avatar_color, avatar_url: user.avatar_url,
      phone: user.phone, department: user.department, job_title: user.job_title,
      bio: user.bio, timezone: user.timezone, is_active: user.is_active,
      last_login: new Date().toISOString(), created_at: user.created_at, token
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    if (token) {
      const db = await getDb();
      run(db, 'DELETE FROM sessions WHERE token = ?', [token]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const user = queryOne(db, 'SELECT id, name, email, role, avatar_color, avatar_url, phone, department, job_title, bio, timezone, is_active, last_login, created_at FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
