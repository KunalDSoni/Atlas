// ===== REQUEST LOGGER MIDDLEWARE =====
// Logs all API requests with timing, user info, and method/path
// Also provides audit logging helpers for business-level events

const { v4: uuidv4 } = require('uuid');
const { getDb, run, queryOne } = require('../database');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

const methodColors = {
  GET: colors.green,
  POST: colors.cyan,
  PUT: colors.yellow,
  DELETE: colors.red,
  PATCH: colors.magenta,
};

// Format duration
function fmtDuration(ms) {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Status color
function statusColor(code) {
  if (code < 300) return colors.green;
  if (code < 400) return colors.yellow;
  return colors.red;
}

// Request logger middleware — logs every API request to console + DB
function requestLogger(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();

  const start = Date.now();
  const originalEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - start;
    const method = req.method;
    const path = req.originalUrl || req.path;
    const status = res.statusCode;
    const mc = methodColors[method] || colors.reset;
    const sc = statusColor(status);

    // Console log with colors
    const userInfo = req.userId ? `${colors.dim}[${req.userName || req.userId}]${colors.reset}` : `${colors.dim}[anon]${colors.reset}`;
    console.log(
      `${colors.dim}${new Date().toISOString().slice(11, 23)}${colors.reset} ${mc}${method.padEnd(7)}${colors.reset} ${sc}${status}${colors.reset} ${path} ${colors.dim}${fmtDuration(duration)}${colors.reset} ${userInfo}`
    );

    // Log mutating requests to audit_log DB
    if (method !== 'GET' && method !== 'OPTIONS' && method !== 'HEAD') {
      logToDb({
        userId: req.userId || null,
        userName: req.userName || null,
        action: `${method} ${path}`,
        category: 'api',
        method,
        path,
        statusCode: status,
        durationMs: duration,
        ipAddress: req.ip || req.connection?.remoteAddress,
      }).catch(() => {}); // don't fail request on log errors
    }

    originalEnd.apply(res, args);
  };

  next();
}

// Audit log writer — writes to audit_log table
async function logToDb({ userId, userName, action, category, entityType, entityId, entityName, details, method, path, statusCode, durationMs, ipAddress }) {
  try {
    const db = await getDb();
    const id = uuidv4();

    // Look up user name if not provided but we have userId
    let uName = userName;
    if (!uName && userId) {
      const user = await queryOne(db, 'SELECT name FROM users WHERE id = ?', [userId]);
      uName = user ? user.name : null;
    }

    await run(db,
      `INSERT INTO audit_log (id, user_id, user_name, action, category, entity_type, entity_id, entity_name, details, ip_address, method, path, status_code, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, uName, action, category || 'system', entityType || null, entityId || null, entityName || null,
       details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
       ipAddress || null, method || null, path || null, statusCode || null, durationMs || null]
    );
  } catch (e) {
    console.error('Audit log write failed:', e.message);
  }
}

// High-level audit logger for business events
async function auditLog({ userId, action, category, entityType, entityId, entityName, details }) {
  return logToDb({ userId, action, category: category || 'business', entityType, entityId, entityName, details });
}

module.exports = { requestLogger, auditLog };
