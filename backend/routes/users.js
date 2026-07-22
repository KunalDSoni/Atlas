// ===== USERS MODULE =====
// GET    /api/users - List all users
// POST   /api/users - Create user (admin only)
// GET    /api/users/:id - Get user by ID
// PUT    /api/users/:id - Update user (admin only)
// DELETE /api/users/:id - Deactivate user (admin only)

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/logger');
const { hashPassword } = require('../utils/password');
const { serverError } = require('../utils/errors');

const router = express.Router();

const ROLES = ['admin', 'board_admin', 'user', 'client'];
// Deliberately loose: the point is to catch a typo, not to adjudicate RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Is there an active admin OTHER than this one? Guards the lockout paths. */
async function anotherActiveAdminExists(db, excludeId) {
  const row = await queryOne(db,
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?",
    [excludeId]);
  return Number(row?.c || 0) > 0;
}

// GET /api/users
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const users = await queryAll(db, `SELECT id, name, email, role, avatar_color, avatar_url, phone, department, job_title, bio, timezone, is_active, last_login, created_at FROM users ORDER BY created_at`);
    res.json(users);
  } catch (e) { serverError(res, e); }
});

// POST /api/users
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, email, role, avatar_color } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: 'Email already exists' });

    const id = uuidv4();
    // Generated per-user rather than a shared well-known default. Returned once so the
    // admin can hand it over; it is only ever stored as a hash.
    const initialPassword = req.body.password || crypto.randomBytes(12).toString('base64url');
    const color = avatar_color || '#6366f1';
    await run(db, `INSERT INTO users (id, name, email, password, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, email, await hashPassword(initialPassword), role || 'user', color]);

    // Create default settings
    await run(db, `INSERT INTO user_settings (id, user_id) VALUES (?, ?)`, [uuidv4(), id]);

    auditLog({ userId: req.userId, action: 'Created user', category: 'users', entityType: 'user', entityId: id, entityName: `${name} (${email})`, details: { role: role || 'user' } });
    res.status(201).json({ id, name, email, role: role || 'user', avatar_color: color, is_active: 1, initial_password: initialPassword });
  } catch (e) { serverError(res, e); }
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const user = await queryOne(db, 'SELECT id, name, email, role, avatar_color, avatar_url, phone, department, job_title, bio, timezone, is_active, last_login, created_at FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { serverError(res, e); }
});

// PUT /api/users/:id
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, email, role, is_active } = req.body;

    if (name !== undefined && !String(name).trim()) {
      // The name renders in the directory, on every avatar and in every
      // mention; an empty one leaves blanks scattered across the app.
      return res.status(400).json({ error: 'Name required' });
    }
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}` });
    }
    if (email !== undefined) {
      const next = String(email).trim().toLowerCase();
      if (!EMAIL_RE.test(next)) return res.status(400).json({ error: 'That email address is not valid' });
      // Email is UNIQUE in the schema, so without this the duplicate surfaces
      // as a 500 instead of something the admin can act on. Comparing by id
      // rather than value lets a user keep their own address.
      const clash = await queryOne(db, 'SELECT id FROM users WHERE LOWER(email) = ?', [next]);
      if (clash && clash.id !== req.params.id) {
        return res.status(400).json({ error: 'Email already in use by another account' });
      }
    }

    // Losing the last admin leaves nobody able to administer the instance, and
    // no way back in through the UI. Checked for both routes into it — a
    // demotion and a deactivation — since either one is equally final.
    const losingAdmin = user.role === 'admin'
      && ((role !== undefined && role !== 'admin') || (is_active !== undefined && !is_active));
    if (losingAdmin && !(await anotherActiveAdminExists(db, req.params.id))) {
      return res.status(400).json({ error: 'This is the last admin — promote another account first' });
    }

    // Every column an admin may edit. Profile fields are included because the
    // person they describe may never log in to set them, and an admin
    // correcting a department should not have to ask them to do it.
    const EDITABLE = {
      name: (v) => String(v).trim(),
      email: (v) => String(v).trim().toLowerCase(),
      role: (v) => v,
      avatar_color: (v) => v,
      phone: (v) => v,
      department: (v) => v,
      job_title: (v) => v,
      bio: (v) => v,
      timezone: (v) => v,
    };

    const updates = [];
    const params = [];
    for (const [column, normalize] of Object.entries(EDITABLE)) {
      if (req.body[column] === undefined) continue;
      updates.push(`${column} = ?`);
      // An explicit empty string clears the field; undefined leaves it alone.
      params.push(req.body[column] === null ? null : normalize(req.body[column]));
    }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      auditLog({
        userId: req.userId, action: 'Updated user', category: 'users',
        entityType: 'user', entityId: req.params.id, entityName: `${user.name} (${user.email})`,
        // Field names only — values can be personal data, and the log is a
        // wider audience than the record itself.
        details: { fields: Object.keys(req.body) },
      });
    }

    const updated = await queryOne(db, 'SELECT id, name, email, role, avatar_color, avatar_url, phone, department, job_title, bio, timezone, is_active, last_login, created_at FROM users WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/users/:id (deactivate)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const user = await queryOne(db, 'SELECT name, email, role FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Same lockout guard as PUT — deactivating the last admin through this
    // route would be just as final.
    if (user.role === 'admin' && !(await anotherActiveAdminExists(db, req.params.id))) {
      return res.status(400).json({ error: 'This is the last admin — promote another account first' });
    }

    await run(db, 'UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
    auditLog({ userId: req.userId, action: 'Deactivated user', category: 'users', entityType: 'user', entityId: req.params.id, entityName: user ? `${user.name} (${user.email})` : req.params.id });
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
