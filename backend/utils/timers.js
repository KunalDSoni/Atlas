// ===== ISSUE STOPWATCH =====
// Explicit start/pause time tracking, stored as append-only segments in
// timer_segments. A segment's started_at is written once and its ended_at once
// on pause; nothing is ever updated after that, so totals are always summed on
// read and there is no accumulator a crash can desynchronise.
//
// Unlike utils/auto-worklog.js, segment durations are RAW WALL-CLOCK and are
// never business-hours clipped. Clipping exists to stop wall-clock *inference*
// from overcounting a weekend; it has no business overriding a human who
// explicitly pressed Start at 9pm.
//
// No cron. Abandoned segments are repaired lazily by closeStaleSegments on the
// next read or write, matching the philosophy in utils/sla.js.

const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, run } = require('../database');
const { resolveBusinessHours, localMidnightUtc, isoWeekdayInTz } = require('./flow');
const { recomputeTimeSpent } = require('./worklog-sync');

// A running segment past this many minutes is surfaced to the user as
// suspicious. It drives a UI warning only and never changes stored data, so it
// is safe to tune without a migration.
const RUNAWAY_MINUTES = 720;

/** Current time in the project's stored datetime format. */
function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Parse a stored datetime string ('YYYY-MM-DD HH:MM:SS' or ISO) as a UTC Date. */
function parseUtc(s) {
  return new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));
}

/** Raw wall-clock minutes of a segment; an open segment is measured to `now`. */
function segmentMinutes(seg, now) {
  const start = parseUtc(seg.started_at);
  const end = seg.ended_at ? parseUtc(seg.ended_at) : now;
  return Math.max(0, (end - start) / 60_000);
}

async function profileForIssue(db, issueId, userId) {
  const issue = await queryOne(db, 'SELECT project_id FROM issues WHERE id = ?', [issueId]);
  if (!issue) return null;
  const [project, user] = await Promise.all([
    queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [issue.project_id]),
    queryOne(db, 'SELECT business_hours FROM users WHERE id = ?', [userId]),
  ]);
  return resolveBusinessHours(project?.business_hours, user?.business_hours);
}

/**
 * The UTC instant at which the working day containing `startedAt` ends, or
 * null when no defensible boundary exists — because no profile is configured,
 * because that day is not a work day, or because the segment started after
 * close. Returning null is deliberate: the business-hours spec forbids
 * fabricating an implicit default, so an unjustifiable boundary must degrade
 * to the runaway warning rather than invent a cutoff.
 */
function workdayEndFor(startedAt, profile) {
  if (!profile) return null;
  const start = parseUtc(startedAt);
  const midnight = localMidnightUtc(start, profile.timezone);
  if (!profile.work_days.includes(isoWeekdayInTz(start, profile.timezone))) return null;
  const end = new Date(midnight.getTime() + profile.end_hour * 3_600_000);
  if (end <= start) return null;
  return end;
}

/**
 * Repair abandoned open segments.
 *
 * `{ issueId }` — closes every open segment on the issue at `now`,
 * unconditionally. Used by the Done path: reaching a done-category status is
 * positive evidence the work stopped.
 *
 * `{ userId }` — closes only segments that started on an EARLIER local
 * calendar day, at that day's business-day end. The earlier-day condition is
 * essential: without it, someone who starts at 4pm under a 9-6 profile and is
 * still working at 7pm would have their live, actively running timer truncated
 * to 6pm the moment they loaded the page. A same-day timer running past
 * business hours means the person is still working.
 *
 * Returns the number of segments closed.
 */
async function closeStaleSegments(db, { userId, issueId } = {}) {
  if (issueId) {
    const open = await queryAll(db,
      'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [issueId]);
    for (const seg of open) {
      await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?', [nowStamp(), seg.id]);
    }
    return open.length;
  }

  if (!userId) return 0;
  const open = await queryAll(db,
    'SELECT * FROM timer_segments WHERE user_id = ? AND ended_at IS NULL', [userId]);

  let closed = 0;
  const now = new Date();
  for (const seg of open) {
    const profile = await profileForIssue(db, seg.issue_id, userId);
    if (!profile) continue; // no profile: leave open, surface as runaway instead

    const startMidnight = localMidnightUtc(parseUtc(seg.started_at), profile.timezone);
    const nowMidnight = localMidnightUtc(now, profile.timezone);
    if (startMidnight.getTime() >= nowMidnight.getTime()) continue; // same local day: still working

    const end = workdayEndFor(seg.started_at, profile);
    if (!end) continue; // no defensible boundary; runaway warning covers it

    await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?',
      [end.toISOString().slice(0, 19).replace('T', ' '), seg.id]);
    closed += 1;
  }
  return closed;
}

/** Open a segment, first closing this user's open segment on any other issue. */
async function startTimer(db, issueId, userId) {
  await closeStaleSegments(db, { userId });

  const existing = await queryOne(db,
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ? AND ended_at IS NULL',
    [issueId, userId]);
  if (existing) return { paused_issue: null }; // already running here; no duplicate

  // One running timer per user, globally. Enforced here rather than by a
  // partial unique index because MySQL has no partial indexes.
  const otherOpen = await queryAll(db,
    'SELECT * FROM timer_segments WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC', [userId]);
  let pausedIssue = null;
  for (const seg of otherOpen) {
    await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?', [nowStamp(), seg.id]);
    if (!pausedIssue) {
      pausedIssue = await queryOne(db, 'SELECT id, issue_key FROM issues WHERE id = ?', [seg.issue_id]);
    }
  }

  const stamp = nowStamp();
  await run(db,
    'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    [uuidv4(), issueId, userId, stamp, stamp]);

  return { paused_issue: pausedIssue || null };
}

/** Close this user's open segment on the issue. No-op when none is open. */
async function pauseTimer(db, issueId, userId) {
  const open = await queryOne(db,
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ? AND ended_at IS NULL',
    [issueId, userId]);
  if (!open) return;
  await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?', [nowStamp(), open.id]);
}

/** Distinct users who have tracked any time on the issue. */
async function issueTimerUserIds(db, issueId) {
  const rows = await queryAll(db,
    'SELECT DISTINCT user_id FROM timer_segments WHERE issue_id = ?', [issueId]);
  return rows.map((r) => r.user_id);
}

/** Per-user minute totals for all completed timer segments on the issue. */
async function issueTimerTotals(db, issueId) {
  const segments = await queryAll(db,
    `SELECT t.*, u.name AS user_name FROM timer_segments t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.issue_id = ? ORDER BY t.started_at`, [issueId]);

  const now = new Date();
  const byUser = new Map();
  for (const seg of segments) {
    if (!byUser.has(seg.user_id)) {
      byUser.set(seg.user_id, { user_id: seg.user_id, name: seg.user_name || 'Unknown', minutes: 0 });
    }
    byUser.get(seg.user_id).minutes += segmentMinutes(seg, now);
  }
  return [...byUser.values()].map((u) => ({ ...u, minutes: Math.round(u.minutes) }));
}

/** Timer state for one user on one issue, plus per-user totals for everyone. */
async function timerState(db, issueId, userId) {
  await closeStaleSegments(db, { userId });

  const segments = await queryAll(db,
    `SELECT t.*, u.name AS user_name FROM timer_segments t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.issue_id = ? ORDER BY t.started_at`, [issueId]);

  const now = new Date();
  const mine = segments.filter((s) => s.user_id === userId);
  const open = mine.find((s) => !s.ended_at) || null;

  const byUser = new Map();
  for (const seg of segments) {
    if (!byUser.has(seg.user_id)) {
      byUser.set(seg.user_id, { user_id: seg.user_id, name: seg.user_name || 'Unknown', minutes: 0 });
    }
    byUser.get(seg.user_id).minutes += segmentMinutes(seg, now);
  }

  return {
    running: !!open,
    started_at: open ? open.started_at : null,
    elapsed_minutes: Math.round(mine.reduce((sum, s) => sum + segmentMinutes(s, now), 0)),
    runaway: !!open && segmentMinutes(open, now) > RUNAWAY_MINUTES,
    by_user: [...byUser.values()].map((u) => ({ ...u, minutes: Math.round(u.minutes) })),
  };
}

/**
 * Roll this user's segments on the issue into a single source='timer' work log
 * and lock the issue against the status-derived recompute.
 *
 * Idempotent: the existing timer row for this user is replaced, not appended
 * to — the same pattern applyAutoWorklog uses for its auto row.
 */
async function commitTimer(db, issueId, userId) {
  await pauseTimer(db, issueId, userId);

  const segments = await queryAll(db,
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ?', [issueId, userId]);
  const now = new Date();
  const total = Math.round(segments.reduce((sum, s) => sum + segmentMinutes(s, now), 0));

  await run(db, "DELETE FROM work_logs WHERE issue_id = ? AND user_id = ? AND source = 'timer'",
    [issueId, userId]);
  if (total > 0) {
    await run(db,
      "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'timer')",
      [uuidv4(), issueId, userId, total, 'Tracked with timer']);

    // Tracked time is authoritative: skip the status-derived calculation for
    // this issue from now on (read by utils/auto-worklog.js's
    // applyAutoWorklog). Only lock when a real session was committed — a
    // zero-minute start/immediately-pause must not permanently lock the
    // issue out of the derived calculation with nothing logged from either
    // source.
    await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [issueId]);
  }
  await recomputeTimeSpent(db, issueId);
  return total;
}

module.exports = {
  RUNAWAY_MINUTES, nowStamp, closeStaleSegments, startTimer, pauseTimer,
  timerState, commitTimer, issueTimerUserIds, issueTimerTotals,
};
