// The invariant: no issue in a done-category status has open children.
//
// Two halves, because work moves in both directions.
//
//   completionBlock()    guards the PARENT side — a parent cannot enter a done
//                        status while its children are open.
//   reopenDoneAncestors() guards the CHILD side — when open work lands under a
//                        done parent (created there, moved there, or reopened
//                        there), the parent comes back out of done.
//
// Only blocking the parent left the invariant trivially defeatable: reparent an
// open subtask onto a done story and you were back in the state the block
// exists to prevent, having never seen it.
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

const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, run } = require('../database');
const { categoryOf } = require('./flow');
const { projectStatuses } = require('./workflow-statuses');

/** How many blockers the single-line message names before it summarizes. */
const INLINE_LIMIT = 5;

/**
 * How many blockers the response carries. The count is always exact; the list
 * is capped so a rejected click on a 500-child epic does not ship a 90 KB body
 * that no client renders in full.
 */
const PAYLOAD_LIMIT = 20;

/** A parent cannot sit above open work forever; stop walking runaway chains. */
const MAX_ANCESTOR_DEPTH = 10;

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
    blockers: blockers.slice(0, PAYLOAD_LIMIT),
    blocker_count: blockers.length,
  };
}

/** Where a reopened parent lands: the first in-progress column, else the first todo. */
function reopenTarget(statuses) {
  const ordered = [...statuses].sort((a, b) => Number(a.position) - Number(b.position));
  return ordered.find((s) => s.category === 'in_progress')
    || ordered.find((s) => s.category === 'todo')
    || null;
}

/**
 * The child half of the invariant. Called after open work lands under a parent
 * — by creation, by reparenting, or by the child leaving done — it walks up the
 * chain and pulls any done ancestor back out of done.
 *
 * In-progress, not to-do: the parent had been finished and is not any more, and
 * some of its children are still done, so it is genuinely mid-flight. Each move
 * is written to activity_log under the user who caused it, because it really
 * did happen and the history would otherwise show a status changing by itself.
 *
 * Returns the issues it reopened, outermost last.
 */
async function reopenDoneAncestors(db, child, actorId) {
  const reopened = [];
  let current = child;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (!current || !current.parent_id) break;
    const parent = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [current.parent_id]);
    if (!parent) break;

    const statuses = await projectStatuses(db, parent.project_id);
    if (categoryOf(parent.status, statuses) !== 'done') break;

    const target = reopenTarget(statuses);
    // A workflow made entirely of done columns has nowhere to reopen to.
    if (!target || target.key === parent.status) break;

    await run(db, "UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [target.key, parent.id]);
    await run(db,
      "INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, 'update', 'status', ?, ?)",
      [uuidv4(), parent.id, actorId, parent.status, target.key]);

    reopened.push({ ...parent, status: target.key, previous_status: parent.status });
    current = parent;
  }

  return reopened;
}

module.exports = {
  findOpenChildren, entersDone, blockerSummary, blockerMessage, completionBlock,
  reopenTarget, reopenDoneAncestors,
};
