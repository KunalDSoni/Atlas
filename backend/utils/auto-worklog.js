// ===== AUTO WORK LOG =====
// Derives a work_logs 'auto' row from activity_log status transitions instead
// of requiring manual entry. Triggered on completion (utils used by
// routes/issues.js); no timers, no polling — recomputed on write, read the
// same way the cycle-time/time-in-status reports already do
// (routes/reports.js's loadFlowData + utils/flow.js's statusTimeline).

const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, run } = require('../database');
const { categoryOf, statusTimeline, businessMinutesBetween, resolveBusinessHours } = require('./flow');
const { recomputeTimeSpent } = require('./worklog-sync');

async function inProgressSegments(db, issue, statuses) {
  const transitions = await queryAll(db,
    "SELECT old_value, new_value, created_at FROM activity_log WHERE issue_id = ? AND field = 'status' ORDER BY created_at",
    [issue.id]);
  const timeline = statusTimeline(issue, transitions);
  return timeline.filter((seg) => categoryOf(seg.status, statuses) === 'in_progress');
}

async function resolvedProfileFor(db, issue, userId) {
  const [project, user] = await Promise.all([
    queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [issue.project_id]),
    userId ? queryOne(db, 'SELECT business_hours FROM users WHERE id = ?', [userId]) : null,
  ]);
  return resolveBusinessHours(project?.business_hours, user?.business_hours);
}

/**
 * Sums business-hours-clipped in-progress time and (re)writes a single
 * source='auto' work_logs row, unless issue.auto_worklog_locked is set (a
 * human already corrected/deleted the auto entry for this issue — see
 * routes/worklogs.js PATCH/DELETE).
 *
 * `fallbackActorId` is used as the work log's user_id when the issue has no
 * assignee (matches the base spec's unassigned-issue rule).
 */
async function applyAutoWorklog(db, issue, statuses, fallbackActorId) {
  if (Number(issue.auto_worklog_locked)) return;

  const segments = (await inProgressSegments(db, issue, statuses))
    .filter((seg) => seg.to !== null); // completed segments only; the final open segment is handled by liveInProgressMinutes
  const attributedUserId = issue.assignee_id || fallbackActorId || issue.reporter_id;
  const profile = await resolvedProfileFor(db, issue, attributedUserId);

  const totalMinutes = Math.round(
    segments.reduce((sum, seg) => sum + businessMinutesBetween(seg.from, seg.to, profile), 0)
  );

  await run(db, "DELETE FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issue.id]);
  if (totalMinutes > 0) {
    await run(db,
      "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'auto')",
      [uuidv4(), issue.id, attributedUserId, totalMinutes, 'Auto-logged: time in progress']);
  }
  await recomputeTimeSpent(db, issue.id);
}

/**
 * Live (uncommitted) in-progress minutes for an issue currently sitting in an
 * in_progress-category status, measured against now. Null when the issue's
 * current status isn't in that category — nothing to show.
 */
async function liveInProgressMinutes(db, issue, statuses) {
  if (categoryOf(issue.status, statuses) !== 'in_progress') return null;

  const segments = await inProgressSegments(db, issue, statuses);
  const openSegment = segments.find((seg) => seg.to === null);
  if (!openSegment) return null;

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const attributedUserId = issue.assignee_id;
  const profile = await resolvedProfileFor(db, issue, attributedUserId);

  const closedTotal = segments
    .filter((seg) => seg.to !== null)
    .reduce((sum, seg) => sum + businessMinutesBetween(seg.from, seg.to, profile), 0);
  const openMinutes = businessMinutesBetween(openSegment.from, now, profile);
  return Math.round(closedTotal + openMinutes);
}

module.exports = { inProgressSegments, applyAutoWorklog, liveInProgressMinutes };
