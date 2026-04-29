// ===== ACTIVITY LOG MODULE =====
// GET /api/issues/:issueId/activity - Get activity log for an issue

const express = require('express');
const { getDb, queryAll } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/issues/:issueId/activity
router.get('/issues/:issueId/activity', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const activities = await queryAll(db,
      `SELECT a.*, u.name as user_name, u.avatar_color as user_color
       FROM activity_log a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.issue_id = ?
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [req.params.issueId]
    );
    res.json(activities);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
