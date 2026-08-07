const crypto = require('crypto');
const { getDb, queryOne, run } = require('../database');

const PAT_PREFIX = 'atlas_pat_';
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Identity is derived ONLY from a valid session token or a personal API token.
// Never trust client-supplied identity headers (x-user-id / x-user-role) — they
// are attacker-controlled.
async function authMiddleware(req, res, next) {
  const sessionToken = req.headers['x-auth-token'];
  const authz = req.headers['authorization'] || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
  if (!sessionToken && !bearer) return next();

  try {
    const db = await getDb();
    let userId = null;

    if (sessionToken) {
      const session = await queryOne(db, "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')", [sessionToken]);
      if (session) userId = session.user_id;
    }
    // Personal API token: Authorization: Bearer atlas_pat_...
    if (!userId && bearer && bearer.startsWith(PAT_PREFIX)) {
      const tok = await queryOne(db, 'SELECT id, user_id FROM api_tokens WHERE token_hash = ?', [hashToken(bearer)]);
      if (tok) {
        userId = tok.user_id;
        req.apiTokenId = tok.id;
        try { await run(db, "UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?", [tok.id]); } catch (e) { /* best effort */ }
      }
    }

    if (userId) {
      const user = await queryOne(db, 'SELECT id, name, role FROM users WHERE id = ? AND is_active = 1', [userId]);
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

function adminOrProjectOwner(req, res, next) {
  if (req.userRole === 'admin') return next();
  // For non-admins, we'll check project ownership in the route handler
  // since we need access to the feature/project data
  next();
}

module.exports = { authMiddleware, requireAuth, requireAdmin, requireRole, adminOrProjectOwner };
