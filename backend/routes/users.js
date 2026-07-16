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

    const { name, email, role, is_active, avatar_color } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (avatar_color !== undefined) { updates.push('avatar_color = ?'); params.push(avatar_color); }

    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne(db, 'SELECT id, name, email, role, avatar_color, department, job_title, is_active, last_login, created_at FROM users WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/users/:id (deactivate)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const user = await queryOne(db, 'SELECT name, email FROM users WHERE id = ?', [req.params.id]);
    await run(db, 'UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
    auditLog({ userId: req.userId, action: 'Deactivated user', category: 'users', entityType: 'user', entityId: req.params.id, entityName: user ? `${user.name} (${user.email})` : req.params.id });
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
