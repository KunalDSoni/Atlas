// ===== SETTINGS MODULE =====
// GET /api/settings - Get user settings
// PUT /api/settings - Update user settings

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const config = require('../config');

const router = express.Router();

// GET /api/settings/email-status — whether the server can actually deliver email,
// so the UI can tell users their toggles do nothing until SMTP is configured.
router.get('/email-status', requireAuth, (req, res) => {
  res.json({ email_configured: config.email.enabled() });
});

// GET /api/settings
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    let settings = await queryOne(db, 'SELECT * FROM user_settings WHERE user_id = ?', [req.userId]);
    if (!settings) {
      const id = uuidv4();
      await run(db, 'INSERT INTO user_settings (id, user_id) VALUES (?, ?)', [id, req.userId]);
      settings = await queryOne(db, 'SELECT * FROM user_settings WHERE id = ?', [id]);
    }
    res.json(settings);
  } catch (e) { serverError(res, e); }
});

// PUT /api/settings
router.put('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    let settings = await queryOne(db, 'SELECT * FROM user_settings WHERE user_id = ?', [req.userId]);
    if (!settings) {
      await run(db, 'INSERT INTO user_settings (id, user_id) VALUES (?, ?)', [uuidv4(), req.userId]);
    }

    const allowed = ['theme', 'language', 'email_notifications', 'push_notifications', 'notify_assigned', 'notify_mentions', 'notify_comments', 'notify_status_changes', 'notify_sprint_updates', 'compact_view', 'default_project_id', 'items_per_page'];
    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key]);
      }
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      params.push(req.userId);
      await run(db, `UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`, params);
    }

    settings = await queryOne(db, 'SELECT * FROM user_settings WHERE user_id = ?', [req.userId]);
    res.json(settings);
  } catch (e) { serverError(res, e); }
});

module.exports = router;
