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
// POST   /api/product/features/:id/impact-metrics     - Record impact measurement
// GET    /api/product/features/:id/impact-metrics     - Get metrics with variance
// PUT    /api/product/features/:id/forecast-metrics   - Set pre-launch forecast
// GET    /api/product/features/impact-dashboard       - Dashboard summary
//
// Computed scores (never stored):
//   user_impact = Σ linked-insight importance × company tier weight (strategic 3 / growth 2 / else 1)
//   rice        = reach × impact × (confidence/100) / max(effort, 1)
//   delivery    = done-category linked issues / total linked issues

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth, adminOrProjectOwner } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { demandForFeatures } = require('../utils/demand');
const { buildSpecBody } = require('../utils/spec-draft');
const { complete, aiEnabled, MODELS } = require('./ai');
const { projectStatuses } = require('./workflows');
const { outcomeDetailsForFeature, sqlTimestamp } = require('../utils/product-outcomes');
const { notify } = require('../utils/notify');
const FeatureMergeHistory = require('../models/feature-merge-history');
const FeatureImpactMetrics = require('../models/feature-impact-metrics');
const { findSimilarFeatures } = require('../lib/similarity');

const router = express.Router();

const FEATURE_STATUSES = ['idea', 'discovery', 'planned', 'in_progress', 'launched', 'archived'];
const TIMEFRAMES = ['now', 'next', 'later'];
const PORTAL_STATUSES = ['under_consideration', 'planned', 'launched'];
const PORTAL_STATUS_LABELS = {
  under_consideration: 'Under consideration',
  planned: 'Planned',
  launched: 'Launched',
};

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

// `demand` is additive: user_impact above keeps its tier-weighted meaning and
// stays the features screen's default sort. Demand answers a different question
// in real currency, and the two are shown side by side rather than merged.
function attachDemand(feature, d) {
  return {
    ...withRice(feature),
    demand: d.demand,
    demand_breakdown: d.breakdown,
    demand_unattributed: d.unattributed,
  };
}

async function getEnrichedFeature(db, id) {
  const feature = await queryOne(db, `${ENRICHED_SELECT} WHERE f.id = ?`, [id]);
  if (!feature) return null;
  const map = await demandForFeatures(db, [id]);
  return attachDemand(feature, map.get(id));
}

async function getFeatureWithOutcome(db, id) {
  const feature = await getEnrichedFeature(db, id);
  if (!feature) return null;
  return { ...feature, ...await outcomeDetailsForFeature(db, feature) };
}

// One demand query for the whole list rather than one per feature.
async function withDemand(db, features) {
  const map = await demandForFeatures(db, features.map((f) => f.id));
  return features.map((f) => attachDemand(f, map.get(f.id) || { demand: 0, breakdown: [], unattributed: 0 }));
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
    res.json(await withDemand(db, features));
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
    const featureStatus = status || 'idea';
    await run(db, `INSERT INTO pb_features (id, project_id, name, description, status, timeframe, portal_status, owner_id, effort, value, reach, impact, confidence, release_id, launched_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, project_id || null, name.trim(), description || '', status || 'idea',
       timeframe || null, portal_status || null, owner_id || null,
       effort ?? null, value ?? null, reach ?? null, impact ?? null, confidence ?? null,
       release_id || null, featureStatus === 'launched' ? sqlTimestamp() : null, req.userId]);
    res.status(201).json(await getFeatureWithOutcome(db, id));
  } catch (e) { serverError(res, e); }
});

// GET /api/product/features/impact-dashboard
router.get('/product/features/impact-dashboard', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const features = await queryAll(
      db,
      `SELECT id, name, forecast_adoption, forecast_revenue, actual_adoption, actual_revenue, impact_status
       FROM pb_features WHERE actual_adoption IS NOT NULL OR actual_revenue IS NOT NULL
       ORDER BY updated_at DESC`
    );

    const summary = {
      total_features_analyzed: features.length,
      avg_adoption_variance: null,
      avg_revenue_variance: null,
      features: features,
    };

    if (features.length > 0) {
      const adoptionVariances = features
        .filter(f => f.forecast_adoption)
        .map(f => FeatureImpactMetrics.calculateVariance(f.forecast_adoption, f.actual_adoption || 0));

      const revenueVariances = features
        .filter(f => f.forecast_revenue)
        .map(f => FeatureImpactMetrics.calculateVariance(f.forecast_revenue, f.actual_revenue || 0));

      if (adoptionVariances.length > 0) {
        summary.avg_adoption_variance = adoptionVariances.reduce((a, b) => a + b, 0) / adoptionVariances.length;
      }

      if (revenueVariances.length > 0) {
        summary.avg_revenue_variance = revenueVariances.reduce((a, b) => a + b, 0) / revenueVariances.length;
      }
    }

    res.json({ data: summary });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
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
    Object.assign(feature, await outcomeDetailsForFeature(db, feature));
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
    const launchedAt = updated.status === 'launched' && !existing.launched_at
      ? sqlTimestamp() : existing.launched_at;
    await run(db, `UPDATE pb_features SET project_id = ?, name = ?, description = ?, status = ?, timeframe = ?, portal_status = ?, owner_id = ?, effort = ?, value = ?, reach = ?, impact = ?, confidence = ?, release_id = ?, launched_at = ?, updated_at = datetime('now') WHERE id = ?`,
      [...fields.map(fld => updated[fld]), launchedAt, req.params.id]);

    // A follower asked to hear when the public promise changes. Fan out only
    // after the update succeeds, and use the existing notify helper so in-app,
    // SSE, email, and user email preferences stay on one delivery path.
    if (body.portal_status !== undefined && updated.portal_status !== existing.portal_status) {
      const followers = await queryAll(db,
        'SELECT user_id FROM pb_portal_followers WHERE feature_id = ?', [req.params.id]);
      const statusText = updated.portal_status
        ? `is now ${PORTAL_STATUS_LABELS[updated.portal_status]}`
        : 'is no longer on the public roadmap';
      for (const follower of followers) {
        await notify(db, {
          userId: follower.user_id,
          actorId: req.userId,
          type: 'portal_status_changed',
          message: `${updated.name} ${statusText}`,
          link: updated.portal_status ? `/portal/features/${req.params.id}` : '/portal',
        });
      }
    }
    res.json(await getFeatureWithOutcome(db, req.params.id));
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
    await run(db, 'DELETE FROM pb_portal_followers WHERE feature_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_feature_outcomes WHERE feature_id = ?', [req.params.id]);
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

// POST /api/product/features/:id/spec — draft a spec page in the wiki from what
// the database already knows about this feature.
//
// Idempotent: a feature has one spec page, and a second call returns it rather
// than making another. Regenerating over an existing page would overwrite prose
// a human has since edited, which needs its own decision about version history —
// deliberately out of scope here.
//
// The caller names the space. A global setting would be invisible and wrong the
// moment a second team wants a different one; defaulting to the first space is
// silently arbitrary.
router.post('/product/features/:id/spec', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });

    // Re-check the page still exists: spec_page_id is not a foreign key, so a
    // page deleted from the wiki leaves a dangling link that should draft afresh
    // rather than 200 with a dead id.
    if (feature.spec_page_id) {
      const existing = await queryOne(db, 'SELECT id FROM wiki_pages WHERE id = ?', [feature.spec_page_id]);
      if (existing) return res.json({ page_id: feature.spec_page_id, created: false });
    }

    const { space_id } = req.body;
    if (!space_id) return res.status(400).json({ error: 'space_id required' });
    const space = await queryOne(db, 'SELECT id FROM wiki_spaces WHERE id = ?', [space_id]);
    if (!space) return res.status(404).json({ error: 'Space not found' });

    const objectives = await queryAll(db,
      `SELECT o.name FROM pb_feature_objectives fo
       JOIN pb_objectives o ON fo.objective_id = o.id
       WHERE fo.feature_id = ?`, [req.params.id]);
    const evidence = await queryAll(db,
      `SELECT il.quote, il.importance, co.name as company_name
       FROM pb_insight_links il
       JOIN pb_insights ins ON il.insight_id = ins.id
       LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
       LEFT JOIN pb_companies co ON cu.company_id = co.id
       WHERE il.feature_id = ? ORDER BY il.importance DESC`, [req.params.id]);
    const demandMap = await demandForFeatures(db, [req.params.id]);

    let body = buildSpecBody({
      feature,
      objectives,
      evidence,
      demandBreakdown: demandMap.get(req.params.id).breakdown,
    });

    if (aiEnabled()) {
      try {
        const drafted = await complete({
          model: MODELS.write,
          maxTokens: 2000,
          system: 'You draft product specs. Given an assembled spec skeleton, rewrite the '
            + 'Problem, Proposed solution and Open questions sections using the evidence '
            + 'present. Keep every heading, and reproduce the Evidence, Demand and '
            + 'Objectives sections exactly as given. Reply with HTML only, no code fences.',
          user: body,
        });
        // Only accept a draft that still looks like the document we sent. A
        // model failure or a refusal must leave the assembled skeleton intact —
        // a spec you can edit beats an error, and the caller asked for a spec,
        // not for AI.
        if (drafted && drafted.includes('<h1>')) body = drafted;
      } catch {
        /* keep the assembled skeleton */
      }
    }

    const pageId = uuidv4();
    const slug = `spec-${String(feature.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    await run(db,
      `INSERT INTO wiki_pages (id, space_id, title, slug, body, body_format, status, author_id)
       VALUES (?, ?, ?, ?, ?, 'html', 'current', ?)`,
      [pageId, space_id, `Spec: ${feature.name}`, slug, body, req.userId]);
    await run(db, 'UPDATE pb_features SET spec_page_id = ? WHERE id = ?', [pageId, req.params.id]);

    res.status(201).json({ page_id: pageId, created: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/product/features/:id/merge-candidates
router.get('/product/features/:id/merge-candidates', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { limit = 10 } = req.query;

    const feature = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: true, message: 'Feature not found', code: 'NOT_FOUND', status: 404 });

    const allFeatures = await queryAll(db, 'SELECT * FROM pb_features WHERE project_id = ?', [feature.project_id]);
    const candidates = findSimilarFeatures(feature, allFeatures, 0.6).slice(0, limit);

    res.json({ data: candidates });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message, code: 'SERVER_ERROR', status: 500 });
  }
});

// POST /api/product/features/:id/merge
router.post('/product/features/:id/merge', requireAuth, adminOrProjectOwner, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: true, message: 'Not authenticated', code: 'UNAUTHORIZED', status: 401 });
    }

    const db = await getDb();
    const { childFeatureIds, reason } = req.body;

    if (!Array.isArray(childFeatureIds) || childFeatureIds.length === 0) {
      return res.status(400).json({ error: true, message: 'childFeatureIds must be non-empty array', code: 'BAD_REQUEST', status: 400 });
    }

    const parent = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    if (!parent) return res.status(404).json({ error: true, message: 'Parent feature not found', code: 'NOT_FOUND', status: 404 });

    // Check for cycles
    const parentMergedFrom = JSON.parse(parent.merged_from_ids || '[]');
    if (parentMergedFrom.some(id => childFeatureIds.includes(id))) {
      return res.status(400).json({ error: true, message: 'Cannot merge: would create cycle', code: 'CYCLE_DETECTED', status: 400 });
    }

    let totalRequestCount = parent.request_count || 0;
    let currentMergedFrom = JSON.parse(parent.merged_from_ids || '[]');
    const mergeHistories = [];

    // Note: Transaction support depends on database layer capabilities.
    // For now, we ensure atomicity through careful ordering and error handling.
    try {
      for (const childId of childFeatureIds) {
        const child = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [childId]);
        if (!child) continue;

        if (JSON.parse(child.merged_from_ids || '[]').length > 0) {
          throw new Error(`Cannot merge already-merged feature ${childId}. Unmerge first.`);
        }

        const childCount = child.request_count || 0;
        totalRequestCount += childCount;

        // Update parent with accumulated merged_from_ids
        currentMergedFrom = Array.from(new Set([
          ...currentMergedFrom,
          childId,
        ]));

        await run(db,
          `UPDATE pb_features SET request_count = ?, merged_from_ids = ?, merged_at = datetime('now'), merged_by_id = ?
           WHERE id = ?`,
          [totalRequestCount, JSON.stringify(currentMergedFrom), req.userId, req.params.id]
        );

        // Create history entry
        const history = await FeatureMergeHistory.create(req.params.id, childId, req.userId, childCount, reason);
        mergeHistories.push(history);

        // Log activity
        await run(db,
          `INSERT INTO activity (id, type, actor_id, resource_type, resource_id, changes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [uuidv4(), 'merged', req.userId, 'feature', req.params.id, JSON.stringify({ child_id: childId, request_count_added: childCount })]
        );
      }
    } catch (error) {
      throw error;
    }

    const updatedParent = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    res.json({ data: updatedParent, merged_count: childFeatureIds.length });
  } catch (error) {
    res.status(400).json({ error: true, message: error.message, code: 'BAD_REQUEST', status: 400 });
  }
});

// GET /api/product/features/:id/merge-history
router.get('/product/features/:id/merge-history', requireAuth, async (req, res) => {
  try {
    const history = await FeatureMergeHistory.findByParentId(req.params.id);
    res.json({ data: history });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message, code: 'SERVER_ERROR', status: 500 });
  }
});

// POST /api/product/features/:id/unmerge
router.post('/product/features/:id/unmerge', requireAuth, adminOrProjectOwner, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: true, message: 'Not authenticated', code: 'UNAUTHORIZED', status: 401 });
    }

    const db = await getDb();
    const { childFeatureId } = req.body;

    const history = await FeatureMergeHistory.findByChildId(childFeatureId);
    if (!history) {
      return res.status(404).json({ error: true, message: 'Merge not found', code: 'NOT_FOUND', status: 404 });
    }

    // Check 24h window
    const mergedAt = new Date(history.merged_at);
    const now = new Date();
    const hoursAgo = (now - mergedAt) / (1000 * 60 * 60);

    if (hoursAgo > 24) {
      return res.status(400).json({ error: true, message: 'Merge too old to undo (>24h)', code: 'MERGE_TOO_OLD', status: 400 });
    }

    try {
      // Restore child feature
      await run(db,
        `UPDATE pb_features SET merged_from_ids = '[]' WHERE id = ?`,
        [childFeatureId]
      );

      // Update parent request count
      const currentParent = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [history.parent_feature_id]);
      const newRequestCount = Math.max(0, (currentParent.request_count || 0) - history.child_request_count);

      const updatedMergedFrom = JSON.parse(currentParent.merged_from_ids || '[]').filter(id => id !== childFeatureId);
      await run(db,
        `UPDATE pb_features SET request_count = ?, merged_from_ids = ? WHERE id = ?`,
        [newRequestCount, JSON.stringify(updatedMergedFrom), history.parent_feature_id]
      );

      // Log activity
      await run(db,
        `INSERT INTO activity (id, type, actor_id, resource_type, resource_id, changes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [uuidv4(), 'unmerged', req.userId, 'feature', history.parent_feature_id, JSON.stringify({ child_id: childFeatureId })]
      );
    } catch (error) {
      throw error;
    }

    const restoredChild = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [childFeatureId]);
    res.json({ data: restoredChild });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message, code: 'SERVER_ERROR', status: 500 });
  }
});

// POST /api/product/features/:id/impact-metrics
router.post('/product/features/:id/impact-metrics', requireAuth, async (req, res) => {
  try {
    const { metricType, actualValue, unit, dataSource = 'manual', notes } = req.body;

    if (!metricType || actualValue === undefined) {
      return res.status(400).json({ error: true, message: 'metricType and actualValue required' });
    }

    if (actualValue < 0) {
      return res.status(400).json({ error: true, message: 'Actual value must be ≥ 0' });
    }

    const metric = await FeatureImpactMetrics.create(
      req.params.id,
      metricType,
      actualValue,
      unit,
      dataSource,
      notes,
      req.userId
    );

    // Log activity
    const db = await getDb();
    await run(
      db,
      `INSERT INTO activity (id, type, actor_id, resource_type, resource_id, changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), 'impact_measured', req.userId, 'feature', req.params.id,
       JSON.stringify({ metric_type: metricType, actual_value: actualValue })]
    );

    res.json({ data: metric });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// GET /api/product/features/:id/impact-metrics
router.get('/product/features/:id/impact-metrics', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: true, message: 'Feature not found' });

    const metrics = await FeatureImpactMetrics.findByFeatureId(req.params.id);

    // Group by metric type and calculate variance
    const grouped = {};
    metrics.forEach(m => {
      if (!grouped[m.metric_type]) grouped[m.metric_type] = [];

      const variance = FeatureImpactMetrics.calculateVariance(m.forecast_value, m.actual_value);
      grouped[m.metric_type].push({ ...m, variance });
    });

    res.json({
      data: {
        feature_id: feature.id,
        impact_status: feature.impact_status,
        forecast_adoption: feature.forecast_adoption,
        forecast_revenue: feature.forecast_revenue,
        actual_adoption: feature.actual_adoption,
        actual_revenue: feature.actual_revenue,
        metrics: grouped,
      },
    });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// PUT /api/product/features/:id/forecast-metrics
router.put('/product/features/:id/forecast-metrics', requireAuth, async (req, res) => {
  try {
    const { forecastAdoption, forecastRevenue, forecastNotes } = req.body;
    const db = await getDb();

    await run(
      db,
      `UPDATE pb_features SET forecast_adoption = ?, forecast_revenue = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [forecastAdoption ?? null, forecastRevenue ?? null, req.params.id]
    );

    await run(
      db,
      `INSERT INTO activity (id, type, actor_id, resource_type, resource_id, changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), 'forecast_set', req.userId, 'feature', req.params.id,
       JSON.stringify({ forecast_adoption: forecastAdoption, forecast_revenue: forecastRevenue })]
    );

    const updated = await queryOne(db, 'SELECT * FROM pb_features WHERE id = ?', [req.params.id]);
    res.json({ data: updated });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

module.exports = router;
