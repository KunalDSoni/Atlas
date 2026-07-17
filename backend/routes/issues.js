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
const { notify } = require('../utils/notify');

const requireBoardAdmin = requireRole('admin', 'board_admin');

// Epic color constraints: only these 8 named colors are valid
const EPIC_COLORS = ['purple', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink'];

// Hierarchy rules: a strict three-level tree. Epics take no parent and no sprint;
// stories/tasks/bugs may hang under an epic; subtasks must hang under a
// story/task/bug and follow their parent's sprint. Returns an error message or null.
const SUBTASK_PARENT_TYPES = ['story', 'task', 'bug'];

async function validateHierarchy(db, { id, projectId, type, parentId, sprintId }) {
  if (type === 'epic') {
    if (parentId) return 'An epic cannot have a parent';
    if (sprintId) return 'An epic cannot be assigned to a sprint';
  }
  if (type === 'subtask') {
    if (!parentId) return 'A subtask requires a parent issue';
    if (sprintId) return 'A subtask follows its parent sprint and cannot be assigned to one directly';
  }
  if (id) {
    // An issue keeps its children only while its type remains a valid parent for them.
    const kids = await queryOne(db,
      "SELECT COUNT(*) as total, SUM(CASE WHEN type = 'subtask' THEN 1 ELSE 0 END) as subtasks FROM issues WHERE parent_id = ?", [id]);
    const subtaskKids = Number(kids.subtasks || 0);
    const epicKids = Number(kids.total) - subtaskKids;
    if (epicKids > 0 && type !== 'epic') return 'Cannot change type: this epic still has child issues';
    if (subtaskKids > 0 && !SUBTASK_PARENT_TYPES.includes(type)) return 'Cannot change type: this issue still has subtasks';
  }
  if (parentId) {
    const parent = await queryOne(db, 'SELECT id, type, project_id FROM issues WHERE id = ?', [parentId]);
    if (!parent) return 'Parent issue not found';
    if (type === 'subtask') {
      if (!SUBTASK_PARENT_TYPES.includes(parent.type)) return 'A subtask parent must be a story, task, or bug';
    } else if (parent.type !== 'epic') {
      return 'Parent must be an epic';
    }
    if (parent.project_id !== projectId) return 'Parent must be in the same project';
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
    ? await queryOne(db, 'SELECT issue_key, title, type, epic_color FROM issues WHERE id = ?', [issue.parent_id])
    : null;
  const fixVersion = issue.fix_version_id
    ? await queryOne(db, 'SELECT name, status FROM versions WHERE id = ?', [issue.fix_version_id])
    : null;
  const component = issue.component_id
    ? await queryOne(db, 'SELECT name FROM components WHERE id = ?', [issue.component_id])
    : null;
  const subtasks = await queryOne(db,
    "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done FROM issues WHERE parent_id = ? AND type = 'subtask'", [issue.id]);
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
    parent_key: parent?.issue_key || null,
    parent_title: parent?.title || null,
    parent_type: parent?.type || null,
    epic_key: parent?.type === 'epic' ? parent.issue_key : null,
    epic_title: parent?.type === 'epic' ? parent.title : null,
    epic_badge_color: parent?.type === 'epic' ? parent.epic_color : null,
    fix_version_name: fixVersion?.name || null,
    fix_version_status: fixVersion?.status || null,
    component_name: component?.name || null,
    subtask_count: Number(subtasks.total),
    subtask_done_count: Number(subtasks.done || 0),
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

// GET /api/projects/:projectId/epics — epics with child rollups (Epics screen)
router.get('/projects/:projectId/epics', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const epics = await queryAll(db, `
      SELECT e.*, u.name AS assignee_name, u.avatar_color AS assignee_color,
        (SELECT COUNT(*) FROM issues c WHERE c.parent_id = e.id) AS child_count,
        (SELECT COUNT(*) FROM issues c WHERE c.parent_id = e.id AND c.status = 'done') AS done_count,
        (SELECT COALESCE(SUM(c.story_points), 0) FROM issues c WHERE c.parent_id = e.id) AS total_points,
        (SELECT COALESCE(SUM(c.story_points), 0) FROM issues c WHERE c.parent_id = e.id AND c.status = 'done') AS done_points
      FROM issues e
      LEFT JOIN users u ON u.id = e.assignee_id
      WHERE e.project_id = ? AND e.type = 'epic'
      ORDER BY e.board_order, e.created_at`, [req.params.projectId]);
    // mysql2 returns SUM()/COUNT() aggregates as strings — the API contract is numeric.
    res.json(epics.map(e => ({
      ...e,
      child_count: Number(e.child_count),
      done_count: Number(e.done_count),
      total_points: Number(e.total_points),
      done_points: Number(e.done_points),
    })));
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/:id/children — child issues of an epic
router.get('/issues/:id/children', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const children = await queryAll(db, 'SELECT * FROM issues WHERE parent_id = ? ORDER BY created_at', [req.params.id]);
    res.json(await Promise.all(children.map(c => enrichIssue(db, c))));
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

    const allowed = ['title', 'description', 'type', 'status', 'priority', 'assignee_id', 'sprint_id', 'story_points', 'board_order', 'labels', 'due_date', 'original_estimate', 'time_spent', 'parent_id', 'epic_color', 'fix_version_id', 'component_id'];
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
          activityEntries.push({ field: key === 'parent_id' ? (nextType === 'subtask' ? 'parent' : 'epic') : key, old_value: oldVal, new_value: String(newVal) });
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

    // Assignment notification: tell the new assignee (unless self-assigned).
    if (req.body.assignee_id !== undefined && req.body.assignee_id && req.body.assignee_id !== issue.assignee_id) {
      const actor = await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.userId]);
      await notify(db, {
        userId: req.body.assignee_id,
        actorId: req.userId,
        type: 'assigned',
        message: `${actor?.name || 'Someone'} assigned ${issue.issue_key} to you`,
        link: `/board?issue=${issue.id}`,
        issueId: issue.id,
      });
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
    // Orphan children rather than cascade — matches Jira semantics.
    await run(db, 'UPDATE issues SET parent_id = NULL WHERE parent_id = ?', [req.params.id]);
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
    if (issue.type === 'subtask' && req.body.sprint_id) {
      return res.status(400).json({ error: 'A subtask follows its parent sprint and cannot be assigned to one directly' });
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
