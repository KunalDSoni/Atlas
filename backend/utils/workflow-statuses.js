// Per-project status list (board columns), shared by routes and utils.
//
// This lived on the routes/workflows.js router export, which meant anything
// outside the route layer had to require a route module to ask what a
// project's statuses are. The completion guard and the automation engine both
// need that answer, so the lookup moved here; routes/workflows.js re-exports
// `projectStatuses` so existing importers are unaffected.

const { queryAll } = require('../database');

const CATEGORIES = ['todo', 'in_progress', 'done'];

/** Built-in workflow used until a project defines its own. */
const DEFAULT_STATUSES = [
  { key: 'todo', label: 'To Do', category: 'todo', position: 0 },
  { key: 'in_progress', label: 'In Progress', category: 'in_progress', position: 1 },
  { key: 'blocked', label: 'Blocked', category: 'in_progress', position: 2 },
  { key: 'in_review', label: 'In Review', category: 'in_progress', position: 3 },
  { key: 'done', label: 'Done', category: 'done', position: 4 },
];

async function projectStatuses(db, projectId) {
  const rows = await queryAll(db,
    'SELECT * FROM project_statuses WHERE project_id = ? ORDER BY position, key', [projectId]);
  if (rows.length === 0) {
    return DEFAULT_STATUSES.map((s) => ({ id: `default-${s.key}`, project_id: projectId, builtin: true, ...s }));
  }
  return rows.map((r) => ({ ...r, position: Number(r.position), builtin: false }));
}

module.exports = { CATEGORIES, DEFAULT_STATUSES, projectStatuses };
