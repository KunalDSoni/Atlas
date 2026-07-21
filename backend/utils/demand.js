// ===== REVENUE-WEIGHTED DEMAND =====
// How much revenue asked for a feature, and how emphatically.
//
//   demand = Σ  arr(company) × importance
//
// This is deliberately NOT a replacement for `user_impact` in
// routes/product-features.js, which weights the same evidence by tier on a
// 3/2/1 scale and is the features screen's default sort. That number keeps its
// meaning; this one sits beside it in real currency. Where they disagree — many
// excited small accounts versus one quiet large one — the disagreement is the
// finding, and collapsing them into a single score would destroy it.
//
// Computed in JS rather than SQL, following utils/flow.js: the set is bounded
// (the features of one project, all of which the screen fetches anyway), so
// there is no pagination pressure forcing the arithmetic into a WHERE clause.
// The service desk wave took the opposite decision for SLA breach state for
// exactly that reason — a queue is an unbounded paginated query.

const TIERS = ['strategic', 'growth', 'standard'];

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Null ARR falls back to the median of its tier, computed from the companies
// that do carry a figure. Keeping one unit throughout is the point: a fallback
// expressed as a small integer would be summed against six-figure ARR values
// and vanish — worse than no fallback, because it looks like it worked.
function tierMedians(companies) {
  const out = {};
  for (const tier of TIERS) {
    const values = companies
      .filter((c) => c.tier === tier && c.arr != null && Number(c.arr) > 0)
      .map((c) => Number(c.arr));
    out[tier] = median(values);
  }
  return out;
}

// `rows` are insight-link rows already joined out to their company, for ONE
// feature. Returns the score, a per-company breakdown ranked by contribution,
// and a count of evidence that could not be attributed to any company.
function computeDemand(rows, medians) {
  const byCompany = new Map();
  let unattributed = 0;

  for (const row of rows) {
    if (!row.company_id) { unattributed += 1; continue; }

    const importance = Number(row.importance) || 1;
    const measured = row.arr != null && Number(row.arr) > 0;
    const arr = measured ? Number(row.arr) : (medians[row.tier] || 0);

    const existing = byCompany.get(row.company_id);
    if (existing) {
      existing.contribution += arr * importance;
      existing.insight_count += 1;
    } else {
      byCompany.set(row.company_id, {
        company_id: row.company_id,
        company_name: row.company_name,
        tier: row.tier,
        // Null when estimated, so nothing downstream can mistake a tier median
        // for revenue somebody actually recorded.
        arr: measured ? Number(row.arr) : null,
        estimated: !measured,
        insight_count: 1,
        contribution: arr * importance,
      });
    }
  }

  const breakdown = [...byCompany.values()].sort((a, b) => b.contribution - a.contribution);
  const demand = breakdown.reduce((sum, b) => sum + b.contribution, 0);
  return { demand, breakdown, unattributed };
}

// One query for every feature asked about, not one per feature.
async function demandForFeatures(db, featureIds) {
  const { queryAll } = require('../database');

  const result = new Map();
  for (const id of featureIds) result.set(id, { demand: 0, breakdown: [], unattributed: 0 });
  if (featureIds.length === 0) return result;

  const companies = await queryAll(db, 'SELECT tier, arr FROM pb_companies', []);
  const medians = tierMedians(companies);

  const placeholders = featureIds.map(() => '?').join(', ');
  const rows = await queryAll(db,
    `SELECT il.feature_id, il.importance,
       co.id AS company_id, co.name AS company_name, co.tier, co.arr
     FROM pb_insight_links il
     JOIN pb_insights ins ON il.insight_id = ins.id
     LEFT JOIN pb_customers cu ON ins.customer_id = cu.id
     LEFT JOIN pb_companies co ON cu.company_id = co.id
     WHERE il.feature_id IN (${placeholders})`, featureIds);

  const byFeature = new Map();
  for (const row of rows) {
    if (!byFeature.has(row.feature_id)) byFeature.set(row.feature_id, []);
    byFeature.get(row.feature_id).push(row);
  }
  for (const id of featureIds) {
    result.set(id, computeDemand(byFeature.get(id) || [], medians));
  }
  return result;
}

module.exports = { tierMedians, computeDemand, demandForFeatures, median };
