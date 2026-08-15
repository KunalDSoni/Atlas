// ===== SPRINTS MODULE =====
// GET    /api/projects/:id/sprints - List sprints for project (with issue stats)
// POST   /api/projects/:id/sprints - Create sprint
// GET    /api/sprints/:id - Get single sprint with stats
// PUT    /api/sprints/:id - Update sprint (name, goal, dates, status)
// POST   /api/sprints/:id/reopen - Reopen a completed sprint with a new end date
// DELETE /api/sprints/:id - Delete sprint (moves issues to the next sprint)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { slugify, uniqueSlug } = require('../utils/slug');

const requireBoardAdmin = requireRole('admin', 'board_admin');
const { auditLog } = require('../middleware/logger');
const { serverError } = require('../utils/errors');

const router = express.Router();

// A child counts as done when its literal status is 'done' (baked-in workflow) or
// the project's workflow maps its status to the done category. Same rule the epic
// rollup uses in routes/issues.js — a project whose done column is not literally
// 'done' must not have its sprints wedged shut.
const CHILD_DONE = `(child.status = 'done' OR EXISTS (
  SELECT 1 FROM project_statuses ps
  WHERE ps.project_id = child.project_id AND ps.key = child.status AND ps.category = 'done'))`;

// Jira lets you rename a completed sprint but not re-date or re-status one, and
// the only way back to active is POST /sprints/:id/reopen, which carries its own
// guards and its own audit entry. Only a *changed* value is refused: the edit
// dialog submits the whole record on every save, so refusing on mere presence
// would block the rename Jira allows.
function completedSprintFrozen(res, sprint, body = {}) {
  if (sprint.status !== 'completed') return false;
  const redated = ('start_date' in body && !sameDay(body.start_date, sprint.start_date))
    || ('end_date' in body && !sameDay(body.end_date, sprint.end_date));
  const restatused = 'status' in body && body.status !== sprint.status;
  if (!redated && !restatused) return false;
  res.status(409).json({ error: "A completed sprint's dates and status can't be changed. Reopen it first." });
  return true;
}

// A cleared date input arrives as '', the column holds NULL, and Postgres hands
// back a Date where SQLite hands back 'YYYY-MM-DD'. Compare on the day alone.
function sameDay(a, b) {
  return dayOf(a) === dayOf(b);
}

function dayOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// Jira refuses to complete a sprint while any work item in it has an unfinished
// subtask. parent_id carries both subtask->parent and story->epic links here, so
// this filters on type: an epic with unfinished stories must not block a sprint.
// The subtask itself can sit outside the sprint, so it looks at parentage rather
// than at the sprint's own issue list.
async function unfinishedSubtaskParents(db, sprintId) {
  const rows = await queryAll(db, `
    SELECT DISTINCT parent.issue_key AS issue_key
    FROM issues child
    JOIN issues parent ON child.parent_id = parent.id
    WHERE parent.sprint_id = ? AND child.type = 'subtask' AND NOT ${CHILD_DONE}
    ORDER BY parent.issue_key
  `, [sprintId]);
  return rows.map((row) => row.issue_key);
}

// Jira moves a deleted sprint's issues to the next sprint in the list rather than
// dropping them in the backlog; the backlog is the fallback when nothing follows.
// "The list" is the one GET returns, so this walks that exact ordering instead of
// re-deriving it — created_at has second resolution and ids are random UUIDs, so a
// separate comparison would order same-second sprints differently from the list
// the user is looking at.
async function nextSprintAfter(db, sprint) {
  const sprints = await queryAll(db,
    'SELECT id, name, status FROM sprints WHERE project_id = ? ORDER BY created_at',
    [sprint.project_id]);
  const index = sprints.findIndex((s) => s.id === sprint.id);
  if (index === -1) return null;
  return sprints.slice(index + 1).find((s) => s.status !== 'completed') || null;
}

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
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/sprints
router.post('/projects/:projectId/sprints', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const { name, goal, start_date, end_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Sprint name required' });

    const db = await getDb();
    const id = uuidv4();
    const taken = (await queryAll(db, 'SELECT slug FROM sprints WHERE project_id = ?', [req.params.projectId]))
      .map((row) => row.slug).filter(Boolean);
    const slug = uniqueSlug(slugify(name), taken);
    await run(db, 'INSERT INTO sprints (id, project_id, name, slug, goal, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, name, slug, goal || '', start_date || null, end_date || null]);

    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [id]);
    auditLog({ userId: req.userId, action: 'Created sprint', category: 'sprints', entityType: 'sprint', entityId: id, entityName: name });
    res.status(201).json(await enrichSprint(db, sprint));
  } catch (e) { serverError(res, e); }
});

// GET /api/sprints/:id
router.get('/sprints/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
    res.json(await enrichSprint(db, sprint));
  } catch (e) { serverError(res, e); }
});

// PUT /api/sprints/:id
router.put('/sprints/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
    if (completedSprintFrozen(res, sprint, req.body)) return;

    const { name, goal, start_date, end_date, status } = req.body;

    if (status === 'completed' && sprint.status !== 'completed') {
      const blocked = await unfinishedSubtaskParents(db, req.params.id);
      if (blocked.length > 0) {
        return res.status(409).json({
          error: `Finish or move the unfinished subtasks first (${blocked.join(', ')}).`,
          blocked_by: blocked,
        });
      }
    }

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
  } catch (e) { serverError(res, e); }
});

// POST /api/sprints/:id/reopen
// Reopening exists for the case Atlassian documents it for: the wrong sprint was
// completed, or the right one was completed too early. Jira gates reopening
// alongside an active sprint behind its parallel-sprints setting; Atlas has no
// such setting and the board resolves exactly one sprint, so a second active
// sprint would simply be invisible. Refused outright instead.
router.post('/sprints/:id/reopen', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
    if (sprint.status !== 'completed') {
      return res.status(409).json({ error: 'Only completed sprints can be reopened.' });
    }

    const active = await queryOne(db,
      "SELECT id FROM sprints WHERE project_id = ? AND status = 'active'", [sprint.project_id]);
    if (active) {
      return res.status(409).json({ error: 'Another sprint is already active. Complete it before reopening this one.' });
    }

    // Jira asks for a new end date on reopen and the sprint report reads from it.
    // Without one the sprint comes back already overdue.
    const { end_date } = req.body || {};
    if (!end_date || Number.isNaN(Date.parse(end_date))) {
      return res.status(400).json({ error: 'A new end date is required to reopen a sprint.' });
    }

    await run(db, "UPDATE sprints SET status = 'active', end_date = ? WHERE id = ?", [end_date, req.params.id]);
    const updated = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    auditLog({ userId: req.userId, action: 'Sprint reopened', category: 'sprints', entityType: 'sprint', entityId: req.params.id, entityName: updated.name, details: { from: 'completed', to: 'active', end_date } });
    res.json(await enrichSprint(db, updated));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/sprints/:id
router.delete('/sprints/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (sprint) {
      if (sprint.status === 'completed') {
        return res.status(409).json({ error: 'This sprint is completed. Completed sprints are read-only.' });
      }
      // Jira has no delete for a running sprint — completing it is the way out.
      if (sprint.status === 'active') {
        return res.status(409).json({ error: "An active sprint can't be deleted. Complete it instead." });
      }
    }

    const next = sprint ? await nextSprintAfter(db, sprint) : null;
    await run(db, 'UPDATE issues SET sprint_id = ? WHERE sprint_id = ?', [next ? next.id : null, req.params.id]);
    await run(db, 'DELETE FROM sprints WHERE id = ?', [req.params.id]);
    auditLog({ userId: req.userId, action: 'Deleted sprint', category: 'sprints', entityType: 'sprint', entityId: req.params.id, entityName: sprint ? sprint.name : req.params.id, details: next ? { moved_to: next.name } : { moved_to: 'Backlog' } });
    res.json({ ok: true, moved_to: next ? next.id : null, moved_to_name: next ? next.name : null });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
