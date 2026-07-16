// ===== ISSUES MODULE =====
// GET    /api/projects/:id/issues?sprint_id= - List issues (optional sprint filter)
// POST   /api/projects/:id/issues - Create issue
// GET    /api/issues/:id - Get single issue with enriched fields
// PUT    /api/issues/:id - Update issue fields
// DELETE /api/issues/:id - Delete issue + cascade comments
// PUT    /api/issues/:id/move - Move issue (status/sprint change)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { auditLog } = require('../middleware/logger');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const requireBoardAdmin = requireRole('admin', 'board_admin');

// Epic color constraints: only these 8 named colors are valid
const EPIC_COLORS = ['purple', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink'];

// Hierarchy rules: an issue's parent must be an epic in the same project;
// epics themselves take no parent and no sprint. Returns an error message or null.
async function validateHierarchy(db, { id, projectId, type, parentId, sprintId }) {
  if (type === 'epic') {
    if (parentId) return 'An epic cannot have a parent';
    if (sprintId) return 'An epic cannot be assigned to a sprint';
    if (id) return null;
  }
  if (id && type !== 'epic') {
    const children = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE parent_id = ?', [id]);
    if (children.count > 0) return 'Cannot change type: this epic still has child issues';
  }
  if (parentId) {
    const parent = await queryOne(db, 'SELECT id, type, project_id FROM issues WHERE id = ?', [parentId]);
    if (!parent) return 'Parent issue not found';
    if (parent.type !== 'epic') return 'Parent must be an epic';
    if (parent.project_id !== projectId) return 'Parent epic must be in the same project';
  }
  return null;
}

const router = express.Router();

async function enrichIssue(db, issue) {
  const assignee = issue.assignee_id
    ? await queryOne(db, 'SELECT name, avatar_color FROM users WHERE id = ?', [issue.assignee_id])
    : null;
  const reporter = issue.reporter_id
    ? await queryOne(db, 'SELECT name, avatar_color FROM users WHERE id = ?', [issue.reporter_id])
    : null;
  const parent = issue.parent_id
    ? await queryOne(db, 'SELECT issue_key, title, epic_color FROM issues WHERE id = ?', [issue.parent_id])
    : null;
  const commentCount = await queryOne(db, 'SELECT COUNT(*) as count FROM comments WHERE issue_id = ?', [issue.id]);
  const attachmentCount = await queryOne(db, 'SELECT COUNT(*) as count FROM attachments WHERE issue_id = ?', [issue.id]);
  const watcherCount = await queryOne(db, 'SELECT COUNT(*) as count FROM issue_watchers WHERE issue_id = ?', [issue.id]);
  const linkCount = await queryOne(db, 'SELECT COUNT(*) as count FROM issue_links WHERE source_issue_id = ? OR target_issue_id = ?', [issue.id, issue.id]);

  return {
    ...issue,
    assignee_name: assignee?.name || null,
    assignee_color: assignee?.avatar_color || null,
    reporter_name: reporter?.name || null,
    reporter_color: reporter?.avatar_color || null,
    epic_key: parent?.issue_key || null,
    epic_title: parent?.title || null,
    epic_badge_color: parent?.epic_color || null,
    comment_count: commentCount.count,
    attachment_count: attachmentCount.count,
    watcher_count: watcherCount.count,
    link_count: linkCount.count,
    labels_parsed: (() => { try { return JSON.parse(issue.labels || '[]'); } catch(e) { return []; } })()
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
    const issues = await queryAll(db, query, params);
    res.json(await Promise.all(issues.map(i => enrichIssue(db, i))));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/issues
router.post('/projects/:projectId/issues', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const issueCount = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE project_id = ?', [req.params.projectId]);
    const issueNumber = issueCount.count + 1;
    const id = uuidv4();

    const { title, description, type, priority, assignee_id, reporter_id, sprint_id, story_points, due_date, labels, original_estimate, parent_id, epic_color } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const hierarchyError = await validateHierarchy(db, {
      projectId: req.params.projectId,
      type: type || 'task',
      parentId: parent_id || null,
      sprintId: sprint_id || null,
    });
    if (hierarchyError) return res.status(400).json({ error: hierarchyError });

    if (epic_color !== undefined && !EPIC_COLORS.includes(epic_color)) {
      return res.status(400).json({ error: 'Invalid epic color' });
    }

    await run(db, `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, assignee_id, reporter_id, sprint_id, story_points, due_date, labels, original_estimate, parent_id, epic_color, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, req.params.projectId, `${project.key}-${issueNumber}`, issueNumber,
       title, description || '', type || 'task', priority || 'medium',
       assignee_id || null, reporter_id || req.userId, sprint_id || null,
       story_points || null, due_date || null, labels || '[]', original_estimate || null,
       parent_id || null, epic_color || 'purple']);

    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [id]);
    auditLog({ userId: req.userId, action: 'Created issue', category: 'issues', entityType: 'issue', entityId: id, entityName: issue.issue_key, details: { title, type: type || 'task', priority: priority || 'medium' } });
    res.status(201).json(await enrichIssue(db, issue));
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/:id
router.get('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(await enrichIssue(db, issue));
  } catch (e) { serverError(res, e); }
});

// PUT /api/issues/:id
router.put('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const nextType = req.body.type !== undefined ? req.body.type : issue.type;
    const nextParent = req.body.parent_id !== undefined ? req.body.parent_id : issue.parent_id;
    const nextSprint = req.body.sprint_id !== undefined ? req.body.sprint_id : issue.sprint_id;
    const hierarchyError = await validateHierarchy(db, {
      id: issue.id,
      projectId: issue.project_id,
      type: nextType,
      parentId: nextParent,
      sprintId: nextSprint,
    });
    if (hierarchyError) return res.status(400).json({ error: hierarchyError });

    if (req.body.epic_color !== undefined && !EPIC_COLORS.includes(req.body.epic_color)) {
      return res.status(400).json({ error: 'Invalid epic color' });
    }

    const allowed = ['title', 'description', 'type', 'status', 'priority', 'assignee_id', 'sprint_id', 'story_points', 'board_order', 'labels', 'due_date', 'original_estimate', 'time_spent', 'parent_id', 'epic_color'];
    const updates = [];
    const params = [];
    const activityEntries = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const oldVal = key === 'labels' ? (issue[key] || '[]') : (issue[key] !== null && issue[key] !== undefined ? String(issue[key]) : null);
        const newVal = key === 'labels' ? (typeof req.body[key] === 'string' ? req.body[key] : JSON.stringify(req.body[key])) : req.body[key];
        updates.push(`${key} = ?`);
        params.push(newVal);
        // Log activity for meaningful field changes
        if (key !== 'board_order' && String(oldVal) !== String(newVal)) {
          activityEntries.push({ field: key === 'parent_id' ? 'epic' : key, old_value: oldVal, new_value: String(newVal) });
        }
      }
    }
    updates.push("updated_at = datetime('now')");

    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Log activity
    for (const entry of activityEntries) {
      const actId = uuidv4();
      await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, 'update', ?, ?, ?)`,
        [actId, req.params.id, req.userId, entry.field, entry.old_value, entry.new_value]);
    }

    const updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    res.json(await enrichIssue(db, updated));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/issues/:id
router.delete('/issues/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    await run(db, 'DELETE FROM attachments WHERE issue_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM comments WHERE issue_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM activity_log WHERE issue_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM issue_watchers WHERE issue_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM issue_links WHERE source_issue_id = ? OR target_issue_id = ?', [req.params.id, req.params.id]);
    await run(db, 'DELETE FROM issues WHERE id = ?', [req.params.id]);
    auditLog({ userId: req.userId, action: 'Deleted issue', category: 'issues', entityType: 'issue', entityId: req.params.id, entityName: issue ? issue.issue_key : req.params.id });
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// PUT /api/issues/:id/move
router.put('/issues/:id/move', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    if (issue.type === 'epic' && req.body.sprint_id) {
      return res.status(400).json({ error: 'An epic cannot be assigned to a sprint' });
    }

    const { status, sprint_id, board_order } = req.body;
    const updates = [];
    const params = [];
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (sprint_id !== undefined) { updates.push('sprint_id = ?'); params.push(sprint_id); }
    if (board_order !== undefined) { updates.push('board_order = ?'); params.push(board_order); }
    updates.push("updated_at = datetime('now')");

    params.push(req.params.id);
    await run(db, `UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    res.json(await enrichIssue(db, updated));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
