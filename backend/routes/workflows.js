// ===== CUSTOM WORKFLOWS MODULE =====
// Per-project statuses (board columns). Projects with no rows use the built-in
// default workflow; defining any row switches the project to its custom set.
//
// GET    /api/projects/:id/statuses - Project workflow (defaults if none defined)
// POST   /api/projects/:id/statuses - Add a status (board admin)
// PUT    /api/statuses/:id - Rename / recategorize / reorder
// DELETE /api/statuses/:id?migrate_to=<key> - Remove; issues move to migrate_to

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const requireBoardAdmin = requireRole('admin', 'board_admin');
const router = express.Router();

const CATEGORIES = ['todo', 'in_progress', 'done'];

/** Built-in workflow used until a project defines its own. */
const DEFAULT_STATUSES = [
  { key: 'todo', label: 'To Do', category: 'todo', position: 0 },
  { key: 'in_progress', label: 'In Progress', category: 'in_progress', position: 1 },
  { key: 'blocked', label: 'Blocked', category: 'in_progress', position: 2 },
  { key: 'in_review', label: 'In Review', category: 'in_progress', position: 3 },
  { key: 'done', label: 'Done', category: 'done', position: 4 },
];

async function projectStatuses(db, projectId) {
  const rows = await queryAll(db,
    'SELECT * FROM project_statuses WHERE project_id = ? ORDER BY position, key', [projectId]);
  if (rows.length === 0) {
    return DEFAULT_STATUSES.map((s) => ({ id: `default-${s.key}`, project_id: projectId, builtin: true, ...s }));
  }
  return rows.map((r) => ({ ...r, position: Number(r.position), builtin: false }));
}

// GET /api/projects/:projectId/statuses
router.get('/projects/:projectId/statuses', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    res.json(await projectStatuses(db, req.params.projectId));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/statuses
// The first POST on a default-workflow project materializes the defaults first,
// so the project keeps its existing columns plus the new one.
router.post('/projects/:projectId/statuses', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const { label, category } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: 'Status label required' });
    if (category !== undefined && !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    const key = (req.body.key || label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) return res.status(400).json({ error: 'Status key required' });

    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const existing = await queryAll(db, 'SELECT * FROM project_statuses WHERE project_id = ?', [req.params.projectId]);
    if (existing.length === 0) {
      for (const s of DEFAULT_STATUSES) {
        await run(db, 'INSERT INTO project_statuses (id, project_id, key, label, category, position) VALUES (?, ?, ?, ?, ?, ?)',
          [uuidv4(), req.params.projectId, s.key, s.label, s.category, s.position]);
      }
    }
    const dupe = await queryOne(db, 'SELECT id FROM project_statuses WHERE project_id = ? AND key = ?', [req.params.projectId, key]);
    if (dupe) return res.status(400).json({ error: 'A status with this key already exists' });

    const maxPos = await queryOne(db, 'SELECT COALESCE(MAX(position), -1) as m FROM project_statuses WHERE project_id = ?', [req.params.projectId]);
    const id = uuidv4();
    await run(db, 'INSERT INTO project_statuses (id, project_id, key, label, category, position) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, key, label.trim(), category || 'in_progress', Number(maxPos.m) + 1]);
    res.status(201).json(await queryOne(db, 'SELECT * FROM project_statuses WHERE id = ?', [id]));
  } catch (e) { serverError(res, e); }
});

// PUT /api/statuses/:id
router.put('/statuses/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const status = await queryOne(db, 'SELECT * FROM project_statuses WHERE id = ?', [req.params.id]);
    if (!status) return res.status(404).json({ error: 'Status not found' });
    if (req.body.category !== undefined && !CATEGORIES.includes(req.body.category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    const allowed = ['label', 'category', 'position'];
    const updates = []; const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { updates.push(`${key} = ?`); params.push(req.body[key]); }
    }
    // Flagging a status as "waiting for customer" is what pauses a service desk
    // SLA clock while the ball is in the customer's court (epic 43). Stored as
    // 0/1 because SQLite has no boolean.
    if (req.body.waiting_for_customer !== undefined) {
      updates.push('waiting_for_customer = ?');
      params.push(req.body.waiting_for_customer ? 1 : 0);
    }
    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE project_statuses SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    res.json(await queryOne(db, 'SELECT * FROM project_statuses WHERE id = ?', [req.params.id]));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/statuses/:id?migrate_to=<key>
router.delete('/statuses/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const status = await queryOne(db, 'SELECT * FROM project_statuses WHERE id = ?', [req.params.id]);
    if (!status) return res.status(404).json({ error: 'Status not found' });

    const remaining = await queryAll(db,
      'SELECT * FROM project_statuses WHERE project_id = ? AND id != ? ORDER BY position', [status.project_id, req.params.id]);
    if (remaining.length === 0) return res.status(400).json({ error: 'A project needs at least one status' });

    const migrateTo = req.query.migrate_to || remaining[0].key;
    if (!remaining.some((s) => s.key === migrateTo)) {
      return res.status(400).json({ error: 'migrate_to must be another status in this project' });
    }
    await run(db, "UPDATE issues SET status = ?, updated_at = datetime('now') WHERE project_id = ? AND status = ?",
      [migrateTo, status.project_id, status.key]);
    await run(db, 'DELETE FROM project_statuses WHERE id = ?', [req.params.id]);
    res.json({ ok: true, migrated_to: migrateTo });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
module.exports.projectStatuses = projectStatuses;
