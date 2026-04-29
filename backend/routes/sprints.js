// ===== SPRINTS MODULE =====
// GET    /api/projects/:id/sprints - List sprints for project (with issue stats)
// POST   /api/projects/:id/sprints - Create sprint
// GET    /api/sprints/:id - Get single sprint with stats
// PUT    /api/sprints/:id - Update sprint (name, goal, dates, status)
// DELETE /api/sprints/:id - Delete sprint (moves issues to backlog)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { auditLog } = require('../middleware/logger');

const router = express.Router();

async function enrichSprint(db, sprint) {
  const stats = await queryOne(db, `
    SELECT COUNT(*) as issue_count,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_count,
      COALESCE(SUM(story_points), 0) as total_points,
      COALESCE(SUM(CASE WHEN status = 'done' THEN story_points ELSE 0 END), 0) as done_points
    FROM issues WHERE sprint_id = ?
  `, [sprint.id]);
  return { ...sprint, ...stats };
}

// GET /api/projects/:projectId/sprints
router.get('/projects/:projectId/sprints', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprints = await queryAll(db, 'SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at', [req.params.projectId]);
    res.json(await Promise.all(sprints.map(s => enrichSprint(db, s))));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/projects/:projectId/sprints
router.post('/projects/:projectId/sprints', requireAuth, async (req, res) => {
  try {
    const { name, goal, start_date, end_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Sprint name required' });

    const db = await getDb();
    const id = uuidv4();
    await run(db, 'INSERT INTO sprints (id, project_id, name, goal, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, name, goal || '', start_date || null, end_date || null]);

    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [id]);
    auditLog({ userId: req.userId, action: 'Created sprint', category: 'sprints', entityType: 'sprint', entityId: id, entityName: name });
    res.status(201).json(await enrichSprint(db, sprint));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sprints/:id
router.get('/sprints/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
    res.json(await enrichSprint(db, sprint));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/sprints/:id
router.put('/sprints/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const { name, goal, start_date, end_date, status } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (goal !== undefined) { updates.push('goal = ?'); params.push(goal); }
    if (start_date !== undefined) { updates.push('start_date = ?'); params.push(start_date); }
    if (end_date !== undefined) { updates.push('end_date = ?'); params.push(end_date); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }

    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE sprints SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (status && status !== sprint.status) {
      auditLog({ userId: req.userId, action: `Sprint ${status}`, category: 'sprints', entityType: 'sprint', entityId: req.params.id, entityName: updated.name, details: { from: sprint.status, to: status } });
    }
    res.json(await enrichSprint(db, updated));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/sprints/:id
router.delete('/sprints/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, 'SELECT name FROM sprints WHERE id = ?', [req.params.id]);
    // Move issues back to backlog (null sprint_id)
    await run(db, 'UPDATE issues SET sprint_id = NULL WHERE sprint_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM sprints WHERE id = ?', [req.params.id]);
    auditLog({ userId: req.userId, action: 'Deleted sprint', category: 'sprints', entityType: 'sprint', entityId: req.params.id, entityName: sprint ? sprint.name : req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
