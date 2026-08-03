# Auto time tracking, revised: business-hours-aware, editable

## Relationship to the base spec

This revises `docs/superpowers/specs/2026-07-29-auto-time-tracking-design.md`
before it's built. Everything in the base spec still applies — the trigger
point (status transition into a `done`-category status, in
`backend/routes/issues.js` next to the existing `sla.onStatusChange` /
`runAutomation('status_changed', ...)` call), the segment source
(`activity_log` replayed via `backend/utils/flow.js`'s `statusTimeline`, same
data `loadFlowData`/`reports.js` already uses), the `work_logs.source` column,
and the non-goals (no clock/timer table, no cron — everything derived on
read/write). This document only changes **how segment duration is measured**
and **how a resulting auto entry can be corrected**. Sections 3–6 of the base
spec (live value, rollup endpoint, CSV export, ticket display) carry over
unchanged except that every duration computation now goes through the
business-hours helper described below instead of raw subtraction.

## Problem with the base spec

The base spec sums raw wall-clock time across every segment whose status
category is `in_progress`. Atlas's own seeded users span three timezones
(Asia/Dubai, America/Los_Angeles, Asia/Kolkata, per `database.js`'s demo
seed), and teams working the same board can be in Australia, the US, and
India. Raw wall-clock time in-progress overcounts badly: an issue picked up
Friday afternoon and completed Monday morning logs ~64 hours, none of which
is real effort. That number is unusable in a report handed to a client.

## Goal

Make the auto-logged duration reflect actual working time, using each
project's (and optionally each assignee's) configured business hours and
timezone, while keeping the base spec's guarantee: no new clock/timer
infrastructure, everything computed from `activity_log` on read/write. Also
let a human correct an auto-logged entry that's still wrong (business-hours
math is an approximation, not ground truth), without that correction being
silently overwritten the next time the issue completes.

## Non-goals

- No org-wide default business-hours setting. Until a project or user has one
  configured, that project/user's issues keep the base spec's raw wall-clock
  behavior — never a fabricated implicit default (e.g. "Mon–Fri 9–6" assumed
  for everyone). This also means auto-logging works correctly from day one
  on an unconfigured system; it only gets more precise as admins configure
  it.
- No per-segment assignee history. Attribution stays exactly as the base
  spec defined it — whoever is the issue's assignee *at completion time*
  gets all the segments' time, now just clipped to their resolved business
  hours rather than left raw. If an issue is reassigned mid-flight between
  timezones, the final assignee's profile is used for the whole span. This
  is a known simplification, not a bug: tracking per-segment assignee history
  would require joining `activity_log` field='assignee_id' rows against the
  field='status' rows and interleaving them, which is meaningfully more
  plumbing for a case (mid-flight cross-timezone handoff) that's likely rare.
  If it turns out to matter in practice, the segment data needed to build it
  is already fully present in `activity_log` — nothing here forecloses it.
- No holiday calendars. Business-hours profiles are a weekly recurring
  pattern (which weekdays, which hour range, which timezone) only.

## Design

### 1. Schema changes

```sql
ALTER TABLE projects ADD COLUMN business_hours TEXT;   -- JSON, nullable
ALTER TABLE users ADD COLUMN business_hours TEXT;       -- JSON, nullable
ALTER TABLE work_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK(source IN ('manual', 'auto'));                  -- from base spec
ALTER TABLE work_logs ADD COLUMN locked_from_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE issues ADD COLUMN auto_worklog_locked INTEGER NOT NULL DEFAULT 0;
```

All additive, all nullable/defaulted — no backfill required, matches the
project's existing migration conventions (`backend/migrations.js`).

`business_hours` JSON shape (same shape for `projects` and `users`):

```json
{ "timezone": "Asia/Kolkata", "work_days": [1,2,3,4,5], "start_hour": 9, "end_hour": 18 }
```

`work_days` uses ISO weekday numbers (1=Monday..7=Sunday) so a Gulf-region
project can configure `[7,1,2,3,4]` (Sun–Thu) without any code change.
`start_hour`/`end_hour` are local-time hour-of-day integers (0–24).

No admin UI is specified in detail here beyond: a settings field on the
project edit form, and a settings field on the user profile form, each
serializing to this JSON. Both are simple form additions to existing screens
(project settings already has a form-backed `wip_limits` JSON field
following the same pattern — `004_projects_wip_limits` in
`backend/migrations.js` — this follows the same convention).

### 2. Business-hours helper

New pure function, colocated with the other segment-math helpers in
`backend/utils/flow.js`:

```js
/**
 * Minutes of overlap between [start, end) and a business-hours profile.
 * profile: { timezone, work_days: number[], start_hour, end_hour } | null.
 * null profile => raw wall-clock minutes (base-spec behavior).
 */
function businessMinutesBetween(start, end, profile) { ... }
```

Implementation walks calendar days (in `profile.timezone`) from `start` to
`end`; for each day whose ISO weekday is in `work_days`, intersects
`[start_hour, end_hour)` (converted to that day's UTC range in the given
timezone) with `[start, end)` and accumulates the overlap in minutes. Days
not in `work_days`, or the portion of `[start,end)` outside `start_hour`–
`end_hour`, contribute 0. When `profile` is `null`, returns raw
`hoursBetween(start, end) * 60` unchanged — this is the fallback path, not a
special case, so "unconfigured" and "raw wall-clock" are the literal same
code path as today.

Unit-testable in isolation (no DB), same as `flow.js`'s existing functions —
pass in synthetic segment boundaries and profiles, assert minutes.

### 3. Profile resolution

New helper, `resolveBusinessHours(issue, project, assignee)`:

1. If `assignee.business_hours` is set, use it.
2. Else if `project.business_hours` is set, use it.
3. Else `null` (raw wall-clock fallback in step 2's helper).

Resolved once per completion event (or once per live-value read), passed
into `businessMinutesBetween` for every segment in that issue — profile
doesn't vary segment-to-segment, per the attribution non-goal above.

### 4. Auto-log on completion (revises base spec step 2)

Same trigger and same segment-gathering as the base spec. Difference: each
`in_progress`-category segment's duration is computed via
`businessMinutesBetween(segment.from, segment.to, resolvedProfile)` instead
of raw subtraction, before summing and rounding to whole minutes.

Before regenerating the auto row (base spec's "delete existing auto row,
insert fresh one"), check `issues.auto_worklog_locked`:

- If `0` (default): proceed as base spec — delete any existing
  `source='auto'` row for this issue, insert a fresh one with the computed
  total.
- If `1`: skip regeneration entirely. The human-corrected value (now
  `source='manual'`, `locked_from_auto=1`, per step 5 below) stands as-is.

### 5. Editable/correctable auto entries

A user with permission to edit a work log (author, or the issue's assignee,
or admin — same rule as manual entries in `worklogs.js`) can edit or delete a
`source='auto'` row through the existing worklog UI/API
(`PATCH`/`DELETE /api/worklogs/:id`, extending the existing endpoints — no
new routes). On such an edit:

- The row's `source` flips to `'manual'` and `locked_from_auto` is set to
  `1` (so it's indistinguishable from a manual entry going forward except
  for this provenance flag, which only the lock-check in step 4 reads).
- The issue's `auto_worklog_locked` is set to `1`.

On delete of an auto row: same effect on `issues.auto_worklog_locked` (set
to `1`), but no replacement row is created — "delete" is read as "I don't
want this counted," not "recompute it."

`issues.auto_worklog_locked` clears back to `0` automatically when the issue
transitions into a `todo`/backlog-category status (a genuine restart, not a
same-cycle reopen). A reopen that goes straight from `done` back to
`in_progress` (rework without an intermediate backlog stop) leaves the lock
in place — the human correction survives simple reopens, and only a full
restart gets a clean slate. This is a small addition to the existing
status-transition handling in `issues.js`: wherever the new status's
category is checked for the `done` case, also check for the `todo` case and
clear the flag.

### 6. Everything else (unchanged from base spec)

- **Live in-progress value** (`GET /api/issues/:id` / `:issueKey`,
  `in_progress_minutes_live`): same as base spec section 3, computed via
  `businessMinutesBetween` against `resolveBusinessHours`, with the final
  open segment measured to `now`.
- **Sprint/user rollup endpoint**
  (`GET /api/projects/:projectId/reports/time-tracking`): unchanged shape.
- **CSV exports**: unchanged.
- **Ticket display, web + mobile**: unchanged, plus the web worklog list
  should allow editing/deleting an `auto`-tagged row through whatever control
  already exists for manual rows (no new UI component — same list, same
  actions, gated by the same permission check already in `worklogs.js`).

### 7. Testing

Everything from the base spec's testing section, plus:

- `businessMinutesBetween` unit tests: same-day partial overlap, multi-day
  span crossing a weekend (Sun–Thu profile vs. Mon–Fri profile), `null`
  profile falls back to raw wall-clock, segment entirely outside work hours
  (zero minutes), timezone conversion correctness (a segment that starts
  "9am" in one timezone but is on the other side of midnight UTC).
- `resolveBusinessHours` precedence: user override wins over project
  default; project default used when no user override; `null` when neither
  set.
- Completion-time lock behavior: editing an auto row sets the lock and a
  subsequent completion (reopen → redo → done again) does not overwrite it;
  deleting an auto row behaves the same way; transitioning to a
  `todo`-category status clears the lock; a same-cycle reopen (done →
  in_progress, no backlog stop) does not clear it.

## Open questions / assumptions carried into implementation

- No admin UI wireframe is specified here — this spec covers data model and
  computation only; the settings-form additions on project/user screens
  follow existing patterns (`wip_limits` on projects) and can be scoped in
  the implementation plan.
- Business-hours profiles are weekly-recurring only (no holiday calendar).
  If holidays turn out to matter, `business_hours` JSON can gain a
  `holidays: string[]` field later without a schema change (it's already a
  JSON blob).
