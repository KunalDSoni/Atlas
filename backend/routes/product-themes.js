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
const { complete, aiEnabled, MODELS } = require('./ai');

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

// How many insights one suggest call may consider, and how much of each. A
// bounded batch keeps the prompt bounded — an inbox with two thousand rows must
// not build a two thousand row prompt.
const SUGGEST_BATCH = 40;
const SUGGEST_EXCERPT = 240;

// Model output is untrusted input. Extracted from the route so it can be tested
// without an API key — the suite runs with none, so an inline version would
// have shipped completely unexercised.
//
// Returns null when the response is not JSON at all; otherwise an array, having
// dropped every id that was not in the batch we asked about. Without that
// filter a hallucinated id would flow into POST /themes and silently do nothing,
// or worse, name a real insight the model never saw.
function parseSuggestions(raw, validIds) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  return (Array.isArray(parsed.themes) ? parsed.themes : [])
    .map((t) => ({
      name: String((t && t.name) || '').slice(0, 200),
      summary: String((t && t.summary) || '').slice(0, 1000),
      insight_ids: (Array.isArray(t && t.insight_ids) ? t.insight_ids : []).filter((id) => validIds.has(id)),
    }))
    // A theme of one is not a grouping, and an unnamed one is not usable.
    .filter((t) => t.name && t.insight_ids.length >= 2);
}

// POST /api/product/themes/suggest — proposes groupings over untriaged
// insights. Declared before the '/:id' routes, which would otherwise match
// 'suggest' as an identifier.
//
// Writes NOTHING. The PM edits the proposal and confirms it through
// POST /product/themes, which is the only path that creates a theme. Clustering
// feedback is a judgement call where a confident wrong answer is worse than no
// answer, so the model never gets the last word.
router.post('/product/themes/suggest', requireAuth, async (req, res) => {
  try {
    if (!aiEnabled()) return res.json({ enabled: false, suggestions: [] });

    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT id, title, origin_excerpt, content FROM pb_insights
       WHERE processed = 0 AND dismissed_at IS NULL
       ORDER BY created_at DESC LIMIT ?`, [SUGGEST_BATCH]);
    if (rows.length < 2) return res.json({ enabled: true, suggestions: [] });

    const catalogue = rows.map((r) =>
      `${r.id} :: ${r.title} :: ${String(r.origin_excerpt || r.content || '').slice(0, SUGGEST_EXCERPT)}`
    ).join('\n');

    const raw = await complete({
      model: MODELS.summary,
      maxTokens: 1500,
      system: 'You group customer feedback into themes. Reply with JSON only: '
        + '{"themes":[{"name":"...","summary":"...","insight_ids":["..."]}]}. '
        + 'Use only ids from the input. Omit an insight rather than forcing it into a theme. '
        + 'A theme needs at least two insights. No preamble, no code fences.',
      user: `Group these insights. Each line is "id :: title :: excerpt".\n\n${catalogue}`,
    });

    const suggestions = parseSuggestions(raw, new Set(rows.map((r) => r.id)));
    if (suggestions === null) {
      return res.json({ enabled: true, suggestions: [], error: 'Could not parse the suggestion' });
    }
    res.json({ enabled: true, suggestions });
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

// POST /api/product/themes/:id/promote — turn a theme into a feature, carrying
// its evidence across.
//
// The theme is left intact. It is the record of HOW the feature was arrived at
// — which pieces of feedback were judged to be the same ask — and consuming it
// on promotion would destroy that just when the decision starts mattering.
router.post('/product/themes/:id/promote', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const theme = await queryOne(db, 'SELECT * FROM pb_themes WHERE id = ?', [req.params.id]);
    if (!theme) return res.status(404).json({ error: 'Theme not found' });

    const members = await queryAll(db,
      'SELECT insight_id FROM pb_insight_themes WHERE theme_id = ?', [req.params.id]);
    if (members.length === 0) {
      return res.status(400).json({ error: 'Theme has no insights to promote' });
    }

    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [project_id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const featureId = uuidv4();
    await run(db,
      `INSERT INTO pb_features (id, project_id, name, description, status, created_by)
       VALUES (?, ?, ?, ?, 'idea', ?)`,
      [featureId, project_id, theme.name, theme.summary || '', req.userId]);

    // Importance 1 across the board: the grouping asserts these are the same
    // ask, not how loudly each was made. Grading individual evidence is a
    // judgement a PM makes afterwards, and inventing a number here would put
    // fabricated weight into the demand calculation.
    for (const m of members) {
      await run(db,
        `INSERT INTO pb_insight_links (id, insight_id, feature_id, importance, created_by)
         VALUES (?, ?, ?, 1, ?)`,
        [uuidv4(), m.insight_id, featureId, req.userId]);
      await run(db, 'UPDATE pb_insights SET processed = 1 WHERE id = ?', [m.insight_id]);
    }

    res.status(201).json({ id: featureId, name: theme.name, insight_count: members.length });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
// Exported for testing: the suite runs without an API key, so the route body
// that calls this never executes there.
module.exports.parseSuggestions = parseSuggestions;
