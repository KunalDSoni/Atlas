// ===== FLOW METRICS HELPERS =====
// Pure functions for the cycle-time / time-in-status / cumulative-flow
// reports. Everything here operates on plain rows so it is unit-testable
// without a database.

// Built-in categories, used when a status key is absent from the project's
// configured workflow. Should track the categories used by DEFAULT_STATUSES
// in routes/workflows.js, though the two lists are maintained separately.
const BUILTIN_CATEGORY = {
  todo: 'todo',
  in_progress: 'in_progress',
  blocked: 'in_progress',
  in_review: 'in_progress',
  done: 'done',
};

/** Category for a status key, given the project's status list. Unknown → todo. */
function categoryOf(statusKey, statuses) {
  const hit = statuses.find((s) => s.key === statusKey);
  if (hit) return hit.category;
  return BUILTIN_CATEGORY[statusKey] || 'todo';
}

/**
 * Replays an issue's status transitions into contiguous segments.
 * `transitions` are activity_log rows (field='status') sorted ascending.
 * The first segment starts at created_at in the first observed status —
 * the earliest transition's old_value, or the current status when the issue
 * has no recorded transitions (the data-honesty rule: no fabricated history).
 * The final segment is open (`to: null`).
 */
function statusTimeline(issue, transitions) {
  const first = transitions[0] ? transitions[0].old_value : issue.status;
  const segments = [];
  let current = { status: first, from: issue.created_at, to: null };
  for (const t of transitions) {
    current.to = t.created_at;
    segments.push(current);
    current = { status: t.new_value, from: t.created_at, to: null };
  }
  segments.push(current);
  return segments;
}

/** Fractional hours between two datetime strings ('YYYY-MM-DD HH:MM:SS' or ISO). */
function hoursBetween(a, b) {
  const parse = (s) => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime();
  return (parse(b) - parse(a)) / 3_600_000;
}

/** Nearest-rank percentile of an ascending-sorted array. Empty → null. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Parse a business_hours JSON column value; null/invalid => null (unconfigured). */
function parseBusinessHours(json) {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (!p || !Array.isArray(p.work_days) || typeof p.start_hour !== 'number' || typeof p.end_hour !== 'number' || !p.timezone) return null;
    return p;
  } catch { return null; }
}

/**
 * Resolve the effective business-hours profile: user override wins over
 * project default; null when neither is configured (raw wall-clock fallback).
 */
function resolveBusinessHours(projectBusinessHours, userBusinessHours) {
  return parseBusinessHours(userBusinessHours) || parseBusinessHours(projectBusinessHours);
}

/** ISO weekday (1=Monday..7=Sunday) of a Date, in a given IANA timezone. */
function isoWeekdayInTz(date, timezone) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd];
}

/** Parse a stored datetime string ('YYYY-MM-DD HH:MM:SS' or ISO) as a UTC Date. */
function parseUtc(s) {
  return new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));
}

/** Wall-clock fields of `instant` as rendered in `timezone`. */
function wallPartsIn(instant, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
}

/**
 * The timezone's UTC offset in milliseconds at `instant` (positive east of
 * Greenwich). Derived by reading the wall clock in `timezone` and re-reading it
 * as if it were UTC — the difference is the offset, sign included.
 */
function tzOffsetMs(instant, timezone) {
  const p = wallPartsIn(instant, timezone);
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second));
  return asUtc - instant.getTime();
}

/**
 * UTC instant of local midnight for the calendar day (in `timezone`) that
 * `date` falls on.
 *
 * The offset must be SUBTRACTED from the wall-clock midnight, and it must
 * carry its sign. An earlier version inferred the offset by rendering
 * `Y-M-D 00:00Z` in the zone and reading back the hour, which silently
 * assumed a positive offset: in New York that guess renders as 19:00 on the
 * PREVIOUS day, so an offset of -5h was read as +19h and every result landed
 * a full calendar day early. That made businessMinutesBetween return 0 for a
 * whole workday and stopped abandoned timers from ever being closed, for
 * every user west of Greenwich.
 */
function localMidnightUtc(date, timezone) {
  const p = wallPartsIn(date, timezone);
  const wallMidnight = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  // Refine once: on a DST-transition day the offset in force at the naive
  // guess can differ from the one in force at real local midnight.
  const first = wallMidnight - tzOffsetMs(new Date(wallMidnight), timezone);
  return new Date(wallMidnight - tzOffsetMs(new Date(first), timezone));
}

/**
 * Minutes of overlap between [start, end) and a recurring weekly business-hours
 * window. `profile` is `{ timezone, work_days: number[] (ISO 1-7), start_hour,
 * end_hour }` or null. A null profile returns raw wall-clock minutes — the
 * unconfigured fallback is the same code path as "no clipping", not a branch.
 */
function businessMinutesBetween(start, end, profile) {
  const startDate = parseUtc(start);
  const endDate = parseUtc(end);
  if (!profile) return Math.max(0, (endDate - startDate) / 60_000);

  let totalMs = 0;
  let cursor = localMidnightUtc(startDate, profile.timezone);
  for (let guard = 0; guard < 3650 && cursor < endDate; guard++) {
    const weekday = isoWeekdayInTz(cursor, profile.timezone);
    const dayWorkStart = new Date(cursor.getTime() + profile.start_hour * 3_600_000);
    const dayWorkEnd = new Date(cursor.getTime() + profile.end_hour * 3_600_000);

    if (profile.work_days.includes(weekday)) {
      const overlapStart = new Date(Math.max(startDate, dayWorkStart));
      const overlapEnd = new Date(Math.min(endDate, dayWorkEnd));
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
    }

    // Advance to the next local calendar day's midnight.
    cursor = localMidnightUtc(new Date(cursor.getTime() + 24 * 3_600_000 + 12 * 3_600_000), profile.timezone);
  }
  return Math.round(totalMs / 60_000);
}

// localMidnightUtc / isoWeekdayInTz are exported for utils/timers.js, which
// needs the same timezone-aware calendar-day math to decide whether an
// abandoned stopwatch segment started on an earlier local day.
module.exports = {
  categoryOf, statusTimeline, hoursBetween, percentile,
  businessMinutesBetween, resolveBusinessHours,
  localMidnightUtc, isoWeekdayInTz,
};
