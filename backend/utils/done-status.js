// ===== WHAT "DONE" MEANS =====
// An issue counts as done when its literal status is 'done' (baked-in workflow)
// or the project's workflow maps its status to the done category. The same rule
// the epic rollup uses in routes/issues.js.
//
// Lifted out of routes/sprints.js when automatic sprint scheduling arrived:
// the reconciler decides which issues get MOVED OUT of a closing sprint, so it
// has to answer this question identically to the routes that decide what a
// sprint reports and whether it may close. A project whose done column is
// "shipped" had already been burned once by three copies of this predicate
// disagreeing (see 2026-08-15-jira-parity-sprint-lifecycle-design.md); a fourth
// copy living in utils/ would have reopened exactly that bug.

/** SQL predicate: the issue at `alias` is in a done-category status. */
const doneWhere = (alias) => `(${alias}.status = 'done' OR EXISTS (
  SELECT 1 FROM project_statuses ps
  WHERE ps.project_id = ${alias}.project_id AND ps.key = ${alias}.status AND ps.category = 'done'))`;

/**
 * SQL predicate: the issue at `alias` should not stay in a closing sprint —
 * it is unfinished, OR it is finished but still has an unfinished subtask.
 *
 * The second clause is what keeps the subtask guard honest. Completing a sprint
 * is refused while any issue in it has an unfinished subtask
 * (`unfinishedSubtaskParents` in routes/sprints.js). A 409 has nobody to show
 * itself to during an automatic completion, and a sprint that refuses to close
 * would deadlock the next one out of activating, since only one sprint may be
 * active. So rather than bypass the guard, the sweep makes it true: a done
 * parent with an unfinished subtask leaves too, and the guard's predicate is
 * empty by construction by the time completion runs.
 *
 * parent_id carries both subtask->parent and story->epic links, so this filters
 * on type — otherwise an epic with unfinished stories, ordinary in-progress
 * work, would be swept out of its sprint every fortnight.
 */
const leavesClosingSprint = (alias) => `(NOT ${doneWhere(alias)} OR EXISTS (
  SELECT 1 FROM issues child
  WHERE child.parent_id = ${alias}.id AND child.type = 'subtask' AND NOT ${doneWhere('child')}))`;

module.exports = { doneWhere, leavesClosingSprint };
