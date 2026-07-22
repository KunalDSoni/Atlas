// ===== RELEASES (FIX VERSIONS) + COMPONENTS MODULE =====
// GET    /api/projects/:id/versions - Versions with per-version issue rollups
// POST   /api/projects/:id/versions - Create version (board admin)
// PUT    /api/versions/:id - Update name/description/status/release_date
// DELETE /api/versions/:id - Delete; issues keep working (fix_version_id -> NULL)
// GET    /api/projects/:id/components - Components with issue counts
// POST   /api/projects/:id/components - Create component (board admin)
// PUT    /api/components/:id - Update name/description
// DELETE /api/components/:id - Delete; issues' component_id -> NULL

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { slugify, uniqueSlug } = require('../utils/slug');

const requireBoardAdmin = requireRole('admin', 'board_admin');
const router = express.Router();

// GET /api/projects/:projectId/versions
router.get('/projects/:projectId/versions', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const versions = await queryAll(db, `
      SELECT v.*,
        (SELECT COUNT(*) FROM issues i WHERE i.fix_version_id = v.id) AS issue_count,
        (SELECT COUNT(*) FROM issues i WHERE i.fix_version_id = v.id AND i.status = 'done') AS done_count
      FROM versions v WHERE v.project_id = ? ORDER BY v.created_at`, [req.params.projectId]);
    res.json(versions.map((v) => ({ ...v, issue_count: Number(v.issue_count), done_count: Number(v.done_count) })));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/versions
router.post('/projects/:projectId/versions', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const { name, description, release_date } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Version name required' });
    const db = await getDb();
    const id = uuidv4();
    const cleanName = name.trim();
    const taken = (await queryAll(db, 'SELECT slug FROM versions WHERE project_id = ?', [req.params.projectId]))
      .map((row) => row.slug).filter(Boolean);
    const slug = uniqueSlug(slugify(cleanName), taken);
    await run(db, 'INSERT INTO versions (id, project_id, name, slug, description, release_date) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, cleanName, slug, description || null, release_date || null]);
    const version = await queryOne(db, 'SELECT * FROM versions WHERE id = ?', [id]);
    res.status(201).json({ ...version, issue_count: 0, done_count: 0 });
  } catch (e) { serverError(res, e); }
});

// PUT /api/versions/:id
router.put('/versions/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const version = await queryOne(db, 'SELECT * FROM versions WHERE id = ?', [req.params.id]);
    if (!version) return res.status(404).json({ error: 'Version not found' });
    if (req.body.status !== undefined && !['unreleased', 'released'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid version status' });
    }
    const allowed = ['name', 'description', 'status', 'release_date'];
    const updates = []; const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { updates.push(`${key} = ?`); params.push(req.body[key]); }
    }
    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE versions SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    res.json(await queryOne(db, 'SELECT * FROM versions WHERE id = ?', [req.params.id]));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/versions/:id
router.delete('/versions/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'UPDATE issues SET fix_version_id = NULL WHERE fix_version_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM versions WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/projects/:projectId/components
router.get('/projects/:projectId/components', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const components = await queryAll(db, `
      SELECT c.*,
        (SELECT COUNT(*) FROM issues i WHERE i.component_id = c.id) AS issue_count
      FROM components c WHERE c.project_id = ? ORDER BY c.name`, [req.params.projectId]);
    res.json(components.map((c) => ({ ...c, issue_count: Number(c.issue_count) })));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/components
router.post('/projects/:projectId/components', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Component name required' });
    const db = await getDb();
    const id = uuidv4();
    await run(db, 'INSERT INTO components (id, project_id, name, description) VALUES (?, ?, ?, ?)',
      [id, req.params.projectId, name.trim(), description || null]);
    const component = await queryOne(db, 'SELECT * FROM components WHERE id = ?', [id]);
    res.status(201).json({ ...component, issue_count: 0 });
  } catch (e) { serverError(res, e); }
});

// PUT /api/components/:id
router.put('/components/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const component = await queryOne(db, 'SELECT * FROM components WHERE id = ?', [req.params.id]);
    if (!component) return res.status(404).json({ error: 'Component not found' });
    const allowed = ['name', 'description'];
    const updates = []; const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { updates.push(`${key} = ?`); params.push(req.body[key]); }
    }
    if (updates.length > 0) {
      params.push(req.params.id);
      await run(db, `UPDATE components SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    res.json(await queryOne(db, 'SELECT * FROM components WHERE id = ?', [req.params.id]));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/components/:id
router.delete('/components/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'UPDATE issues SET component_id = NULL WHERE component_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM components WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
