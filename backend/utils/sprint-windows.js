// ===== AUTOMATIC SPRINT WINDOWS =====
// Two sprints a month, on a fixed calendar: the 1st through the 15th, and the
// 16th through the last day of the month. Pure date math — no database, no
// clock of its own. Every caller passes the instant it wants evaluated, so the
// boundary rules are testable without a server and without waiting for a date.
//
// Boundaries are computed in UTC. sprints.start_date/end_date are date-only
// strings, and `projects` has no timezone column — timezone lives on `users`
// (database.js:29), so there is no project-wide answer to "is it the 16th yet?"
// to read. UTC is the deterministic stand-in, deliberately confined to this
// file so moving to a project timezone later changes one function.

// The last day belonging to the first window. The second window runs from the
// day after this one to the end of the month, so a 28-day February gives a
// 13-day second window and a 31-day month gives a 16-day one. Sprint length
// varying by a few days across months is inherent to a calendar cadence.
const FIRST_WINDOW_LAST_DAY = 15;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Days in `month` (1-12) of `year`, leap years included. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

/**
 * The window `year`/`month`/`half` describes, as the shape everything else
 * here passes around. `key` is the stable identity written to sprints.auto_key.
 */
function buildWindow(year, month, half) {
  const first = half === 1;
  const startDay = first ? 1 : FIRST_WINDOW_LAST_DAY + 1;
  const endDay = first ? FIRST_WINDOW_LAST_DAY : daysInMonth(year, month);
  const label = MONTH_NAMES[month - 1];

  return {
    key: `${year}-${pad(month)}-${half}`,
    year,
    month,
    half,
    start_date: dateStr(year, month, startDay),
    end_date: dateStr(year, month, endDay),
    // The year is in the name because a project's sprint list outlives a year
    // and "Sep 1–15" alone repeats annually.
    name: `${label} ${startDay}–${endDay}, ${year}`,
    // Derived from the key rather than slugified from the name: the name can be
    // renamed (Jira allows it even after completion) and the slug is a URL.
    slug: `sprint-${year}-${pad(month)}-${half}`,
  };
}

/** The window containing `date`. */
function windowFor(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const half = date.getUTCDate() <= FIRST_WINDOW_LAST_DAY ? 1 : 2;
  return buildWindow(year, month, half);
}

/** The window immediately after `window`, rolling the year at December. */
function nextWindow(window) {
  if (window.half === 1) return buildWindow(window.year, window.month, 2);
  return window.month === 12
    ? buildWindow(window.year + 1, 1, 1)
    : buildWindow(window.year, window.month + 1, 1);
}

/**
 * The two windows the reconciler materializes: the one `now` sits in, and the
 * one after it. Past windows are never generated — a project idle for months
 * gets the current sprint, not a history it never worked in.
 */
function currentAndNext(now) {
  const current = windowFor(now);
  return { current, next: nextWindow(current) };
}

module.exports = {
  FIRST_WINDOW_LAST_DAY,
  daysInMonth,
  windowFor,
  nextWindow,
  currentAndNext,
};
