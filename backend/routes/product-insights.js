// ===== PRODUCT: INSIGHTS (FEEDBACK) MODULE =====
// GET    /api/product/insights                - List insights (?processed=0|1&source=&customer_id=)
// POST   /api/product/insights                - Capture a piece of feedback
// GET    /api/product/insights/:id            - Single insight with feature links
// PUT    /api/product/insights/:id            - Update (title/content/source/customer/processed)
// DELETE /api/product/insights/:id            - Delete insight + its feature links
// POST   /api/product/insights/:id/links      - Link insight to a feature (importance + quote)
// DELETE /api/product/insight-links/:id       - Remove a feature link

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { resolveOrigin } = require('../utils/insight-origin');

const router = express.Router();

const INSIGHT_SOURCES = ['portal', 'email', 'support', 'sales', 'interview', 'other'];

const ENRICHED_SELECT = `
  SELECT ins.*, cu.name as customer_name, cu.email as customer_email,
    co.name as company_name, co.tier as company_tier,
    u.name as created_by_name,
    (SELECT COUNT(*) FROM pb_insight_links il WHERE il.insight_id = ins.id) as feature_count
  FROM pb_insights ins
  LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
  LEFT JOIN pb_companies co ON cu.company_id = co.id
  LEFT JOIN users u ON ins.created_by = u.id`;

// GET /api/product/insights
router.get('/product/insights', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const clauses = [];
    const params = [];
    if (req.query.processed !== undefined) { clauses.push('ins.processed = ?'); params.push(Number(req.query.processed)); }
    if (req.query.source) { clauses.push('ins.source = ?'); params.push(req.query.source); }
    if (req.query.customer_id) { clauses.push('ins.customer_id = ?'); params.push(req.query.customer_id); }
    if (req.query.dismissed !== undefined) {
      clauses.push(Number(req.query.dismissed) ? 'ins.dismissed_at IS NOT NULL' : 'ins.dismissed_at IS NULL');
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const insights = await queryAll(db, `${ENRICHED_SELECT}${where} ORDER BY ins.created_at DESC`, params);
    res.json(insights);
  } catch (e) { serverError(res, e); }
});

// POST /api/product/insights
router.post('/product/insights', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { title, content, source, customer_id } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
    if (source && !INSIGHT_SOURCES.includes(source)) return res.status(400).json({ error: 'invalid source' });
    if (customer_id) {
      const customer = await queryOne(db, 'SELECT id FROM pb_customers WHERE id = ?', [customer_id]);
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
    }

    const id = uuidv4();
    await run(db, 'INSERT INTO pb_insights (id, title, content, source, customer_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [id, title.trim(), content || '', source || 'other', customer_id || null, req.userId]);
    const insight = await queryOne(db, `${ENRICHED_SELECT} WHERE ins.id = ?`, [id]);
    res.status(201).json(insight);
  } catch (e) { serverError(res, e); }
});

// POST /api/product/insights/capture — turn text that already exists in Atlas
// into a triageable insight. Declared before the '/:id' routes below, which
// would otherwise match 'capture' as an id.
//
// The excerpt is snapshotted at capture time; origin_id is a backlink that may
// dangle if the source is later deleted. resolveOrigin() is the security
// boundary — it confirms the caller may see the source before anything is read
// out of it.
router.post('/product/insights/capture', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { origin_kind, origin_id, title, customer_id } = req.body;

    const origin = await resolveOrigin(db, origin_kind, origin_id, req.userId, req.userRole);
    if (!origin.ok) return res.status(origin.status).json({ error: origin.error });

    if (customer_id) {
      const customer = await queryOne(db, 'SELECT id FROM pb_customers WHERE id = ?', [customer_id]);
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
    }

    // A request or comment is support feedback; a wiki capture is research
    // somebody wrote up. Neither is 'other', which is the manual form's default.
    const source = origin_kind === 'wiki' ? 'interview' : 'support';
    const id = uuidv4();
    await run(db,
      `INSERT INTO pb_insights
         (id, title, content, source, customer_id, created_by, origin_kind, origin_id, origin_excerpt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, (title || origin.title || 'Captured feedback').trim(), '', source,
       customer_id || origin.customer_id || null, req.userId,
       origin_kind, origin_id, origin.excerpt]);

    const insight = await queryOne(db, `${ENRICHED_SELECT} WHERE ins.id = ?`, [id]);
    res.status(201).json(insight);
  } catch (e) { serverError(res, e); }
});

// GET /api/product/insights/:id — includes linked features
router.get('/product/insights/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const insight = await queryOne(db, `${ENRICHED_SELECT} WHERE ins.id = ?`, [req.params.id]);
    if (!insight) return res.status(404).json({ error: 'Insight not found' });
    insight.features = await queryAll(db,
      `SELECT il.id as link_id, il.importance, il.quote, f.id, f.name, f.status, f.timeframe
       FROM pb_insight_links il
       JOIN pb_features f ON il.feature_id = f.id
       WHERE il.insight_id = ?
       ORDER BY il.created_at DESC`, [req.params.id]);
    res.json(insight);
  } catch (e) { serverError(res, e); }
});

// PUT /api/product/insights/:id
router.put('/product/insights/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM pb_insights WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Insight not found' });

    const { title, content, source, customer_id, processed } = req.body;
    if (source !== undefined && !INSIGHT_SOURCES.includes(source)) return res.status(400).json({ error: 'invalid source' });

    await run(db, 'UPDATE pb_insights SET title = ?, content = ?, source = ?, customer_id = ?, processed = ? WHERE id = ?',
      [title !== undefined ? title : existing.title,
       content !== undefined ? content : existing.content,
       source !== undefined ? source : existing.source,
       customer_id !== undefined ? customer_id : existing.customer_id,
       processed !== undefined ? (processed ? 1 : 0) : existing.processed,
       req.params.id]);
    const insight = await queryOne(db, `${ENRICHED_SELECT} WHERE ins.id = ?`, [req.params.id]);
    res.json(insight);
  } catch (e) { serverError(res, e); }
});

// POST /api/product/insights/:id/dismiss — triaged as not actionable. Kept
// rather than deleted: a dismissed insight is still evidence of what somebody
// asked for, and the inbox filters on dismissed_at rather than losing the row.
router.post('/product/insights/:id/dismiss', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM pb_insights WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Insight not found' });
    await run(db, "UPDATE pb_insights SET dismissed_at = datetime('now') WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/insights/:id
router.delete('/product/insights/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_insight_links WHERE insight_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_insights WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// POST /api/product/insights/:id/links — attach feedback to a feature.
// Linking counts as triage, so the insight is marked processed.
router.post('/product/insights/:id/links', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const insight = await queryOne(db, 'SELECT id FROM pb_insights WHERE id = ?', [req.params.id]);
    if (!insight) return res.status(404).json({ error: 'Insight not found' });
    const { feature_id, importance, quote } = req.body;
    if (!feature_id) return res.status(400).json({ error: 'feature_id required' });
    const feature = await queryOne(db, 'SELECT id FROM pb_features WHERE id = ?', [feature_id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    if (importance !== undefined && ![1, 2, 3].includes(Number(importance))) return res.status(400).json({ error: 'importance must be 1-3' });
    const dup = await queryOne(db, 'SELECT id FROM pb_insight_links WHERE insight_id = ? AND feature_id = ?', [req.params.id, feature_id]);
    if (dup) return res.status(400).json({ error: 'Already linked to this feature' });

    const id = uuidv4();
    await run(db, 'INSERT INTO pb_insight_links (id, insight_id, feature_id, importance, quote, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.id, feature_id, Number(importance) || 1, quote || null, req.userId]);
    await run(db, 'UPDATE pb_insights SET processed = 1 WHERE id = ?', [req.params.id]);
    const link = await queryOne(db,
      `SELECT il.*, f.name as feature_name FROM pb_insight_links il
       JOIN pb_features f ON il.feature_id = f.id WHERE il.id = ?`, [id]);
    res.status(201).json(link);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/insight-links/:id
router.delete('/product/insight-links/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_insight_links WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
