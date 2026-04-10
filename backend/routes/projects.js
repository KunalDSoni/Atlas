// ===== PROJECTS MODULE =====
// GET    /api/projects - List all projects with counts
// POST   /api/projects - Create project (admin only)
// PUT    /api/projects/:id - Update project
// DELETE /api/projects/:id - Delete project + cascade
// GET    /api/projects/:id/stats - Project dashboard stats
// GET    /api/projects/:id/members - List project members
// POST   /api/projects/:id/members - Add member
// PUT    /api/projects/:id/members/:userId - Update member role
// DELETE /api/projects/:id/members/:userId - Remove member

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { auditLog } = require('../middleware/logger');

const router = express.Router();

// GET /api/projects
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const projects = queryAll(db, `
      SELECT p.*, u.name as lead_name, u.avatar_color as lead_color,
        (SELECT COUNT(*) FROM issues WHERE project_id = p.id) as issue_count,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count
      FROM projects p LEFT JOIN users u ON u.id = p.lead_id ORDER BY p.created_at
    `);
    res.json(projects);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/projects
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, key, description, lead_id } = req.body;
    if (!name || !key) return res.status(400).json({ error: 'Name and key required' });

    const db = await getDb();
    const id = uuidv4();
    run(db, 'INSERT INTO projects (id, name, key, description, lead_id) VALUES (?, ?, ?, ?, ?)',
      [id, name, key.toUpperCase(), description || '', lead_id || req.userId]);

    // Add lead as project member
    if (lead_id) {
      run(db, 'INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)',
        [uuidv4(), id, lead_id, 'lead']);
    }

    const project = queryOne(db, 'SELECT * FROM projects WHERE id = ?', [id]);
    auditLog({ userId: req.userId, action: 'Created project', category: 'projects', entityType: 'project', entityId: id, entityName: `${key} - ${name}` });
    res.status(201).json(project);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/projects/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const project = queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, key, description, lead_id, status } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (key !== undefined) { updates.push('key = ?'); params.push(key.toUpperCase()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (lead_id !== undefined) { updates.push('lead_id = ?'); params.push(lead_id); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }

    if (updates.length > 0) {
      params.push(req.params.id);
      run(db, `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/projects/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pid = req.params.id;
    // Cascade delete
    run(db, 'DELETE FROM comments WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ?)', [pid]);
    run(db, 'DELETE FROM issues WHERE project_id = ?', [pid]);
    run(db, 'DELETE FROM sprints WHERE project_id = ?', [pid]);
    run(db, 'DELETE FROM project_members WHERE project_id = ?', [pid]);
    const proj = queryOne(db, 'SELECT name, key FROM projects WHERE id = ?', [pid]);
    run(db, 'DELETE FROM projects WHERE id = ?', [pid]);
    auditLog({ userId: req.userId, action: 'Deleted project', category: 'projects', entityType: 'project', entityId: pid, entityName: proj ? `${proj.key} - ${proj.name}` : pid });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/projects/:id/stats
router.get('/:id/stats', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pid = req.params.id;
    const total = queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE project_id = ?', [pid]).count;
    const byStatus = queryAll(db, 'SELECT status, COUNT(*) as count FROM issues WHERE project_id = ? GROUP BY status', [pid]);
    const byType = queryAll(db, 'SELECT type, COUNT(*) as count FROM issues WHERE project_id = ? GROUP BY type', [pid]);
    const byAssignee = queryAll(db, `
      SELECT u.name, u.avatar_color, COUNT(*) as count
      FROM issues i JOIN users u ON u.id = i.assignee_id
      WHERE i.project_id = ? AND i.assignee_id IS NOT NULL
      GROUP BY i.assignee_id ORDER BY count DESC
    `, [pid]);
    res.json({ total, byStatus, byType, byAssignee });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/projects/:id/members
router.get('/:id/members', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const members = queryAll(db, `
      SELECT pm.*, u.name, u.email, u.avatar_color, u.role as global_role
      FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? ORDER BY pm.added_at
    `, [req.params.id]);
    res.json(members);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/projects/:id/members
router.post('/:id/members', requireAuth, async (req, res) => {
  try {
    const { user_id, role_in_project } = req.body;
    if (!user_id) return res.status(400).json({ error: 'User ID required' });

    const db = await getDb();
    const existing = queryOne(db, 'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, user_id]);
    if (existing) return res.status(400).json({ error: 'User already a member' });

    const id = uuidv4();
    run(db, 'INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)',
      [id, req.params.id, user_id, role_in_project || 'member']);
    res.status(201).json({ id, project_id: req.params.id, user_id, role_in_project: role_in_project || 'member' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/projects/:id/members/:userId
router.put('/:id/members/:userId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { role_in_project } = req.body;
    run(db, 'UPDATE project_members SET role_in_project = ? WHERE project_id = ? AND user_id = ?',
      [role_in_project, req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/projects/:id/members/:userId
router.delete('/:id/members/:userId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    run(db, 'DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
