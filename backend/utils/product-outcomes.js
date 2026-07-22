// ===== PRODUCT OUTCOME TRACKING =====
//
// Atlas has no metrics warehouse, so the declared measure stays honest free
// text. The only computed signal is feedback Atlas actually stores: insights
// created after a feature's durable launch timestamp and linked to that feature.

const { queryAll, queryOne } = require('../database');

const OUTCOME_VERDICTS = ['achieved', 'partial', 'missed', 'too_early'];

function sqlTimestamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 23);
}

function parseSqlDate(value) {
  if (!value) return null;
  const raw = String(value);
  const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw)
    ? raw
    : raw.includes('T') ? `${raw}Z` : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysSince(value, now = new Date()) {
  const then = parseSqlDate(value);
  if (!then) return 0;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86400000));
}

async function getOutcome(db, featureId) {
  return queryOne(db,
    `SELECT o.*, u.name AS reviewed_by_name
       FROM pb_feature_outcomes o
       LEFT JOIN users u ON o.reviewed_by = u.id
      WHERE o.feature_id = ?`, [featureId]);
}

// One query for the whole review queue, not one query per launched feature.
// Insight creation time is the signal: linking old pre-launch feedback later
// must not make it look like customers reported a problem after launch.
async function postLaunchSignalsForFeatures(db, featureIds) {
  const grouped = new Map(featureIds.map((id) => [id, []]));
  if (featureIds.length === 0) return grouped;

  const marks = featureIds.map(() => '?').join(',');
  const rows = await queryAll(db,
    `SELECT il.feature_id, il.importance, il.quote, il.created_at AS linked_at,
            ins.id, ins.title, ins.content, ins.source, ins.origin_kind,
            ins.origin_excerpt, ins.created_at,
            cu.name AS customer_name, co.name AS company_name, co.tier AS company_tier
       FROM pb_insight_links il
       JOIN pb_insights ins ON il.insight_id = ins.id
       JOIN pb_features f ON il.feature_id = f.id
       LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
       LEFT JOIN pb_companies co ON cu.company_id = co.id
      WHERE il.feature_id IN (${marks})
        AND f.launched_at IS NOT NULL
        AND ins.created_at > f.launched_at
      ORDER BY ins.created_at DESC`, featureIds);

  for (const row of rows) {
    row.importance = Number(row.importance) || 1;
    grouped.get(row.feature_id)?.push(row);
  }
  return grouped;
}

async function outcomeDetailsForFeature(db, feature) {
  const outcome = await getOutcome(db, feature.id);
  let signals = [];
  if (feature.status === 'launched') {
    const grouped = await postLaunchSignalsForFeatures(db, [feature.id]);
    signals = grouped.get(feature.id) || [];
  }
  return {
    outcome,
    post_launch_insight_count: signals.length,
    post_launch_insights: signals,
    needs_outcome_metric: feature.status === 'launched' && !String(outcome?.metric || '').trim(),
  };
}

module.exports = {
  OUTCOME_VERDICTS,
  sqlTimestamp,
  parseSqlDate,
  daysSince,
  getOutcome,
  postLaunchSignalsForFeatures,
  outcomeDetailsForFeature,
};
