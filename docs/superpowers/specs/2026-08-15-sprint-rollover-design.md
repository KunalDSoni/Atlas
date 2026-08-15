# Sprint Rollover Design

**Date:** 2026-08-15
**Status:** Implemented
**Priority:** Medium (production behavior change on a live system)

## Overview

Two rules with one subject: what happens to an issue when the sprint under it
closes.

1. A ticket that carried over says so, naming the sprints it came from.
2. A completed sprint stops being somewhere work can be put.

## Problem Statement

Completing a sprint sweeps its unfinished work into another sprint. Afterwards
the ticket looks like it was always there — nothing on it records that it slipped,
so "how long has this been dragging on?" can only be answered by reading the
activity tab move by move.

Separately, the Sprint picker on a ticket lists every sprint the project has ever
had, completed ones included. Assigning work to a sprint that closed weeks ago
silently corrupts that sprint's velocity and its report, and nothing stops it.

## Design Decisions

| Question | Decision |
|---|---|
| How the history reads | Jira parity: the field shows the current sprint, with the past ones named beneath it |
| Which past sprints count | Ones the issue has left **that are now completed** |
| A ticket already in a completed sprint | Its own sprint stays listed but disabled, so the field still reads correctly |
| Enforcement | Server rejects the assignment too — hiding a control is not a rule |
| Who the rule applies to | Every caller, personal API tokens included |

The last row was revisited after release, when the obvious cost of enforcement —
an integration that assigns to a closed sprint starts getting a 409 — came up
against the option of exempting API tokens. Jira does not exempt them: its Agile
API refuses to move issues into a closed sprint the same way its UI does. A rule
that applies only to humans is not a rule, and the write it would wave through is
exactly the one that corrupts a closed sprint's velocity and report, silently and
after the fact. Enforcement stays uniform; the surprise is addressed by
documenting the rule in the API reference instead of by weakening it.

The second row is what separates a rollover from a correction. An issue filed
against the wrong planning sprint and moved an hour later never rolled over, and
that sprint never closes with the issue in it. Restricting to completed sprints
drops those without needing to tag anything at completion time — which also means
history recorded before this change reads correctly.

## Architecture

### 1. Rollover history is derived, not stored

**Scope:** `backend/routes/issues.js`

No new column and no migration. Every path that reassigns an issue already writes
an `activity_log` row carrying the old and new sprint ids, including the sweep at
sprint completion. `previousSprints(db, issue)` reads those rows, keeps the ids
the issue has left, and returns the ones whose sprint is now `completed`.

**Two field spellings.** The two write paths disagree: `PUT /issues/:id/move`
labels the row `sprint`, while `PUT /issues/:id` passes the column name straight
through as `sprint_id`. The completion sweep goes through the PUT, so `sprint_id`
is the spelling most rollovers actually carry — a query matching only `sprint`
returns an empty history for the exact case the feature exists for. The query
matches both.

**Ordering.** By when the issue *left* each sprint, which is the order someone
reading the ticket is reconstructing. Sorting on the sprints' own dates cannot do
it: `start_date` is optional, and `created_at` has second resolution in both
engines, so sprints created in one burst tie and come back in whatever order the
engine happened to scan — the same trap documented in
`2026-08-15-jira-parity-sprint-lifecycle-design.md`. Ties fall back to the
sprint's `created_at` and then its id: arbitrary, but fixed, so the line never
reorders itself between two reads of the same issue.

**Payload placement.** `previous_sprints` is attached in `enrichIssue` (the
single-issue path) and not in `enrichIssues` (the list path). Only the detail
panel shows the history, and a board of 100 issues should not pay for a history
read each. This is the same bargain `in_progress_minutes_live` already makes, and
`enrich-batching.test.js` records it as a deliberate divergence rather than
letting it silently widen.

### 2. A completed sprint takes no new work

**Scope:** `backend/routes/issues.js`

`completedSprintError(db, nextSprintId, currentSprintId)` returns a message, or
null when the move is allowed. It guards all three write paths: `POST` create,
`PUT` update, and `PUT /move`. Violations return **409** with
`"<name> is completed and can't take new work. Reopen it first."`

The check fires only when the incoming value **differs from the stored one**. The
done work a sprint keeps after it closes is still in that sprint, and the edit
dialog resubmits the whole record on every save — rejecting on mere presence
would make that work unsavable. Moving an issue *out* of a completed sprint, or
to the backlog, is never blocked.

Reopening a sprint restores its right to take work, with no special handling:
`status` is no longer `completed`, so the guard stops firing.

### 3. One definition of an assignable sprint

**Scope:** `frontend/src/lib/domain.tsx`

`assignableSprints(sprints, currentSprintId?)` drops completed sprints, keeping
the one the issue is already in. Both pickers use it, so the rule cannot drift
between them:

| Surface | Call | Completed sprint shown? |
|---|---|---|
| Issue detail rail | `assignableSprints(sprints, issue.sprint_id)` | Only the issue's own, disabled and labelled `(completed)` |
| Create issue dialog | `assignableSprints(sprints)` | No — new work is the newest work there is |

The create dialog can still be handed a completed sprint as its default by a
screen scoped to one. Rather than reset state in an effect keyed on a prop array
(which would clear the form on every parent re-render), the selected value is
derived at render and falls back to Backlog when it is not in the list.

Filtering in the client only spares people a 409; the server is what enforces it.

### 4. The Previously line

**Scope:** `frontend/src/components/app/issue-detail/issue-fields.tsx`

Beneath the Sprint field, when the list is non-empty:

```
Sprint
┌──────────────────────────┐
│ Sprint 3               ⌄ │
└──────────────────────────┘
Previously: Sprint 1, Sprint 2
```

An absent `previous_sprints` — an older server, or any payload without the field
— renders nothing rather than a dangling `Previously:`. The Sprint trigger gained
an `aria-label`, which it lacked; the visible `<Label>` was never associated with
it.

## Data Flow

1. Sprint 1 is completed; its unfinished work is swept into Sprint 2 via
   `PUT /issues/:id`, which writes `activity_log(field='sprint_id',
   old_value=Sprint 1, new_value=Sprint 2)`
2. Sprint 1's status becomes `completed`
3. Opening the ticket calls `GET /issues/:id`; `previousSprints` reads that row,
   sees Sprint 1 is completed, and returns it
4. The rail renders `Previously: Sprint 1`
5. The Sprint dropdown no longer offers Sprint 1; the server 409s if anything
   asks for it anyway
6. `patch()` refetches after every change, so the line stays current without a
   reload

## Testing

**Backend** — `backend/tests/backend/sprint-rollover.test.js`, 14 tests:
history after a completed sprint; accumulation across two rollovers; ordering
by exit time (with the exit timestamps written directly, days apart and out of
order, because moves made back to back all land in the same second and would pass
on whatever order the engine scanned); a move between two open sprints ignored;
the current sprint never listed; an issue that never moved; the list payload
omitting the field; 409 on all three write paths; an issue already in a completed
sprint still editable and still movable out; the backlog never blocked; a
reopened sprint accepting work again.

**Frontend** — `assignable-sprints.test.ts` (5) covers the filtering rule
directly; `issue-fields.test.tsx` (5) covers the Previously line, its absence in
both the empty and missing-field cases, and the field reading a completed sprint
it is still in. Which options a Radix menu renders is not asserted through the
DOM — opening one needs pointer APIs jsdom lacks, and the rule itself is already
covered as a unit.

**Verified in the running app**, not only in tests: a ticket seeded through two
rollovers renders `Sprint 3 / Previously: Sprint 1, Sprint 2`, its dropdown lists
only the backlog and open sprints, and `PUT` with a completed sprint id returns
409.

## Edge Cases

1. **An issue moved to the backlog between sprints.** The exit from the first
   sprint is its own activity row, so the history survives the detour.
2. **An issue that passed through the same sprint twice.** Listed once, placed by
   its first exit.
3. **A sprint deleted rather than completed.** `DELETE /sprints/:id` reassigns
   issues with raw SQL and writes no activity row. Nothing to show, and the
   sprint is gone — correct by omission.
4. **Two sprints closed in the same second.** Deterministic but arbitrary order.
   Real sprints close days apart.
5. **A completed sprint that gets reopened.** It drops out of the history (it is
   no longer completed) and returns to the picker. Consistent in both directions.
6. **Subtasks.** They follow their parent's sprint and cannot be assigned one, so
   they have no history of their own. Unchanged.

## Out of Scope

- Showing rollover on board or backlog cards. The count belongs where the
  explanation is; adding a badge to the card means paying for the history read on
  every list.
- A "rolled over N times" metric in reports.
- Blocking rollover, or capping how many times work may carry over.

## Relationship to Prior Work

`2026-08-15-jira-parity-sprint-lifecycle-design.md` established what a completed
sprint permits (rename yes, dates and status no, reopen via its own endpoint) and
made completion recoverable. It governs the *sprint*. This design governs the
*issues* pointing at one: what they remember, and what may still be pointed at a
closed sprint.
