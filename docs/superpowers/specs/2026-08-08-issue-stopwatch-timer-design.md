# Issue stopwatch: explicit start/pause time tracking

## Relationship to the existing time-tracking specs

Two specs already cover automatic time tracking:

- `docs/superpowers/specs/2026-07-29-auto-time-tracking-design.md` — derive a
  work log from `activity_log` status transitions when an issue reaches a
  `done`-category status.
- `docs/superpowers/specs/2026-07-29-auto-time-tracking-business-hours-design.md`
  — measure those durations in configured business hours rather than raw
  wall-clock, and let a human correct a wrong auto entry.

Both are **implemented and merged**. This spec adds a third, complementary
source of truth — an explicit user-driven stopwatch — and defines how it
takes precedence over the derived calculation. It does not change how the
derived calculation works.

## Current state (verified 2026-08-08)

What exists and works:

- `work_logs.source` (`'manual'` / `'auto'`), `work_logs.locked_from_auto`,
  `issues.auto_worklog_locked`, and `business_hours` JSON on `projects` and
  `users` — all shipped in migration `024_auto_time_tracking_business_hours`.
- `backend/utils/auto-worklog.js` — `applyAutoWorklog` sums every
  `in_progress`-category segment from `activity_log`, clipped to the resolved
  business-hours profile, and writes a single `source='auto'` row. Wired into
  the status-change block at `backend/routes/issues.js:487`.
- Moving to a `todo`-category status clears `auto_worklog_locked`, so a fresh
  cycle recomputes cleanly (`backend/routes/issues.js:489`).
- `liveInProgressMinutes` and the `in_progress_minutes_live` field on
  `GET /api/issues/:id` (`backend/routes/issues.js:377`).
- `PATCH`/`DELETE /api/worklogs/:id` convert an auto row to a locked manual
  row so human corrections survive re-completion
  (`backend/routes/worklogs.js`).
- `GET /api/projects/:projectId/reports/time-tracking` and its CSV export.

What is missing, and is picked up by this spec:

- `in_progress_minutes_live` is **dead on the web client**. The backend
  computes and returns it and `frontend/src/lib/types.ts:190` declares it, but
  no component reads it. The only time-tracking UI on web is the worklog list
  and its `auto` badge in
  `frontend/src/components/app/issue-detail/issue-fields.tsx`.
- **Mobile has no time-tracking UI at all.**
  `mobile/src/screens/IssueDetailScreen.tsx` is 84 lines covering title,
  description, status picker, and assignee picker only.

Explicitly deferred (see Non-goals): there is no settings UI for
`business_hours` on either the project or user forms. The columns work but are
only writable through the API.

## Problem

Time derived from status transitions is an inference, not a measurement. It
answers "how long was this ticket sitting in an in-progress column," which is
a good default but wrong whenever the two diverge: a ticket left in In
Progress while the person works on something else, work done on a ticket
before it was formally moved, or two people splitting a ticket where only the
assignee gets credited.

There is currently no way for a person to say "I am working on this *now*,"
and no way to stop counting without moving the ticket off the board column
they want it in.

## Goal

Let a user explicitly start, pause, and resume a per-issue stopwatch; have
that explicitly-tracked time take precedence over the derived calculation for
issues where it was used; and surface both values on web and mobile.

## Non-goals

- **Not replacing the derived calculation.** Issues where nobody ran a
  stopwatch keep behaving exactly as they do today.
- **No cron, no scheduler.** Consistent with `backend/utils/sla.js`'s stated
  philosophy, everything is computed from timestamps on read/write. Segment
  auto-close (§2) happens lazily when the data is next touched.
- **No per-segment assignee reattribution.** A timer segment belongs to the
  user who started it, permanently, regardless of later reassignment. This is
  simpler *and* more correct than the derived path's assignee-at-completion
  rule, because the stopwatch records who was actually working.
- **No board-card timer indicator** in this iteration.
- **No `business_hours` settings UI** in this iteration. The runaway-timer cap
  degrades gracefully without it (§2), so nothing here is blocked by its
  absence.
- **No holiday calendars** — inherited from the business-hours spec.

## Design

### 1. Schema

Migration `029_issue_timers` (last shipped id is `028_feature_impact_metrics_table`):

```sql
CREATE TABLE timer_segments (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  started_at  DATETIME NOT NULL,
  ended_at    DATETIME,          -- NULL = currently running
  created_at  DATETIME NOT NULL
);
CREATE INDEX idx_timer_segments_issue ON timer_segments(issue_id);
CREATE INDEX idx_timer_segments_user_open ON timer_segments(user_id, ended_at);
```

Append-only. A segment is written on start, closed on pause, and never
mutated again. The running total is always derived by summing segments —
there is no stored accumulator to corrupt. This mirrors how
`activity_log` → `statusTimeline` already works and means a crash mid-timer
loses at most the open segment's end time, which §2's auto-close recovers.

Both a `sqlite` and a `mysql` form are required for every step, per
`backend/migrations.js` conventions.

**One running segment per user, globally** — enforced in application code, not
by a partial unique index, because MySQL does not support those and the same
migration list runs against both drivers. Starting a timer while one is
running on another issue closes the other one first (§3).

`work_logs.source` gains a third accepted value, `'timer'`. There is no CHECK
constraint to alter — it was deliberately omitted when the column was added
(migration `024`, following `001_issues_epic_color`'s precedent that `ALTER
TABLE ADD COLUMN` cannot carry a CHECK), and the allowed set is enforced in
application code.

### 2. Measurement, and the runaway-timer problem

**Stopwatch segments are not business-hours clipped.** This is a deliberate
divergence from the derived path. Business-hours clipping exists to stop
*wall-clock inference* from counting a weekend as work; it has no business
overriding an explicit human action. If someone starts a timer at 9pm, that is
attested work, and silently discarding it would be a data-loss bug wearing a
correctness costume.

That leaves forgotten timers. The business-hours spec sets a hard rule against
fabricating implicit defaults ("never a fabricated implicit default (e.g.
'Mon–Fri 9–6' assumed for everyone)"), so an arbitrary 8-hour cutoff is not
available. Instead:

- **Business-hours profile configured** (resolved via the existing
  `resolveBusinessHours(project.business_hours, user.business_hours)`): an open
  segment **whose start is on an earlier calendar day than now**, in the
  user's timezone, is closed at the end of the working day it started on.
  Forgetting to pause on Friday logs Friday, not the weekend.
- **No profile configured**: the segment is **not** truncated. Once elapsed
  passes 12 hours the API marks it `runaway: true` and the UI surfaces a
  warning with one-click pause-and-correct. Loud rather than quietly wrong.

The earlier-calendar-day condition matters and is not incidental. Without it,
a person who starts at 4pm under a 9–6 profile and is still working at 7pm
would have their **live, actively running** timer truncated to 6pm the moment
they loaded the page — auto-close would be destroying real work in progress.
A same-day timer running past business hours is left alone: the person is
evidently still working, and §2's first principle says explicit action wins.
Auto-close exists only to bound timers that were genuinely abandoned, which is
always detectable by the day having rolled over.

Auto-close is performed by a helper called at the top of every timer read and
write — it is a lazy repair, not a scheduled job.

New helpers in a new `backend/utils/timers.js`:

```js
closeStaleSegments(db, { userId, issueId })  // auto-close per §2; scoped by
                                            // user (timer reads/writes) or by
                                            // issue (the Done path, all users)
timerState(db, issueId, userId)  // { running, started_at, elapsed_minutes, runaway, segments }
issueTimerTotals(db, issueId)    // per-user minute totals across all segments
commitTimer(db, issueId, userId) // that user's segments -> one source='timer' work_logs row
```

`closeStaleSegments` takes either scope because the two callers need different
ones: timer reads and writes repair the calling user's abandoned segments
anywhere, while the Done path (§4) must close every user's open segment on one
specific issue. The Done path closes unconditionally — reaching Done is
positive evidence the work stopped, so the earlier-calendar-day guard does not
apply there.

`commitTimer` replaces that user's existing `source='timer'` row rather than
appending, so it is idempotent — the same pattern `applyAutoWorklog` uses for
its auto row. It ends by calling the existing
`recomputeTimeSpent(db, issueId)` from `backend/utils/worklog-sync.js`.

### 3. API

New `backend/routes/timers.js`, mounted at `/api` next to `worklogsRoutes` in
`backend/server.js`. All routes use `requireAuth` and act on `req.userId` —
a user can only start, pause, or commit their own timer.

| Endpoint | Behavior |
|---|---|
| `POST /api/issues/:id/timer/start` | Closes the caller's open segment on any other issue, then opens a new one. Response includes `paused_issue` (key + id) when it displaced another timer, so the UI can say what happened. Starting an already-running timer is a no-op returning current state, not an error. |
| `POST /api/issues/:id/timer/pause` | Sets `ended_at` on the caller's open segment for this issue. No open segment is a no-op returning current state. |
| `POST /api/issues/:id/timer/commit` | Pauses, then rolls all of the caller's segments for this issue into one `source='timer'` work log and sets `issues.auto_worklog_locked = 1`. |
| `GET /api/issues/:id/timer` | `{ running, started_at, elapsed_minutes, runaway, by_user: [{ user_id, name, minutes }] }` |
| `GET /api/me/timer` | The caller's running timer with its issue key and elapsed minutes, or `null`. Lets a timer survive a page refresh and follow the user between web and mobile. |

### 4. Precedence over the derived calculation

At the existing `done`-category branch in `backend/routes/issues.js:487`:

1. `closeStaleSegments(db, { issueId })` — close every open segment on the
   issue, for **all** users. This is auto-stop-on-Done: a person who forgot to
   pause does not keep accruing time on a finished ticket.
2. If the issue has **any** timer segments, call `commitTimer(db, issueId,
   userId)` once for each distinct `user_id` among them — producing one
   `source='timer'` row per person who tracked time — and skip
   `applyAutoWorklog` entirely.
3. Otherwise call `applyAutoWorklog` exactly as today.

Step 2 sets `issues.auto_worklog_locked = 1` through `commitTimer`, which is
the same flag human corrections already use. A reopen → rework → Done cycle
therefore will not overwrite tracked time — that behavior already exists and
is covered by tests in `backend/tests/backend/auto-worklog.test.js`.

The `todo`-category branch at `backend/routes/issues.js:489` already clears
`auto_worklog_locked` on a genuine restart. Timer segments are **not** deleted
when that happens: the time was really worked, and the committed
`source='timer'` work log stays. Only the derived calculation gets a clean
slate.

### 5. Rollup bug fix (required by the new `source` value)

`backend/routes/reports.js:610` and `:646` both bucket time with:

```js
r.source === 'auto' ? 'auto_minutes' : 'manual_minutes'
```

A ternary — so `'timer'` rows would silently land in `manual_minutes`. Both
the JSON endpoint and its CSV twin need an explicit three-way split, adding a
`timer_minutes` key, with `total_minutes` summing all three. This is a
prerequisite for the feature reporting honestly, not an optional extra.

### 6. Web UI

`frontend/src/components/app/issue-detail/issue-fields.tsx`, in the existing
Time section:

- A Start/Pause control with a live elapsed counter that ticks client-side
  from `started_at`. No polling — the server is only contacted on
  start/pause/commit and on issue load.
- A `timer` badge on `source='timer'` work log rows, alongside the existing
  `auto` badge (currently at `issue-fields.tsx:287`).
- **Render `in_progress_minutes_live`**, which the backend already returns and
  no component currently reads. Shown next to the status field while the issue
  sits in an `in_progress`-category status. This closes the gap left by the
  original spec's section 6.
- When a start displaces another issue's timer, an inline note names the
  paused issue.
- When `runaway` is true, a warning with a pause-and-correct action.

`frontend/src/lib/types.ts`: widen `WorkLog.source` to
`'manual' | 'auto' | 'timer'` and add a `TimerState` type.
`frontend/src/lib/api.ts`: a `timers` group beside the existing `worklogs`
group. Timer state loads alongside the other issue-detail fetches in
`use-issue-detail.ts`.

### 7. Mobile UI

`mobile/src/screens/IssueDetailScreen.tsx` gains a Time section below the
assignee picker: the live in-progress value, a Start/Pause control, and the
tracked total. It follows the screen's existing React Query patterns —
`useQuery` for timer state, `useMutation` with `invalidateQueries` for
start/pause.

New `mobile/src/api/timers.ts` (start / pause / commit / fetch), mirroring
`mobile/src/api/issues.ts`. The `Issue` type in `mobile/src/api/issues.ts`
gains `time_spent`, `in_progress_minutes_live`, and `original_estimate`.

### 8. Testing

Backend unit tests (`backend/tests/backend/timers.test.js`):

- Segment summing across pause/resume cycles.
- `closeStaleSegments` closes a segment started on an earlier calendar day at
  that day's business-day end when a profile is configured; leaves the segment
  open and flags `runaway` past 12 hours when no profile is configured.
- `closeStaleSegments` does **not** truncate a same-day segment still running
  past business hours — the regression guard for the live-timer bug in §2.
- The Done path closes open segments unconditionally, including same-day ones.
- Stopwatch time is **not** business-hours clipped — a segment fully outside
  work hours still counts its full duration.
- `commitTimer` is idempotent: committing twice yields one row, not two.
- Starting a timer closes the caller's running segment on another issue.
- A second user's timer on the same issue is independent of the first's.

Route tests: start/pause/commit happy paths, no-op semantics for
double-start and pause-with-nothing-running, and that a user cannot
start/pause another user's timer.

Integration tests (extending
`backend/tests/backend/auto-worklog.test.js`):

- Done with timer segments present → per-user `source='timer'` rows, no
  `source='auto'` row.
- Done with no timer segments → `applyAutoWorklog` runs unchanged (regression
  guard on existing behavior).
- Done closes an open segment rather than leaving it running.
- Moving back to `todo` clears `auto_worklog_locked` but preserves committed
  timer work logs.

Report test: the three-way `auto` / `manual` / `timer` rollup split, asserting
a timer row does not land in `manual_minutes`.

Frontend: one RN Testing Library test for the mobile Time section
(`mobile/src/__tests__/IssueDetailScreen.test.tsx` already exists), and web
coverage of the live counter and the timer badge.

## Open questions carried into implementation

- The 12-hour runaway threshold is a UI warning trigger only — it never
  changes stored data, so it is safe to tune later without a migration.
- `GET /api/me/timer` is specified because it is required for a timer to
  survive a refresh, but no cross-device push/sync is included: a timer
  started on web and viewed on mobile is correct on load, not live-updated.
- If per-segment issue reattribution (moving tracked time between tickets)
  turns out to be wanted, the append-only segment table supports it without a
  schema change — but it is not designed here.
