// ===== AUDIT LOG API MODULE =====
// GET /api/admin/audit-log — List audit log entries (admin only)
// GET /api/admin/audit-log/stats — Audit log stats/summary

const express = require('express');
const { getDb, queryAll, queryOne } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/audit-log — List with filtering + pagination
router.get('/audit-log', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const {
      page = 1,
      limit = 50,
      category,
      user_id,
      action,
      entity_type,
      method,
      search,
      from_date,
      to_date,
      status_min,
      status_max,
    } = req.query;

    const conditions = [];
    const params = [];

    if (category) { conditions.push('a.category = ?'); params.push(category); }
    if (user_id) { conditions.push('a.user_id = ?'); params.push(user_id); }
    if (action) { conditions.push('a.action LIKE ?'); params.push(`%${action}%`); }
    if (entity_type) { conditions.push('a.entity_type = ?'); params.push(entity_type); }
    if (method) { conditions.push('a.method = ?'); params.push(method); }
    if (from_date) { conditions.push('a.created_at >= ?'); params.push(from_date); }
    if (to_date) { conditions.push('a.created_at <= ?'); params.push(to_date + 'T23:59:59'); }
    if (status_min) { conditions.push('a.status_code >= ?'); params.push(parseInt(status_min)); }
    if (status_max) { conditions.push('a.status_code <= ?'); params.push(parseInt(status_max)); }
    if (search) {
      conditions.push('(a.action LIKE ? OR a.entity_name LIKE ? OR a.details LIKE ? OR a.path LIKE ? OR a.user_name LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get total count
    const countResult = await queryOne(db, `SELECT COUNT(*) as total FROM audit_log a ${where}`, params);
    const total = countResult ? countResult.total : 0;

    // Get paginated results
    const entries = await queryAll(db,
      `SELECT a.*, u.avatar_color
       FROM audit_log a
       LEFT JOIN users u ON a.user_id = u.id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      entries,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / parseInt(limit))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/audit-log/stats — Summary statistics
router.get('/audit-log/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();

    const total = await queryOne(db, 'SELECT COUNT(*) as count FROM audit_log');
    const today = await queryOne(db, "SELECT COUNT(*) as count FROM audit_log WHERE created_at >= date('now')");
    const errors = await queryOne(db, 'SELECT COUNT(*) as count FROM audit_log WHERE status_code >= 400');
    const byCategory = await queryAll(db, 'SELECT category, COUNT(*) as count FROM audit_log GROUP BY category ORDER BY count DESC');
    const byMethod = await queryAll(db, 'SELECT method, COUNT(*) as count FROM audit_log WHERE method IS NOT NULL GROUP BY method ORDER BY count DESC');
    const byUser = await queryAll(db,
      `SELECT a.user_id, a.user_name, u.avatar_color, COUNT(*) as count
       FROM audit_log a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.user_id IS NOT NULL
       GROUP BY a.user_id
       ORDER BY count DESC
       LIMIT 10`
    );
    const recentErrors = await queryAll(db,
      `SELECT * FROM audit_log WHERE status_code >= 400 ORDER BY created_at DESC LIMIT 5`
    );
    const avgDuration = await queryOne(db, 'SELECT AVG(duration_ms) as avg_ms FROM audit_log WHERE duration_ms IS NOT NULL');

    res.json({
      total: total.count,
      today: today.count,
      errors: errors.count,
      avg_duration_ms: avgDuration ? Math.round(avgDuration.avg_ms || 0) : 0,
      by_category: byCategory,
      by_method: byMethod,
      by_user: byUser,
      recent_errors: recentErrors,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
