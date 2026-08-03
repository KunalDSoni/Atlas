# Auto time tracking (In Progress → Done)

## Problem

Time spent on a task is currently logged manually: a user opens an issue and
types how many minutes they worked (`POST /api/issues/:id/worklogs`, backed by
the `work_logs` table and `issues.time_spent`). This is error-prone and often
skipped, which makes per-task / per-sprint / per-user time reports unreliable
for sharing with clients.

Separately, every status change on an issue is already recorded automatically
in `activity_log` (field='status', with a timestamp), and
`backend/utils/flow.js` already replays those rows into contiguous
in-status segments — this is what powers the existing `cycle-time` and
`time-in-status` project reports. That mechanism already captures "when did
this move to In Progress" and "when did this move to Done"; nothing currently
turns it into a work log entry.

## Goal

Automatically derive time spent per issue from status-change timestamps
instead of requiring manual entry, while leaving manual entry available for
cases where it's still wanted (e.g. logging effort on a Won't Fix or backlog
item that never went through the board). Surface the auto-tracked time on the
ticket (web + mobile) and let admins extract it per sprint and per user.

## Non-goals

- No new "clock" table and no background timers/cron. Atlas has no scheduler
  (see `backend/utils/sla.js` header comment: "not a timer that fires... a row
  of timestamps"), and this feature follows the same philosophy — everything
  is derived from `activity_log` on read/write, never polled.
- Not replacing manual work logs — `source='manual'` rows keep working exactly
  as today.
- Not building a client-facing public/unauthenticated portal for this data in
  this iteration — admins extract via the existing CSV export mechanism.

## Design

### 1. Schema change

```sql
ALTER TABLE work_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK(source IN ('manual', 'auto'));
```

Additive, backward compatible. Existing rows default to `'manual'`.

### 2. Auto-log on completion

In `backend/routes/issues.js`, in the existing status-update block where
`sla.onStatusChange` and `runAutomation('status_changed', ...)` already fire
(~line 437), add: when the new status's category (via
`projectStatuses`/`categoryOf`) is `done`:

1. Load the issue's ordered `activity_log` status transitions (same query
   `loadFlowData` in `reports.js` already runs, factored into a shared
   helper).
2. Run them through `flow.js`'s `statusTimeline`, sum every segment whose
   `categoryOf(segment.status)` is `in_progress` (covers custom workflows with
   multiple in-progress-category statuses, e.g. "In Progress" + "In Review" —
   consistent with how the existing time-in-status report defines "in
   progress").
3. Round to whole minutes. If the total is 0, do nothing.
4. Delete any existing `work_logs` row for this issue with `source='auto'`
   (handles reopen → rework → complete-again without double counting — the
   auto entry always reflects the full cumulative in-progress time, not an
   incremental delta).
5. Insert a fresh `work_logs` row: `minutes` = the computed total,
   `user_id` = `issue.assignee_id`, falling back to the actor performing this
   status change (`req.userId`) if the issue is unassigned, `comment =
   'Auto-logged: time in progress'`, `source = 'auto'`.
6. Recompute `issues.time_spent` as the sum of all its `work_logs.minutes`
   (manual + auto) rather than incrementing, since the auto row itself may
   change size across step 4/5. Extract this into a shared
   `recomputeTimeSpent(db, issueId)` helper used by both `worklogs.js` (manual
   add/delete) and this new path, replacing the current increment/decrement
   arithmetic in `worklogs.js`.

If an issue leaves a `done`-category status later (reopened), no action is
taken at that moment — the stale auto row simply remains until the issue
reaches `done` again, at which point step 4 clears and step 5 replaces it.

### 3. Live in-progress value (no storage)

`GET /api/issues/:id` (and `:issueKey`) gains an extra field, computed only
when the issue's current status category is `in_progress`:

```
in_progress_minutes_live: <int>
```

Computed the same way as step 2.2, but with the final open segment measured
against `now` instead of a close timestamp — identical to how the existing
`time-in-status` report treats open segments. `null`/absent when the issue is
not currently in an in_progress-category status.

### 4. Sprint / user rollup endpoint

New `GET /api/projects/:projectId/reports/time-tracking` in `reports.js`:

```json
{
  "by_sprint": [{ "sprint_id", "sprint_name", "auto_minutes", "manual_minutes", "total_minutes" }],
  "by_user":   [{ "user_id", "name", "auto_minutes", "manual_minutes", "total_minutes" }]
}
```

Built from one query joining `work_logs` → `issues` (for `sprint_id`,
`assignee_id`) → `sprints` / `users`, grouped both ways, splitting on
`source`.

### 5. CSV export

Extend the existing `GET /projects/:id/reports/export/csv` issue export with
`time_spent_minutes` (already on `issues`, just not exported today). Add a
second export endpoint, `GET /projects/:id/reports/time-tracking/export/csv`,
for the by-sprint/by-user rollup from #4, so admins can hand a client a sprint
or per-person time breakdown directly.

### 6. Ticket display

- **Web**: the existing worklog list UI (renders `work_logs` rows) gains a
  visual tag distinguishing `auto` vs `manual` entries, and shows the live
  value from #3 next to the status field while an issue is in progress.
- **Mobile** (`mobile/src/screens/IssueDetailScreen.tsx`): currently has no
  time-tracking UI. Add a small read-only section below the status/assignee
  pickers: while in progress, show "In progress: Xh Ym" (live); once Done,
  show the logged total. Extend the `Issue` type / `fetchIssue` response in
  `mobile/src/api/issues.ts` to include `time_spent` and
  `in_progress_minutes_live`. No new mobile API module needed.

### 7. Testing

- Backend unit tests (alongside `backend/tests/backend/move-activity.test.js`
  and the `flow.js` tests): multi-visit in-progress segments summed
  correctly, reopen-then-redo replaces rather than duplicates the auto row,
  unassigned-issue fallback to actor, manual logs untouched by auto logic,
  `time_spent` recomputation matches sum of rows.
- One RN Testing Library test for the new `IssueDetailScreen` section
  (in-progress live badge, completed total, hidden when never entered
  in-progress).

## Open questions / assumptions carried into implementation

- "Admin can extract" is satisfied via CSV export, not a new UI page; if a
  dedicated on-screen sprint/user time report page turns out to be wanted, the
  `/reports/time-tracking` JSON endpoint from #4 already supports building
  one later without further backend changes.
