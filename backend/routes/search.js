// ===== GLOBAL SEARCH + SAVED FILTERS MODULE =====
// GET    /api/search?q= - Quick search across issues and wiki pages
// GET    /api/projects/:projectId/filters - List the caller's saved filters
// POST   /api/projects/:projectId/filters - Save a validated backlog or JQL filter
// PUT    /api/filters/:id - Rename or replace one of the caller's filters
// DELETE /api/filters/:id - Delete a saved filter (owner or admin)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { parseJql, isJqlLike } = require('../utils/jql');
const {
  parseStoredFilterParams,
  validateFilterName,
  validateSavedFilterParams,
} = require('../utils/saved-filters');

const router = express.Router();

function presentFilter(filter, userId) {
  return { ...filter, params_parsed: parseStoredFilterParams(filter.params, userId) };
}

async function duplicateFilterName(db, { projectId, userId, name, excludeId = null }) {
  let sql = 'SELECT id FROM saved_filters WHERE project_id = ? AND user_id = ? AND LOWER(name) = LOWER(?)';
  const params = [projectId, userId, name];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  return queryOne(db, sql, params);
}

function canDeleteFilter(req, filter) {
  return filter.user_id === req.userId || req.userRole === 'admin';
}

// GET /api/search?q=&project_id=
// Two modes: a plain-text LIKE search, or a JQL v2 structured query when the
// text contains an operator (e.g. `status = done OR assignee IS EMPTY`). JQL
// searches issues only; wiki pages are returned only for text queries.
router.get('/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ issues: [], pages: [] });
    const db = await getDb();

    if (req.query.jql === 'true' || isJqlLike(q)) {
      const parsed = parseJql(q, req.userId);
      if (parsed.error) return res.status(400).json({ error: parsed.error, jql: true });
      const clauses = [parsed.where];
      const params = [...parsed.params];
      if (req.query.project_id) { clauses.push('i.project_id = ?'); params.push(req.query.project_id); }
      const issues = await queryAll(db, `
        SELECT i.id, i.issue_key, i.title, i.type, i.status, i.priority, i.project_id,
               p.key AS project_key, p.name AS project_name,
               u.name AS assignee_name,
               s.name AS sprint_name, s.slug AS sprint_slug
        FROM issues i JOIN projects p ON p.id = i.project_id
        LEFT JOIN users u ON u.id = i.assignee_id
        LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.updated_at DESC LIMIT 50`, params);
      return res.json({ issues, pages: [], jql: true });
    }

    const like = `%${q}%`;
    let issueQuery = `
      SELECT i.id, i.issue_key, i.title, i.type, i.status, i.priority, i.project_id,
             p.key AS project_key, p.name AS project_name,
             s.name AS sprint_name, s.slug AS sprint_slug
      FROM issues i JOIN projects p ON p.id = i.project_id
      LEFT JOIN sprints s ON s.id = i.sprint_id
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
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const filters = await queryAll(db,
      'SELECT * FROM saved_filters WHERE project_id = ? AND user_id = ? ORDER BY created_at, name, id',
      [req.params.projectId, req.userId]);
    res.json(filters.map((filter) => presentFilter(filter, req.userId)));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/filters
router.post('/projects/:projectId/filters', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const checkedName = validateFilterName(req.body?.name);
    if (checkedName.error) return res.status(400).json({ error: checkedName.error });
    const checkedParams = validateSavedFilterParams(req.body?.params ?? {}, req.userId);
    if (checkedParams.error) return res.status(400).json({ error: checkedParams.error, jql: true });
    if (await duplicateFilterName(db, {
      projectId: req.params.projectId, userId: req.userId, name: checkedName.value,
    })) {
      return res.status(409).json({ error: 'A saved filter with that name already exists' });
    }

    const id = uuidv4();
    await run(db, 'INSERT INTO saved_filters (id, project_id, user_id, name, params) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.projectId, req.userId, checkedName.value, JSON.stringify(checkedParams.value)]);
    const filter = await queryOne(db, 'SELECT * FROM saved_filters WHERE id = ?', [id]);
    res.status(201).json(presentFilter(filter, req.userId));
  } catch (e) { serverError(res, e); }
});

// PUT /api/filters/:id
router.put('/filters/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const filter = await queryOne(db, 'SELECT * FROM saved_filters WHERE id = ?', [req.params.id]);
    if (!filter) return res.status(404).json({ error: 'Filter not found' });
    if (filter.user_id !== req.userId) return res.status(403).json({ error: 'Not your filter' });

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Request body must be an object' });
    }
    const changesName = Object.prototype.hasOwnProperty.call(body, 'name');
    const changesParams = Object.prototype.hasOwnProperty.call(body, 'params');
    if (!changesName && !changesParams) {
      return res.status(400).json({ error: 'Name or params required' });
    }

    const checkedName = validateFilterName(changesName ? body.name : filter.name);
    if (checkedName.error) return res.status(400).json({ error: checkedName.error });
    const checkedParams = changesParams
      ? validateSavedFilterParams(body.params, filter.user_id)
      : { value: parseStoredFilterParams(filter.params, filter.user_id) };
    if (checkedParams.error) return res.status(400).json({ error: checkedParams.error, jql: true });
    if (await duplicateFilterName(db, {
      projectId: filter.project_id,
      userId: filter.user_id,
      name: checkedName.value,
      excludeId: filter.id,
    })) {
      return res.status(409).json({ error: 'A saved filter with that name already exists' });
    }

    await run(db, 'UPDATE saved_filters SET name = ?, params = ? WHERE id = ?',
      [checkedName.value, JSON.stringify(checkedParams.value), filter.id]);
    const updated = await queryOne(db, 'SELECT * FROM saved_filters WHERE id = ?', [filter.id]);
    res.json(presentFilter(updated, req.userId));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/filters/:id
router.delete('/filters/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const filter = await queryOne(db, 'SELECT * FROM saved_filters WHERE id = ?', [req.params.id]);
    if (!filter) return res.status(404).json({ error: 'Filter not found' });
    if (!canDeleteFilter(req, filter)) {
      return res.status(403).json({ error: 'Not your filter' });
    }
    await run(db, 'DELETE FROM saved_filters WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
