// ===== PRODUCT: OUTCOME TRACKING (EPIC 51) =====
// GET /api/product/outcomes                    - launched-feature review queue
// PUT /api/product/features/:id/outcome        - set the metric or record a review

const express = require('express');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { notifyNewMentions } = require('../utils/notify');
const {
  OUTCOME_VERDICTS, daysSince, getOutcome, postLaunchSignalsForFeatures, sqlTimestamp,
} = require('../utils/product-outcomes');

const router = express.Router();
const DEFAULT_REVIEW_DAYS = Math.max(1, parseInt(process.env.OUTCOME_REVIEW_DAYS, 10) || 30);
const TEXT_FIELDS = ['metric', 'target', 'baseline', 'measured', 'notes'];

function reviewWindow(raw) {
  if (raw === undefined) return DEFAULT_REVIEW_DAYS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : null;
}

function textValue(value, field) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') throw new TypeError(`${field} must be text or null`);
  const trimmed = value.trim();
  return trimmed || null;
}

// The queue is bounded to launched product features. One feature query and one
// signal query keep its cost flat as the number of launches grows.
router.get('/product/outcomes', requireAuth, async (req, res) => {
  try {
    const reviewAfterDays = reviewWindow(req.query.review_after_days);
    if (reviewAfterDays === null) {
      return res.status(400).json({ error: 'review_after_days must be an integer between 1 and 3650' });
    }

    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT f.id, f.project_id, f.name, f.description, f.status, f.launched_at,
              f.created_at, f.updated_at, f.owner_id,
              p.name AS project_name, p.key AS project_key, u.name AS owner_name,
              o.feature_id AS outcome_feature_id, o.metric, o.target, o.baseline,
              o.measured, o.verdict, o.reviewed_at, o.reviewed_by, o.notes,
              reviewer.name AS reviewed_by_name
         FROM pb_features f
         LEFT JOIN projects p ON f.project_id = p.id
         LEFT JOIN users u ON f.owner_id = u.id
         LEFT JOIN pb_feature_outcomes o ON f.id = o.feature_id
         LEFT JOIN users reviewer ON o.reviewed_by = reviewer.id
        WHERE f.status = 'launched'
        ORDER BY f.launched_at DESC, f.updated_at DESC, f.name`, []);

    const signalsByFeature = await postLaunchSignalsForFeatures(db, rows.map((row) => row.id));
    const features = rows.map((row) => {
      const signals = signalsByFeature.get(row.id) || [];
      const outcome = row.outcome_feature_id ? {
        feature_id: row.id,
        metric: row.metric,
        target: row.target,
        baseline: row.baseline,
        measured: row.measured,
        verdict: row.verdict,
        reviewed_at: row.reviewed_at,
        reviewed_by: row.reviewed_by,
        reviewed_by_name: row.reviewed_by_name,
        notes: row.notes,
      } : null;
      const age = daysSince(row.launched_at || row.updated_at || row.created_at);
      return {
        id: row.id,
        project_id: row.project_id,
        project_name: row.project_name,
        project_key: row.project_key,
        name: row.name,
        description: row.description,
        status: row.status,
        owner_id: row.owner_id,
        owner_name: row.owner_name,
        launched_at: row.launched_at || row.updated_at || row.created_at,
        days_since_launch: age,
        outcome,
        needs_outcome_metric: !String(row.metric || '').trim(),
        post_launch_insight_count: signals.length,
        post_launch_insights: signals,
        review_due: !row.reviewed_at && age >= reviewAfterDays,
      };
    });

    res.json({ review_after_days: reviewAfterDays, features });
  } catch (e) { serverError(res, e); }
});

router.put('/product/features/:id/outcome', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const feature = await queryOne(db, 'SELECT id FROM pb_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });

    const body = req.body || {};
    if (body.verdict !== undefined && body.verdict !== null && !OUTCOME_VERDICTS.includes(body.verdict)) {
      return res.status(400).json({ error: 'invalid verdict' });
    }

    const existing = await getOutcome(db, req.params.id);
    const next = {};
    try {
      for (const field of TEXT_FIELDS) {
        next[field] = body[field] !== undefined
          ? textValue(body[field], field)
          : existing?.[field] ?? null;
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    next.verdict = body.verdict !== undefined ? body.verdict : existing?.verdict ?? null;

    const touchesReview = ['measured', 'verdict', 'notes'].some((field) => body[field] !== undefined);
    let reviewedAt = existing?.reviewed_at ?? null;
    let reviewedBy = existing?.reviewed_by ?? null;
    if (!next.verdict) {
      reviewedAt = null;
      reviewedBy = null;
    } else if (touchesReview) {
      reviewedAt = sqlTimestamp();
      reviewedBy = req.userId;
    }

    if (existing) {
      await run(db,
        `UPDATE pb_feature_outcomes
            SET metric = ?, target = ?, baseline = ?, measured = ?, verdict = ?,
                reviewed_at = ?, reviewed_by = ?, notes = ?, updated_at = datetime('now')
          WHERE feature_id = ?`,
        [next.metric, next.target, next.baseline, next.measured, next.verdict,
         reviewedAt, reviewedBy, next.notes, req.params.id]);
    } else {
      await run(db,
        `INSERT INTO pb_feature_outcomes
          (feature_id, metric, target, baseline, measured, verdict, reviewed_at, reviewed_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, next.metric, next.target, next.baseline, next.measured,
         next.verdict, reviewedAt, reviewedBy, next.notes]);
    }

    if (body.notes !== undefined && next.notes !== (existing?.notes ?? null)) {
      const named = await queryOne(db, 'SELECT name FROM pb_features WHERE id = ?', [req.params.id]);
      await notifyNewMentions(db, {
        text: next.notes || '',
        previousText: existing?.notes || '',
        actorId: req.userId,
        where: `the outcome review for "${named?.name || 'a feature'}"`,
        link: '/product/outcomes',
      });
    }

    res.json(await getOutcome(db, req.params.id));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
