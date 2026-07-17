// ===== PRODUCT: FEATURES & PRIORITIZATION MODULE =====
// GET    /api/product/features                 - List features enriched with scores (?project_id=&status=&timeframe=)
// POST   /api/product/features                 - Create feature
// GET    /api/product/features/:id             - Single feature with insights, issues, objectives
// PUT    /api/product/features/:id             - Update feature fields
// DELETE /api/product/features/:id             - Delete feature + cascade its links/votes
// POST   /api/product/features/:id/issues      - Link an existing delivery issue
// POST   /api/product/features/:id/push        - Create a new issue in a project and link it
// DELETE /api/product/feature-issues/:id       - Unlink a delivery issue
// POST   /api/product/features/:id/vote        - Toggle current user's vote
//
// Computed scores (never stored):
//   user_impact = Σ linked-insight importance × company tier weight (strategic 3 / growth 2 / else 1)
//   rice        = reach × impact × (confidence/100) / max(effort, 1)
//   delivery    = done-category linked issues / total linked issues

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { projectStatuses } = require('./workflows');

const router = express.Router();

const FEATURE_STATUSES = ['idea', 'discovery', 'planned', 'in_progress', 'launched', 'archived'];
const TIMEFRAMES = ['now', 'next', 'later'];
const PORTAL_STATUSES = ['under_consideration', 'planned', 'launched'];

// Tier-weighted sum of linked insight importance. ELSE 1 covers both 'standard'
// and insights with no customer/company attached.
const USER_IMPACT_SQL = `
  (SELECT COALESCE(SUM(il.importance * CASE co.tier WHEN 'strategic' THEN 3 WHEN 'growth' THEN 2 ELSE 1 END), 0)
   FROM pb_insight_links il
   JOIN pb_insights ins ON il.insight_id = ins.id
   LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
   LEFT JOIN pb_companies co ON cu.company_id = co.id
   WHERE il.feature_id = f.id)`;

// An issue counts as done if its literal status is 'done' or its project's
// workflow maps that status key to the done category.
const DELIVERY_DONE_SQL = `
  (SELECT COUNT(*) FROM pb_feature_issues fi JOIN issues iss ON fi.issue_id = iss.id
   WHERE fi.feature_id = f.id AND (iss.status = 'done' OR EXISTS (
     SELECT 1 FROM project_statuses ps
     WHERE ps.project_id = iss.project_id AND ps.key = iss.status AND ps.category = 'done')))`;

const ENRICHED_SELECT = `
  SELECT f.*, u.name as owner_name, p.name as project_name, p.key as project_key,
    v.name as release_name,
    ${USER_IMPACT_SQL} as user_impact,
    (SELECT COUNT(*) FROM pb_insight_links il2 WHERE il2.feature_id = f.id) as insight_count,
    (SELECT COUNT(*) FROM pb_votes pv WHERE pv.feature_id = f.id) as vote_count,
    (SELECT COUNT(*) FROM pb_feature_issues fi2 WHERE fi2.feature_id = f.id) as delivery_total,
    ${DELIVERY_DONE_SQL} as delivery_done
  FROM pb_features f
  LEFT JOIN users u ON f.owner_id = u.id
  LEFT JOIN projects p ON f.project_id = p.id
  LEFT JOIN versions v ON f.release_id = v.id`;

function withRice(feature) {
  const { reach, impact, confidence, effort } = feature;
  const rice = (reach && impact && confidence)
    ? Math.round((reach * impact * (confidence / 100)) / Math.max(effort || 1, 1) * 10) / 10
    : null;
  return { ...feature, rice };
}

async function getEnrichedFeature(db, id) {
  const feature = await queryOne(db, `${ENRICHED_SELECT} WHERE f.id = ?`, [id]);
  return feature ? withRice(feature) : null;
}

// GET /api/product/features
router.get('/product/features', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const clauses = [];
    const params = [];
    if (req.query.project_id) { clauses.push('f.project_id = ?'); params.push(req.query.project_id); }
    if (req.query.status) { clauses.push('f.status = ?'); params.push(req.query.status); }
    if (req.query.timeframe) { clauses.push('f.timeframe = ?'); params.push(req.query.timeframe); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const features = await queryAll(db, `${ENRICHED_SELECT}${where} ORDER BY f.created_at DESC`, params);
    res.json(features.map(withRice));
  } catch (e) { serverError(res, e); }
});

// POST /api/product/features
router.post('/product/features', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, description, project_id, status, timeframe, portal_status,
            owner_id, effort, value, reach, impact, confidence, release_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    if (status && !FEATURE_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
    if (timeframe && !TIMEFRAMES.includes(timeframe)) return res.status(400).json({ error: 'invalid timeframe' });
    if (portal_status && !PORTAL_STATUSES.includes(portal_status)) return res.status(400).json({ error: 'invalid portal_status' });

    const id = uuidv4();
    await run(db, `INSERT INTO pb_features (id, project_id, name, description, status, timeframe, portal_status, owner_id, effort, value, reach, impact, confidence, release_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, project_id || null, name.trim(), description || '', status || 'idea',
       timeframe || null, portal_status || null, owner_id || null,
       effort ?? null, value ?? null, reach ?? null, impact ?? null, confidence ?? null,
       release_id || null, req.userId]);
    res.status(201).json(await getEnrichedFeature(db, id));
  } catch (e) { serverError(res, e); }
});

// GET /api/product/features/:id — full detail: linked insights (with quotes), issues, objectives
router.get('/product/features/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await getEnrichedFeature(db, req.params.id);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });

    feature.insights = await queryAll(db,
      `SELECT il.id as link_id, il.importance, il.quote, ins.*,
         cu.name as customer_name, co.name as company_name, co.tier as company_tier
       FROM pb_insight_links il
       JOIN pb_insights ins ON il.insight_id = ins.id
       LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
       LEFT JOIN pb_companies co ON cu.company_id = co.id
       WHERE il.feature_id = ?
       ORDER BY il.importance DESC, ins.created_at DESC`, [req.params.id]);
    feature.issues = await queryAll(db,
      `SELECT fi.id as link_id, iss.id, iss.issue_key, iss.title, iss.status, iss.type, iss.project_id,
         CASE WHEN iss.status = 'done' OR EXISTS (
           SELECT 1 FROM project_statuses ps
           WHERE ps.project_id = iss.project_id AND ps.key = iss.status AND ps.category = 'done')
         THEN 1 ELSE 0 END as is_done
       FROM pb_feature_issues fi
       JOIN issues iss ON fi.issue_id = iss.id
       WHERE fi.feature_id = ?
       ORDER BY iss.issue_key`, [req.params.id]);
    feature.objectives = await queryAll(db,
      `SELECT fo.id as link_id, o.*
       FROM pb_feature_objectives fo
       JOIN pb_objectives o ON fo.objective_id = o.id
       WHERE fo.feature_id = ?
       ORDER BY o.name`, [req.params.id]);
    res.json(feature);
  } catch (e) { serverError(res, e); }
});

// PUT /api/product/features/:id
router.put('/product/features/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Feature not found' });

    const body = req.body;
    if (body.status !== undefined && !FEATURE_STATUSES.includes(body.status)) return res.status(400).json({ error: 'invalid status' });
    if (body.timeframe !== undefined && body.timeframe !== null && !TIMEFRAMES.includes(body.timeframe)) return res.status(400).json({ error: 'invalid timeframe' });
    if (body.portal_status !== undefined && body.portal_status !== null && !PORTAL_STATUSES.includes(body.portal_status)) return res.status(400).json({ error: 'invalid portal_status' });

    const fields = ['project_id', 'name', 'description', 'status', 'timeframe', 'portal_status',
                    'owner_id', 'effort', 'value', 'reach', 'impact', 'confidence', 'release_id'];
    const updated = {};
    fields.forEach(fld => { updated[fld] = body[fld] !== undefined ? body[fld] : existing[fld]; });
    await run(db, `UPDATE pb_features SET project_id = ?, name = ?, description = ?, status = ?, timeframe = ?, portal_status = ?, owner_id = ?, effort = ?, value = ?, reach = ?, impact = ?, confidence = ?, release_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [...fields.map(fld => updated[fld]), req.params.id]);
    res.json(await getEnrichedFeature(db, req.params.id));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/features/:id — cascade all links (FKs are not enforced)
router.delete('/product/features/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_insight_links WHERE feature_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_feature_issues WHERE feature_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_feature_objectives WHERE feature_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_votes WHERE feature_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_features WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// POST /api/product/features/:id/issues — link an existing issue
router.post('/product/features/:id/issues', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await queryOne(db, 'SELECT id FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    const { issue_id } = req.body;
    if (!issue_id) return res.status(400).json({ error: 'issue_id required' });
    const issue = await queryOne(db, 'SELECT id FROM issues WHERE id = ?', [issue_id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    const dup = await queryOne(db, 'SELECT id FROM pb_feature_issues WHERE feature_id = ? AND issue_id = ?', [req.params.id, issue_id]);
    if (dup) return res.status(400).json({ error: 'Issue already linked' });

    await run(db, 'INSERT INTO pb_feature_issues (id, feature_id, issue_id) VALUES (?, ?, ?)',
      [uuidv4(), req.params.id, issue_id]);
    res.status(201).json(await getEnrichedFeature(db, req.params.id));
  } catch (e) { serverError(res, e); }
});

// POST /api/product/features/:id/push — create a delivery issue (epic/story/task) and link it
router.post('/product/features/:id/push', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });

    const { project_id, type } = req.body;
    const targetProjectId = project_id || feature.project_id;
    if (!targetProjectId) return res.status(400).json({ error: 'project_id required' });
    const issueType = type || 'epic';
    if (!['epic', 'story', 'task'].includes(issueType)) return res.status(400).json({ error: 'type must be epic, story, or task' });
    const project = await queryOne(db, 'SELECT * FROM projects WHERE id = ?', [targetProjectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const issueCount = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE project_id = ?', [targetProjectId]);
    const issueNumber = issueCount.count + 1;
    const statuses = await projectStatuses(db, targetProjectId);
    const defaultStatus = statuses[0]?.key || 'todo';
    const issueId = uuidv4();
    await run(db, `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, labels, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'medium', ?, '[]', 0)`,
      [issueId, targetProjectId, `${project.key}-${issueNumber}`, issueNumber,
       feature.name, feature.description || '', issueType, defaultStatus, req.userId]);
    await run(db, 'INSERT INTO pb_feature_issues (id, feature_id, issue_id) VALUES (?, ?, ?)',
      [uuidv4(), req.params.id, issueId]);

    // Pushing a planned feature moves it into delivery
    if (feature.status === 'idea' || feature.status === 'discovery' || feature.status === 'planned') {
      await run(db, "UPDATE pb_features SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
    }
    res.status(201).json(await getEnrichedFeature(db, req.params.id));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/feature-issues/:id
router.delete('/product/feature-issues/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM pb_feature_issues WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// POST /api/product/features/:id/vote — toggle
router.post('/product/features/:id/vote', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await queryOne(db, 'SELECT id FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    const existing = await queryOne(db, 'SELECT id FROM pb_votes WHERE feature_id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (existing) {
      await run(db, 'DELETE FROM pb_votes WHERE id = ?', [existing.id]);
    } else {
      await run(db, 'INSERT INTO pb_votes (id, feature_id, user_id) VALUES (?, ?, ?)', [uuidv4(), req.params.id, req.userId]);
    }
    const count = await queryOne(db, 'SELECT COUNT(*) as c FROM pb_votes WHERE feature_id = ?', [req.params.id]);
    res.json({ voted: !existing, vote_count: count.c });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
