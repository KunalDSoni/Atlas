// ===== HELP CENTER =====
// The customer-facing surface. Every response goes through toPublicRequest();
// no handler here builds a payload by hand.
//
// GET  /api/help/request-types
// POST /api/help/requests
// GET  /api/help/requests
// GET  /api/help/requests/:key
// POST /api/help/requests/:key/comments
// POST /api/help/requests/:key/resolve

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { requireClientSafe } = require('../middleware/servicedesk');
const { serverError } = require('../utils/errors');
const { toPublicRequest, validateSubmission, renderSubmission } = require('../utils/servicedesk');

const router = express.Router();

function parseFields(t) {
  try { return JSON.parse(t.fields || '[]'); } catch (e) { return []; }
}

// Resolves a status key to its label and category for the customer view.
async function statusFor(db, projectId, statusKey) {
  const row = await queryOne(db,
    'SELECT label, category FROM project_statuses WHERE project_id = ? AND key = ?',
    [projectId, statusKey]);
  if (row) return { statusLabel: row.label, statusCategory: row.category };
  const FALLBACK = {
    todo: ['To Do', 'todo'],
    in_progress: ['In Progress', 'in_progress'],
    in_review: ['In Review', 'in_progress'],
    done: ['Done', 'done'],
  };
  const [label, category] = FALLBACK[statusKey] || [statusKey, 'in_progress'];
  return { statusLabel: label, statusCategory: category };
}

async function projectRequest(db, issue) {
  const requestType = issue.request_type_id
    ? await queryOne(db, 'SELECT id, name, icon FROM sd_request_types WHERE id = ?', [issue.request_type_id])
    : null;
  const { statusLabel, statusCategory } = await statusFor(db, issue.project_id, issue.status);
  const comments = await queryAll(db,
    `SELECT c.id, c.body, c.visibility, c.created_at, u.name as author_name
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.issue_id = ? ORDER BY c.created_at`, [issue.id]);
  return toPublicRequest(issue, { requestType, statusLabel, statusCategory, comments });
}

// GET /api/help/request-types — every type in every service desk project.
router.get('/help/request-types', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT rt.id, rt.name, rt.description, rt.icon, rt.fields
         FROM sd_request_types rt
         JOIN projects p ON p.id = rt.project_id
        WHERE p.is_service_desk = 1
        ORDER BY rt.position, rt.created_at`);
    res.json(rows.map((t) => ({ ...t, fields: parseFields(t) })));
  } catch (e) { serverError(res, e); }
});

// POST /api/help/requests — raise one.
router.post('/help/requests', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { request_type_id, summary, fields } = req.body;
    if (!summary || !String(summary).trim()) return res.status(400).json({ error: 'Summary required' });

    const type = await queryOne(db,
      `SELECT rt.* FROM sd_request_types rt
         JOIN projects p ON p.id = rt.project_id
        WHERE rt.id = ? AND p.is_service_desk = 1`, [request_type_id]);
    if (!type) return res.status(404).json({ error: 'Request type not found' });

    const schema = parseFields(type);
    const submission = validateSubmission(schema, fields);
    if (!submission.ok) return res.status(400).json({ error: submission.error });

    const project = await queryOne(db, 'SELECT * FROM projects WHERE id = ?', [type.project_id]);
    const count = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE project_id = ?', [project.id]);
    const issueNumber = count.count + 1;
    const id = uuidv4();

    const statuses = await queryAll(db,
      'SELECT key FROM project_statuses WHERE project_id = ? ORDER BY position', [project.id]);
    const defaultStatus = statuses[0] ? statuses[0].key : 'todo';

    await run(db,
      `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, request_type_id, sd_fields, board_order)
       VALUES (?, ?, ?, ?, ?, ?, 'request', ?, 'medium', ?, ?, ?, 0)`,
      [id, project.id, `${project.key}-${issueNumber}`, issueNumber,
        String(summary).trim(), renderSubmission(schema, submission.values),
        defaultStatus, req.userId, type.id, JSON.stringify(submission.values)]);

    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [id]);
    res.status(201).json(await projectRequest(db, issue));
  } catch (e) { serverError(res, e); }
});

// GET /api/help/requests — mine, newest first.
router.get('/help/requests', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT * FROM issues
        WHERE type = 'request' AND (reporter_id = ?
          OR id IN (SELECT issue_id FROM issue_watchers WHERE user_id = ?))
        ORDER BY created_at DESC`, [req.userId, req.userId]);
    res.json(await Promise.all(rows.map((i) => projectRequest(db, i))));
  } catch (e) { serverError(res, e); }
});

// GET /api/help/requests/:key
router.get('/help/requests/:key', requireAuth, requireClientSafe, async (req, res) => {
  try {
    const db = await getDb();
    res.json(await projectRequest(db, req.serviceRequest));
  } catch (e) { serverError(res, e); }
});

// POST /api/help/requests/:key/comments — always public, whatever was asked for.
router.post('/help/requests/:key/comments', requireAuth, requireClientSafe, async (req, res) => {
  try {
    const db = await getDb();
    const { body } = req.body;
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'Comment body required' });

    const id = uuidv4();
    await run(db,
      "INSERT INTO comments (id, issue_id, author_id, body, visibility) VALUES (?, ?, ?, ?, 'public')",
      [id, req.serviceRequest.id, req.userId, String(body).trim()]);

    // Commenting subscribes the caller, which is how a second customer keeps access.
    const watching = await queryOne(db,
      'SELECT id FROM issue_watchers WHERE issue_id = ? AND user_id = ?', [req.serviceRequest.id, req.userId]);
    if (!watching) {
      await run(db, 'INSERT INTO issue_watchers (id, issue_id, user_id) VALUES (?, ?, ?)',
        [uuidv4(), req.serviceRequest.id, req.userId]);
    }

    const comment = await queryOne(db, 'SELECT * FROM comments WHERE id = ?', [id]);
    res.status(201).json({ id: comment.id, body: comment.body, created_at: comment.created_at });
  } catch (e) { serverError(res, e); }
});

// POST /api/help/requests/:key/resolve
router.post('/help/requests/:key/resolve', requireAuth, requireClientSafe, async (req, res) => {
  try {
    const db = await getDb();
    if (req.serviceRequest.reporter_id !== req.userId) {
      return res.status(403).json({ error: 'Only the reporter can resolve a request' });
    }
    const done = await queryOne(db,
      "SELECT key FROM project_statuses WHERE project_id = ? AND category = 'done' ORDER BY position LIMIT 1",
      [req.serviceRequest.project_id]);
    await run(db, 'UPDATE issues SET status = ? WHERE id = ?',
      [done ? done.key : 'done', req.serviceRequest.id]);
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.serviceRequest.id]);
    res.json(await projectRequest(db, issue));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
