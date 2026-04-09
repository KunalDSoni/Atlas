// ===== ISSUES MODULE =====
// GET    /api/projects/:id/issues?sprint_id= - List issues (optional sprint filter)
// POST   /api/projects/:id/issues - Create issue
// GET    /api/issues/:id - Get single issue with enriched fields
// PUT    /api/issues/:id - Update issue fields
// DELETE /api/issues/:id - Delete issue + cascade comments
// PUT    /api/issues/:id/move - Move issue (status/sprint change)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function enrichIssue(db, issue) {
  const assignee = issue.assignee_id
    ? queryOne(db, 'SELECT name, avatar_color FROM users WHERE id = ?', [issue.assignee_id])
    : null;
  const reporter = issue.reporter_id
    ? queryOne(db, 'SELECT name, avatar_color FROM users WHERE id = ?', [issue.reporter_id])
    : null;
  const commentCount = queryOne(db, 'SELECT COUNT(*) as count FROM comments WHERE issue_id = ?', [issue.id]);

  return {
    ...issue,
    assignee_name: assignee?.name || null,
    assignee_color: assignee?.avatar_color || null,
    reporter_name: reporter?.name || null,
    reporter_color: reporter?.avatar_color || null,
    comment_count: commentCount.count
  };
}

// GET /api/projects/:projectId/issues
router.get('/projects/:projectId/issues', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    let query = 'SELECT * FROM issues WHERE project_id = ?';
    const params = [req.params.projectId];

    if (req.query.sprint_id) {
      query += ' AND sprint_id = ?';
      params.push(req.query.sprint_id);
    }

    query += ' ORDER BY board_order, created_at';
    const issues = queryAll(db, query, params);
    res.json(issues.map(i => enrichIssue(db, i)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/projects/:projectId/issues
router.post('/projects/:projectId/issues', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const project = queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const issueCount = queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE project_id = ?', [req.params.projectId]);
    const issueNumber = issueCount.count + 1;
    const id = uuidv4();

    const { title, description, type, priority, assignee_id, reporter_id, sprint_id, story_points } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    run(db, `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, assignee_id, reporter_id, sprint_id, story_points, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, 0)`,
      [id, req.params.projectId, `${project.key}-${issueNumber}`, issueNumber,
       title, description || '', type || 'task', priority || 'medium',
       assignee_id || null, reporter_id || req.userId, sprint_id || null,
       story_points || null]);

    const issue = queryOne(db, 'SELECT * FROM issues WHERE id = ?', [id]);
    res.status(201).json(enrichIssue(db, issue));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/issues/:id
router.get('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(enrichIssue(db, issue));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/issues/:id
router.put('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const allowed = ['title', 'description', 'type', 'status', 'priority', 'assignee_id', 'sprint_id', 'story_points', 'board_order'];
    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }
    updates.push("updated_at = datetime('now')");

    if (updates.length > 0) {
      params.push(req.params.id);
      run(db, `UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    res.json(enrichIssue(db, updated));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/issues/:id
router.delete('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    run(db, 'DELETE FROM comments WHERE issue_id = ?', [req.params.id]);
    run(db, 'DELETE FROM issues WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/issues/:id/move
router.put('/issues/:id/move', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const { status, sprint_id, board_order } = req.body;
    const updates = [];
    const params = [];
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (sprint_id !== undefined) { updates.push('sprint_id = ?'); params.push(sprint_id); }
    if (board_order !== undefined) { updates.push('board_order = ?'); params.push(board_order); }
    updates.push("updated_at = datetime('now')");

    params.push(req.params.id);
    run(db, `UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    res.json(enrichIssue(db, updated));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
