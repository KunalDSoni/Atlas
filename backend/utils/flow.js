// ===== FLOW METRICS HELPERS =====
// Pure functions for the cycle-time / time-in-status / cumulative-flow
// reports. Everything here operates on plain rows so it is unit-testable
// without a database.

// Built-in categories, used when a status key is absent from the project's
// configured workflow (matching DEFAULT_STATUSES in routes/workflows.js).
const BUILTIN_CATEGORY = {
  todo: 'todo',
  in_progress: 'in_progress',
  in_review: 'in_progress',
  done: 'done',
};

/** Category for a status key, given the project's status list. Unknown → todo. */
function categoryOf(statusKey, statuses) {
  const hit = statuses.find((s) => s.key === statusKey);
  if (hit) return hit.category;
  return BUILTIN_CATEGORY[statusKey] || 'todo';
}

/**
 * Replays an issue's status transitions into contiguous segments.
 * `transitions` are activity_log rows (field='status') sorted ascending.
 * The first segment starts at created_at in the first observed status —
 * the earliest transition's old_value, or the current status when the issue
 * has no recorded transitions (the data-honesty rule: no fabricated history).
 * The final segment is open (`to: null`).
 */
function statusTimeline(issue, transitions) {
  const first = transitions[0] ? transitions[0].old_value : issue.status;
  const segments = [];
  let current = { status: first, from: issue.created_at, to: null };
  for (const t of transitions) {
    current.to = t.created_at;
    segments.push(current);
    current = { status: t.new_value, from: t.created_at, to: null };
  }
  segments.push(current);
  return segments;
}

/** Fractional hours between two datetime strings ('YYYY-MM-DD HH:MM:SS' or ISO). */
function hoursBetween(a, b) {
  const parse = (s) => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime();
  return (parse(b) - parse(a)) / 3_600_000;
}

/** Nearest-rank percentile of an ascending-sorted array. Empty → null. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

module.exports = { categoryOf, statusTimeline, hoursBetween, percentile };
