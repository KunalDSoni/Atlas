// Automation engine: trigger → conditions → actions.
// Fired after issue events. Actions run at depth 1 only — an automation-applied
// change never re-triggers another rule, so rules cannot loop.

const { queryOne, queryAll, run } = require('../database');
const { notify } = require('./notify');
const { issueLink } = require('./links');
const { categoryOf } = require('./flow');
const { projectStatuses } = require('./workflow-statuses');
const { completionBlock } = require('./completion-guard');

function parse(json, fallback) {
  try { return JSON.parse(json) ?? fallback; } catch { return fallback; }
}

/** conditions: [{ field: 'type'|'priority'|'status', value }] — all must match. */
function conditionsMatch(conditions, issue) {
  return conditions.every((c) => {
    if (!c || !c.field) return true;
    return String(issue[c.field] ?? '') === String(c.value ?? '');
  });
}

async function applyActions(db, rule, issue, actorId) {
  const actions = parse(rule.actions, []);
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'set_status': {
          if (issue.status !== action.value) {
            // The completion guard binds rules too: a rule that closed a parent
            // out from under its open children would be a back door around the
            // same check the UI enforces. There is no run log to write the skip
            // to, and an activity row would read as a change that never
            // happened, so the skip is reported to the server log only.
            const statuses = await projectStatuses(db, issue.project_id);
            const blocked = await completionBlock(db, issue, action.value, statuses);
            if (blocked) {
              console.warn(`automation set_status skipped (rule ${rule.id}): ${blocked.error}`);
              break;
            }
            await run(db, "UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?", [action.value, issue.id]);
          }
          break;
        }
        case 'set_assignee': {
          await run(db, "UPDATE issues SET assignee_id = ?, updated_at = datetime('now') WHERE id = ?", [action.value || null, issue.id]);
          break;
        }
        case 'add_label': {
          const labels = parse(issue.labels || '[]', []);
          if (action.value && !labels.includes(action.value)) {
            labels.push(action.value);
            await run(db, "UPDATE issues SET labels = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(labels), issue.id]);
          }
          break;
        }
        case 'notify_user': {
          await notify(db, {
            userId: action.value,
            actorId,
            type: 'automation',
            message: `Rule "${rule.name}" matched ${issue.issue_key}`,
            link: issueLink(issue.issue_key),
            issueId: issue.id,
          });
          break;
        }
        default:
          break;
      }
    } catch (e) {
      console.error(`automation action failed (rule ${rule.id}):`, e.message);
    }
  }
}

/**
 * Run all enabled rules for an event.
 * event: { type: 'issue_created'|'status_changed'|'all_subtasks_done', issue, actorId }
 */
async function runAutomation(db, { type, issue, actorId }) {
  if (!issue) return;
  try {
    const rules = await queryAll(db,
      'SELECT * FROM automation_rules WHERE project_id = ? AND trigger_type = ? AND enabled = 1',
      [issue.project_id, type]);
    for (const rule of rules) {
      if (conditionsMatch(parse(rule.conditions, []), issue)) {
        await applyActions(db, rule, issue, actorId);
      }
    }
  } catch (e) {
    console.error('automation run failed:', e.message);
  }
}

/**
 * After a subtask status change: if every sibling subtask of the parent is done,
 * fire all_subtasks_done with the PARENT issue.
 */
async function checkAllSubtasksDone(db, subtask, actorId) {
  if (!subtask || subtask.type !== 'subtask' || !subtask.parent_id) return;
  try {
    // Done is a status CATEGORY, not the literal key 'done'. A project that
    // renamed its done column, or added a second one, used to never fire this
    // trigger because every subtask failed a `status = 'done'` comparison.
    const statuses = await projectStatuses(db, subtask.project_id);
    const siblings = await queryAll(db,
      "SELECT status FROM issues WHERE parent_id = ? AND type = 'subtask'", [subtask.parent_id]);
    const allDone = siblings.length > 0
      && siblings.every((s) => categoryOf(s.status, statuses) === 'done');
    if (allDone) {
      const parent = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [subtask.parent_id]);
      await runAutomation(db, { type: 'all_subtasks_done', issue: parent, actorId });
    }
  } catch (e) {
    console.error('all_subtasks_done check failed:', e.message);
  }
}

module.exports = { runAutomation, checkAllSubtasksDone };
