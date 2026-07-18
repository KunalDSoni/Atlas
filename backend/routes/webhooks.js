// ===== WEBHOOKS MANAGEMENT =====
// GET    /api/projects/:projectId/webhooks   - List a project's webhooks
// POST   /api/projects/:projectId/webhooks   - Register a webhook (secret returned once)
// PUT    /api/webhooks/:id                    - Update url/events/enabled
// DELETE /api/webhooks/:id                    - Remove
//
// Managing webhooks is restricted to admins / board admins.

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();
const requireBoardAdmin = requireRole('admin', 'board_admin');

const EVENTS = ['issue.created', 'issue.updated', 'issue.deleted'];

// Never leak the secret after creation.
function publicHook(h) {
  if (!h) return h;
  const { secret, ...rest } = h;
  let events = [];
  try { events = JSON.parse(h.events || '[]'); } catch (e) { events = []; }
  return { ...rest, events };
}

// GET /api/projects/:projectId/webhooks
router.get('/projects/:projectId/webhooks', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, 'SELECT * FROM webhooks WHERE project_id = ? ORDER BY created_at DESC', [req.params.projectId]);
    res.json(rows.map(publicHook));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/webhooks { url, events? }
router.post('/projects/:projectId/webhooks', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const url = String(req.body.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid http(s) url is required' });
    const events = Array.isArray(req.body.events) ? req.body.events.filter((e) => EVENTS.includes(e)) : [];

    const id = uuidv4();
    const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');
    await run(db, 'INSERT INTO webhooks (id, project_id, url, secret, events, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, url, secret, JSON.stringify(events), req.userId]);
    const hook = await queryOne(db, 'SELECT * FROM webhooks WHERE id = ?', [id]);
    // Return the signing secret once so the caller can verify deliveries.
    res.status(201).json({ ...publicHook(hook), secret });
  } catch (e) { serverError(res, e); }
});

// PUT /api/webhooks/:id
router.put('/webhooks/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const hook = await queryOne(db, 'SELECT * FROM webhooks WHERE id = ?', [req.params.id]);
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });

    const url = req.body.url !== undefined ? String(req.body.url).trim() : hook.url;
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid http(s) url is required' });
    const events = req.body.events !== undefined
      ? JSON.stringify((req.body.events || []).filter((e) => EVENTS.includes(e)))
      : hook.events;
    const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : hook.enabled;

    await run(db, 'UPDATE webhooks SET url = ?, events = ?, enabled = ? WHERE id = ?', [url, events, enabled, req.params.id]);
    res.json(publicHook(await queryOne(db, 'SELECT * FROM webhooks WHERE id = ?', [req.params.id])));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/webhooks/:id
router.delete('/webhooks/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM webhooks WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
module.exports.EVENTS = EVENTS;
