// ===== AUTOMATION RULES MODULE =====
// GET    /api/projects/:id/automations - Rules for a project
// POST   /api/projects/:id/automations - Create rule (board admin)
// PUT    /api/automations/:id - Update rule (rename, enable/disable, edit parts)
// DELETE /api/automations/:id - Delete rule

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const requireBoardAdmin = requireRole('admin', 'board_admin');
const router = express.Router();

const TRIGGERS = ['issue_created', 'status_changed', 'all_subtasks_done'];
const ACTION_TYPES = ['set_status', 'set_assignee', 'add_label', 'notify_user'];

function shape(rule) {
  const parse = (j, f) => { try { return JSON.parse(j) ?? f; } catch { return f; } };
  return {
    ...rule,
    enabled: Number(rule.enabled),
    conditions_parsed: parse(rule.conditions, []),
    actions_parsed: parse(rule.actions, []),
  };
}

function validateParts(body) {
  if (body.trigger_type !== undefined && !TRIGGERS.includes(body.trigger_type)) {
    return 'Invalid trigger';
  }
  if (body.actions !== undefined) {
    const actions = Array.isArray(body.actions) ? body.actions : null;
    if (!actions || actions.length === 0) return 'At least one action required';
    for (const a of actions) {
      if (!a || !ACTION_TYPES.includes(a.type)) return 'Invalid action type';
    }
  }
  if (body.conditions !== undefined && !Array.isArray(body.conditions)) {
    return 'Conditions must be a list';
  }
  return null;
}

// GET /api/projects/:projectId/automations
router.get('/projects/:projectId/automations', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rules = await queryAll(db,
      'SELECT * FROM automation_rules WHERE project_id = ? ORDER BY created_at', [req.params.projectId]);
    res.json(rules.map(shape));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/automations
router.post('/projects/:projectId/automations', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const { name, trigger_type, conditions, actions } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Rule name required' });
    if (!TRIGGERS.includes(trigger_type)) return res.status(400).json({ error: 'Invalid trigger' });
    const err = validateParts({ trigger_type, conditions: conditions ?? [], actions: actions ?? [] });
    if (err) return res.status(400).json({ error: err });

    const db = await getDb();
    const id = uuidv4();
    await run(db, 'INSERT INTO automation_rules (id, project_id, name, trigger_type, conditions, actions, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [id, req.params.projectId, name.trim(), trigger_type, JSON.stringify(conditions || []), JSON.stringify(actions || [])]);
    res.status(201).json(shape(await queryOne(db, 'SELECT * FROM automation_rules WHERE id = ?', [id])));
  } catch (e) { serverError(res, e); }
});

// PUT /api/automations/:id
router.put('/automations/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rule = await queryOne(db, 'SELECT * FROM automation_rules WHERE id = ?', [req.params.id]);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    const err = validateParts(req.body);
    if (err) return res.status(400).json({ error: err });

    const updates = []; const params = [];
    if (req.body.name !== undefined) { updates.push('name = ?'); params.push(req.body.name); }
    if (req.body.trigger_type !== undefined) { updates.push('trigger_type = ?'); params.push(req.body.trigger_type); }
    if (req.body.conditions !== undefined) { updates.push('conditions = ?'); params.push(JSON.stringify(req.body.conditions)); }
    if (req.body.actions !== undefined) { updates.push('actions = ?'); params.push(JSON.stringify(req.body.actions)); }
    if (req.body.enabled !== undefined) { updates.push('enabled = ?'); params.push(req.body.enabled ? 1 : 0); }
    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE automation_rules SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    res.json(shape(await queryOne(db, 'SELECT * FROM automation_rules WHERE id = ?', [req.params.id])));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/automations/:id
router.delete('/automations/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM automation_rules WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
