// ===== CUSTOM FIELDS =====
// Per-project custom field definitions + per-issue values.
// GET    /api/projects/:projectId/fields       - List field definitions
// POST   /api/projects/:projectId/fields       - Create a field (board admin)
// PUT    /api/fields/:id                        - Update name/options/position
// DELETE /api/fields/:id                        - Delete (and its values)
// PUT    /api/issues/:issueId/fields            - Set values { field_id: value, ... }

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();
const requireBoardAdmin = requireRole('admin', 'board_admin');
const TYPES = ['text', 'number', 'select', 'date', 'checkbox'];

function parseOptions(f) {
  let options = [];
  try { options = JSON.parse(f.options || '[]'); } catch (e) { options = []; }
  return { ...f, options };
}

// Validate a raw value against a field type; returns { ok, value } or { ok:false, error }.
function coerce(type, options, raw) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const s = String(raw);
  switch (type) {
    case 'number':
      if (isNaN(Number(s))) return { ok: false, error: 'must be a number' };
      return { ok: true, value: s };
    case 'select':
      if (!options.includes(s)) return { ok: false, error: 'not a valid option' };
      return { ok: true, value: s };
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: 'must be YYYY-MM-DD' };
      return { ok: true, value: s };
    case 'checkbox':
      return { ok: true, value: (s === 'true' || s === '1') ? '1' : '0' };
    default:
      return { ok: true, value: s.slice(0, 2000) };
  }
}

// GET /api/projects/:projectId/fields
router.get('/projects/:projectId/fields', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, 'SELECT * FROM custom_fields WHERE project_id = ? ORDER BY position, created_at', [req.params.projectId]);
    res.json(rows.map(parseOptions));
  } catch (e) { serverError(res, e); }
});

// POST /api/projects/:projectId/fields
router.post('/projects/:projectId/fields', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const name = String(req.body.name || '').trim();
    const type = req.body.field_type || 'text';
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'invalid field_type' });
    const options = type === 'select' && Array.isArray(req.body.options)
      ? req.body.options.map((o) => String(o).trim()).filter(Boolean) : [];
    if (type === 'select' && options.length === 0) return res.status(400).json({ error: 'select fields need options' });

    const maxPos = await queryOne(db, 'SELECT COALESCE(MAX(position),0)+1 as p FROM custom_fields WHERE project_id = ?', [req.params.projectId]);
    const id = uuidv4();
    await run(db, 'INSERT INTO custom_fields (id, project_id, name, field_type, options, position) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.projectId, name, type, JSON.stringify(options), maxPos.p]);
    res.status(201).json(parseOptions(await queryOne(db, 'SELECT * FROM custom_fields WHERE id = ?', [id])));
  } catch (e) { serverError(res, e); }
});

// PUT /api/fields/:id
router.put('/fields/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const field = await queryOne(db, 'SELECT * FROM custom_fields WHERE id = ?', [req.params.id]);
    if (!field) return res.status(404).json({ error: 'Field not found' });
    const name = req.body.name !== undefined ? String(req.body.name).trim() : field.name;
    const options = req.body.options !== undefined
      ? JSON.stringify((req.body.options || []).map((o) => String(o).trim()).filter(Boolean))
      : field.options;
    const position = req.body.position !== undefined ? Number(req.body.position) : field.position;
    await run(db, 'UPDATE custom_fields SET name = ?, options = ?, position = ? WHERE id = ?', [name, options, position, req.params.id]);
    res.json(parseOptions(await queryOne(db, 'SELECT * FROM custom_fields WHERE id = ?', [req.params.id])));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/fields/:id
router.delete('/fields/:id', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM issue_field_values WHERE field_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM custom_fields WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// PUT /api/issues/:issueId/fields  { values: { field_id: value } }
router.put('/issues/:issueId/fields', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT id, project_id FROM issues WHERE id = ?', [req.params.issueId]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    const values = req.body.values || {};

    for (const [fieldId, raw] of Object.entries(values)) {
      const field = await queryOne(db, 'SELECT * FROM custom_fields WHERE id = ? AND project_id = ?', [fieldId, issue.project_id]);
      if (!field) continue; // ignore stray field ids
      const { options } = parseOptions(field);
      const c = coerce(field.field_type, options, raw);
      if (!c.ok) return res.status(400).json({ error: `${field.name}: ${c.error}` });

      const existing = await queryOne(db, 'SELECT id FROM issue_field_values WHERE issue_id = ? AND field_id = ?', [req.params.issueId, fieldId]);
      if (c.value === null) {
        if (existing) await run(db, 'DELETE FROM issue_field_values WHERE id = ?', [existing.id]);
      } else if (existing) {
        await run(db, 'UPDATE issue_field_values SET value = ? WHERE id = ?', [c.value, existing.id]);
      } else {
        await run(db, 'INSERT INTO issue_field_values (id, issue_id, field_id, value) VALUES (?, ?, ?, ?)', [uuidv4(), req.params.issueId, fieldId, c.value]);
      }
    }
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// Enrichment helper: custom fields (definitions + this issue's values) for an issue.
async function issueCustomFields(db, issue) {
  const rows = await queryAll(db,
    `SELECT f.id as field_id, f.name, f.field_type, f.options, f.position, v.value
     FROM custom_fields f
     LEFT JOIN issue_field_values v ON v.field_id = f.id AND v.issue_id = ?
     WHERE f.project_id = ? ORDER BY f.position, f.created_at`,
    [issue.id, issue.project_id]);
  return rows.map((r) => ({ ...parseOptions(r), value: r.value ?? null }));
}

module.exports = router;
module.exports.issueCustomFields = issueCustomFields;
