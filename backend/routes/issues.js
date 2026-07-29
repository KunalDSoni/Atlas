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
const { projectStatuses } = require('./workflows');
const { runAutomation, checkAllSubtasksDone } = require('../utils/automation');
const { dispatch: dispatchWebhook } = require('../utils/webhooks');
const { publish } = require('../utils/events');
const { issueCustomFieldsBatch } = require('./custom-fields');
const { placeholders, indexBy, countsBy } = require('../utils/sql');
const sla = require('../utils/sla-clocks');
const { issueLink } = require('../utils/links');
const { applyAutoWorklog } = require('../utils/auto-worklog');
const { categoryOf } = require('../utils/flow');

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

function parseLabels(labels) {
  try { return JSON.parse(labels || '[]'); } catch (e) { return []; }
}

/**
 * Enriches a whole list of issues in a fixed number of queries.
 *
 * The per-issue version of this cost ~11 round trips each, so a 100-issue board
 * ran ~1100 queries. Every lookup here is instead a single batched read keyed by
 * the ids in the list, giving the same payload in ~10 queries regardless of size.
 */
async function enrichIssues(db, issues) {
  if (issues.length === 0) return [];

  const ids = issues.map((i) => i.id);
  const idList = placeholders(ids);
  const uniq = (vals) => [...new Set(vals.filter(Boolean))];

  // Referenced rows: one query each, only when something actually references them.
  const userIds = uniq([...issues.map((i) => i.assignee_id), ...issues.map((i) => i.reporter_id)]);
  const parentIds = uniq(issues.map((i) => i.parent_id));
  const versionIds = uniq(issues.map((i) => i.fix_version_id));
  const componentIds = uniq(issues.map((i) => i.component_id));

  const [users, parents, versions, components] = await Promise.all([
    userIds.length
      ? queryAll(db, `SELECT id, name, avatar_color FROM users WHERE id IN (${placeholders(userIds)})`, userIds)
      : [],
    parentIds.length
      ? queryAll(db, `SELECT id, issue_key, title, type, epic_color FROM issues WHERE id IN (${placeholders(parentIds)})`, parentIds)
      : [],
    versionIds.length
      ? queryAll(db, `SELECT id, name, status FROM versions WHERE id IN (${placeholders(versionIds)})`, versionIds)
      : [],
    componentIds.length
      ? queryAll(db, `SELECT id, name FROM components WHERE id IN (${placeholders(componentIds)})`, componentIds)
      : [],
  ]);

  // Rollups: one grouped query each. Issues with no children/comments/etc. simply
  // produce no row, and the lookups below default them to 0.
  const [subtaskRows, commentRows, attachmentRows, watcherRows, linkRows, customFields] = await Promise.all([
    queryAll(db,
      `SELECT parent_id, COUNT(*) as total,
         SUM(CASE WHEN c.status = 'done' OR EXISTS (
           SELECT 1 FROM project_statuses ps
           WHERE ps.project_id = c.project_id AND ps.key = c.status AND ps.category = 'done')
         THEN 1 ELSE 0 END) as done
       FROM issues c WHERE c.parent_id IN (${idList}) AND c.type = 'subtask'
       GROUP BY c.parent_id`, ids),
    queryAll(db, `SELECT issue_id, COUNT(*) as count FROM comments WHERE issue_id IN (${idList}) GROUP BY issue_id`, ids),
    queryAll(db, `SELECT issue_id, COUNT(*) as count FROM attachments WHERE issue_id IN (${idList}) GROUP BY issue_id`, ids),
    queryAll(db, `SELECT issue_id, COUNT(*) as count FROM issue_watchers WHERE issue_id IN (${idList}) GROUP BY issue_id`, ids),
    queryAll(db,
      `SELECT source_issue_id, target_issue_id FROM issue_links
       WHERE source_issue_id IN (${idList}) OR target_issue_id IN (${idList})`, [...ids, ...ids]),
    issueCustomFieldsBatch(db, issues),
  ]);

  const userById = indexBy(users, 'id');
  const parentById = indexBy(parents, 'id');
  const versionById = indexBy(versions, 'id');
  const componentById = indexBy(components, 'id');
  const commentCounts = countsBy(commentRows, 'issue_id');
  const attachmentCounts = countsBy(attachmentRows, 'issue_id');
  const watcherCounts = countsBy(watcherRows, 'issue_id');
  const subtaskRollup = indexBy(subtaskRows, 'parent_id');

  // A link counts once for each endpoint it touches — but a row whose source and
  // target are the same issue matched the old `source = ? OR target = ?` query
  // once, so it must not be double counted here.
  const inList = new Set(ids);
  const linkCounts = new Map();
  const bump = (id) => linkCounts.set(id, (linkCounts.get(id) || 0) + 1);
  for (const link of linkRows) {
    if (inList.has(link.source_issue_id)) bump(link.source_issue_id);
    if (inList.has(link.target_issue_id) && link.target_issue_id !== link.source_issue_id) {
      bump(link.target_issue_id);
    }
  }

  return issues.map((issue) => {
    const assignee = issue.assignee_id ? userById.get(issue.assignee_id) : null;
    const reporter = issue.reporter_id ? userById.get(issue.reporter_id) : null;
    const parent = issue.parent_id ? parentById.get(issue.parent_id) : null;
    const fixVersion = issue.fix_version_id ? versionById.get(issue.fix_version_id) : null;
    const component = issue.component_id ? componentById.get(issue.component_id) : null;
    const subtasks = subtaskRollup.get(issue.id);

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
      subtask_count: Number(subtasks?.total || 0),
      subtask_done_count: Number(subtasks?.done || 0),
      comment_count: commentCounts.get(issue.id) || 0,
      attachment_count: attachmentCounts.get(issue.id) || 0,
      watcher_count: watcherCounts.get(issue.id) || 0,
      link_count: linkCounts.get(issue.id) || 0,
      labels_parsed: parseLabels(issue.labels),
      custom_fields: customFields.get(issue.id) || [],
    };
  });
}

async function enrichIssue(db, issue) {
  const [enriched] = await enrichIssues(db, [issue]);
  return enriched;
}

// POST /api/issues/resolve — issue summaries for a batch of keys.
// Serves wiki content that is not saved yet (editor preview, AI drafts), where
// the stored page→issue links are not yet current.
// Registered before any /issues/:id route so `resolve` is not read as an id.
const RESOLVE_MAX_KEYS = 100;

router.post('/issues/resolve', requireAuth, async (req, res) => {
  try {
    const keys = req.body?.keys;
    if (!Array.isArray(keys)) return res.status(400).json({ error: 'keys must be an array' });
    if (keys.length > RESOLVE_MAX_KEYS) {
      return res.status(400).json({ error: `At most ${RESOLVE_MAX_KEYS} keys per request` });
    }
    if (keys.length === 0) return res.json({ issues: [] });

    const db = await getDb();
    const issues = await queryAll(db, `
      SELECT i.id, i.issue_key, i.title, i.status, i.type, i.priority,
             u.name AS assignee_name, u.avatar_color AS assignee_color
      FROM issues i
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.issue_key IN (${placeholders(keys)})`, keys);
    res.json({ issues });
  } catch (e) { serverError(res, e); }
});

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

    // Opt-in pagination for API clients (the board/backlog omit these and get
    // the full set as before). `limit` present ⇒ paginate + expose the total.
    const hasLimit = req.query.limit !== undefined;
    if (hasLimit) {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const totalRow = await queryOne(db, query.replace('SELECT *', 'SELECT COUNT(*) as c').replace(/ ORDER BY.*$/, ''), params);
      res.setHeader('X-Total-Count', String(totalRow?.c ?? 0));
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const issues = await queryAll(db, query, params);
    res.json(await enrichIssues(db, issues));
  } catch (e) { serverError(res, e); }
});

// GET /api/projects/:projectId/epics — epics with child rollups (Epics screen)
router.get('/projects/:projectId/epics', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    // A child counts as done when its literal status is 'done' (baked-in
    // workflow) or the project's workflow maps its status to the done category.
    const DONE = `(c.status = 'done' OR EXISTS (
      SELECT 1 FROM project_statuses ps
      WHERE ps.project_id = c.project_id AND ps.key = c.status AND ps.category = 'done'))`;
    const epics = await queryAll(db, `
      SELECT e.*, u.name AS assignee_name, u.avatar_color AS assignee_color,
        (SELECT COUNT(*) FROM issues c WHERE c.parent_id = e.id) AS child_count,
        (SELECT COUNT(*) FROM issues c WHERE c.parent_id = e.id AND ${DONE}) AS done_count,
        (SELECT COALESCE(SUM(c.story_points), 0) FROM issues c WHERE c.parent_id = e.id) AS total_points,
        (SELECT COALESCE(SUM(c.story_points), 0) FROM issues c WHERE c.parent_id = e.id AND ${DONE}) AS done_points
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
    res.json(await enrichIssues(db, children));
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

    // New issues land in the project's first workflow column.
    const statuses = await projectStatuses(db, req.params.projectId);
    const defaultStatus = statuses[0]?.key || 'todo';

    await run(db, `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, assignee_id, reporter_id, sprint_id, story_points, due_date, labels, original_estimate, parent_id, epic_color, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, req.params.projectId, `${project.key}-${issueNumber}`, issueNumber,
       title, description || '', type || 'task', defaultStatus, priority || 'medium',
       assignee_id || null, reporter_id || req.userId, sprint_id || null,
       story_points || null, due_date || null, labels || '[]', original_estimate || null,
       parent_id || null, epic_color || 'purple']);

    let issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [id]);
    await runAutomation(db, { type: 'issue_created', issue, actorId: req.userId });
    issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [id]);
    auditLog({ userId: req.userId, action: 'Created issue', category: 'issues', entityType: 'issue', entityId: id, entityName: issue.issue_key, details: { title, type: type || 'task', priority: priority || 'medium' } });
    dispatchWebhook(db, req.params.projectId, 'issue.created', { id: issue.id, issue_key: issue.issue_key, title: issue.title, type: issue.type, status: issue.status });
    publish({ type: 'issue', action: 'created', projectId: req.params.projectId, issueId: issue.id, actorId: req.userId });
    res.status(201).json(await enrichIssue(db, issue));
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/by-key/:key — resolve a human-readable key (ATLAS-3).
//
// This is what makes /atlas/ATLAS-3 a bootable URL: the page has a key, not a
// UUID, and must not have to guess an id before it can render. Keys are unique
// across projects because projects.key is.
//
// Authorisation is deliberate parity with GET /issues/:id below — requireAuth,
// and clients never arrive because middleware/servicedesk.blockClients is
// mounted ahead of this router. There is no per-project read filter on issues
// today and this endpoint does not invent one.
router.get('/issues/by-key/:key', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE UPPER(issue_key) = ?',
      [String(req.params.key).toUpperCase()]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(await enrichIssue(db, issue));
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

    if (req.body.status !== undefined) {
      const statuses = await projectStatuses(db, issue.project_id);
      if (!statuses.some((s) => s.key === req.body.status)) {
        return res.status(400).json({ error: 'Unknown status for this project' });
      }
    }

    const allowed = ['title', 'description', 'type', 'status', 'priority', 'assignee_id', 'sprint_id', 'story_points', 'board_order', 'labels', 'due_date', 'original_estimate', 'time_spent', 'parent_id', 'epic_color', 'fix_version_id', 'component_id', 'start_date'];
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
        link: issueLink(issue.issue_key),
        issueId: issue.id,
      });
    }

    let updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (req.body.status !== undefined && req.body.status !== issue.status) {
      await sla.onStatusChange(db, updated, updated.status);
      await runAutomation(db, { type: 'status_changed', issue: updated, actorId: req.userId });
      await checkAllSubtasksDone(db, updated, req.userId);

      const statuses = await projectStatuses(db, updated.project_id);
      const newCategory = categoryOf(updated.status, statuses);
      if (newCategory === 'done') {
        await applyAutoWorklog(db, updated, statuses, req.userId);
      } else if (newCategory === 'todo') {
        await run(db, 'UPDATE issues SET auto_worklog_locked = 0 WHERE id = ?', [updated.id]);
      }

      updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    }
    dispatchWebhook(db, updated.project_id, 'issue.updated', { id: updated.id, issue_key: updated.issue_key, title: updated.title, type: updated.type, status: updated.status });
    publish({ type: 'issue', action: 'updated', projectId: updated.project_id, issueId: updated.id, actorId: req.userId });
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
    await run(db, 'DELETE FROM wiki_page_issues WHERE issue_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM issues WHERE id = ?', [req.params.id]);
    auditLog({ userId: req.userId, action: 'Deleted issue', category: 'issues', entityType: 'issue', entityId: req.params.id, entityName: issue ? issue.issue_key : req.params.id });
    if (issue) dispatchWebhook(db, issue.project_id, 'issue.deleted', { id: issue.id, issue_key: issue.issue_key });
    if (issue) publish({ type: 'issue', action: 'deleted', projectId: issue.project_id, issueId: issue.id, actorId: req.userId });
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
    if (status !== undefined) {
      const statuses = await projectStatuses(db, issue.project_id);
      if (!statuses.some((s) => s.key === status)) {
        return res.status(400).json({ error: 'Unknown status for this project' });
      }
    }
    const updates = [];
    const params = [];
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (sprint_id !== undefined) { updates.push('sprint_id = ?'); params.push(sprint_id); }
    if (board_order !== undefined) { updates.push('board_order = ?'); params.push(board_order); }
    updates.push("updated_at = datetime('now')");

    params.push(req.params.id);
    await run(db, `UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, params);

    // Board moves are status history too — the flow reports replay these rows.
    // Same shape the general PUT writes, so consumers can't tell them apart.
    if (status !== undefined && status !== issue.status) {
      await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, 'update', 'status', ?, ?)`,
        [uuidv4(), req.params.id, req.userId, issue.status, status]);
    }
    if (sprint_id !== undefined && String(sprint_id) !== String(issue.sprint_id)) {
      await run(db, `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, 'update', 'sprint', ?, ?)`,
        [uuidv4(), req.params.id, req.userId, issue.sprint_id, sprint_id]);
    }

    let updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (status !== undefined && status !== issue.status) {
      // A board drag is a status change like any other — the SLA cannot only
      // notice the ones made through the issue form.
      await sla.onStatusChange(db, updated, updated.status);
      await runAutomation(db, { type: 'status_changed', issue: updated, actorId: req.userId });
      await checkAllSubtasksDone(db, updated, req.userId);
      updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    }
    publish({ type: 'issue', action: 'moved', projectId: updated.project_id, issueId: updated.id, actorId: req.userId });
    res.json(await enrichIssue(db, updated));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
