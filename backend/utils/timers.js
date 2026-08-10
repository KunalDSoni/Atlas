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

// A segment open longer than this with no defensible business-hours boundary
// is treated as abandoned and capped at RUNAWAY_MINUTES of credited time.
//
// Deliberately 2x RUNAWAY_MINUTES rather than equal to it. The runaway warning
// needs a window in which it is both true and still actionable: if the cap
// fired at the same threshold, closeStaleSegments (which every read runs
// first) would close the segment before timerState could ever report
// runaway:true, and the warning would be dead code. This leaves a full 12
// hours in which the user sees the warning and can pause the timer themselves,
// keeping their real elapsed time instead of the capped estimate.
const ABANDONED_AFTER_MINUTES = RUNAWAY_MINUTES * 2;

// Why the server closed a segment. NULL means the user pressed Pause. Stored
// so the UI can explain a stop the user did not ask for — see migration
// 030_timer_auto_stop_reason.
const STOP_WORKDAY_END = 'workday_end';   // left running overnight; closed at that day's close
const STOP_ABANDONED = 'abandoned';       // no boundary available; capped at RUNAWAY_MINUTES
const STOP_ISSUE_DONE = 'issue_done';     // the issue reached a done-category status
const STOP_SWITCHED = 'switched_issue';   // the user started a timer on another issue
const STOP_DUPLICATE = 'duplicate';       // a lost start race recorded the same session twice

/** Map of key -> rows, preserving input order within each group. */
function groupBy(rows, keyOf) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

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

/** Format a Date in the project's stored datetime format. */
function stampOf(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Repair abandoned open segments.
 *
 * `{ issueId }` — closes every open segment on the issue at `now`,
 * unconditionally. Used by the Done path: reaching a done-category status is
 * positive evidence the work stopped.
 *
 * `{ userId }` — closes segments the user has plainly stopped working on:
 *
 *   1. Started on an EARLIER local calendar day → closed at that day's
 *      business-day end. The earlier-day condition is essential: without it,
 *      someone who starts at 4pm under a 9-6 profile and is still working at
 *      7pm would have their live, actively running timer truncated to 6pm the
 *      moment they loaded the page. A same-day timer running past business
 *      hours means the person is still working.
 *   2. Open longer than ABANDONED_AFTER_MINUTES with no business-hours
 *      boundary available (no profile configured, a non-work day, or a start
 *      after close) → capped at RUNAWAY_MINUTES.
 *
 * Rule 2 replaces an earlier "leave it open and let the runaway warning cover
 * it". Leaving it open is not the conservative choice it looks like: the
 * segment keeps accruing against `now` on every read, so an abandoned timer
 * inflates the issue's per-user totals without bound and, when the issue
 * finally reaches Done, commitTimer writes that entire multi-day span —
 * nights and weekends included — into work_logs as tracked time. Capping at
 * the largest plausible single session is a smaller and, unlike the open
 * segment, a *visible* error: every close records why in `auto_stopped`.
 *
 * Returns the number of segments closed.
 */
async function closeStaleSegments(db, { userId, issueId, reason } = {}) {
  if (issueId) {
    const open = await queryAll(db,
      'SELECT * FROM timer_segments WHERE issue_id = ? AND ended_at IS NULL', [issueId]);
    for (const seg of open) {
      await run(db, 'UPDATE timer_segments SET ended_at = ?, auto_stopped = ? WHERE id = ?',
        [nowStamp(), reason || STOP_ISSUE_DONE, seg.id]);
    }
    return open.length;
  }

  if (!userId) return 0;
  let open = await queryAll(db,
    'SELECT * FROM timer_segments WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at', [userId]);

  let closed = 0;
  const closedIssueIds = new Set();
  const now = new Date();

  // Duplicates on ONE issue are a lost start race — startTimer's
  // check-then-insert is not atomic (the invariant is enforced in application
  // code because MySQL has no partial indexes), so a web and a phone start
  // landing together each observe no open segment and both insert. The two
  // rows describe the same real session but are each measured to `now`, so
  // the elapsed readout runs at double speed and the committed work log
  // inherits the same multiple. Close the later rows at their own start so
  // they contribute exactly zero, and let the earliest — the true beginning of
  // the session — run on.
  //
  // This is done first because it is pure de-duplication: it neither credits
  // nor discards time, so it cannot disturb the staleness rules below.
  if (open.length > 1) {
    const deduped = [];
    for (const [, group] of groupBy(open, (s) => s.issue_id)) {
      const [earliest, ...dupes] = group;
      for (const dupe of dupes) {
        await run(db, 'UPDATE timer_segments SET ended_at = ?, auto_stopped = ? WHERE id = ?',
          [dupe.started_at, STOP_DUPLICATE, dupe.id]);
        closed += 1;
      }
      deduped.push(earliest);
    }
    open = deduped;
  }

  const stillRunning = [];
  for (const seg of open) {
    const profile = await profileForIssue(db, seg.issue_id, userId);
    const openMinutes = segmentMinutes(seg, now);

    if (profile) {
      const startMidnight = localMidnightUtc(parseUtc(seg.started_at), profile.timezone);
      const nowMidnight = localMidnightUtc(now, profile.timezone);
      const end = startMidnight.getTime() < nowMidnight.getTime()
        ? workdayEndFor(seg.started_at, profile)
        : null; // same local day: still working
      if (end) {
        await run(db, 'UPDATE timer_segments SET ended_at = ?, auto_stopped = ? WHERE id = ?',
          [stampOf(end), STOP_WORKDAY_END, seg.id]);
        closedIssueIds.add(seg.issue_id);
        closed += 1;
        continue;
      }
    }

    // No defensible business-hours boundary — either no profile at all, or a
    // start that falls outside one (weekend, after close). Fall back to the
    // abandonment cap so the segment cannot grow without bound.
    if (openMinutes > ABANDONED_AFTER_MINUTES) {
      const cappedEnd = new Date(parseUtc(seg.started_at).getTime() + RUNAWAY_MINUTES * 60_000);
      await run(db, 'UPDATE timer_segments SET ended_at = ?, auto_stopped = ? WHERE id = ?',
        [stampOf(cappedEnd), STOP_ABANDONED, seg.id]);
      closedIssueIds.add(seg.issue_id);
      closed += 1;
      continue;
    }

    stillRunning.push(seg);
  }

  // Anything still open after the staleness rules is genuinely live, so more
  // than one means concurrent starts on different issues got through. Keep the
  // most recent — the same "newest intent wins" rule startTimer applies when it
  // displaces a running timer — and close the rest at `now`.
  //
  // This runs LAST on purpose. Applied before the rules above it would close a
  // three-week-old abandoned segment at `now` and commit the entire three
  // weeks, which is the exact overcounting the abandonment cap exists to
  // prevent.
  if (stillRunning.length > 1) {
    stillRunning.sort((a, b) => parseUtc(a.started_at) - parseUtc(b.started_at));
    for (const displaced of stillRunning.slice(0, -1)) {
      await run(db, 'UPDATE timer_segments SET ended_at = ?, auto_stopped = ? WHERE id = ?',
        [nowStamp(), STOP_SWITCHED, displaced.id]);
      closedIssueIds.add(displaced.issue_id);
      closed += 1;
    }
  }

  // A segment the server closed still has to reach work_logs, or the time is
  // stranded: the stopwatch shows it, time_spent and every report do not.
  // These are the forgotten timers specifically, so they are the ones most
  // likely to be the user's only record of an afternoon's work.
  for (const id of closedIssueIds) await commitTimer(db, id, userId);

  return closed;
}

/**
 * Find — and optionally repair — segments that recorded an impossible session.
 *
 * Before the abandonment cap existed a forgotten timer stayed open, accruing
 * against `now` on every read, and was closed and committed whole when the
 * issue eventually reached a done status. A timer nobody paused on a Friday
 * afternoon could therefore land in work_logs as three weeks of tracked work.
 * The live rules now cap such a segment, but only while it is still open;
 * anything already closed keeps its inflated span, so it needs this one pass.
 *
 * `apply: false` (the default) inspects and returns the same report without
 * writing anything, so the caller can show the damage before consenting to it.
 *
 * Idempotent: a capped segment no longer exceeds the threshold. Segments a
 * human has taken ownership of (settled_at set) are never touched — correcting
 * a number by hand is exactly the signal that the machine should stop adjusting
 * it. Orphaned segments are skipped via the JOIN: with no issue left there is
 * nothing to recompute and no report they can reach.
 */
async function findTimerOvercounts(db, { apply = false } = {}) {
  const segments = await queryAll(db, `
    SELECT t.id, t.issue_id, t.user_id, t.started_at, t.ended_at,
           i.issue_key, u.name AS user_name
    FROM timer_segments t
    JOIN issues i ON i.id = t.issue_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.ended_at IS NOT NULL AND t.settled_at IS NULL
    ORDER BY t.started_at`);

  const overcounted = segments
    .map((seg) => ({ ...seg, minutes: segmentMinutes(seg, new Date()) }))
    .filter((seg) => seg.minutes > ABANDONED_AFTER_MINUTES)
    .map((seg) => ({ ...seg, capped_minutes: RUNAWAY_MINUTES }));

  const pairs = new Map();
  for (const seg of overcounted) {
    pairs.set(`${seg.issue_id} ${seg.user_id}`,
      { issueId: seg.issue_id, userId: seg.user_id, issueKey: seg.issue_key });
  }

  if (apply) {
    for (const seg of overcounted) {
      const capped = new Date(parseUtc(seg.started_at).getTime() + RUNAWAY_MINUTES * 60_000);
      await run(db, 'UPDATE timer_segments SET ended_at = ?, auto_stopped = ? WHERE id = ?',
        [stampOf(capped), STOP_ABANDONED, seg.id]);
    }
    // Rewrite each affected work log through commitTimer — the same function
    // the live paths use, so repaired rows come from exactly the rule that
    // will maintain them from here on.
    for (const pair of pairs.values()) {
      pair.repaired_minutes = await commitTimer(db, pair.issueId, pair.userId);
    }
  }

  return {
    segments: overcounted,
    pairs: [...pairs.values()],
    minutes_before: Math.round(overcounted.reduce((sum, s) => sum + s.minutes, 0)),
    minutes_after: overcounted.length * RUNAWAY_MINUTES,
    applied: apply,
  };
}

/**
 * Hand this user's tracked time on the issue over to a human-owned work log.
 *
 * Settled segments are excluded from every stopwatch total and from
 * commitTimer's sum, so the stopwatch stops regenerating a row for time a
 * person has already taken responsibility for. The rows themselves are kept:
 * they remain the record of what was actually tracked, and an append-only
 * table should not start deleting history because someone corrected a number.
 *
 * Called from routes/worklogs.js when a source='timer' entry is edited or
 * deleted. Idempotent.
 */
async function settleSegments(db, issueId, userId) {
  await run(db,
    'UPDATE timer_segments SET settled_at = ? WHERE issue_id = ? AND user_id = ? AND settled_at IS NULL',
    [nowStamp(), issueId, userId]);
}

/**
 * The stop this user most recently experienced on this issue, when the server
 * caused it, so the UI can explain a stop nobody asked for.
 *
 * Reported only when the server-closed segment is the user's LAST segment on
 * the issue. If they have since started and paused it themselves, the earlier
 * automatic stop is history, not news — and an explanation attached to a
 * session the user just ended by hand reads as the timer misbehaving again.
 * Stops older than a day are dropped for the same reason.
 *
 * STOP_DUPLICATE is never reported: it is an internal repair of a lost start
 * race that credits zero time, so there is nothing for the user to act on.
 */
async function recentAutoStop(db, issueId, userId) {
  const seg = await queryOne(db,
    `SELECT ended_at, auto_stopped FROM timer_segments
     WHERE issue_id = ? AND user_id = ? AND ended_at IS NOT NULL AND settled_at IS NULL
     ORDER BY ended_at DESC`, [issueId, userId]);
  if (!seg || !seg.auto_stopped || seg.auto_stopped === STOP_DUPLICATE) return null;
  const ageMinutes = (Date.now() - parseUtc(seg.ended_at)) / 60_000;
  if (ageMinutes > 24 * 60) return null;
  return { reason: seg.auto_stopped, stopped_at: seg.ended_at };
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
  const displaced = new Set();
  for (const seg of otherOpen) {
    await run(db, 'UPDATE timer_segments SET ended_at = ?, auto_stopped = ? WHERE id = ?',
      [nowStamp(), STOP_SWITCHED, seg.id]);
    displaced.add(seg.issue_id);
    if (!pausedIssue) {
      pausedIssue = await queryOne(db, 'SELECT id, issue_key FROM issues WHERE id = ?', [seg.issue_id]);
    }
  }
  // Same reasoning as the pause route: a displaced timer's time must reach
  // work_logs here, or switching issues quietly strands it.
  for (const id of displaced) await commitTimer(db, id, userId);

  const stamp = nowStamp();
  await run(db,
    'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    [uuidv4(), issueId, userId, stamp, stamp]);

  return { paused_issue: pausedIssue || null };
}

/**
 * Close this user's open segments on the issue. No-op when none is open.
 *
 * Closes ALL of them, not just one. "One running timer per user" is enforced
 * in application code (MySQL has no partial indexes), so startTimer's
 * check-then-insert is not atomic: two starts racing from two devices — the
 * web app and the phone, which is exactly how this feature is used — can both
 * observe no open segment and both insert. Two open segments on one issue are
 * each measured to `now`, so the elapsed total runs at double speed and a
 * single-row pause leaves the survivor running. Closing every open row makes
 * Pause mean pause whatever the race left behind.
 */
async function pauseTimer(db, issueId, userId) {
  const open = await queryAll(db,
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ? AND ended_at IS NULL',
    [issueId, userId]);
  const stamp = nowStamp();
  for (const seg of open) {
    await run(db, 'UPDATE timer_segments SET ended_at = ? WHERE id = ?', [stamp, seg.id]);
  }
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
     WHERE t.issue_id = ? AND t.settled_at IS NULL ORDER BY t.started_at`, [issueId]);

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
     WHERE t.issue_id = ? AND t.settled_at IS NULL ORDER BY t.started_at`, [issueId]);

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
    // Only meaningful when nothing is running: a stop the user did not ask for
    // is the thing that needs explaining, and explaining it under a live timer
    // would just be confusing.
    auto_stopped: open ? null : await recentAutoStop(db, issueId, userId),
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
    'SELECT * FROM timer_segments WHERE issue_id = ? AND user_id = ? AND settled_at IS NULL',
    [issueId, userId]);
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

    // The lock only stops FUTURE derived recomputes; an 'auto' row written by
    // an earlier pass survives it. Left in place it sits alongside the timer
    // row and both are summed into issues.time_spent, so the same work is
    // counted twice — once as inferred in-progress time and once as tracked
    // time. The Done path in routes/issues.js already deletes it after
    // committing; doing it here covers every other entry point (POST
    // /timer/commit on an issue that is still in progress), which is where
    // the double count was actually reachable.
    await run(db, "DELETE FROM work_logs WHERE issue_id = ? AND source = 'auto'", [issueId]);
  }
  await recomputeTimeSpent(db, issueId);
  return total;
}

module.exports = {
  RUNAWAY_MINUTES, ABANDONED_AFTER_MINUTES, nowStamp, closeStaleSegments,
  startTimer, pauseTimer, timerState, commitTimer, issueTimerUserIds,
  issueTimerTotals, recentAutoStop, settleSegments, findTimerOvercounts,
  STOP_WORKDAY_END, STOP_ABANDONED, STOP_ISSUE_DONE, STOP_SWITCHED, STOP_DUPLICATE,
};
