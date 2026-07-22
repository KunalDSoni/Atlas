// ===== SERVICE DESK ACCESS =====
// Answers one question: may this caller see this request?
//
// A caller qualifies if they reported the request or watch it. Commenting adds
// the commenter as a watcher, which is how a second customer gains access.
//
// Failure is 404, never 403: a 403 would confirm that a request key exists,
// letting anyone enumerate keys.

const { getDb, queryOne } = require('../database');
const { serverError } = require('../utils/errors');

async function requireClientSafe(req, res, next) {
  try {
    const db = await getDb();
    const issue = await queryOne(db,
      "SELECT * FROM issues WHERE issue_key = ? AND type = 'request'",
      [req.params.key]);

    if (!issue) return res.status(404).json({ error: 'Request not found' });

    if (issue.reporter_id === req.userId) {
      req.serviceRequest = issue;
      return next();
    }

    const watching = await queryOne(db,
      'SELECT id FROM issue_watchers WHERE issue_id = ? AND user_id = ?',
      [issue.id, req.userId]);
    if (watching) {
      req.serviceRequest = issue;
      return next();
    }

    return res.status(404).json({ error: 'Request not found' });
  } catch (e) { serverError(res, e); }
}

// Customer-facing modules are mounted before this boundary. Everything after
// it is internal and refused once, rather than by every route remembering to
// check the client role independently.
function blockClients(req, res, next) {
  if (req.userRole === 'client') {
    return res.status(403).json({ error: 'Not available to service desk customers' });
  }
  next();
}

module.exports = { requireClientSafe, blockClients };
