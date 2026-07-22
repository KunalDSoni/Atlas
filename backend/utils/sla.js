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

/** Epoch ms/Date -> the UTC timestamp shape shared by SQLite and MySQL. */
function sqlTimestamp(value) {
  const ms = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Computes the two persisted boundaries used by SLA-aware JQL.
 *
 * `paused_total_minutes` is already banked time. An in-flight pause does not
 * move the boundaries until resume; SQL freezes its comparison clock at
 * `paused_at`, exactly as slaState() does.
 */
function slaBoundaries(clock) {
  if (!clock) return { due_at: null, at_risk_at: null };
  const target = Number(clock.target_minutes);
  const started = parseTime(clock.started_at);
  if (!Number.isFinite(target) || target <= 0 || started === null) {
    return { due_at: null, at_risk_at: null };
  }

  const paused = Math.max(0, Number(clock.paused_total_minutes) || 0);
  return {
    due_at: sqlTimestamp(started + (target + paused) * 60_000),
    at_risk_at: sqlTimestamp(started + (target * AT_RISK_RATIO + paused) * 60_000),
  };
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
  const exactElapsed = Math.max(0, (until - started) / 60_000 - pausedTotal);
  const elapsed = Math.round(exactElapsed);

  let status;
  // Compare the unrounded duration so the badge flips at the exact same stored
  // timestamp that SQL uses for `due_at <= now` and `at_risk_at <= now`.
  if (exactElapsed >= target) status = 'breached';
  // A finished clock either met the goal or did not — "at risk" describes time
  // still running out, which a stopped clock no longer is.
  else if (stopped !== null) status = 'ok';
  else status = exactElapsed >= target * AT_RISK_RATIO ? 'at_risk' : 'ok';

  return {
    elapsed_minutes: elapsed,
    remaining_minutes: target - elapsed,
    target_minutes: target,
    status,
    paused: stopped === null && pausedAt !== null,
    stopped: stopped !== null,
  };
}

module.exports = { slaState, slaBoundaries, sqlTimestamp, parseTime, AT_RISK_RATIO };
