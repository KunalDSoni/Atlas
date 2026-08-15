// ===== MY TIME =====
// GET /api/me/time?from=&to= — the caller's work logs across every project.
//
// Every other time report is scoped to one project, but the question a person
// needs answered is "what did I work on this week", which spans all of them.
// Nothing new is computed: work_logs is already the single source the issue
// rail, the project report and issues.time_spent all read.
//
// See docs/superpowers/specs/2026-08-15-my-time-design.md

const express = require('express');
const { getDb, queryAll, queryOne } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

// Long enough for a month view, short enough that one request cannot pull a
// person's entire history into memory.
const MAX_RANGE_DAYS = 31;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight UTC of a YYYY-MM-DD date, or null when it is not one. */
function parseDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

const isoDate = (d) => d.toISOString().slice(0, 10);

/**
 * The calendar date a timestamp falls on, as seen from `timezone`.
 *
 * work_logs carries only created_at, so a log is attributed to the day it was
 * RECORDED — for late-night work that is the following day. Fixing that would
 * mean a separate worked-on date in every logging path, which a reporting view
 * does not justify; the screen labels totals with the timezone instead.
 */
function localDate(stamp, timezone) {
  const utc = new Date(`${String(stamp).replace(' ', 'T')}Z`);
  if (Number.isNaN(utc.getTime())) return null;
  try {
    // en-CA renders as YYYY-MM-DD, which is the shape we compare and return.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(utc);
  } catch {
    return isoDate(utc);
  }
}

// GET /api/me/time — scoped to req.userId with no override. A manager's view of
// someone else's time is a different feature with different permissions, and a
// user_id parameter here would be the whole of its access control.
router.get('/me/time', requireAuth, async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    if (!from) return res.status(400).json({ error: 'from must be a YYYY-MM-DD date' });
    const to = parseDate(req.query.to);
    if (!to) return res.status(400).json({ error: 'to must be a YYYY-MM-DD date' });
    if (to <= from) return res.status(400).json({ error: 'to must be later than from' });

    const days = Math.round((to - from) / 86_400_000);
    if (days > MAX_RANGE_DAYS) {
      return res.status(400).json({ error: `range must be ${MAX_RANGE_DAYS} days or fewer` });
    }

    const db = await getDb();
    const user = await queryOne(db, 'SELECT timezone FROM users WHERE id = ?', [req.userId]);
    const timezone = user?.timezone || 'UTC';

    // Half-open [from, to). Widened by a day on each side before filtering,
    // because a UTC timestamp can land on a different local date in either
    // direction and the boundary is defined in the user's timezone, not UTC.
    const lowerBound = `${isoDate(new Date(from.getTime() - 86_400_000))} 00:00:00`;
    const upperBound = `${isoDate(new Date(to.getTime() + 86_400_000))} 00:00:00`;

    const rows = await queryAll(db, `
      SELECT w.id, w.issue_id, w.minutes, w.source, w.comment, w.created_at,
             i.issue_key, i.title, p.key AS project_key
      FROM work_logs w
      JOIN issues i ON i.id = w.issue_id
      JOIN projects p ON p.id = i.project_id
      WHERE w.user_id = ? AND w.created_at >= ? AND w.created_at < ?
      ORDER BY w.created_at`, [req.userId, lowerBound, upperBound]);

    const fromDate = isoDate(from);
    const toDate = isoDate(to);
    const entries = [];
    const minutesByDate = new Map();
    for (const row of rows) {
      const date = localDate(row.created_at, timezone);
      if (!date || date < fromDate || date >= toDate) continue;
      const minutes = Number(row.minutes);
      entries.push({ ...row, minutes, date });
      minutesByDate.set(date, (minutesByDate.get(date) || 0) + minutes);
    }

    // Every date in the range, zeros included: a caller reconstructing missing
    // days to draw a week is a caller that will get it wrong.
    const byDay = [];
    for (let i = 0; i < days; i += 1) {
      const date = isoDate(new Date(from.getTime() + i * 86_400_000));
      byDay.push({ date, minutes: minutesByDate.get(date) || 0 });
    }

    res.json({
      from: fromDate,
      to: toDate,
      timezone,
      total_minutes: entries.reduce((sum, e) => sum + e.minutes, 0),
      by_day: byDay,
      entries,
    });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
