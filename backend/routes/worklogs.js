// ===== TIME TRACKING MODULE =====
// GET    /api/issues/:id/worklogs - Work log entries for an issue (newest first)
// POST   /api/issues/:id/worklogs - Log work { minutes, comment? }; source='manual'
// PATCH  /api/worklogs/:id - Edit a work log (author or admin); auto rows become
//                            manual + locked, so a later auto-recompute won't
//                            silently overwrite the correction (utils/auto-worklog.js)
// DELETE /api/worklogs/:id - Remove a work log (author or admin)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { recomputeTimeSpent } = require('../utils/worklog-sync');
const { settleSegments } = require('../utils/timers');
const { auditLog } = require('../middleware/logger');

const router = express.Router();

function canEditWorklog(log, req) {
  return log.user_id === req.userId || req.userRole === 'admin';
}

// GET /api/issues/:issueId/worklogs
router.get('/issues/:issueId/worklogs', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const logs = await queryAll(db, `
      SELECT w.*, u.name AS user_name, u.avatar_color AS user_color
      FROM work_logs w LEFT JOIN users u ON u.id = w.user_id
      WHERE w.issue_id = ? ORDER BY w.created_at DESC`, [req.params.issueId]);
    res.json(logs.map((l) => ({ ...l, minutes: Number(l.minutes) })));
  } catch (e) { serverError(res, e); }
});

// POST /api/issues/:issueId/worklogs
router.post('/issues/:issueId/worklogs', requireAuth, async (req, res) => {
  try {
    const minutes = Math.round(Number(req.body.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ error: 'minutes must be a positive number' });
    }
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT id FROM issues WHERE id = ?', [req.params.issueId]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const id = uuidv4();
    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, comment, source) VALUES (?, ?, ?, ?, ?, 'manual')",
      [id, req.params.issueId, req.userId, minutes, req.body.comment || null]);

    // Logging work here answers the question an abandoned timer asked — how
    // long was that session? — so it stops being unresolved. Scoped to this
    // user, so one person's answer never clears another's prompt.
    await settleSegments(db, req.params.issueId, req.userId);
    await recomputeTimeSpent(db, req.params.issueId);

    const log = await queryOne(db, `
      SELECT w.*, u.name AS user_name, u.avatar_color AS user_color
      FROM work_logs w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?`, [id]);
    res.status(201).json({ ...log, minutes: Number(log.minutes) });
  } catch (e) { serverError(res, e); }
});

// PATCH /api/worklogs/:id
router.patch('/worklogs/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const log = await queryOne(db, 'SELECT * FROM work_logs WHERE id = ?', [req.params.id]);
    if (!log) return res.status(404).json({ error: 'Work log not found' });
    if (!canEditWorklog(log, req)) return res.status(403).json({ error: 'Not your work log' });

    const updates = [];
    const params = [];
    if (req.body.minutes !== undefined) {
      const minutes = Math.round(Number(req.body.minutes));
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ error: 'minutes must be a positive number' });
      }
      updates.push('minutes = ?');
      params.push(minutes);
    }
    if (req.body.comment !== undefined) {
      updates.push('comment = ?');
      params.push(req.body.comment || null);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    // Editing an auto-generated entry converts it to a locked manual entry —
    // see utils/auto-worklog.js: a locked issue is skipped on the next
    // status-completion recompute, so the human correction sticks.
    if (log.source === 'auto') {
      updates.push("source = 'manual'", 'locked_from_auto = 1');
      await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [log.issue_id]);
    }

    // A timer entry needs the same protection, and needs it at the source.
    // Converting the row alone is not enough: commitTimer re-derives a fresh
    // source='timer' row from timer_segments on the next pause or done
    // transition, so the correction would either be overwritten or added to.
    // Settling the segments hands ownership of that time to the human's row
    // and takes the stopwatch out of the loop for good.
    if (log.source === 'timer') {
      updates.push("source = 'manual'", 'locked_from_auto = 1');
      await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [log.issue_id]);
      await settleSegments(db, log.issue_id, log.user_id);
    }

    params.push(req.params.id);
    await run(db, `UPDATE work_logs SET ${updates.join(', ')} WHERE id = ?`, params);
    await recomputeTimeSpent(db, log.issue_id);

    const updated = await queryOne(db, `
      SELECT w.*, u.name AS user_name, u.avatar_color AS user_color
      FROM work_logs w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?`, [req.params.id]);

    // Tracked time is a claim about what someone did, so a change to it should
    // not be invisible afterwards. Written after the update lands, so a
    // rejected edit leaves no trail of a change that never happened. The
    // source conversion is included because it is the consequential part: it
    // takes the stopwatch out of the loop for this issue permanently.
    const issueRow = await queryOne(db, 'SELECT issue_key FROM issues WHERE id = ?', [log.issue_id]);
    auditLog({
      userId: req.userId,
      action: 'Edited work log',
      category: 'issues',
      entityType: 'work_log',
      entityId: req.params.id,
      entityName: issueRow ? issueRow.issue_key : log.issue_id,
      details: {
        issue_id: log.issue_id,
        minutes_before: Number(log.minutes),
        minutes_after: Number(updated.minutes),
        source_before: log.source,
        source_after: updated.source,
      },
    });
    res.json({ ...updated, minutes: Number(updated.minutes) });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/worklogs/:id
router.delete('/worklogs/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const log = await queryOne(db, 'SELECT * FROM work_logs WHERE id = ?', [req.params.id]);
    if (!log) return res.status(404).json({ error: 'Work log not found' });
    if (!canEditWorklog(log, req)) return res.status(403).json({ error: 'Not your work log' });

    // Deleting an auto entry is "I don't want this counted" — lock the issue
    // so the next completion doesn't regenerate it (utils/auto-worklog.js).
    if (log.source === 'auto') {
      await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [log.issue_id]);
    }

    // Same intent for a timer entry, but the lock alone cannot deliver it:
    // commitTimer rebuilds the row from timer_segments, so without settling
    // them the entry reappears on the next pause or done transition and the
    // deletion silently undoes itself. The segments are kept, not dropped —
    // they stay as the record of what was tracked, just no longer as the
    // source of a work log.
    // The lock is still needed alongside it, for the same reason the auto
    // branch above sets it: once every tracker's time is settled the next done
    // transition sees zero tracked minutes and falls through to the
    // status-derived calculation, so "I don't want this counted" would come
    // back as an inferred 'auto' row instead of a timer one.
    if (log.source === 'timer') {
      await settleSegments(db, log.issue_id, log.user_id);
      await run(db, 'UPDATE issues SET auto_worklog_locked = 1 WHERE id = ?', [log.issue_id]);
    }

    await run(db, 'DELETE FROM work_logs WHERE id = ?', [req.params.id]);
    await recomputeTimeSpent(db, log.issue_id);

    // Captured from the row read before the delete — nothing else will be left
    // to say how much time was removed, or from where.
    const gone = await queryOne(db, 'SELECT issue_key FROM issues WHERE id = ?', [log.issue_id]);
    auditLog({
      userId: req.userId,
      action: 'Deleted work log',
      category: 'issues',
      entityType: 'work_log',
      entityId: req.params.id,
      entityName: gone ? gone.issue_key : log.issue_id,
      details: {
        issue_id: log.issue_id,
        minutes_before: Number(log.minutes),
        source_before: log.source,
      },
    });
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
