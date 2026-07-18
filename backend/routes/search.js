// ===== GLOBAL SEARCH + SAVED FILTERS MODULE =====
// GET    /api/search?q= - Quick search across issues and wiki pages
// GET    /api/projects/:projectId/filters - List the caller's saved filters
// POST   /api/projects/:projectId/filters - Save a filter (name + params JSON)
// DELETE /api/filters/:id - Delete a saved filter (owner or admin)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { parseJql, isJqlLike } = require('../utils/jql');

const router = express.Router();

// GET /api/search?q=&project_id=
// Two modes: a plain-text LIKE search, or a JQL-lite structured query when the
// text contains an operator (e.g. `status = done AND assignee = me`). JQL-lite
// searches issues only; wiki pages are returned only for text queries.
router.get('/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ issues: [], pages: [] });
    const db = await getDb();

    if (isJqlLike(q)) {
      const parsed = parseJql(q, req.userId);
      if (parsed.error) return res.status(400).json({ error: parsed.error, jql: true });
      const clauses = [parsed.where];
      const params = [...parsed.params];
      if (req.query.project_id) { clauses.push('i.project_id = ?'); params.push(req.query.project_id); }
      const issues = await queryAll(db, `
        SELECT i.id, i.issue_key, i.title, i.type, i.status, i.priority, i.project_id,
               p.key AS project_key, p.name AS project_name,
               u.name AS assignee_name
        FROM issues i JOIN projects p ON p.id = i.project_id
        LEFT JOIN users u ON u.id = i.assignee_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.updated_at DESC LIMIT 50`, params);
      return res.json({ issues, pages: [], jql: true });
    }

    const like = `%${q}%`;
    let issueQuery = `
      SELECT i.id, i.issue_key, i.title, i.type, i.status, i.priority, i.project_id,
             p.key AS project_key, p.name AS project_name
      FROM issues i JOIN projects p ON p.id = i.project_id
      WHERE (i.title LIKE ? OR i.issue_key LIKE ? OR i.description LIKE ?)`;
    const issueParams = [like, like, like];
    if (req.query.project_id) {
      issueQuery += ' AND i.project_id = ?';
      issueParams.push(req.query.project_id);
    }
    issueQuery += ' ORDER BY i.updated_at DESC LIMIT 20';
    const issues = await queryAll(db, issueQuery, issueParams);

    const pages = await queryAll(db, `
      SELECT pg.id, pg.title, pg.slug, pg.space_id, s.name AS space_name, s.space_key
      FROM wiki_pages pg JOIN wiki_spaces s ON s.id = pg.space_id
      WHERE pg.status = 'current' AND (pg.title LIKE ? OR pg.body LIKE ?)
      ORDER BY pg.updated_at DESC LIMIT 10`, [like, like]);

    res.json({ issues, pages });
  } catch (e) { serverError(res, e); }
});

// GET /api/projects/:projectId/filters
router.get('/projects/:projectId/filters', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const filters = await queryAll(db,
      'SELECT * FROM saved_filters WHERE project_id = ? AND user_id = ? ORDER BY created_at',
      [req.params.projectId, req.userId]);
    res.json(filters.map((f) => ({
      ...f,
      params_parsed: (() => { try { return JSON.parse(f.params || '{}'); } catch (e) { return {}; } })(),
    })));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/filters
router.post('/projects/:projectId/filters', requireAuth, async (req, res) => {
  try {
    const { name, params } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Filter name required' });
    const db = await getDb();
    const id = uuidv4();
    await run(db, 'INSERT INTO saved_filters (id, project_id, user_id, name, params) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.projectId, req.userId, name.trim(), JSON.stringify(params || {})]);
    const filter = await queryOne(db, 'SELECT * FROM saved_filters WHERE id = ?', [id]);
    res.status(201).json({ ...filter, params_parsed: params || {} });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/filters/:id
router.delete('/filters/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const filter = await queryOne(db, 'SELECT * FROM saved_filters WHERE id = ?', [req.params.id]);
    if (!filter) return res.status(404).json({ error: 'Filter not found' });
    if (filter.user_id !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Not your filter' });
    }
    await run(db, 'DELETE FROM saved_filters WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
