// ===== ISSUE STOPWATCH MODULE =====
// POST /api/issues/:issueId/timer/start  - Start/resume; pauses the caller's
//                                          timer on any other issue first
// POST /api/issues/:issueId/timer/pause  - Pause; no-op when nothing running
// POST /api/issues/:issueId/timer/commit - Roll segments into a source='timer'
//                                          work log and lock the issue
// GET  /api/issues/:issueId/timer        - Timer state for the caller + per-user totals
// GET  /api/me/timer                     - The caller's running timer, if any
//
// Every route acts on req.userId: a user can only drive their own timer.

const express = require('express');
const { getDb, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const {
  startTimer, pauseTimer, timerState, commitTimer, closeStaleSegments, RUNAWAY_MINUTES,
  unresolvedSegments, nowStamp,
} = require('../utils/timers');

const router = express.Router();

async function requireIssue(db, issueId, res) {
  const issue = await queryOne(db, 'SELECT id FROM issues WHERE id = ?', [issueId]);
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' });
    return null;
  }
  return issue;
}

// POST /api/issues/:issueId/timer/start
router.post('/issues/:issueId/timer/start', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    const { paused_issue } = await startTimer(db, req.params.issueId, req.userId);
    const state = await timerState(db, req.params.issueId, req.userId);
    res.json({ ...state, paused_issue });
  } catch (e) { serverError(res, e); }
});

// POST /api/issues/:issueId/timer/pause
router.post('/issues/:issueId/timer/pause', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    // Commit on pause, not only when the issue reaches Done. Until this, the
    // commit endpoint below was the sole writer of timer work logs and no
    // client ever called it, so tracked time sat in timer_segments and was
    // absent from issues.time_spent, the time-tracking report and the rail's
    // own "logged" line — the stopwatch read 2h 30m directly above "— logged".
    // Issues that never reach a done status never reported the time at all.
    await commitTimer(db, req.params.issueId, req.userId);
    res.json(await timerState(db, req.params.issueId, req.userId));
  } catch (e) { serverError(res, e); }
});

// POST /api/issues/:issueId/timer/commit
router.post('/issues/:issueId/timer/commit', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    const minutes = await commitTimer(db, req.params.issueId, req.userId);
    res.json({ ok: true, minutes });
  } catch (e) { serverError(res, e); }
});

// GET /api/issues/:issueId/timer
router.get('/issues/:issueId/timer', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!(await requireIssue(db, req.params.issueId, res))) return;

    res.json(await timerState(db, req.params.issueId, req.userId));
  } catch (e) { serverError(res, e); }
});

// GET /api/me/timer — lets a running timer survive a refresh and follow the
// user between web and mobile.
router.get('/me/timer', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await closeStaleSegments(db, { userId: req.userId });

    // ORDER BY: two open segments should be impossible, but startTimer's
    // check-then-insert is not atomic across devices. Without an order the
    // banner would flip between them at random on each poll; newest wins.
    const open = await queryOne(db, `
      SELECT t.issue_id, t.started_at, i.issue_key, i.title
      FROM timer_segments t JOIN issues i ON i.id = t.issue_id
      WHERE t.user_id = ? AND t.ended_at IS NULL
      ORDER BY t.started_at DESC`, [req.userId]);
    if (!open) return res.json(null);

    const elapsed = Math.round(
      (Date.now() - new Date(String(open.started_at).replace(' ', 'T') + 'Z')) / 60_000
    );
    res.json({
      issue_id: open.issue_id,
      issue_key: open.issue_key,
      title: open.title,
      started_at: open.started_at,
      elapsed_minutes: elapsed,
      runaway: elapsed > RUNAWAY_MINUTES,
    });
  } catch (e) { serverError(res, e); }
});

// GET /api/me/timer/unresolved — abandoned timers this user has not accounted
// for. An abandoned segment credits nothing, so without an answer from the
// person who ran it the time is never recorded anywhere.
router.get('/me/timer/unresolved', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await closeStaleSegments(db, { userId: req.userId });
    res.json(await unresolvedSegments(db, req.userId));
  } catch (e) { serverError(res, e); }
});

// POST /api/timer-segments/:id/resolve — "I did not really work on that".
// Settles without writing a work log, so clearing the prompt never requires
// logging time that was not worked.
router.post('/timer-segments/:id/resolve', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    // Scoped to the caller: 404 rather than 403, because the existence of
    // someone else's segment is not the caller's business.
    const seg = await queryOne(db,
      'SELECT id, issue_id FROM timer_segments WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]);
    if (!seg) return res.status(404).json({ error: 'Timer segment not found' });

    await run(db, 'UPDATE timer_segments SET settled_at = ? WHERE id = ? AND settled_at IS NULL',
      [nowStamp(), seg.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
