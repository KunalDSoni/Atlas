// ===== ADMIN MODULE =====
// GET /api/admin/stats - Admin dashboard statistics

const express = require('express');
const { getDb, queryOne, queryAll } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/stats
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const users = (await queryOne(db, 'SELECT COUNT(*) as count FROM users WHERE is_active = 1')).count;
    const projects = (await queryOne(db, 'SELECT COUNT(*) as count FROM projects')).count;
    const issues = (await queryOne(db, 'SELECT COUNT(*) as count FROM issues')).count;
    const byRole = await queryAll(db, 'SELECT role, COUNT(*) as count FROM users WHERE is_active = 1 GROUP BY role');

    res.json({ users, projects, issues, byRole });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
