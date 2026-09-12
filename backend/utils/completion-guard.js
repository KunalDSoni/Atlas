// A parent issue cannot be completed while its children are still open.
//
// Applies at both levels of the hierarchy: an epic is blocked by its open
// stories/tasks/bugs, and a story/task/bug is blocked by its open subtasks.
//
// "Open" means the child is not sitting in a done-CATEGORY status for that
// project. Projects can rename `done`, add a second done column, or drop the
// built-in one entirely, so `status === 'done'` is not the test.
//
// Only direct children are checked. A story cannot itself reach done while a
// subtask is open, so an epic's deeper levels are enforced transitively. Rows
// that were already done-with-open-children before this guard existed keep
// that shape — the guard runs on transition, and nothing backfills history.

const { queryAll } = require('../database');
const { categoryOf } = require('./flow');

/** How many blockers the single-line message names before it summarizes. */
const INLINE_LIMIT = 5;

function labelOf(statusKey, statuses) {
  const hit = statuses.find((s) => s.key === statusKey);
  return hit ? hit.label : statusKey;
}

/**
 * Direct children of `issue` that are not in a done-category status.
 * Ordered subtasks-last-key-first so the message reads in board order.
 */
async function findOpenChildren(db, issue, statuses) {
  if (!issue || !issue.id) return [];
  const rows = await queryAll(db,
    'SELECT id, issue_key, title, type, status FROM issues WHERE parent_id = ? ORDER BY issue_key',
    [issue.id]);
  return rows
    .filter((child) => categoryOf(child.status, statuses) !== 'done')
    .map((child) => ({
      id: child.id,
      issue_key: child.issue_key,
      title: child.title,
      type: child.type,
      status: child.status,
      status_label: labelOf(child.status, statuses),
    }));
}

/**
 * True only for a move that newly enters a done category. Re-saving an issue
 * already done, or moving between two done columns, is never blocked — the
 * children were either checked on the way in or predate the guard.
 */
function entersDone(fromStatus, toStatus, statuses) {
  if (!toStatus || toStatus === fromStatus) return false;
  return categoryOf(toStatus, statuses) === 'done' && categoryOf(fromStatus, statuses) !== 'done';
}

/** "subtasks" when every blocker is one, "child issues" for a mixed/epic set. */
function nounFor(blockers) {
  const allSubtasks = blockers.every((b) => b.type === 'subtask');
  const singular = allSubtasks ? 'subtask' : 'child issue';
  return blockers.length === 1 ? singular : `${singular}s`;
}

/**
 * The headline, with no list in it — a client that renders `blockers` itself
 * uses this as the title so it does not have to reimplement the noun rules.
 */
function blockerSummary(issue, blockers) {
  return `${issue.issue_key} has ${blockers.length} open ${nounFor(blockers)}. `
    + `Finish ${blockers.length === 1 ? 'it' : 'them'} first.`;
}

/**
 * One self-contained line naming the blockers and the state each is in.
 * Clients that only read `error` still get the whole story; the structured
 * `blockers` array is there for surfaces that can lay it out properly.
 */
function blockerMessage(issue, blockers) {
  const named = blockers.slice(0, INLINE_LIMIT)
    .map((b) => `${b.issue_key} (${b.status_label})`)
    .join(', ');
  const rest = blockers.length - INLINE_LIMIT;
  const tail = rest > 0 ? `${named}, and ${rest} more` : named;
  return `${blockerSummary(issue, blockers).replace(/\.$/, '')}: ${tail}.`;
}

/**
 * null when the transition is allowed; otherwise a ready-to-send 409 body of
 * `{ error, summary, blockers }`.
 */
async function completionBlock(db, issue, nextStatus, statuses) {
  if (!entersDone(issue.status, nextStatus, statuses)) return null;
  const blockers = await findOpenChildren(db, issue, statuses);
  if (blockers.length === 0) return null;
  return {
    error: blockerMessage(issue, blockers),
    summary: blockerSummary(issue, blockers),
    blockers,
  };
}

module.exports = { findOpenChildren, entersDone, blockerSummary, blockerMessage, completionBlock };
