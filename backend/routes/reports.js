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

const router = express.Router();

// ===== SPRINT REPORT =====
router.get('/projects/:projectId/reports/sprint', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprints = queryAll(db, 'SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at DESC', [req.params.projectId]);

    const report = sprints.map(s => {
      const issues = queryAll(db, 'SELECT * FROM issues WHERE sprint_id = ?', [s.id]);
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
    });

    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== VELOCITY CHART =====
router.get('/projects/:projectId/reports/velocity', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprints = queryAll(db, "SELECT * FROM sprints WHERE project_id = ? AND status IN ('active','completed') ORDER BY created_at", [req.params.projectId]);

    const velocity = sprints.map(s => {
      const stats = queryOne(db, `
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
    });

    const avgVelocity = velocity.length > 0
      ? Math.round(velocity.reduce((s, v) => s + v.completed_points, 0) / velocity.length)
      : 0;

    res.json({ sprints: velocity, average_velocity: avgVelocity });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== TEAM WORKLOAD =====
router.get('/projects/:projectId/reports/workload', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const members = queryAll(db, `
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
    const unassigned = queryOne(db, `
      SELECT COUNT(*) as total,
        COALESCE(SUM(story_points), 0) as points
      FROM issues WHERE project_id = ? AND assignee_id IS NULL
    `, [req.params.projectId]);

    res.json({ members, unassigned: { total: unassigned.total, points: unassigned.points } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== RESOLUTION METRICS =====
router.get('/projects/:projectId/reports/resolution', requireAuth, async (req, res) => {
  try {
    const db = await getDb();

    // Issues resolved (done)
    const resolved = queryAll(db, `
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
    const byPriority = queryAll(db, `
      SELECT priority,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as resolved,
        ROUND(AVG(CASE WHEN status = 'done' THEN julianday(updated_at) - julianday(created_at) END), 1) as avg_days
      FROM issues WHERE project_id = ?
      GROUP BY priority
    `, [req.params.projectId]);

    // By type
    const byType = queryAll(db, `
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== BURNDOWN =====
router.get('/projects/:projectId/reports/burndown', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const sprint = queryOne(db, "SELECT * FROM sprints WHERE project_id = ? AND status = 'active'", [req.params.projectId]);
    if (!sprint) return res.json({ sprint: null, data: [] });

    const issues = queryAll(db, 'SELECT * FROM issues WHERE sprint_id = ?', [sprint.id]);
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CREATED vs RESOLVED TREND =====
router.get('/projects/:projectId/reports/created-vs-resolved', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const created = queryAll(db, `
      SELECT date(created_at) as day, COUNT(*) as count
      FROM issues WHERE project_id = ?
      GROUP BY date(created_at) ORDER BY day
    `, [req.params.projectId]);

    const resolved = queryAll(db, `
      SELECT date(updated_at) as day, COUNT(*) as count
      FROM issues WHERE project_id = ? AND status = 'done'
      GROUP BY date(updated_at) ORDER BY day
    `, [req.params.projectId]);

    res.json({ created, resolved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== TYPE DISTRIBUTION =====
router.get('/projects/:projectId/reports/type-distribution', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const data = queryAll(db, `
      SELECT type, status, COUNT(*) as count, COALESCE(SUM(story_points),0) as points
      FROM issues WHERE project_id = ?
      GROUP BY type, status
    `, [req.params.projectId]);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== PRIORITY DISTRIBUTION =====
router.get('/projects/:projectId/reports/priority-distribution', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const data = queryAll(db, `
      SELECT priority, status, COUNT(*) as count, COALESCE(SUM(story_points),0) as points
      FROM issues WHERE project_id = ?
      GROUP BY priority, status
    `, [req.params.projectId]);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CSV EXPORT =====
router.get('/projects/:projectId/reports/export/csv', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const project = queryOne(db, 'SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const issues = queryAll(db, `
      SELECT i.issue_key, i.title, i.type, i.status, i.priority, i.story_points,
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

    const headers = ['Key', 'Title', 'Type', 'Status', 'Priority', 'Story Points', 'Assignee', 'Reporter', 'Sprint', 'Created', 'Updated'];
    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = [headers.join(',')];
    issues.forEach(i => {
      rows.push([
        i.issue_key, escape(i.title), i.type, i.status, i.priority,
        i.story_points || '', i.assignee || 'Unassigned', i.reporter || '',
        i.sprint || 'Backlog', i.created_at, i.updated_at
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${project.key}-issues.csv"`);
    res.send(rows.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
