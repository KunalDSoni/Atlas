// ===== SLA GOALS + LIVE STATE =====
// Agent-facing only. Everything here is mounted after blockClients, so a
// customer never learns a target existed, let alone that it was missed.
//
// GET    /api/request-types/:id/sla-goals
// POST   /api/request-types/:id/sla-goals   (board admin)
// PUT    /api/sla-goals/:id                 (board admin)
// DELETE /api/sla-goals/:id                 (board admin)
// GET    /api/issues/:id/sla                (id or issue key)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { METRICS, readClocks } = require('../utils/sla-clocks');

const router = express.Router();
const requireBoardAdmin = requireRole('admin', 'board_admin');

const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'];

function validateGoal(body) {
  if (!METRICS.includes(body.metric)) {
    return { ok: false, error: `metric must be one of: ${METRICS.join(', ')}` };
  }
  const target = Number(body.target_minutes);
  // Zero or negative would breach the instant the request is raised, which is
  // never what anybody meant — it is a typo, so refuse it at the door.
  if (!Number.isFinite(target) || target <= 0 || !Number.isInteger(target)) {
    return { ok: false, error: 'target_minutes must be a positive whole number of minutes' };
  }
  const priority = body.priority === undefined || body.priority === null || body.priority === ''
    ? null : String(body.priority);
  if (priority !== null && !PRIORITIES.includes(priority)) {
    return { ok: false, error: `priority must be one of: ${PRIORITIES.join(', ')}` };
  }
  return { ok: true, goal: { metric: body.metric, target_minutes: target, priority } };
}

const asNumbers = (g) => ({ ...g, target_minutes: Number(g.target_minutes) });

// GET /api/request-types/:id/sla-goals
router.get('/request-types/:id/sla-goals', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT * FROM sd_sla_goals WHERE request_type_id = ?
        ORDER BY metric, CASE WHEN priority IS NULL THEN 0 ELSE 1 END`,
      [req.params.id]);
    res.json(rows.map(asNumbers));
  } catch (e) { serverError(res, e); }
});

// POST /api/request-types/:id/sla-goals
router.post('/request-types/:id/sla-goals', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const type = await queryOne(db, 'SELECT id FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!type) return res.status(404).json({ error: 'Request type not found' });

    const valid = validateGoal(req.body);
    if (!valid.ok) return res.status(400).json({ error: valid.error });

    // One goal per (type, metric, priority): a second would make which target
    // applies depend on row order.
    const clash = await queryOne(db,
      `SELECT id FROM sd_sla_goals
        WHERE request_type_id = ? AND metric = ?
          AND ((priority IS NULL AND ? IS NULL) OR priority = ?)`,
      [req.params.id, valid.goal.metric, valid.goal.priority, valid.goal.priority]);
    if (clash) return res.status(409).json({ error: 'A goal for this metric and priority already exists' });

    const id = uuidv4();
    await run(db,
      'INSERT INTO sd_sla_goals (id, request_type_id, priority, metric, target_minutes) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.id, valid.goal.priority, valid.goal.metric, valid.goal.target_minutes]);

    res.status(201).json(asNumbers(await queryOne(db, 'SELECT * FROM sd_sla_goals WHERE id = ?', [id])));
  } catch (e) { serverError(res, e); }
});

// PUT /api/sla-goals/:id
router.put('/sla-goals/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM sd_sla_goals WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'SLA goal not found' });

    const valid = validateGoal({ ...existing, ...req.body });
    if (!valid.ok) return res.status(400).json({ error: valid.error });

    await run(db, 'UPDATE sd_sla_goals SET metric = ?, priority = ?, target_minutes = ? WHERE id = ?',
      [valid.goal.metric, valid.goal.priority, valid.goal.target_minutes, req.params.id]);

    res.json(asNumbers(await queryOne(db, 'SELECT * FROM sd_sla_goals WHERE id = ?', [req.params.id])));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/sla-goals/:id
//
// Clocks already started keep their own target_minutes, so deleting a goal
// changes what future requests promise without rewriting history.
router.delete('/sla-goals/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM sd_sla_goals WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'SLA goal not found' });
    await run(db, 'DELETE FROM sd_sla_goals WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/:id/sla — takes an id or an issue key, so an agent screen can
// deep-link by the key the customer quoted.
router.get('/issues/:id/sla', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db,
      'SELECT id FROM issues WHERE id = ? OR issue_key = ?', [req.params.id, req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(await readClocks(db, issue.id));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
