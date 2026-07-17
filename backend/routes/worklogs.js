// ===== TIME TRACKING MODULE =====
// GET    /api/issues/:id/worklogs - Work log entries for an issue (newest first)
// POST   /api/issues/:id/worklogs - Log work { minutes, comment? }; adds to issues.time_spent
// DELETE /api/worklogs/:id - Remove a work log (author or admin); subtracts from time_spent

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

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
    const issue = await queryOne(db, 'SELECT id, time_spent FROM issues WHERE id = ?', [req.params.issueId]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const id = uuidv4();
    await run(db, 'INSERT INTO work_logs (id, issue_id, user_id, minutes, comment) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.issueId, req.userId, minutes, req.body.comment || null]);
    await run(db, "UPDATE issues SET time_spent = ?, updated_at = datetime('now') WHERE id = ?",
      [Number(issue.time_spent || 0) + minutes, req.params.issueId]);

    const log = await queryOne(db, `
      SELECT w.*, u.name AS user_name, u.avatar_color AS user_color
      FROM work_logs w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?`, [id]);
    res.status(201).json({ ...log, minutes: Number(log.minutes) });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/worklogs/:id
router.delete('/worklogs/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const log = await queryOne(db, 'SELECT * FROM work_logs WHERE id = ?', [req.params.id]);
    if (!log) return res.status(404).json({ error: 'Work log not found' });
    if (log.user_id !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Not your work log' });
    }
    const issue = await queryOne(db, 'SELECT id, time_spent FROM issues WHERE id = ?', [log.issue_id]);
    await run(db, 'DELETE FROM work_logs WHERE id = ?', [req.params.id]);
    if (issue) {
      await run(db, "UPDATE issues SET time_spent = ?, updated_at = datetime('now') WHERE id = ?",
        [Math.max(0, Number(issue.time_spent || 0) - Number(log.minutes)), issue.id]);
    }
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
