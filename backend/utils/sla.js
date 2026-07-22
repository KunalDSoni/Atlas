// ===== SLAs — pure derivation =====
// No HTTP, no database. Atlas has no scheduler — no cron, no setInterval — so
// an SLA is never a timer that fires. It is a row of timestamps, and this file
// is the single function that turns those timestamps into state:
//
//   elapsed = (paused_at ?? stopped_at ?? now) - started_at - paused_total
//
// Everything that shows an SLA (queue badge, request detail, the report) calls
// slaState(), so a badge can never disagree with a report.

// A clock is "at risk" once it has burned this much of its target.
const AT_RISK_RATIO = 0.8;

/** 'YYYY-MM-DD HH:MM:SS' (SQLite, UTC) or ISO → epoch ms. */
function parseTime(s) {
  if (!s) return null;
  const str = String(s);
  const t = Date.parse(str.replace(' ', 'T') + (/[Zz]|[+-]\d\d:?\d\d$/.test(str) ? '' : 'Z'));
  return Number.isNaN(t) ? null : t;
}

/**
 * Derives the live state of one SLA clock against its goal.
 *
 * @param clock {started_at, stopped_at?, paused_at?, paused_total_minutes?}
 * @param goal  {target_minutes}
 * @param now   a datetime string or Date; defaults to the current time.
 * @returns {elapsed_minutes, remaining_minutes, status, paused, stopped}
 *          or null when there is nothing to derive.
 */
function slaState(clock, goal, now = new Date()) {
  if (!clock || !goal) return null;
  const target = Number(goal.target_minutes);
  // A zero or negative target is a mis-configured goal, not an instant breach.
  if (!Number.isFinite(target) || target <= 0) return null;

  const started = parseTime(clock.started_at);
  if (started === null) return null;

  const nowMs = now instanceof Date ? now.getTime() : parseTime(now);
  const stopped = parseTime(clock.stopped_at);
  const pausedAt = parseTime(clock.paused_at);

  // Precedence: a stopped clock is final; otherwise a paused clock is frozen at
  // the moment it paused; otherwise it is still running.
  const until = stopped !== null ? stopped : (pausedAt !== null ? pausedAt : nowMs);

  const pausedTotal = Number(clock.paused_total_minutes) || 0;
  // Clamped at zero: paused_total is accumulated from real intervals, but a
  // clock started and paused inside the same minute can round below zero, and
  // negative elapsed would read as time not yet spent.
  const elapsed = Math.max(0, Math.round((until - started) / 60_000) - pausedTotal);

  let status;
  if (elapsed > target) status = 'breached';
  // A finished clock either met the goal or did not — "at risk" describes time
  // still running out, which a stopped clock no longer is.
  else if (stopped !== null) status = 'ok';
  else status = elapsed >= target * AT_RISK_RATIO ? 'at_risk' : 'ok';

  return {
    elapsed_minutes: elapsed,
    remaining_minutes: target - elapsed,
    target_minutes: target,
    status,
    paused: stopped === null && pausedAt !== null,
    stopped: stopped !== null,
  };
}

module.exports = { slaState, parseTime, AT_RISK_RATIO };
