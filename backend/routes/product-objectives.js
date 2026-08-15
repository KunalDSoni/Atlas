// ===== PRODUCT: OBJECTIVES (OKR) MODULE =====
// GET    /api/product/objectives               - List objectives with feature rollup
// POST   /api/product/objectives               - Create objective
// GET    /api/product/objectives/:id           - Single objective with linked features
// PUT    /api/product/objectives/:id           - Update objective
// DELETE /api/product/objectives/:id           - Delete objective + its feature links
// POST   /api/product/objectives/:id/features  - Link a feature
// DELETE /api/product/objective-features/:id   - Unlink a feature
//
// Rollup: progress = launched linked features / total linked features.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { notifyNewMentions } = require('../utils/notify');

const router = express.Router();

const OBJECTIVE_STATUSES = ['on_track', 'at_risk', 'off_track', 'done'];

const ENRICHED_SELECT = `
  SELECT o.*, u.name as owner_name,
    (SELECT COUNT(*) FROM pb_feature_objectives fo WHERE fo.objective_id = o.id) as feature_count,
    (SELECT COUNT(*) FROM pb_feature_objectives fo JOIN pb_features f ON fo.feature_id = f.id
     WHERE fo.objective_id = o.id AND f.status = 'launched') as launched_count
  FROM pb_objectives o
  LEFT JOIN users u ON o.owner_id = u.id`;

// GET /api/product/objectives
router.get('/product/objectives', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const objectives = await queryAll(db, `${ENRICHED_SELECT} ORDER BY o.target_date IS NULL, o.target_date, o.name`);
    res.json(objectives);
  } catch (e) { serverError(res, e); }
});

// POST /api/product/objectives
router.post('/product/objectives', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, description, status, target_date, owner_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    if (status && !OBJECTIVE_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });

    const id = uuidv4();
    await run(db, 'INSERT INTO pb_objectives (id, name, description, status, target_date, owner_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name.trim(), description || '', status || 'on_track', target_date || null, owner_id || null]);
    await notifyNewMentions(db, {
      text: description || '',
      actorId: req.userId,
      where: `the objective "${name.trim()}"`,
      link: '/product/objectives',
    });
    const objective = await queryOne(db, `${ENRICHED_SELECT} WHERE o.id = ?`, [id]);
    res.status(201).json(objective);
  } catch (e) { serverError(res, e); }
});

// GET /api/product/objectives/:id — includes linked features with delivery progress
router.get('/product/objectives/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const objective = await queryOne(db, `${ENRICHED_SELECT} WHERE o.id = ?`, [req.params.id]);
    if (!objective) return res.status(404).json({ error: 'Objective not found' });
    objective.features = await queryAll(db,
      `SELECT fo.id as link_id, f.id, f.name, f.status, f.timeframe,
         (SELECT COUNT(*) FROM pb_feature_issues fi WHERE fi.feature_id = f.id) as delivery_total,
         (SELECT COUNT(*) FROM pb_feature_issues fi JOIN issues iss ON fi.issue_id = iss.id
          WHERE fi.feature_id = f.id AND (iss.status = 'done' OR EXISTS (
            SELECT 1 FROM project_statuses ps
            WHERE ps.project_id = iss.project_id AND ps.key = iss.status AND ps.category = 'done'))) as delivery_done
       FROM pb_feature_objectives fo
       JOIN pb_features f ON fo.feature_id = f.id
       WHERE fo.objective_id = ?
       ORDER BY f.name`, [req.params.id]);
    res.json(objective);
  } catch (e) { serverError(res, e); }
});

// PUT /api/product/objectives/:id
router.put('/product/objectives/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM pb_objectives WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Objective not found' });

    const { name, description, status, target_date, owner_id } = req.body;
    if (status !== undefined && !OBJECTIVE_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });

    await run(db, 'UPDATE pb_objectives SET name = ?, description = ?, status = ?, target_date = ?, owner_id = ? WHERE id = ?',
      [name !== undefined ? name : existing.name,
       description !== undefined ? description : existing.description,
       status !== undefined ? status : existing.status,
       target_date !== undefined ? target_date : existing.target_date,
       owner_id !== undefined ? owner_id : existing.owner_id,
       req.params.id]);
    if (description !== undefined && description !== existing.description) {
      await notifyNewMentions(db, {
        text: description || '',
        previousText: existing.description || '',
        actorId: req.userId,
        where: `the objective "${name !== undefined ? name : existing.name}"`,
        link: '/product/objectives',
      });
    }
    const objective = await queryOne(db, `${ENRICHED_SELECT} WHERE o.id = ?`, [req.params.id]);
    res.json(objective);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/objectives/:id
router.delete('/product/objectives/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_feature_objectives WHERE objective_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_objectives WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// POST /api/product/objectives/:id/features
router.post('/product/objectives/:id/features', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const objective = await queryOne(db, 'SELECT id FROM pb_objectives WHERE id = ?', [req.params.id]);
    if (!objective) return res.status(404).json({ error: 'Objective not found' });
    const { feature_id } = req.body;
    if (!feature_id) return res.status(400).json({ error: 'feature_id required' });
    const feature = await queryOne(db, 'SELECT id FROM pb_features WHERE id = ?', [feature_id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    const dup = await queryOne(db, 'SELECT id FROM pb_feature_objectives WHERE objective_id = ? AND feature_id = ?', [req.params.id, feature_id]);
    if (dup) return res.status(400).json({ error: 'Feature already linked' });

    await run(db, 'INSERT INTO pb_feature_objectives (id, feature_id, objective_id) VALUES (?, ?, ?)',
      [uuidv4(), feature_id, req.params.id]);
    const updated = await queryOne(db, `${ENRICHED_SELECT} WHERE o.id = ?`, [req.params.id]);
    res.status(201).json(updated);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/objective-features/:id
router.delete('/product/objective-features/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_feature_objectives WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
