// ===== PERSONAL DASHBOARD GADGETS =====
// GET /api/projects/:projectId/dashboard-layout — caller's layout or defaults
// PUT /api/projects/:projectId/dashboard-layout — replace the ordered layout

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const {
  defaultDashboardGadgets,
  parseDashboardGadgets,
  validateDashboardGadgets,
} = require('../utils/dashboard-layout');

const router = express.Router();

async function projectOr404(db, projectId, res) {
  const project = await queryOne(db, 'SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

router.get('/projects/:projectId/dashboard-layout', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!await projectOr404(db, req.params.projectId, res)) return;

    const layout = await queryOne(db,
      'SELECT gadgets, updated_at FROM dashboard_layouts WHERE user_id = ? AND project_id = ?',
      [req.userId, req.params.projectId]);
    if (!layout) {
      return res.json({ gadgets: defaultDashboardGadgets(), customized: false, updated_at: null });
    }
    res.json({
      gadgets: parseDashboardGadgets(layout.gadgets),
      customized: true,
      updated_at: layout.updated_at,
    });
  } catch (error) { serverError(res, error); }
});

router.put('/projects/:projectId/dashboard-layout', requireAuth, async (req, res) => {
  try {
    const validated = validateDashboardGadgets(req.body?.gadgets);
    if (validated.error) return res.status(400).json({ error: validated.error });

    const db = await getDb();
    if (!await projectOr404(db, req.params.projectId, res)) return;

    const existing = await queryOne(db,
      'SELECT id FROM dashboard_layouts WHERE user_id = ? AND project_id = ?',
      [req.userId, req.params.projectId]);
    const json = JSON.stringify(validated.gadgets);
    if (existing) {
      await run(db,
        'UPDATE dashboard_layouts SET gadgets = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [json, existing.id]);
    } else {
      await run(db,
        `INSERT INTO dashboard_layouts (id, user_id, project_id, gadgets)
         VALUES (?, ?, ?, ?)`,
        [uuidv4(), req.userId, req.params.projectId, json]);
    }

    const saved = await queryOne(db,
      'SELECT gadgets, updated_at FROM dashboard_layouts WHERE user_id = ? AND project_id = ?',
      [req.userId, req.params.projectId]);
    res.json({ gadgets: parseDashboardGadgets(saved.gadgets), customized: true, updated_at: saved.updated_at });
  } catch (error) { serverError(res, error); }
});

module.exports = router;
