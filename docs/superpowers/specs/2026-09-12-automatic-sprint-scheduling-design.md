# Automatic Sprint Scheduling Design

**Date:** 2026-09-12
**Status:** Approved — build directed by the user without a review gate
**Priority:** High (production behavior change on a live system, no opt-out)

## Overview

Sprints in Atlas are created, started and completed entirely by hand. This design
makes them run on a fixed semi-monthly calendar instead:

- **Window 1** — the 1st through the 15th
- **Window 2** — the 16th through the last day of the month

Atlas creates the sprint for each window, activates it when the window opens, and
completes the outgoing sprint at the same moment, sweeping unfinished work forward.
Every other sprint rule established in `2026-08-15-jira-parity-sprint-lifecycle-design.md`
is unchanged.

## Decisions

Two were the user's, taken directly:

1. **Full lifecycle.** Atlas creates, activates *and* completes. No human in the loop.
2. **Global, always on.** Every project, no setting, no opt-out. In-flight manual
   sprints are swept at the next boundary.

The user then directed implementation without further questions, so the remaining
decisions below are mine, recorded here so they are reviewable rather than buried.

### Scheduling: lazy reconciliation, not a cron

Atlas has no scheduler. `backend/utils/sla.js:2` states it outright — *"Atlas has
no scheduler — no cron, no setInterval"* — and `backend/utils/timers.js:12` repeats
the philosophy: derived state is repaired lazily on the next read or write.

Automatic sprints follow that same rule. `reconcileProject(db, projectId, now)` runs
at the top of the two sprint reads:

- `GET /api/projects/:projectId/sprints` (the sprints screen **and** the board, which
  calls the same endpoint — `frontend/src/screens/board.tsx:175`)
- `GET /api/sprints/:id` (sprint detail)

The boundary therefore takes effect on the first request after it passes, not at
midnight exactly. For a work-tracking tool this is indistinguishable: nobody is
looking at the board at 00:00, and the first person who looks sees the correct state.

The alternative — adding `node-cron` or a `setInterval` — would introduce the first
background scheduler in the codebase, with its own failure modes on a multi-instance
deployment (every instance firing the same sweep). Rejected.

### Timezone: IST

`sprints.start_date` / `end_date` are date-only strings. `projects` has a
`business_hours` column but **no timezone column**; timezone lives on `users`, so
there is no project-wide answer to "is it the 16th yet?" available today.

Windows are cut on **IST** (`Asia/Kolkata`), the working calendar of the team
Atlas runs for, so a window turns over at local midnight there rather than at
05:30 local. It is one constant, `SPRINT_TIMEZONE`, in one file; when projects
gain a timezone of their own, that constant is what it replaces.

Resolved through `Intl` with a named IANA zone rather than a fixed `+05:30`
offset. India does not observe DST, so the two agree today — but the zone stays
correct if that ever changes, and it matches how the rest of the codebase reads a
wall clock (`utils/flow.js`).

The reconciler's "has this sprint's end date passed?" check reads the same
calendar. Asking it against UTC while cutting windows on IST would have the two
disagree for five and a half hours out of every day.

*(Shipped as UTC on 2026-09-12 and changed to IST the same day, at the user's
request, before the first handover on the 16th.)*

### Identity: an `auto_key`, not a name match

A new nullable column `sprints.auto_key` holds the window it was generated for
(`2026-09-1`, `2026-09-2`), with `UNIQUE (project_id, auto_key)`.

This is what makes reconciliation idempotent and race-safe: two concurrent requests
both try to insert the same window, and the unique index lets exactly one win while
the loser re-reads. Matching on name or slug instead would misfire the moment
someone renames a sprint — which Jira, and Atlas, permit even after completion.

`auto_key IS NULL` marks a hand-made sprint. That is how the reconciler tells the
sprints it owns from the ones a person made.

### Naming

`Sep 1–15, 2026` and `Sep 16–30, 2026`. Slug is derived from the key and is
deterministic: `sprint-2026-09-1`. The year is in the name because a project's
sprint list is long-lived and `Sep 1–15` alone repeats annually.

### The subtask guard, and why sweeping satisfies it

The manual path refuses to complete a sprint while any issue in it has an unfinished
subtask (409, `unfinishedSubtaskParents`). "All other rules are the same" — but a
409 has nobody to show itself to during an automatic completion, and a sprint that
refuses to close would deadlock the next one out of activating, since only one
sprint may be active.

The rule is kept rather than bypassed, by making it true before completion runs.
An issue leaves the closing sprint when:

> it is **not done**, **or** it has an **unfinished subtask**

The second clause is the one that matters. Without it a *done* parent with an
unfinished subtask stays behind and the guard fires. With it, `unfinishedSubtaskParents`
is empty by construction at the moment completion runs, so the same predicate the
manual path enforces is satisfied — not skipped.

"Done" is the workflow-aware `doneWhere` predicate already shared across the sprint
module, not the literal string `'done'`.

### Unfinished work goes to the incoming sprint

Not the backlog. This matches what deleting a sprint already does ("next sprint in
the list") and what Jira's completion dialog defaults to.

Each move writes an `activity_log` row with `field = 'sprint'` and the old sprint id
as `old_value`, because that is the sole source `previousSprints` reads to build an
issue's rollover history (`backend/routes/issues.js:111`). Skipping it would make
automatically-rolled work lose the history that manually-rolled work keeps.

### In-flight manual sprints

On the first reconcile after deploy, a project may have an active hand-made sprint.
It is treated exactly as an outgoing automatic sprint: its unfinished work is swept
into the current window's sprint and it is completed. This is the behavior the user
chose explicitly, with the consequence stated.

Manual sprints in `planning` are left alone — they are not active, so they block
nothing.

### No backfill

Only the current window and the next one are materialized. Past windows are never
created; a project that sat idle for three months gets the current sprint, not a
retroactive history it never worked in.

## Architecture

### `backend/utils/sprint-windows.js` — pure

No database, no clock of its own. Window math only, so the boundary rules are
testable without a server.

- `windowFor(date)` → `{ key, year, month, half, start_date, end_date, name, slug }`
- `nextWindow(window)` → the window after it, rolling the year at December
- `currentAndNext(now)` → the two windows to materialize

### `backend/utils/auto-sprints.js` — the reconciler

`reconcileProject(db, projectId, now)`, idempotent:

1. Compute current and next window.
2. **Short-circuit:** if the current window's sprint exists and is `active`, and no
   other sprint in the project is `active`, and the next window's sprint exists —
   return. This is the common path and costs one query.
3. Ensure a sprint row exists for both windows (insert; on unique violation re-read).
4. Complete every `active` sprint that is not the current window's — sweeping first.
5. Activate the current window's sprint unless it is already `completed`.

A completed current-window sprint is not resurrected; reopening stays the manual,
audited path it is today.

### Audit

Every automatic action writes an `audit_log` entry with a null `user_id`, the actor
name `Atlas scheduler`, and an explicit action — `Sprint auto-created`,
`Sprint auto-started`, `Sprint auto-completed` — with the swept issue count in
`details`. A sweep that moves someone's work must be traceable to the machine that
did it.

## Three things implementation turned up

**`activity_log.user_id` was NOT NULL** (migration `037`). Every row in that table
had until now been somebody's doing. The sweep is nobody's, and the reader whose
page load crossed the boundary is not its author. NULL is what "no user" already
means elsewhere — `audit_log.user_id` is nullable, `routes/activity.js` LEFT JOINs,
`audit-log.tsx` renders a null actor as "System" — so the column is widened to match
rather than a fake system user being invented or a real person being blamed.
`issue-tabs.tsx` gained the fallback it was missing and renders such rows as "Atlas".

**`logToDb` bound `userName` as `undefined`** when given no `userId`. Every existing
caller passed one, so the lookup always assigned it and the `undefined` default never
reached the driver; sql.js rejects an undefined bind outright, and the function's own
catch would have swallowed that as a silently missing audit entry. Now coalesced to
null. Latent bug, not one this feature introduced — but this feature is what reached it.

**Sprint list order was not deterministic.** `ORDER BY created_at` has second
resolution, so same-second sprints tied and came back in whatever order the engine
scanned: the list could reorder itself between two reads, and `nextSprintAfter` could
hand a deleted sprint's issues to a different successor each time. Automatic
scheduling made it reachable by writing two windows in one breath — and creation
order then said nothing about which sprint runs first, so `Sep 16–30` could list above
`Sep 1–15`. Both halves are fixed by one ordering, shared by the GET and
`nextSprintAfter`: `(start_date IS NULL), start_date, created_at, id` — calendar order,
undated sprints last, and a fixed tiebreak. The portable spelling of NULLS LAST, since
SQLite and MySQL both sort NULLs first in ASC.

## Testing

`backend/tests/backend/auto-sprints.test.js`, driving `now` explicitly rather than
waiting on the wall clock:

- Window math: month lengths (30/31), February in a leap and non-leap year, the
  December→January roll, and both boundary days (15→16, last day→1st).
- Reconcile creates current and next, and is idempotent across repeated calls.
- Crossing a boundary completes the outgoing sprint and activates the incoming one.
- Unfinished work moves; done work stays.
- A done parent with an unfinished subtask moves, and the completed sprint does not
  trip the subtask guard.
- Rollover history (`previous_sprints`) names the automatically-completed sprint.
- An in-flight manual sprint is swept and completed at the first reconcile.
- A manual sprint in `planning` is left untouched.

The existing 40 sprint tests must stay green, plus migration tests covering `036`'s
unique index and `037` rebuilding a **legacy `NOT NULL`** `activity_log` — the shape
every deployed instance actually runs it against, and the one a fresh-schema test
would never exercise.

Three existing tests needed their fixtures adjusted, all for the same reason: they
reached for a sprint with `sprints.body[0]` and got a completed calendar window,
which cannot accept new work. They now ask for a sprint that is open. The rules they
assert are unchanged; only the fixture selection became explicit about what it needs.
The fourth was `sprints.test.js`'s delete test, which needed its sprints separated in
time for "the next sprint" to be a well-defined thing at all.

## What the E2E suite caught that the unit tests did not

Every unit test above exercises a project that *has* sprints. Three faults only
appear in a project that does not, or in a person disagreeing with the scheduler:

**The scheduler overrode people.** It re-activated the current window on every
read, which silently removed two abilities: parking the running sprint (the next
page load put it back), and reopening anything at all — reopen refuses while
another sprint is active, so an always-active calendar sprint made
`POST /sprints/:id/reopen` unreachable, and a reopen that did land was completed
again on the next read. The calendar now acts only at a handover it drives: this
window being materialised for the first time, or a sprint it scheduled for an
earlier window still holding the slot past its end date. Between handovers a
person is in charge.

**The handover test was circular.** A hand-made sprint carries no end date, so its
own presence counted as "something outgoing holds the slot" — triggering the
handover that immediately completed it. Nobody could run a sprint of their own.
Only a sprint the calendar itself scheduled can trigger a handover now; a
hand-made one is swept at the next real boundary, which is what "swept at the
next boundary" was asked to mean.

**A project with no sprints loses its board.** `board.tsx` resolves
`active ?? planning ?? null`, and a project that never used sprints hit the
`null` branch and showed everything. Give it an empty calendar sprint and the
board scopes to zero issues — in the demo seed, "Atlas Development" has 219
issues and no sprints, so its board goes blank. Nothing is deleted and the work
stays in the backlog, but it reads as a wiped board.

This last one was **put to the user**, because the consequence was not part of
what they had chosen and it is not reversible once deployed. They chose fully
global, unchanged. It ships as the second option above: every project gets
calendar sprints, and a backlog-only project's board shows its new, empty sprint
until work is planned into it.

## Risks

**This changes data on a live system with no opt-out.** On first load after deploy,
every project with an active manual sprint has that sprint completed and its
unfinished work moved. This was requested explicitly and reaffirmed; it is recorded
here because the audit trail is the only way back to what moved.

The demo seed (`Sprint 12`, active, dated April 2026) will be auto-completed on first
view like any other in-flight sprint.

Separately, **every project that has never used sprints gets an empty active sprint,
and its board goes blank** until work is planned into it. The work is untouched in
the backlog. This was raised with the user and confirmed rather than assumed.
