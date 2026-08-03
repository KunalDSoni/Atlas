// ===== WORK LOG SYNC =====
// issues.time_spent is a denormalized rollup of work_logs.minutes. Recomputed
// from scratch (not incremented/decremented) because auto-log rows can be
// replaced wholesale (see utils/auto-worklog.js), so an add/subtract delta is
// not safe here the way it was for manual-only entries.

const { queryAll, run } = require('../database');

async function recomputeTimeSpent(db, issueId) {
  const rows = await queryAll(db, 'SELECT minutes FROM work_logs WHERE issue_id = ?', [issueId]);
  const total = rows.reduce((sum, r) => sum + Number(r.minutes), 0);
  await run(db, "UPDATE issues SET time_spent = ?, updated_at = datetime('now') WHERE id = ?", [total, issueId]);
  return total;
}

module.exports = { recomputeTimeSpent };
