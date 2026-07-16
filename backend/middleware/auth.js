const { getDb, queryOne } = require('../database');

// Identity is derived ONLY from a valid session token. Never trust client-supplied
// identity headers (x-user-id / x-user-role) — they are attacker-controlled.
async function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return next();

  try {
    const db = await getDb();
    const session = await queryOne(db, "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')", [token]);
    if (session) {
      const user = await queryOne(db, 'SELECT id, name, role FROM users WHERE id = ? AND is_active = 1', [session.user_id]);
      if (user) {
        req.userId = user.id;
        req.userName = user.name;
        req.userRole = user.role;
      }
    }
  } catch (e) {
    return next(e);
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
