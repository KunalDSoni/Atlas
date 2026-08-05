// ===== REPORTS MODULE =====
// GET /api/projects/:id/reports/sprint      - Sprint report (current + history)
// GET /api/projects/:id/reports/velocity     - Velocity across sprints
// GET /api/projects/:id/reports/workload     - Team workload breakdown
// GET /api/projects/:id/reports/resolution   - Issue resolution metrics
// GET /api/projects/:id/reports/burndown     - Burndown data for active sprint
// GET /api/projects/:id/reports/created-vs-resolved - Creation vs resolution trend
// GET /api/projects/:id/reports/type-distribution   - Issue type breakdown
// GET /api/projects/:id/reports/priority-distribution - Priority breakdown
// GET /api/projects/:id/reports/export/csv   - Export issues as CSV

const express = require('express');
const { getDb, queryAll, queryOne } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { projectStatuses } = require('./workflows');
const { categoryOf, statusTimeline, hoursBetween, percentile } = require('../utils/flow');

const router = express.Router();

// ===== SPRINT REPORT =====
router.get('/projects/:projectId/reports/sprint', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprints = await queryAll(db, 'SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at DESC', [req.params.projectId]);

    const report = await Promise.all(sprints.map(async s => {
      const issues = await queryAll(db, 'SELECT * FROM issues WHERE sprint_id = ?', [s.id]);
      const done = issues.filter(i => i.status === 'done');
      const notDone = issues.filter(i => i.status !== 'done');
      const totalPoints = issues.reduce((sum, i) => sum + (i.story_points || 0), 0);
      const donePoints = done.reduce((sum, i) => sum + (i.story_points || 0), 0);
      const notDonePoints = notDone.reduce((sum, i) => sum + (i.story_points || 0), 0);

      return {
        id: s.id,
        name: s.name,
        status: s.status,
        start_date: s.start_date,
        end_date: s.end_date,
        goal: s.goal,
        total_issues: issues.length,
        completed_issues: done.length,
        incomplete_issues: notDone.length,
        total_points: totalPoints,
        completed_points: donePoints,
        incomplete_points: notDonePoints,
        completion_rate: issues.length > 0 ? Math.round((done.length / issues.length) * 100) : 0,
        completed: done.map(i => ({ id: i.id, key: i.issue_key, title: i.title, type: i.type, points: i.story_points || 0 })),
        incomplete: notDone.map(i => ({ id: i.id, key: i.issue_key, title: i.title, type: i.type, status: i.status, points: i.story_points || 0 })),
      };
    }));

    res.json(report);
  } catch (e) { serverError(res, e); }
});

// ===== VELOCITY CHART =====
router.get('/projects/:projectId/reports/velocity', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprints = await queryAll(db, "SELECT * FROM sprints WHERE project_id = ? AND status IN ('active','completed') ORDER BY created_at", [req.params.projectId]);

    const velocity = await Promise.all(sprints.map(async s => {
      const stats = await queryOne(db, `
        SELECT COUNT(*) as total,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
          COALESCE(SUM(story_points), 0) as total_points,
          COALESCE(SUM(CASE WHEN status = 'done' THEN story_points ELSE 0 END), 0) as done_points
        FROM issues WHERE sprint_id = ?
      `, [s.id]);
      return {
        sprint: s.name,
        sprint_id: s.id,
        status: s.status,
        committed_points: stats.total_points,
        completed_points: stats.done_points,
        committed_issues: stats.total,
        completed_issues: stats.done,
      };
    }));

    const avgVelocity = velocity.length > 0
      ? Math.round(velocity.reduce((s, v) => s + v.completed_points, 0) / velocity.length)
      : 0;

    res.json({ sprints: velocity, average_velocity: avgVelocity });
  } catch (e) { serverError(res, e); }
});

// ===== TEAM WORKLOAD =====
router.get('/projects/:projectId/reports/workload', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const members = await queryAll(db, `
      SELECT u.id, u.name, u.avatar_color, u.job_title,
        COUNT(i.id) as total_issues,
        SUM(CASE WHEN i.status = 'todo' THEN 1 ELSE 0 END) as todo,
        SUM(CASE WHEN i.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN i.status = 'in_review' THEN 1 ELSE 0 END) as in_review,
        SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END) as done,
        COALESCE(SUM(i.story_points), 0) as total_points,
        COALESCE(SUM(CASE WHEN i.status = 'done' THEN i.story_points ELSE 0 END), 0) as done_points
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      LEFT JOIN issues i ON i.assignee_id = u.id AND i.project_id = ?
      WHERE pm.project_id = ?
      GROUP BY u.id
      ORDER BY total_issues DESC
    `, [req.params.projectId, req.params.projectId]);

    // Unassigned issues
    const unassigned = await queryOne(db, `
      SELECT COUNT(*) as total,
        COALESCE(SUM(story_points), 0) as points
      FROM issues WHERE project_id = ? AND assignee_id IS NULL
    `, [req.params.projectId]);

    res.json({ members, unassigned: { total: unassigned.total, points: unassigned.points } });
  } catch (e) { serverError(res, e); }
});

// ===== RESOLUTION METRICS =====
router.get('/projects/:projectId/reports/resolution', requireAuth, async (req, res) => {
  try {
    const db = await getDb();

    // Issues resolved (done)
    const resolved = await queryAll(db, `
      SELECT id, issue_key, title, type, priority, story_points,
        created_at, updated_at,
        ROUND(julianday(updated_at) - julianday(created_at), 1) as days_to_resolve
      FROM issues WHERE project_id = ? AND status = 'done'
      ORDER BY updated_at DESC
    `, [req.params.projectId]);

    const avgDays = resolved.length > 0
      ? Math.round(resolved.reduce((s, i) => s + (i.days_to_resolve || 0), 0) / resolved.length * 10) / 10
      : 0;

    // By priority
    const byPriority = await queryAll(db, `
      SELECT priority,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as resolved,
        ROUND(AVG(CASE WHEN status = 'done' THEN julianday(updated_at) - julianday(created_at) END), 1) as avg_days
      FROM issues WHERE project_id = ?
      GROUP BY priority
    `, [req.params.projectId]);

    // By type
    const byType = await queryAll(db, `
      SELECT type,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as resolved,
        ROUND(AVG(CASE WHEN status = 'done' THEN julianday(updated_at) - julianday(created_at) END), 1) as avg_days
      FROM issues WHERE project_id = ?
      GROUP BY type
    `, [req.params.projectId]);

    res.json({
      total_resolved: resolved.length,
      avg_resolution_days: avgDays,
      by_priority: byPriority,
      by_type: byType,
      recent_resolved: resolved.slice(0, 10),
    });
  } catch (e) { serverError(res, e); }
});

// ===== BURNDOWN =====
router.get('/projects/:projectId/reports/burndown', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = await queryOne(db, "SELECT * FROM sprints WHERE project_id = ? AND status = 'active'", [req.params.projectId]);
    if (!sprint) return res.json({ sprint: null, data: [] });

    const issues = await queryAll(db, 'SELECT * FROM issues WHERE sprint_id = ?', [sprint.id]);
    const totalPoints = issues.reduce((s, i) => s + (i.story_points || 0), 0);

    // Generate daily burndown from sprint start to end
    const start = new Date(sprint.start_date);
    const end = new Date(sprint.end_date);
    const today = new Date();
    const data = [];
    const totalDays = Math.ceil((end - start) / 864e5);
    const idealPerDay = totalPoints / (totalDays || 1);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const ideal = Math.max(0, totalPoints - idealPerDay * Math.ceil((d - start) / 864e5));

      // Actual: count remaining points for issues not done by this date
      let actual = null;
      if (d <= today) {
        const doneByDate = issues.filter(i =>
          i.status === 'done' && i.updated_at && i.updated_at.split('T')[0] <= dateStr
        );
        const donePoints = doneByDate.reduce((s, i) => s + (i.story_points || 0), 0);
        actual = totalPoints - donePoints;
      }

      data.push({ date: dateStr, ideal: Math.round(ideal * 10) / 10, actual });
    }

    res.json({ sprint: { id: sprint.id, name: sprint.name, start_date: sprint.start_date, end_date: sprint.end_date, total_points: totalPoints }, data });
  } catch (e) { serverError(res, e); }
});

// ===== EPIC REPORT =====
router.get('/projects/:projectId/reports/epics/:epicId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const epic = await queryOne(db, 'SELECT * FROM issues WHERE id = ? AND type = ? AND project_id = ?', [req.params.epicId, 'epic', req.params.projectId]);
    if (!epic) return res.status(404).json({ error: 'Epic not found' });

    const children = await queryAll(db, 'SELECT id, issue_key, title, status, story_points, created_at, updated_at FROM issues WHERE parent_id = ? AND project_id = ? ORDER BY board_order', [epic.id, req.params.projectId]);
    const done = children.filter(i => i.status === 'done');
    const totalPoints = children.reduce((s, i) => s + (i.story_points || 0), 0);
    const donePoints = done.reduce((s, i) => s + (i.story_points || 0), 0);

    // Compute daily burndown from epic's created_at to today
    const start = new Date(epic.created_at);
    const today = new Date();
    const burndown = [];

    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const doneByDate = children.filter(c =>
        c.status === 'done' && c.updated_at && c.updated_at.split('T')[0] <= dateStr
      );
      const donePts = doneByDate.reduce((s, c) => s + (c.story_points || 0), 0);
      burndown.push({ date: dateStr, remaining_points: totalPoints - donePts });
    }

    res.json({
      epic: { id: epic.id, name: epic.title, created_at: epic.created_at },
      children: children.map(c => ({ id: c.id, issue_key: c.issue_key, title: c.title, status: c.status, points: c.story_points || 0 })),
      done_count: done.length,
      total_count: children.length,
      done_points: donePoints,
      total_points: totalPoints,
      burndown: burndown
    });
  } catch (e) { serverError(res, e); }
});

// ===== CREATED vs RESOLVED TREND =====
router.get('/projects/:projectId/reports/created-vs-resolved', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const created = await queryAll(db, `
      SELECT date(created_at) as day, COUNT(*) as count
      FROM issues WHERE project_id = ?
      GROUP BY date(created_at) ORDER BY day
    `, [req.params.projectId]);

    const resolved = await queryAll(db, `
      SELECT date(updated_at) as day, COUNT(*) as count
      FROM issues WHERE project_id = ? AND status = 'done'
      GROUP BY date(updated_at) ORDER BY day
    `, [req.params.projectId]);

    res.json({ created, resolved });
  } catch (e) { serverError(res, e); }
});

// ===== TYPE DISTRIBUTION =====
router.get('/projects/:projectId/reports/type-distribution', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const data = await queryAll(db, `
      SELECT type, status, COUNT(*) as count, COALESCE(SUM(story_points),0) as points
      FROM issues WHERE project_id = ?
      GROUP BY type, status
    `, [req.params.projectId]);
    res.json(data);
  } catch (e) { serverError(res, e); }
});

// ===== PRIORITY DISTRIBUTION =====
router.get('/projects/:projectId/reports/priority-distribution', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const data = await queryAll(db, `
      SELECT priority, status, COUNT(*) as count, COALESCE(SUM(story_points),0) as points
      FROM issues WHERE project_id = ?
      GROUP BY priority, status
    `, [req.params.projectId]);
    res.json(data);
  } catch (e) { serverError(res, e); }
});

// ===== CSV EXPORT =====
// ===== FLOW METRICS (ATLAS-33) =====
// All three endpoints share the same two reads: the project's issues and their
// status transitions. History predating move-logging is sparse; metrics use
// created_at as entry into the first observed status and never fabricate rows.

async function loadFlowData(db, projectId) {
  const issues = await queryAll(db,
    'SELECT id, issue_key, title, type, status, created_at FROM issues WHERE project_id = ?', [projectId]);
  const transitions = issues.length === 0 ? [] : await queryAll(db, `
    SELECT a.issue_id, a.old_value, a.new_value, a.created_at
    FROM activity_log a JOIN issues i ON i.id = a.issue_id
    WHERE i.project_id = ? AND a.field = 'status'
    ORDER BY a.created_at`, [projectId]);
  const byIssue = new Map(issues.map((i) => [i.id, []]));
  for (const t of transitions) byIssue.get(t.issue_id)?.push(t);
  return { issues, byIssue };
}

router.get('/projects/:projectId/reports/cycle-time', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const { issues, byIssue } = await loadFlowData(db, req.params.projectId);

    const rows = [];
    for (const issue of issues) {
      if (categoryOf(issue.status, statuses) !== 'done') continue;
      const trans = byIssue.get(issue.id) || [];
      const doneEntry = trans.find((t) => categoryOf(t.new_value, statuses) === 'done');
      if (!doneEntry) continue; // legacy issue with no recorded completion
      const progressEntry = trans.find((t) => categoryOf(t.new_value, statuses) === 'in_progress');
      rows.push({
        id: issue.id,
        issue_key: issue.issue_key,
        title: issue.title,
        type: issue.type,
        completed_at: doneEntry.created_at,
        lead_time_h: hoursBetween(issue.created_at, doneEntry.created_at),
        cycle_time_h: progressEntry && hoursBetween(progressEntry.created_at, doneEntry.created_at) >= 0
          ? hoursBetween(progressEntry.created_at, doneEntry.created_at)
          : null,
      });
    }

    const cycles = rows.map((r) => r.cycle_time_h).filter((c) => c !== null).sort((a, b) => a - b);
    const leads = rows.map((r) => r.lead_time_h).sort((a, b) => a - b);
    const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    res.json({
      issues: rows.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1)).slice(0, 50),
      avg_cycle_h: avg(cycles),
      p50_cycle_h: percentile(cycles, 0.5),
      p85_cycle_h: percentile(cycles, 0.85),
      avg_lead_h: avg(leads),
      count: rows.length,
    });
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/time-in-status', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const { issues, byIssue } = await loadFlowData(db, req.params.projectId);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const acc = new Map(); // status -> { total_h, issues:Set }
    for (const issue of issues) {
      const timeline = statusTimeline(issue, byIssue.get(issue.id) || []);
      for (const seg of timeline) {
        // Open segments in a done-category status are excluded: time after
        // completion is not time "in" the workflow.
        const isOpenDone = seg.to === null && categoryOf(seg.status, statuses) === 'done';
        if (isOpenDone) continue;
        const h = hoursBetween(seg.from, seg.to ?? now);
        if (h <= 0) continue;
        if (!acc.has(seg.status)) acc.set(seg.status, { total_h: 0, issues: new Set() });
        const slot = acc.get(seg.status);
        slot.total_h += h;
        slot.issues.add(issue.id);
      }
    }

    const order = new Map(statuses.map((s, i) => [s.key, i]));
    res.json({
      statuses: [...acc.entries()]
        .map(([status, v]) => ({
          status,
          total_h: Math.round(v.total_h * 10) / 10,
          avg_h: Math.round((v.total_h / v.issues.size) * 10) / 10,
          issues: v.issues.size,
        }))
        .sort((a, b) => (order.get(a.status) ?? 99) - (order.get(b.status) ?? 99)),
    });
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/cumulative-flow', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const { issues, byIssue } = await loadFlowData(db, req.params.projectId);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);

    const timelines = issues.map((i) => ({
      created: i.created_at,
      segments: statusTimeline(i, byIssue.get(i.id) || []),
    }));

    const out = [];
    for (let d = days - 1; d >= 0; d--) {
      const day = new Date(Date.now() - d * 86_400_000);
      // Count state at end-of-day so today's moves are visible today.
      const stamp = day.toISOString().slice(0, 10) + ' 23:59:59';
      const counts = { todo: 0, in_progress: 0, done: 0 };
      for (const t of timelines) {
        if (t.created > stamp) continue; // not created yet on this day
        const seg = t.segments.find((s) => s.from <= stamp && (s.to === null || s.to > stamp));
        if (seg) counts[categoryOf(seg.status, statuses)] += 1;
      }
      out.push({ date: day.toISOString().slice(0, 10), ...counts });
    }
    res.json({ days: out });
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/export/csv', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const issues = await queryAll(db, `
      SELECT i.issue_key, i.title, i.type, i.status, i.priority, i.story_points, i.time_spent,
        i.created_at, i.updated_at,
        u1.name as assignee, u2.name as reporter,
        s.name as sprint
      FROM issues i
      LEFT JOIN users u1 ON i.assignee_id = u1.id
      LEFT JOIN users u2 ON i.reporter_id = u2.id
      LEFT JOIN sprints s ON i.sprint_id = s.id
      WHERE i.project_id = ?
      ORDER BY i.issue_number
    `, [req.params.projectId]);

    const headers = ['Key', 'Title', 'Type', 'Status', 'Priority', 'Story Points', 'Time Spent (min)', 'Assignee', 'Reporter', 'Sprint', 'Created', 'Updated'];
    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = [headers.join(',')];
    issues.forEach(i => {
      rows.push([
        i.issue_key, escape(i.title), i.type, i.status, i.priority,
        i.story_points || '', i.time_spent || 0, i.assignee || 'Unassigned', i.reporter || '',
        i.sprint || 'Backlog', i.created_at, i.updated_at
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${project.key}-issues.csv"`);
    res.send(rows.join('\n'));
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/time-tracking', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, `
      SELECT i.sprint_id, s.name AS sprint_name, i.assignee_id AS user_id, u.name,
             w.source, w.minutes
      FROM work_logs w
      JOIN issues i ON i.id = w.issue_id
      LEFT JOIN sprints s ON s.id = i.sprint_id
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.project_id = ?`, [req.params.projectId]);

    const bySprint = new Map();
    const byUser = new Map();
    for (const r of rows) {
      const minutes = Number(r.minutes);
      const sprintKey = r.sprint_id || 'backlog';
      if (!bySprint.has(sprintKey)) {
        bySprint.set(sprintKey, { sprint_id: r.sprint_id, sprint_name: r.sprint_name || 'Backlog', auto_minutes: 0, manual_minutes: 0 });
      }
      bySprint.get(sprintKey)[r.source === 'auto' ? 'auto_minutes' : 'manual_minutes'] += minutes;

      const userKey = r.user_id || 'unassigned';
      if (!byUser.has(userKey)) {
        byUser.set(userKey, { user_id: r.user_id, name: r.name || 'Unassigned', auto_minutes: 0, manual_minutes: 0 });
      }
      byUser.get(userKey)[r.source === 'auto' ? 'auto_minutes' : 'manual_minutes'] += minutes;
    }

    const finalize = (m) => [...m.values()].map((v) => ({ ...v, total_minutes: v.auto_minutes + v.manual_minutes }));
    res.json({ by_sprint: finalize(bySprint), by_user: finalize(byUser) });
  } catch (e) { serverError(res, e); }
});

router.get('/projects/:projectId/reports/time-tracking/export/csv', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Reuse the same aggregation as the JSON endpoint above.
    const rows = await queryAll(db, `
      SELECT i.sprint_id, s.name AS sprint_name, i.assignee_id AS user_id, u.name,
             w.source, w.minutes
      FROM work_logs w
      JOIN issues i ON i.id = w.issue_id
      LEFT JOIN sprints s ON s.id = i.sprint_id
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.project_id = ?`, [req.params.projectId]);

    const bySprint = new Map();
    const byUser = new Map();
    for (const r of rows) {
      const minutes = Number(r.minutes);
      const sprintKey = r.sprint_id || 'backlog';
      if (!bySprint.has(sprintKey)) bySprint.set(sprintKey, { name: r.sprint_name || 'Backlog', auto: 0, manual: 0 });
      bySprint.get(sprintKey)[r.source === 'auto' ? 'auto' : 'manual'] += minutes;
      const userKey = r.user_id || 'unassigned';
      if (!byUser.has(userKey)) byUser.set(userKey, { name: r.name || 'Unassigned', auto: 0, manual: 0 });
      byUser.get(userKey)[r.source === 'auto' ? 'auto' : 'manual'] += minutes;
    }

    const lines = ['Sprint,Auto Minutes,Manual Minutes,Total Minutes'];
    for (const s of bySprint.values()) lines.push([s.name, s.auto, s.manual, s.auto + s.manual].join(','));
    lines.push('');
    lines.push('User,Auto Minutes,Manual Minutes,Total Minutes');
    for (const u of byUser.values()) lines.push([u.name, u.auto, u.manual, u.auto + u.manual].join(','));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${project.key}-time-tracking.csv"`);
    res.send(lines.join('\n'));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
