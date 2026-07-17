// ===== NOTIFICATIONS + WIKI PAGE WATCHING MODULE =====
// GET    /api/notifications - Latest 50 notifications for the caller
// GET    /api/notifications/unread-count - Unread badge count
// PUT    /api/notifications/:id/read - Mark one read
// PUT    /api/notifications/read-all - Mark all read
// GET    /api/wiki/pages/:id/watchers - Watch state for the caller + count
// POST   /api/wiki/pages/:id/watch - Watch a wiki page
// DELETE /api/wiki/pages/:id/watch - Unwatch a wiki page

const express = require('express');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

// GET /api/notifications
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, `
      SELECT n.*, u.name AS actor_name, u.avatar_color AS actor_color
      FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC LIMIT 50`, [req.userId]);
    res.json(rows.map((r) => ({ ...r, is_read: Number(r.is_read) })));
  } catch (e) { serverError(res, e); }
});

// GET /api/notifications/unread-count
router.get('/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const row = await queryOne(db, 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.userId]);
    res.json({ count: Number(row.count) });
  } catch (e) { serverError(res, e); }
});

// PUT /api/notifications/read-all (before /:id/read so "read-all" isn't captured as an id)
router.put('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.userId]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// PUT /api/notifications/:id/read
router.put('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/wiki/pages/:id/watchers
router.get('/wiki/pages/:id/watchers', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const count = await queryOne(db, 'SELECT COUNT(*) as count FROM wiki_page_watchers WHERE page_id = ?', [req.params.id]);
    const mine = await queryOne(db, 'SELECT 1 as yes FROM wiki_page_watchers WHERE page_id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ count: Number(count.count), watching: Boolean(mine) });
  } catch (e) { serverError(res, e); }
});

// POST /api/wiki/pages/:id/watch
router.post('/wiki/pages/:id/watch', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT id FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const existing = await queryOne(db, 'SELECT 1 as yes FROM wiki_page_watchers WHERE page_id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!existing) {
      await run(db, 'INSERT INTO wiki_page_watchers (page_id, user_id) VALUES (?, ?)', [req.params.id, req.userId]);
    }
    res.json({ ok: true, watching: true });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/wiki/pages/:id/watch
router.delete('/wiki/pages/:id/watch', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM wiki_page_watchers WHERE page_id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ ok: true, watching: false });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
