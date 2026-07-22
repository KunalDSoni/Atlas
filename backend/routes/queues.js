// ===== AGENT QUEUES =====
// The agent-facing side of the service desk: named, saved JQL views over a
// project's issues, with live counts in the sidebar.
//
// GET    /api/projects/:projectId/queues          (with live counts)
// POST   /api/projects/:projectId/queues          (board admin)
// GET    /api/queues/:id
// PUT    /api/queues/:id                          (board admin)
// DELETE /api/queues/:id                          (board admin)
// GET    /api/queues/:id/issues                   (opt-in pagination, epic 28)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { parseJql } = require('../utils/jql');
const { validateQueue, ORDER_BY, DEFAULT_ORDER_BY } = require('../utils/queues');
const { slaState } = require('../utils/sla');
const { placeholders } = require('../utils/sql');

const router = express.Router();
const requireBoardAdmin = requireRole('admin', 'board_admin');

/**
 * Attaches `sla: { <metric>: state }` to each row.
 *
 * One query for every clock on the page, then slaState() per clock — the same
 * function the request detail and the report call, so a queue badge cannot
 * disagree with a report. Rows without goals get `{}` rather than null, so a
 * column renderer never has to null-check before looking up a metric.
 */
async function withSlaState(db, rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const clocks = await queryAll(db,
    `SELECT * FROM sd_sla_clocks WHERE issue_id IN (${placeholders(ids)})`, ids);

  const byIssue = new Map();
  for (const clock of clocks) {
    const state = slaState(clock, { target_minutes: clock.target_minutes });
    if (!state) continue;
    if (!byIssue.has(clock.issue_id)) byIssue.set(clock.issue_id, {});
    byIssue.get(clock.issue_id)[clock.metric] = state;
  }
  return rows.map((r) => ({ ...r, sla: byIssue.get(r.id) || {} }));
}

function parseQueue(q) {
  let columns = [];
  try { columns = JSON.parse(q.column_keys || '[]'); } catch (e) { columns = []; }
  const { column_keys, ...rest } = q;
  return { ...rest, columns };
}

// GET /api/projects/:projectId/queues
//
// Counts for the whole sidebar come from ONE query: each queue contributes a
// SUM(CASE WHEN <its where> ...) column over a single pass of the project's
// issues. The obvious alternative — a COUNT per queue — is N round trips that
// grow every time someone saves a view.
router.get('/projects/:projectId/queues', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      'SELECT * FROM sd_queues WHERE project_id = ? ORDER BY position, created_at',
      [req.params.projectId]);
    const queues = rows.map(parseQueue);
    if (queues.length === 0) return res.json([]);

    // A stored query can stop parsing if the JQL grammar changes under it. Such
    // a queue still lists — so it can be found and fixed — but reports no count,
    // and does not take the rest of the sidebar down with it.
    const parsed = queues.map((q) => parseJql(q.jql, req.userId));

    const selects = [];
    const params = [];
    parsed.forEach((p, i) => {
      if (p.error) return;
      selects.push(`SUM(CASE WHEN ${p.where} THEN 1 ELSE 0 END) AS c${i}`);
      params.push(...p.params);
    });

    let counts = {};
    if (selects.length > 0) {
      params.push(req.params.projectId);
      counts = await queryOne(db,
        `SELECT ${selects.join(', ')} FROM issues i
           JOIN projects p ON p.id = i.project_id
          WHERE i.project_id = ?`, params) || {};
    }

    res.json(queues.map((q, i) => ({
      ...q,
      invalid: parsed[i].error || null,
      // mysql2 returns SUM() as a string, and SUM over no rows is NULL.
      count: parsed[i].error ? null : Number(counts[`c${i}`] || 0),
    })));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/queues
router.post('/projects/:projectId/queues', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const valid = validateQueue(req.body, req.userId);
    if (!valid.ok) return res.status(400).json({ error: valid.error });

    const id = uuidv4();
    const q = valid.queue;
    await run(db,
      'INSERT INTO sd_queues (id, project_id, name, jql, column_keys, order_by, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, q.name, q.jql, JSON.stringify(q.columns), q.order_by, q.position]);

    const created = await queryOne(db, 'SELECT * FROM sd_queues WHERE id = ?', [id]);
    res.status(201).json(parseQueue(created));
  } catch (e) { serverError(res, e); }
});

// GET /api/queues/:id
router.get('/queues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const row = await queryOne(db, 'SELECT * FROM sd_queues WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Queue not found' });
    res.json(parseQueue(row));
  } catch (e) { serverError(res, e); }
});

// PUT /api/queues/:id
router.put('/queues/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM sd_queues WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Queue not found' });

    // Validate the MERGED queue, not the patch: a partial update that changes
    // only the sort still has to leave a coherent, parseable definition behind.
    const merged = { ...parseQueue(existing), ...req.body };
    const valid = validateQueue(merged, req.userId);
    if (!valid.ok) return res.status(400).json({ error: valid.error });

    const q = valid.queue;
    await run(db,
      'UPDATE sd_queues SET name = ?, jql = ?, column_keys = ?, order_by = ?, position = ? WHERE id = ?',
      [q.name, q.jql, JSON.stringify(q.columns), q.order_by, q.position, req.params.id]);

    const updated = await queryOne(db, 'SELECT * FROM sd_queues WHERE id = ?', [req.params.id]);
    res.json(parseQueue(updated));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/queues/:id
router.delete('/queues/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM sd_queues WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Queue not found' });
    await run(db, 'DELETE FROM sd_queues WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/queues/:id/issues
//
// A lean row built for a table, not the full enrichIssues() payload: a queue
// shows at most a dozen columns and can hold hundreds of rows, so enrichment's
// eight batch lookups would be paid for data no column displays.
router.get('/queues/:id/issues', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const queue = await queryOne(db, 'SELECT * FROM sd_queues WHERE id = ?', [req.params.id]);
    if (!queue) return res.status(404).json({ error: 'Queue not found' });

    const parsed = parseJql(queue.jql, req.userId);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    // The project filter is the queue's, not the query's: a stored JQL says
    // nothing about scope, and a queue on one project must never surface
    // another project's issues.
    const from = `FROM issues i
      JOIN projects p ON p.id = i.project_id
      LEFT JOIN users a ON a.id = i.assignee_id
      LEFT JOIN users r ON r.id = i.reporter_id
      LEFT JOIN sd_request_types rt ON rt.id = i.request_type_id
      WHERE i.project_id = ? AND (${parsed.where})`;
    const params = [queue.project_id, ...parsed.params];

    // Opt-in pagination, matching the issues list (epic 28): no `limit` returns
    // the full set; `limit` pages and exposes the total.
    const hasLimit = req.query.limit !== undefined;
    if (hasLimit) {
      const total = await queryOne(db, `SELECT COUNT(*) AS c ${from}`, params);
      res.setHeader('X-Total-Count', String(total?.c ?? 0));
    }

    // ORDER_BY is a fixed map. `order_by` was validated against its keys on
    // write; this still falls back rather than trusting whatever is stored,
    // because the clause is interpolated and a bad value would be SQL.
    const orderBy = ORDER_BY[queue.order_by] || ORDER_BY[DEFAULT_ORDER_BY];
    let sql = `SELECT i.id, i.issue_key, i.title, i.type, i.status, i.priority, i.labels,
                      i.created_at, i.updated_at, i.request_type_id,
                      a.name AS assignee_name, a.avatar_color AS assignee_color,
                      r.name AS reporter_name, r.avatar_color AS reporter_color,
                      rt.name AS request_type_name, rt.icon AS request_type_icon
               ${from} ORDER BY ${orderBy}`;

    if (hasLimit) {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const rows = await queryAll(db, sql, params);
    res.json(await withSlaState(db, rows));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
