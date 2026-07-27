// ===== PUBLIC IDEA PORTAL PROJECTIONS =====
//
// Portal queries deliberately select the raw feature row and then pass it
// through this single allow-list. That makes adding a new internal feature
// column safe by default: it cannot reach a customer until this projection is
// changed intentionally and its projection test is updated.

const PUBLIC_FEATURE_FIELDS = Object.freeze([
  'id',
  'name',
  'description',
  'portal_status',
  'vote_count',
  'follower_count',
  'has_voted',
  'is_following',
]);

function toPublicFeature(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    portal_status: row.portal_status,
    vote_count: Number(row.vote_count) || 0,
    follower_count: Number(row.follower_count) || 0,
    has_voted: Boolean(Number(row.has_voted)),
    is_following: Boolean(Number(row.is_following)),
  };
}

// A submission is an insight internally, but customers do not need its triage
// flags or links. Translate those flags into a small, customer-readable state.
function toPublicSubmission(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content || '',
    status: row.dismissed_at ? 'closed' : Number(row.processed) ? 'reviewed' : 'submitted',
    submitted_at: row.created_at,
  };
}

module.exports = { PUBLIC_FEATURE_FIELDS, toPublicFeature, toPublicSubmission };
