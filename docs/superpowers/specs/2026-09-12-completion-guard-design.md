# Completion guard: a parent cannot be done while its children are open

## Problem

An issue could be dragged or set to Done while the work under it was still
open. Nothing stopped it, and nothing said why it was wrong, so boards showed
completed stories sitting above unfinished subtasks.

## Behavior

A transition **into** a done-category status is rejected when the issue has
direct children that are not themselves in a done-category status. The response
names every open child and the state each one is in, in one go — the point of
the feature is that "three subtasks are open" is useless without saying which
three and where they stand.

Applies at both levels of the hierarchy:

- an **epic** is blocked by open stories, tasks and bugs
- a **story, task or bug** is blocked by open subtasks

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Both levels, not just story → subtask |
| Enforcement | Hard block. No override, no admin bypass, no per-project setting |
| Paths covered | `PUT /issues/:id`, `PUT /issues/:id/move`, and automation `set_status` |
| Presentation | One toast: the headline as the title, a row per blocker as the description |
| Bulk update | Partial apply — the allowed issues move, the blocked ones are named |

Rejected: a configurable per-project workflow-validator framework. With no
override and no per-project switch, the configurability would have had no
consumer.

## Design

`backend/utils/completion-guard.js` is the single definition of "blocked".

```
completionBlock(db, issue, nextStatus, statuses)
  -> null | { error, summary, blockers[] }
```

- **Done is a category, not the key `done`.** Projects rename their done column
  and add second ones, so the test is `categoryOf(status, statuses) === 'done'`
  via the existing `utils/flow.js`. The same bug in `checkAllSubtasksDone` —
  a literal `status = 'done'` comparison that silently never fired on a custom
  workflow — is fixed in this change.
- **Direct children only.** A story cannot reach done with an open subtask, so
  an epic's deeper levels are enforced transitively.
- **Only transitions that newly enter done.** Moving between two done columns,
  or reopening, is never blocked — otherwise rows that predate the guard would
  become unmovable.
- **Three response fields.** `error` is a complete standalone sentence naming
  the blockers, for any surface that can only show a string (the mobile app
  relies on this). `summary` is the same headline with no list in it, for use
  as a toast title. `blockers` is the structured set.

`projectStatuses` moved from the `routes/workflows.js` router export to
`utils/workflow-statuses.js`, so the guard and the automation engine can ask
for a project's statuses without requiring a route module. `routes/workflows.js`
re-exports it; its three existing importers are unchanged.

### Automations

A rule's `set_status` answers to the same guard — otherwise a rule would be a
back door around the check the UI enforces. There is no automation run log, and
an `activity_log` row would render as "changed status from todo to done", a
change that never happened, so a skipped action is reported to the server log
only. The rule's other actions still run.

### Clients

`ApiError` carries `blockers` and `summary`. `lib/completion-blockers.tsx`
owns the presentation for the board (drag and bulk), the issue detail sheet,
and the service desk queues. Bulk update moved from `Promise.all` to
`Promise.allSettled`: one blocked parent used to abandon a batch after some
requests had already landed, leaving a state the toast did not describe.

The mobile issue detail screen gained an `onError` — its status mutation had
none, so a rejected change would have reverted silently.

## Not in scope

Rows that were already done-with-open-children before this shipped keep that
shape. The guard runs on transition; nothing backfills history.

---

## Addendum, 2026-09-14: the child side

The guard as first shipped was one-directional. It stopped a parent entering
done over open children, and did nothing about the children. Three probes
against the merged code all reached the state the guard exists to prevent:

| | Before | After |
| --- | --- | --- |
| Create an open subtask under a done story | `201`, parent stays done | parent reopens |
| Reparent an open subtask onto a done story | `200`, parent stays done | parent reopens |
| Reopen a subtask under a done parent | `200`, parent stays done | parent reopens |

The invariant is now stated in both directions: **no issue in a done-category
status has open children.**

- `completionBlock()` holds the parent side — a parent cannot enter done while
  its children are open.
- `reopenDoneAncestors()` holds the child side — when open work lands under a
  done parent, by creation, reparenting or reopening, the parent comes back out.

Adding work is never refused; only the parent's claim to be finished is. The
reopen walks the whole chain, so a reopened subtask reopens its story and then
its epic, stopping at the first ancestor that is not done.

A reopened parent lands in the project's first in-progress column by position,
falling back to the first to-do column. In-progress, not to-do: the parent had
been finished and is not any more, while some of its children still are, so it
is genuinely mid-flight. Each move is written to `activity_log` under the user
whose action caused it — the status really did change, and history that showed
it changing by itself would be worse than the entry.

### Payload

`blockers` is capped at 20 and `blocker_count` carries the true total. An epic
with 120 open children was returning a 21.6 KB body to render six rows.

### Legacy rows

Rows that were already done-with-open-children still exist and are still never
blocked from moving between done columns or back out of done. They are only
reachable now by direct database writes, which is how the test for that case
builds them.
