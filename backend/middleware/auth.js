const { getDb, queryOne } = require('../database');

async function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token) {
    try {
      const db = await getDb();
      const session = queryOne(db, "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')", [token]);
      if (session) {
        const user = queryOne(db, 'SELECT id, name, role FROM users WHERE id = ? AND is_active = 1', [session.user_id]);
        if (user) {
          req.userId = user.id;
          req.userName = user.name;
          req.userRole = user.role;
        }
      }
    } catch (e) { /* fall through to legacy headers */ }
  }
  // Legacy header fallback
  if (!req.userId) {
    req.userId = req.headers['x-user-id'];
    req.userRole = req.headers['x-user-role'];
    // Resolve name for logger
    if (req.userId && !req.userName) {
      try {
        const db = await getDb();
        const u = queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.userId]);
        if (u) req.userName = u.name;
      } catch(e) {}
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

module.exports = { authMiddleware, requireAuth, requireAdmin, requireRole };
