# Jira-Parity Sprint Lifecycle Design

**Date:** 2026-08-15
**Status:** Draft
**Priority:** High (production behavior change on a live system)

## Overview

Atlas freezes a completed sprint completely: no rename, no date change, no reopen,
no delete, enforced by a 409 on `PUT` and `DELETE /api/sprints/:id`. Jira does not
work that way. This design replaces the blanket freeze with Jira's actual rule set,
verified against Atlassian's documentation.

The current freeze is wrong in both directions. It is too strict — Jira allows
renaming a completed sprint and allows reopening one — and too loose, because Atlas
lets you delete an *active* sprint, which Jira forbids outright.

## Problem Statement

Commit `a8006ea` ("freeze completed sprints and scope the board to its sprint")
made completion irreversible. Choosing "completed" from a sprint card's status
dropdown moves unfinished work, closes the sprint, and permanently strips every
control from the card. There is no undo, no admin override, and no reopen path;
recovering from a misclick requires direct database access.

Atlassian's own documentation frames reopening as the remedy for exactly this: it
exists for when you "mistakenly completed the wrong sprint" or completed the right
one "too early."

Two secondary divergences compound the problem:

- Deleting a sprint in Atlas dumps its issues into the backlog. Jira moves them to
  the next sprint in the list.
- The completion dialog offers the currently-active sprint as a destination for
  unfinished work, and offers no way to create a new sprint. Jira offers the
  backlog, a *future* sprint, or a newly created sprint.

## Design Goals

1. Match Jira's documented sprint lifecycle rules exactly.
2. Make completion recoverable by an administrator, without making it casual.
3. Keep every rule enforced on the server. Hiding a control is not a rule.
4. No schema migration — the existing `status` CHECK constraint already permits
   all three values.

## Verified Jira Rules

Each row below is taken from Atlassian's Jira Cloud documentation (sources at the
end of this document), paired with Atlas's behavior as of `a8006ea`.

| Rule | Jira | Atlas today | Action |
|---|---|---|---|
| Delete a **completed** sprint | Blocked | Blocked | Keep |
| Delete an **active** sprint | Blocked — "you can only complete it" | Allowed | **Block it** |
| Edit a completed sprint's **name and goal** | Allowed | Blocked | **Allow it** |
| Edit a completed sprint's **dates** | Blocked | Blocked | Keep |
| **Reopen** a completed sprint | Allowed, permission-gated | Missing | **Add it** |
| Reopen while another sprint is active | Blocked unless parallel sprints enabled | n/a | **Block it** |
| Reopen sets a new end date | Yes, recorded in the sprint report | n/a | **Add it** |
| Delete sends issues to | Next sprint in the list | Backlog | **Change it** |
| Completion destinations | Backlog · future sprint · new sprint | Backlog · any non-completed sprint | **Change it** |
| Subtasks must be Done to complete | Required | Not enforced | **Add it** |

### Two deliberate deviations

**Parallel sprints.** Jira gates reopening behind a "parallel sprints" setting;
with it enabled, a sprint can be reopened alongside an active one. Atlas has no
parallel-sprints concept, and the board picks exactly one sprint
(`frontend/src/screens/board.tsx:190` resolves `active ?? planning ?? null`), so a
second active sprint would be invisible on the board. Atlas therefore implements
the restriction as a hard block rather than a toggle. Adding parallel sprints is
out of scope.

**Definition of "complete".** Jira counts a work item as complete only when it sits
in the rightmost board column. Atlas has no board-column mapping, so it keeps its
own definition — but which one matters. Sprint *statistics* use the literal
`status = 'done'` (`enrichSprint`). The subtask precondition instead uses the
workflow-aware predicate the epic rollup already uses in `routes/issues.js`: done
is `status = 'done'` **or** a status the project's workflow maps to the `done`
category. A project whose done column is not literally named `done` would otherwise
have every one of its sprints wedged permanently shut.

**Parent links are overloaded.** `issues.parent_id` carries both subtask→parent and
story→epic relationships (see the branch on `nextType === 'subtask'` in
`routes/issues.js`). The precondition therefore filters on `child.type = 'subtask'`.
Without that filter an epic with unfinished stories — ordinary in-progress work —
would block its sprint from ever completing.

## Architecture

### 1. Field-level freeze replaces the blanket freeze

**Scope:** `backend/routes/sprints.js`

`completedSprintFrozen` (line 24) currently rejects every write to a completed
sprint. It is replaced by a check that rejects only the fields Jira protects.

On a completed sprint, `PUT /api/sprints/:id`:

- accepts `name` and `goal`
- rejects `start_date`, `end_date` and `status` with **409** and the message
  `"A completed sprint's dates and status can't be changed. Reopen it first."`

The rejection triggers only when an incoming value **differs from the stored
value**. `EditSprintDialog` submits the full record on every save, so rejecting on
mere presence would break renaming — the exact operation Jira permits.

For the date comparison, an absent, `null` or empty-string incoming date is treated
as equal to a stored `NULL`. The dialog renders a cleared date input as `''` while
the column stores `NULL`, and a strict comparison would reject an unmodified save.

Status still cannot be changed through `PUT`. Reopening has its own endpoint so it
can carry its own guards and its own audit entry.

### 2. New reopen endpoint

**Scope:** `backend/routes/sprints.js`

```
POST /api/sprints/:id/reopen
Body: { end_date }         // required
Auth: requireAuth + requireBoardAdmin (admin, board_admin)
```

Responses:

| Condition | Status | Body |
|---|---|---|
| Sprint not found | 404 | `Sprint not found` |
| `status !== 'completed'` | 409 | `Only completed sprints can be reopened.` |
| Another sprint in the project is `active` | 409 | `Another sprint is already active. Complete it before reopening this one.` |
| `end_date` missing or unparseable | 400 | `A new end date is required to reopen a sprint.` |
| Success | 200 | The enriched sprint |

On success: `status` becomes `'active'`, `end_date` becomes the supplied date, and
an audit entry is written with action `Sprint reopened`, category `sprints`, and
details `{ from: 'completed', to: 'active', end_date }`.

Issues that were moved out at completion are **not** pulled back. This matches
Jira, where items already sitting in another active sprint stay put. The reopened
sprint contains whatever is currently assigned to it.

### 3. Delete rules

**Scope:** `backend/routes/sprints.js:111`

`DELETE /api/sprints/:id` returns **409** when the sprint is `completed` (existing
message retained) and **409** when it is `active`, with
`"An active sprint can't be deleted. Complete it instead."` Only `planning`
sprints are deletable.

Issue reassignment on delete changes from "always backlog" (line 118) to Jira's
rule: issues move to the next non-completed sprint in the project's list, falling
back to the backlog (`sprint_id = NULL`) when no such sprint follows. The delete
confirmation copy names the actual destination, and the response returns it.

"The list" is the one `GET /projects/:id/sprints` returns, so `nextSprintAfter`
walks that exact result rather than re-deriving the order with its own `WHERE`
clause. `created_at` has second resolution and ids are random UUIDs, so any
separate comparison orders same-second sprints differently from the list the user
is looking at — the successor rule has to agree with the list by construction, not
by two queries happening to sort alike.

### 4. Subtask precondition on completion

**Scope:** `backend/routes/sprints.js` (the `status → 'completed'` transition)

A sprint cannot be completed while any issue in it has a child issue
(`issues.parent_id`) whose status is not `done`. The check runs regardless of
whether the child sits in the sprint. Violations return **409** with the blocking
issue keys in the body so the client can name them.

`CompleteSprintDialog` pre-checks the same condition and lists the blocking issues
instead of offering the Complete button.

This is the rule most likely to frustrate users — a stale subtask makes a sprint
uncompletable until someone closes it. It is included because it is Jira's
behavior. It is also the single cleanest thing to drop if that tradeoff proves
wrong in practice.

### 5. Sprint card controls

**Scope:** `frontend/src/screens/sprints.tsx:53`

The single `readOnly` boolean is replaced by per-control conditions:

| Sprint status | Status dropdown | Edit (pencil) | Delete (trash) |
|---|---|---|---|
| `planning` | Yes | Yes | Yes |
| `active` | Yes | Yes | **No** |
| `completed` | No | **Yes** (name/goal only) | No |

All three are additionally gated on `canManage`, as today.

### 6. Edit dialog

**Scope:** `frontend/src/screens/sprints.tsx:181`

The early return at line 215 that refuses to edit a completed sprint is removed.
For a completed sprint the dialog opens with name and goal editable, and the start
date, end date and status fields disabled with the hint "Reopen the sprint to
change its dates."

### 7. Completion dialog

**Scope:** `frontend/src/screens/sprints.tsx:327`

The destination list (`destinationSprints`, line 344) changes from "every
non-completed sprint" to Jira's three options:

1. Any `planning` sprint in the project — the active sprint is no longer offered
2. **New sprint** — prompts for a name, creates it via
   `POST /api/projects/:id/sprints`, then moves the issues into it
3. **Backlog**

Default selection: the first `planning` sprint, falling back to Backlog.

**Write ordering.** `complete()` (line 352) currently closes the sprint first and
moves the issues second, so a failure between the two strands unfinished work
inside a closed sprint. The order is reversed: move the issues, then close the
sprint. A failure now leaves the sprint open and the operation retryable.

### 8. Reopen entry point

**Scope:** `frontend/src/screens/sprint-detail.tsx`

Jira places reopen in the Sprint Report. Atlas has no per-sprint report screen —
`frontend/src/screens/reports.tsx` is a project-wide dashboard — so the equivalent
surface is the sprint detail screen, which is already per-sprint and is already
where a completed sprint card links.

For a completed sprint, board admins see a "Reopen sprint" action in the page
header. It opens a confirmation dialog with a required new end date, explains that
work already moved into another sprint stays there, and calls the reopen endpoint.
On success the screen reloads and the board picks the sprint up again as the
active one.

## Data Flow

**Completing a sprint (Sprint 1, 3 unfinished issues):**

1. Card dropdown → `completed` → `onComplete(sprint)`; no write yet
2. `requestComplete` loads the sprint's issues and partitions on `status !== 'done'`
3. Subtask precondition checked; blocking issues listed if any
4. Dialog opens with destination options (planning sprints / new sprint / backlog)
5. On confirm: unfinished issues are reassigned **first**
6. Then `PUT /api/sprints/:id` with `status: 'completed'`
7. Audit entry written; sprints reload; the card moves to the Completed group
8. Board falls through to the next `planning` sprint

**Reopening a sprint:**

1. Sprint detail → "Reopen sprint" (board admin, completed sprint only)
2. Dialog collects the new end date
3. `POST /api/sprints/:id/reopen`
4. Server verifies completed status and that no other sprint is active
5. `status = 'active'`, `end_date` updated, audit entry written
6. Screen reloads; the board switches to this sprint

## Testing Strategy

`backend/tests/backend/sprints.test.js` currently asserts the blanket 409s that
`a8006ea` introduced. Those assertions are rewritten against the new rules rather
than deleted — the freeze is narrowing, not disappearing.

### Backend

- [ ] `PUT` renaming a completed sprint succeeds; `goal` likewise
- [ ] `PUT` changing a completed sprint's `start_date` or `end_date` returns 409
- [ ] `PUT` changing a completed sprint's `status` returns 409
- [ ] `PUT` resubmitting a completed sprint's unchanged dates and status succeeds
- [ ] `DELETE` on a completed sprint returns 409
- [ ] `DELETE` on an active sprint returns 409
- [ ] `DELETE` on a planning sprint moves issues to the next non-completed sprint
- [ ] `DELETE` on the only planning sprint moves issues to the backlog
- [ ] Reopen succeeds from `completed`, sets `active` and the new end date
- [ ] Reopen from `planning` or `active` returns 409
- [ ] Reopen returns 409 when another sprint in the project is active
- [ ] Reopen without `end_date` returns 400
- [ ] Reopen from a non-board-admin returns 403
- [ ] Completing with an unfinished subtask returns 409 and names the issue
- [ ] Reopen writes an audit entry with `from`/`to`

### Frontend

- [ ] Completed card renders the pencil, and no dropdown or trash
- [ ] Active card renders the dropdown and pencil, and no trash
- [ ] Edit dialog on a completed sprint disables dates and status, not name
- [ ] Completion dialog omits the active sprint from destinations
- [ ] Completion dialog offers "New sprint" and creates one on confirm
- [ ] Issues are reassigned before the sprint is closed
- [ ] Reopen action appears on sprint detail only for completed sprints and admins

### End-to-end

`frontend/e2e/sprints.spec.ts` gains a full round trip: complete a sprint, confirm
the card is frozen apart from rename, reopen it from the detail screen, and confirm
the board returns to it.

## Migration & Rollout

**No database migration.** `sprints.status` already permits `planning`, `active`
and `completed` (`backend/database.js`), and reopening only moves a row between
existing values. No new columns.

**Backward compatibility.** Sprints completed before this change reopen normally;
nothing about their stored shape differs. Reports, velocity and burndown read from
sprint status and issue status and are unaffected by the rule changes, though a
reopened sprint will re-enter "active" reporting — which is the intended behavior
and matches Jira.

**Production safety.** Atlas is live with real users. Reopening is restricted to
`admin` and `board_admin`, is audit-logged, and cannot produce two active sprints.
The riskiest change is the delete-destination switch, since issues now land in
another sprint instead of the backlog; the confirmation dialog names the
destination before the user commits.

**Order of work.** Backend rules first (they are the enforcement), then the card
and dialog changes, then the reopen UI, then the e2e round trip.

## Edge Cases

1. **Reopening when the destination sprint has since been completed.** Issues stay
   where they are. Reopen does not reclaim work, matching Jira.
2. **Reopening a sprint whose end date is in the past.** The new end date is
   required precisely so this cannot happen silently.
3. **Two admins reopening at once.** The second request finds the sprint already
   `active` and returns 409 from the "not completed" guard.
4. **Deleting a planning sprint that is followed by the active sprint.** The
   ordering rule considers any non-completed sprint, so the issues move into the
   active sprint. The backlog fallback applies only when no sprint follows the
   deleted one at all. The confirmation dialog names whichever destination applies.
5. **Renaming a completed sprint changes its slug.** Out of scope — slugs are
   assigned at creation (`uniqueSlug`) and are not recomputed on rename today, so
   existing links keep working.
6. **A completed sprint with an unfinished subtask, completed before this change.**
   The precondition applies only at completion time; existing completed sprints are
   untouched.

## Success Criteria

- Every row of the Verified Jira Rules table matches Atlas's behavior, with the two
  deviations documented above
- An administrator can recover from an accidental completion without database access
- Every rule returns the correct status from the API, not just a hidden button
- Reopening is impossible while another sprint is active
- Existing sprint tests pass in rewritten form; no test is deleted to make a rule pass

## Relationship to Prior Work

The design in `2026-08-06-sprint-status-filtering-design.md` introduced the
completed-sprint status lock and explicitly left "Can admins override the completed
sprint lock?" as an open question, out of scope. Commit `a8006ea` then widened the
lock to cover rename and delete as well. This design answers that open question —
yes, via reopen — and corrects the width of the lock to match Jira.

## Sources

- [Reopen a sprint](https://support.atlassian.com/jira-software-cloud/docs/reopen-a-sprint/)
- [Complete a sprint](https://support.atlassian.com/jira-software-cloud/docs/complete-a-sprint/)
- [Edit a sprint in a company-managed space](https://support.atlassian.com/jira-software-cloud/docs/edit-a-sprint-in-a-company-managed-project/)
- [Delete a sprint](https://support.atlassian.com/jira-software-cloud/docs/delete-a-sprint/)
