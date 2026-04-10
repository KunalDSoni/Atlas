// ===== WATCHERS MODULE =====
// GET    /api/issues/:issueId/watchers - List watchers
// POST   /api/issues/:issueId/watchers - Add watcher
// DELETE /api/issues/:issueId/watchers/:userId - Remove watcher

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/issues/:issueId/watchers
router.get('/issues/:issueId/watchers', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const watchers = queryAll(db,
      `SELECT w.*, u.name, u.avatar_color, u.email
       FROM issue_watchers w
       JOIN users u ON w.user_id = u.id
       WHERE w.issue_id = ?
       ORDER BY w.created_at`,
      [req.params.issueId]
    );
    res.json(watchers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/issues/:issueId/watchers
router.post('/issues/:issueId/watchers', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.body.user_id || req.userId;

    // Check if already watching
    const existing = queryOne(db,
      'SELECT id FROM issue_watchers WHERE issue_id = ? AND user_id = ?',
      [req.params.issueId, userId]
    );
    if (existing) return res.json({ ok: true, already: true });

    const id = uuidv4();
    run(db, 'INSERT INTO issue_watchers (id, issue_id, user_id) VALUES (?, ?, ?)',
      [id, req.params.issueId, userId]);

    res.status(201).json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/issues/:issueId/watchers/:userId
router.delete('/issues/:issueId/watchers/:userId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    run(db, 'DELETE FROM issue_watchers WHERE issue_id = ? AND user_id = ?',
      [req.params.issueId, req.params.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
