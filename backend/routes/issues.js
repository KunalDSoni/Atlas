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
const { notify, notifyNewMentions } = require('../utils/notify');
const { projectStatuses } = require('./workflows');
const { runAutomation, checkAllSubtasksDone } = require('../utils/automation');
const { dispatch: dispatchWebhook } = require('../utils/webhooks');
const { publish } = require('../utils/events');
const { issueCustomFieldsBatch } = require('./custom-fields');
const { placeholders, indexBy, countsBy } = require('../utils/sql');
const sla = require('../utils/sla-clocks');
const { issueLink } = require('../utils/links');
const { applyAutoWorklog, liveInProgressMinutes } = require('../utils/auto-worklog');
const { categoryOf } = require('../utils/flow');
const { completionBlock } = require('../utils/completion-guard');
const { closeStaleSegments, commitTimer, issueTimerUserIds } = require('../utils/timers');
const { recomputeTimeSpent } = require('../utils/worklog-sync');

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

/**
 * Guards a sprint assignment against Jira's rule that a closed sprint takes no
 * new work. Returns an error message, or null when the move is allowed.
 *
 * Only an *incoming* value that differs from the stored one is checked. Issues
 * already sitting in a completed sprint (the done work left behind at close)
 * must stay editable — the edit dialog resubmits the whole record, so rejecting
 * on mere presence would make those issues unsavable.
 */
async function completedSprintError(db, nextSprintId, currentSprintId) {
  if (!nextSprintId) return null;
  if (String(nextSprintId) === String(currentSprintId)) return null;
  const sprint = await queryOne(db, 'SELECT name, status FROM sprints WHERE id = ?', [nextSprintId]);
  if (!sprint || sprint.status !== 'completed') return null;
  return `${sprint.name} is completed and can't take new work. Reopen it first.`;
}

/**
 * The sprints this issue rolled over from: sprints it has left, that have since
 * been completed. Derived from the sprint rows in `activity_log` — every path
 * that reassigns an issue writes one, including the sweep at sprint completion.
 *
 * Restricting to completed sprints is what separates a rollover from a
 * correction: an issue filed against the wrong planning sprint and moved an
 * hour later never rolled over, and that sprint never closes with the issue in
 * it. Ordered like the sprint list, oldest first.
 *
 * Two field spellings, because the two write paths disagree: the board move
 * endpoint labels the row `sprint`, while `PUT /issues/:id` passes the column
 * name straight through as `sprint_id`. The sweep at sprint completion goes
 * through the PUT, so `sprint_id` is the spelling most rollovers carry.
 *
 * Ordered by when the issue *left* each sprint, which is the order someone
 * reading the ticket is reconstructing. Sorting on the sprints' own dates
 * cannot do it: a sprint's `start_date` is optional and `created_at` has second
 * resolution, so sprints made in one burst tie and come back in whatever order
 * the engine happens to scan. The tiebreaks are arbitrary but fixed, so the
 * line never reorders itself between two reads of the same issue.
 */
async function previousSprints(db, issue) {
  const moves = await queryAll(db,
    `SELECT old_value, created_at FROM activity_log
     WHERE issue_id = ? AND field IN ('sprint', 'sprint_id') AND old_value IS NOT NULL`,
    [issue.id]);

  // An issue can pass through the same sprint twice; the first exit is the one
  // that places it in the story.
  const leftAt = new Map();
  for (const move of moves) {
    const at = String(move.created_at ?? '');
    const seen = leftAt.get(move.old_value);
    if (seen === undefined || at < seen) leftAt.set(move.old_value, at);
  }

  const ids = [...leftAt.keys()].filter((id) => String(id) !== String(issue.sprint_id));
  if (ids.length === 0) return [];

  const sprints = await queryAll(db,
    `SELECT id, name, slug, created_at FROM sprints
     WHERE id IN (${placeholders(ids)}) AND status = 'completed'`, ids);

  sprints.sort((a, b) =>
    (leftAt.get(a.id) ?? '').localeCompare(leftAt.get(b.id) ?? '')
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    || String(a.id).localeCompare(String(b.id)));

  return sprints.map(({ id, name, slug }) => ({ id, name, slug }));
}

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
  const sprintIds = uniq(issues.map((i) => i.sprint_id));
  const versionIds = uniq(issues.map((i) => i.fix_version_id));
  const componentIds = uniq(issues.map((i) => i.component_id));

  const [users, parents, sprints, versions, components] = await Promise.all([
    userIds.length
      ? queryAll(db, `SELECT id, name, avatar_color FROM users WHERE id IN (${placeholders(userIds)})`, userIds)
      : [],
    parentIds.length
      ? queryAll(db, `SELECT id, issue_key, title, type, epic_color FROM issues WHERE id IN (${placeholders(parentIds)})`, parentIds)
      : [],
    sprintIds.length
      ? queryAll(db, `SELECT id, name, slug FROM sprints WHERE id IN (${placeholders(sprintIds)})`, sprintIds)
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
  const sprintById = indexBy(sprints, 'id');
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
    const sprint = issue.sprint_id ? sprintById.get(issue.sprint_id) : null;
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
      sprint_name: sprint?.name || null,
      sprint_slug: sprint?.slug || null,
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

// The single-issue payload carries one extra field the list payload does not:
// the sprints this issue rolled over from. Only the detail panel shows them, and
// a board of 100 issues should not pay for a history read each.
async function enrichIssue(db, issue) {
  const [enriched] = await enrichIssues(db, [issue]);
  enriched.previous_sprints = await previousSprints(db, issue);
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
    const enriched = await enrichIssues(db, issues);
    res.json(enriched);
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
    const parent = await queryOne(db, 'SELECT project_id FROM issues WHERE id = ?', [req.params.id]);
    if (!parent) return res.status(404).json({ error: 'Parent issue not found' });
    const children = await queryAll(db, 'SELECT * FROM issues WHERE parent_id = ? ORDER BY created_at', [req.params.id]);
    const enriched = await enrichIssues(db, children);
    res.json(enriched);
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

    const closedSprint = await completedSprintError(db, sprint_id || null, null);
    if (closedSprint) return res.status(409).json({ error: closedSprint });

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

    // A description written at creation time mentions people just as much as
    // one added later; only the edit path used to notice.
    if (description) {
      await notifyNewMentions(db, {
        text: description,
        actorId: req.userId,
        where: issue.issue_key,
        link: issueLink(issue.issue_key),
        issueId: issue.id,
      });
    }

    await runAutomation(db, { type: 'issue_created', issue, actorId: req.userId });
    issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [id]);
    auditLog({ userId: req.userId, action: 'Created issue', category: 'issues', entityType: 'issue', entityId: id, entityName: issue.issue_key, details: { title, type: type || 'task', priority: priority || 'medium' } });
    dispatchWebhook(db, req.params.projectId, 'issue.created', { id: issue.id, issue_key: issue.issue_key, title: issue.title, type: issue.type, status: issue.status });
    publish({ type: 'issue', action: 'created', projectId: req.params.projectId, issueId: issue.id, actorId: req.userId });
    const enriched = await enrichIssue(db, issue);
    res.status(201).json(enriched);
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
    const enriched = await enrichIssue(db, issue);
    res.json(enriched);
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/:id
router.get('/issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    const enriched = await enrichIssue(db, issue);
    const statuses = await projectStatuses(db, issue.project_id);
    const live = await liveInProgressMinutes(db, issue, statuses);
    enriched.in_progress_minutes_live = live ? live.minutes : null;
    // Whether that figure is working time or raw wall-clock. The UI must say
    // which; the same number means very different things.
    enriched.in_progress_business_hours = live ? live.clipped : null;
    res.json(enriched);
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

    const closedSprint = await completedSprintError(db, nextSprint, issue.sprint_id);
    if (closedSprint) return res.status(409).json({ error: closedSprint });

    if (req.body.epic_color !== undefined && !EPIC_COLORS.includes(req.body.epic_color)) {
      return res.status(400).json({ error: 'Invalid epic color' });
    }

    if (req.body.status !== undefined) {
      const statuses = await projectStatuses(db, issue.project_id);
      if (!statuses.some((s) => s.key === req.body.status)) {
        return res.status(400).json({ error: 'Unknown status for this project' });
      }
      // A parent cannot be completed over the top of its open children.
      const blocked = await completionBlock(db, issue, req.body.status, statuses);
      if (blocked) return res.status(409).json(blocked);
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

    // Only ids new to the description are notified, so correcting a typo does
    // not ping everyone a second time.
    if (req.body.description !== undefined && req.body.description !== issue.description) {
      await notifyNewMentions(db, {
        text: req.body.description,
        previousText: issue.description,
        actorId: req.userId,
        where: issue.issue_key,
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
        // Reaching done is positive evidence the work stopped, so close every
        // user's running segment — not just the actor's. Repair each
        // tracker's stale segments with the same earlier-day/workday-end
        // logic the userId-scoped branch already applies on every read
        // BEFORE the unconditional issueId-scoped close below — otherwise a
        // segment abandoned days ago gets closed at `now` and the whole
        // multi-day span (including weekends) is committed as tracked time.
        // Once that repair has run, anything still open can only be a
        // same-day segment (the person really was working right up to
        // Done), which the issueId-scoped call below closes unconditionally.
        const trackerIds = await issueTimerUserIds(db, updated.id);
        for (const trackerId of trackerIds) {
          await closeStaleSegments(db, { userId: trackerId });
        }
        await closeStaleSegments(db, { issueId: updated.id });

        // Explicitly tracked time is authoritative. Commit every tracker
        // first (this also closes/pauses their segments and writes their
        // work_logs rows), then decide based on the actual minutes tracked
        // — not merely on whether timer_segments rows exist — whether to
        // skip the status-derived calculation. A tracker who started and
        // immediately paused (0 elapsed minutes) commits nothing and must
        // not count as "a stopwatch was used"; otherwise the issue ends up
        // with neither auto nor timer time logged, permanently.
        let trackedMinutes = 0;
        for (const trackerId of trackerIds) {
          trackedMinutes += await commitTimer(db, updated.id, trackerId);
        }
        if (trackedMinutes > 0) {
          // A PRIOR done-transition (before any timer was used, or before
          // this tracked session) may have left a stale 'auto' row behind.
          // commitTimer only ever deletes source='timer' rows for its own
          // user, so without this the old auto row survives alongside the
          // new timer row and double-counts in time_spent and the reports.
          await run(db, "DELETE FROM work_logs WHERE issue_id = ? AND source = 'auto'", [updated.id]);
          await recomputeTimeSpent(db, updated.id);
        } else {
          // No tracker, or every tracker's session rounded to 0 minutes —
          // fall through to the derived calculation exactly as if the
          // stopwatch had never been touched.
          await applyAutoWorklog(db, updated, statuses, req.userId);
        }
      } else if (newCategory === 'todo') {
        // A genuine restart gives the derived calculation a clean slate.
        // Timer segments and their committed work logs are deliberately kept:
        // that time was really worked.
        await run(db, 'UPDATE issues SET auto_worklog_locked = 0 WHERE id = ?', [updated.id]);
      }

      updated = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.id]);
    }
    dispatchWebhook(db, updated.project_id, 'issue.updated', { id: updated.id, issue_key: updated.issue_key, title: updated.title, type: updated.type, status: updated.status });
    publish({ type: 'issue', action: 'updated', projectId: updated.project_id, issueId: updated.id, actorId: req.userId });
    const enriched = await enrichIssue(db, updated);
    res.json(enriched);
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
    // Time tracking cascades too. These were previously left behind, so every
    // deleted issue orphaned its work logs and timer segments. The reports all
    // JOIN issues so the rows stayed invisible rather than wrong, but they
    // accumulated forever and any future query that forgot the join would
    // silently count time against an issue nobody can open.
    await run(db, 'DELETE FROM work_logs WHERE issue_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM timer_segments WHERE issue_id = ?', [req.params.id]);
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
    if (sprint_id !== undefined) {
      const closedSprint = await completedSprintError(db, sprint_id, issue.sprint_id);
      if (closedSprint) return res.status(409).json({ error: closedSprint });
    }
    if (status !== undefined) {
      const statuses = await projectStatuses(db, issue.project_id);
      if (!statuses.some((s) => s.key === status)) {
        return res.status(400).json({ error: 'Unknown status for this project' });
      }
      // Dragging a card onto a done column is the same transition as picking
      // the status in the form, so it answers to the same guard.
      const blocked = await completionBlock(db, issue, status, statuses);
      if (blocked) return res.status(409).json(blocked);
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
    const enrichedMoved = await enrichIssue(db, updated);
    res.json(enrichedMoved);
  } catch (e) { serverError(res, e); }
});

module.exports = router;
