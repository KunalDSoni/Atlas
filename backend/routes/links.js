// ===== ISSUE LINKS MODULE =====
// GET    /api/issues/:issueId/links - List linked issues
// POST   /api/issues/:issueId/links - Create link
// DELETE /api/issue-links/:id       - Delete link

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/issues/:issueId/links
router.get('/issues/:issueId/links', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    // Get links where this issue is source or target
    const links = await queryAll(db,
      `SELECT l.*,
         si.issue_key as source_key, si.title as source_title, si.status as source_status, si.type as source_type,
         ti.issue_key as target_key, ti.title as target_title, ti.status as target_status, ti.type as target_type,
         u.name as created_by_name
       FROM issue_links l
       JOIN issues si ON l.source_issue_id = si.id
       JOIN issues ti ON l.target_issue_id = ti.id
       LEFT JOIN users u ON l.created_by = u.id
       WHERE l.source_issue_id = ? OR l.target_issue_id = ?
       ORDER BY l.created_at DESC`,
      [req.params.issueId, req.params.issueId]
    );
    res.json(links);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/issues/:issueId/links
router.post('/issues/:issueId/links', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { target_issue_id, link_type } = req.body;
    if (!target_issue_id) return res.status(400).json({ error: 'target_issue_id required' });

    // Verify target exists
    const target = await queryOne(db, 'SELECT id FROM issues WHERE id = ?', [target_issue_id]);
    if (!target) return res.status(404).json({ error: 'Target issue not found' });

    const id = uuidv4();
    await run(db, `INSERT INTO issue_links (id, source_issue_id, target_issue_id, link_type, created_by) VALUES (?, ?, ?, ?, ?)`,
      [id, req.params.issueId, target_issue_id, link_type || 'relates_to', req.userId]);

    const link = await queryOne(db,
      `SELECT l.*,
         si.issue_key as source_key, si.title as source_title, si.status as source_status, si.type as source_type,
         ti.issue_key as target_key, ti.title as target_title, ti.status as target_status, ti.type as target_type
       FROM issue_links l
       JOIN issues si ON l.source_issue_id = si.id
       JOIN issues ti ON l.target_issue_id = ti.id
       WHERE l.id = ?`, [id]);

    res.status(201).json(link);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/issue-links/:id
router.delete('/issue-links/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM issue_links WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
