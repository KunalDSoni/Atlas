// ===== SERVICE DESK REQUEST TYPES =====
// The forms a customer can raise a request through. Agent-facing CRUD; the
// customer-facing projection of these lives in routes/help.js.
//
// GET    /api/projects/:projectId/request-types
// POST   /api/projects/:projectId/request-types   (board admin)
// GET    /api/request-types/:id
// PUT    /api/request-types/:id                   (board admin)
// DELETE /api/request-types/:id                   (board admin, 409 if in use)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { validateFieldSchema } = require('../utils/servicedesk');

const router = express.Router();
const requireBoardAdmin = requireRole('admin', 'board_admin');

function parseType(t) {
  let fields = [];
  try { fields = JSON.parse(t.fields || '[]'); } catch (e) { fields = []; }
  return { ...t, fields };
}

// GET /api/projects/:projectId/request-types
router.get('/projects/:projectId/request-types', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      'SELECT * FROM sd_request_types WHERE project_id = ? ORDER BY position, created_at',
      [req.params.projectId]);
    res.json(rows.map(parseType));
  } catch (e) { serverError(res, e); }
});

// GET /api/request-types/:id
router.get('/request-types/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const row = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Request type not found' });
    res.json(parseType(row));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/request-types
router.post('/projects/:projectId/request-types', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, description, icon, fields, position } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });

    const schema = validateFieldSchema(fields);
    if (!schema.ok) return res.status(400).json({ error: schema.error });

    const id = uuidv4();
    await run(db,
      'INSERT INTO sd_request_types (id, project_id, name, description, icon, fields, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, String(name).trim(), description || '', icon || 'help-circle',
        JSON.stringify(schema.fields), position || 0]);

    const created = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [id]);
    res.status(201).json(parseType(created));
  } catch (e) { serverError(res, e); }
});

// PUT /api/request-types/:id
router.put('/request-types/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Request type not found' });

    const { name, description, icon, fields, position } = req.body;
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name required' });

    let fieldsJson = existing.fields;
    if (fields !== undefined) {
      const schema = validateFieldSchema(fields);
      if (!schema.ok) return res.status(400).json({ error: schema.error });
      fieldsJson = JSON.stringify(schema.fields);
    }

    await run(db,
      'UPDATE sd_request_types SET name = ?, description = ?, icon = ?, fields = ?, position = ? WHERE id = ?',
      [name !== undefined ? String(name).trim() : existing.name,
        description !== undefined ? description : existing.description,
        icon !== undefined ? icon : existing.icon,
        fieldsJson,
        position !== undefined ? position : existing.position,
        req.params.id]);

    const updated = await queryOne(db, 'SELECT * FROM sd_request_types WHERE id = ?', [req.params.id]);
    res.json(parseType(updated));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/request-types/:id
router.delete('/request-types/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Request type not found' });

    // Deleting a type that requests point at would orphan them: the request
    // would render with no form and no name. Refuse instead.
    const inUse = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE request_type_id = ?', [req.params.id]);
    if (inUse.count > 0) {
      return res.status(409).json({ error: `${inUse.count} request(s) use this type` });
    }

    await run(db, 'DELETE FROM sd_request_types WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
