// ===== AUTOMATIC SPRINT WINDOWS =====
// Two sprints a month, on a fixed calendar: the 1st through the 15th, and the
// 16th through the last day of the month. Pure date math — no database, no
// clock of its own. Every caller passes the instant it wants evaluated, so the
// boundary rules are testable without a server and without waiting for a date.
//
// Boundaries are computed in IST (Asia/Kolkata), the working calendar of the
// team Atlas runs for. A window turns over at local midnight there, so the 16th
// begins when the team's day does rather than at 05:30 their time, which is what
// a UTC boundary would have meant.
//
// It is one constant in one file. `projects` has no timezone column — timezone
// lives on `users` (database.js:29) — so there is still no per-project answer
// available; when there is, SPRINT_TIMEZONE is what it replaces.
//
// Resolved through Intl with a named IANA zone rather than a fixed +05:30
// offset. India happens not to observe DST, so the two agree today, but the
// zone stays correct if that ever stops being true, and it matches how the rest
// of the codebase reads a wall clock (utils/flow.js).

// The last day belonging to the first window. The second window runs from the
// day after this one to the end of the month, so a 28-day February gives a
// 13-day second window and a 31-day month gives a 16-day one. Sprint length
// varying by a few days across months is inherent to a calendar cadence.
const FIRST_WINDOW_LAST_DAY = 15;

// The calendar the windows are cut on. One constant, one file.
const SPRINT_TIMEZONE = 'Asia/Kolkata';

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
  const { year, month, day } = calendarParts(date);
  return buildWindow(year, month, day <= FIRST_WINDOW_LAST_DAY ? 1 : 2);
}

/** The calendar date `instant` falls on, as read in SPRINT_TIMEZONE. */
function calendarParts(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SPRINT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * `instant` as a 'YYYY-MM-DD' day in SPRINT_TIMEZONE.
 *
 * Shared with the reconciler so that "has this sprint's end date passed?" is
 * asked against the same calendar the windows are cut on. Comparing a stored
 * end_date against a UTC today would disagree with the window boundaries for
 * five and a half hours every day.
 */
function calendarDay(instant) {
  const { year, month, day } = calendarParts(instant);
  return dateStr(year, month, day);
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
  SPRINT_TIMEZONE,
  daysInMonth,
  windowFor,
  nextWindow,
  currentAndNext,
  calendarDay,
};
