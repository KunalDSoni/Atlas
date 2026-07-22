// ===== PRODUCT: THEMES =====
// GET    /api/product/themes                          - List with insight counts
// POST   /api/product/themes                          - Create, optionally with members
// GET    /api/product/themes/:id                       - One theme with its insights
// PUT    /api/product/themes/:id                       - Rename / re-summarise
// DELETE /api/product/themes/:id                       - Drop the grouping, keep the insights
// POST   /api/product/themes/:id/insights              - Add members (idempotent)
// DELETE /api/product/themes/:id/insights/:insightId   - Remove one member
//
// A theme is a named grouping of insights — one level above an individual piece
// of feedback, one below a feature. It exists because `pb_insights.processed` is
// a boolean: two hundred insights is two hundred rows, with no way to say that
// fourteen of them are the same request.
//
// Grouping is manual and works with no API key. routes/ai.js only ever proposes
// groupings; confirming one comes back through POST /product/themes like any
// hand-made theme.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

const THEME_SELECT = `
  SELECT t.*, u.name as created_by_name,
    (SELECT COUNT(*) FROM pb_insight_themes it WHERE it.theme_id = t.id) as insight_count
  FROM pb_themes t
  LEFT JOIN users u ON t.created_by = u.id`;

// Membership is idempotent and forgiving: an insight already in the theme is a
// no-op, and an id that does not resolve is skipped rather than failing the
// whole request. A confirmed AI suggestion can name an insight that was deleted
// between proposal and confirmation, and losing the other nine groupings to that
// race would be worse than quietly dropping one.
async function addMembers(db, themeId, insightIds) {
  let added = 0;
  for (const insightId of insightIds || []) {
    if (!insightId) continue;
    const insight = await queryOne(db, 'SELECT id FROM pb_insights WHERE id = ?', [insightId]);
    if (!insight) continue;
    const dup = await queryOne(db,
      'SELECT id FROM pb_insight_themes WHERE theme_id = ? AND insight_id = ?', [themeId, insightId]);
    if (dup) continue;
    await run(db, 'INSERT INTO pb_insight_themes (id, insight_id, theme_id) VALUES (?, ?, ?)',
      [uuidv4(), insightId, themeId]);
    added += 1;
  }
  return added;
}

// GET /api/product/themes
router.get('/product/themes', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    res.json(await queryAll(db, `${THEME_SELECT} ORDER BY t.created_at DESC`, []));
  } catch (e) { serverError(res, e); }
});

// POST /api/product/themes
router.post('/product/themes', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, summary, insight_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

    const id = uuidv4();
    await run(db, 'INSERT INTO pb_themes (id, name, summary, created_by) VALUES (?, ?, ?, ?)',
      [id, name.trim(), summary || '', req.userId]);
    await addMembers(db, id, insight_ids);

    res.status(201).json(await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [id]));
  } catch (e) { serverError(res, e); }
});

// GET /api/product/themes/:id
router.get('/product/themes/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const theme = await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [req.params.id]);
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    theme.insights = await queryAll(db,
      `SELECT i.id, i.title, i.origin_kind, i.origin_excerpt, i.source, i.created_at
       FROM pb_insight_themes it JOIN pb_insights i ON it.insight_id = i.id
       WHERE it.theme_id = ? ORDER BY i.created_at DESC`, [req.params.id]);
    res.json(theme);
  } catch (e) { serverError(res, e); }
});

// PUT /api/product/themes/:id
router.put('/product/themes/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM pb_themes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Theme not found' });
    const { name, summary } = req.body;
    await run(db, 'UPDATE pb_themes SET name = ?, summary = ? WHERE id = ?',
      [name !== undefined ? name : existing.name,
       summary !== undefined ? summary : existing.summary,
       req.params.id]);
    res.json(await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [req.params.id]));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/themes/:id — drops the grouping, never the insights. The
// feedback outlives any particular way of organising it.
router.delete('/product/themes/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_insight_themes WHERE theme_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_themes WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// POST /api/product/themes/:id/insights
router.post('/product/themes/:id/insights', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const theme = await queryOne(db, 'SELECT id FROM pb_themes WHERE id = ?', [req.params.id]);
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    await addMembers(db, req.params.id, req.body.insight_ids);
    res.json(await queryOne(db, `${THEME_SELECT} WHERE t.id = ?`, [req.params.id]));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/themes/:id/insights/:insightId
router.delete('/product/themes/:id/insights/:insightId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_insight_themes WHERE theme_id = ? AND insight_id = ?',
      [req.params.id, req.params.insightId]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
