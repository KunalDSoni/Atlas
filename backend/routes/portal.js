// ===== IDEA PORTAL MODULE =====
// The customer-facing surface of the product module. Deliberately narrow:
// only features with a portal_status are visible, and only public-safe fields
// are projected (no scores, effort, owner, or internal status).
//
// GET  /api/portal/features - Public features grouped by portal_status
// POST /api/portal/ideas    - Submit an idea (becomes an insight, source='portal')

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

// GET /api/portal/features — public projection only
router.get('/portal/features', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const features = await queryAll(db,
      `SELECT f.id, f.name, f.description, f.portal_status,
         (SELECT COUNT(*) FROM pb_votes pv WHERE pv.feature_id = f.id) as vote_count,
         (SELECT COUNT(*) FROM pb_votes pv2 WHERE pv2.feature_id = f.id AND pv2.user_id = ?) as has_voted
       FROM pb_features f
       WHERE f.portal_status IS NOT NULL
       ORDER BY vote_count DESC, f.created_at DESC`, [req.userId]);
    res.json(features.map(f => ({ ...f, has_voted: !!f.has_voted })));
  } catch (e) { serverError(res, e); }
});

// POST /api/portal/ideas — an idea is raw feedback for the PM to triage;
// it lands in the insights inbox, optionally attributed to the submitter's
// customer record (matched by email).
router.post('/portal/ideas', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { title, content } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });

    const user = await queryOne(db, 'SELECT email FROM users WHERE id = ?', [req.userId]);
    const customer = user?.email
      ? await queryOne(db, 'SELECT id FROM pb_customers WHERE email = ?', [user.email])
      : null;

    const id = uuidv4();
    await run(db, "INSERT INTO pb_insights (id, title, content, source, customer_id, created_by) VALUES (?, ?, ?, 'portal', ?, ?)",
      [id, title.trim(), content || '', customer?.id || null, req.userId]);
    res.status(201).json({ ok: true, id });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
