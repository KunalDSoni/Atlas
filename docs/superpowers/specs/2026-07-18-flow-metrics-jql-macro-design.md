# Flow Metrics & JQL Table Macro — Design

**Date:** 2026-07-18
**Wave:** roadmap epics 33–34 — flow metrics, JQL table macro
**Status:** Approved (design approved in-session; spec pre-approved by user)

> Numbering note: `ATLAS-NN` here is the roadmap **epic ordinal** (see the
> wiki-issue-integration spec for why seeded issue keys differ).

Wave B (epics 35–36: dashboard gadgets, page approvals) is deliberately out of
scope and gets its own spec after this ships.

## Problem

**Flow metrics.** Atlas has 8 reports but none of the flow metrics engineering
managers actually run: cycle time, time-in-status, cumulative flow. The raw
material exists — `activity_log` stores `field='status', old_value, new_value,
created_at` on every issue update — but with one hole that would corrupt every
chart:

`PUT /api/issues/:id/move`, the endpoint board drag-and-drop uses, **writes
nothing to activity_log**. The most common way a status changes is invisible to
history. This is also a standing user-facing bug: the Activity tab on an issue
shows nothing for board moves.

**JQL macro.** The wiki wave gave pages live issue chips, but there is no way to
embed a *set* of issues — "all open bugs in this component" — as a live table.
JQL-lite (`backend/utils/jql.js`) and the search endpoint already evaluate
exactly such queries with a 50-row cap and structured parse errors; nothing
renders them inside a page.

## Epic 33: Flow metrics

### 33.1 The prerequisite fix — move logging

The move handler gets the same `activity_log` writes the general `PUT` handler
already does, in the same format (`action='update'`), for the two fields it can
change:

- `field='status'` with old/new when status actually changes
- `field='sprint'` with old/new sprint names when sprint actually changes

No row when the value did not change (a pure reorder logs nothing).

### 33.2 Data honesty rule

Rows predating this fix are missing transitions. All metrics:

- Treat `issues.created_at` as entry into the issue's **first observed** state:
  the `old_value` of its earliest status transition, or its current status if it
  has none.
- Compute only from recorded transitions; never fabricate backfill.
- The UI labels these panels "since tracking began" so sparse early charts read
  as honest, not broken.

### 33.3 Status → category mapping

A shared helper (new `backend/utils/flow.js`) maps a status key to
`todo | in_progress | done` using `project_statuses` rows for the project,
falling back to the built-in keys (`todo`→todo, `in_progress`/`in_review`→
in_progress, `done`→done, unknown→todo). This mirrors the DONE-category logic
the epics rollup already applies, in one importable place.

### 33.4 Endpoints

Three new routes in `backend/routes/reports.js`, following its existing style
(auth-gated, project-scoped, plain JSON):

**`GET /projects/:id/reports/cycle-time`**
Per issue whose current status maps to `done` and that has at least one
recorded transition into a done-category status:
- `lead_time_h`: created_at → first done-entry
- `cycle_time_h`: first in_progress-entry → first done-entry (null when the
  issue was never observed in progress; excluded from cycle aggregates)
Response: `{ issues: [{ id, issue_key, title, type, completed_at, lead_time_h,
cycle_time_h }], avg_cycle_h, p50_cycle_h, p85_cycle_h, avg_lead_h, count }`.
Percentiles by nearest-rank on the sorted cycle times; all-null cycle times ⇒
aggregates are `null`, `count` still reported.

**`GET /projects/:id/reports/time-in-status`**
Replays each issue's transition log (created_at → t1 → t2 → … → now or
done-entry) and sums hours per status key. Response:
`{ statuses: [{ status, avg_h, total_h, issues }] }` ordered by workflow
position where known.

**`GET /projects/:id/reports/cumulative-flow?days=30`**
For each day in the window (default 30, max 90): count of issues per category
existing on that day, reconstructed by replaying transitions forward from
created_at. Response: `{ days: [{ date, todo, in_progress, done }] }`.

All three: fixed query count (one issues read + one activity_log read per
request, computed in JS), matching the ATLAS-30 batching discipline. No new
tables, no caching.

### 33.5 Frontend

Three panels appended to the existing Reports screen (`reports.tsx`), using the
existing `charts.tsx` primitives:
- Cycle time: stat tiles (avg / P50 / P85) + `DataTable` of recent completions
- Time-in-status: `HBarChart` of average hours per status
- Cumulative flow: `StackedBar` (or `LineChart` if stacked reads poorly with
  sparse data) over the window, one series per category

API methods added to `api.reports` in `lib/api.ts` following its pattern.

## Epic 34: JQL table macro

### 34.1 Syntax and rendering

`[jql: <query>]` alone in a paragraph (case-insensitive prefix, mirroring
`[toc]` detection) renders as a live issue table. Applied in `applyMacros`
AFTER sanitizing, built from `textContent` — the sanitizer and `PURIFY_CONFIG`
are untouched, preserving the chip wave's safety property.

Because results must be fetched, the macro renders a placeholder `<div
data-jql="...">` synchronously; a small effect in `RichTextView` finds these
after render and swaps in the fetched table (loading skeleton meanwhile).

### 34.2 Evaluation

Client calls the existing `GET /api/search?q=<query>` — no new backend
endpoint. That endpoint already: parses JQL-lite, caps at 50 rows, returns
`{ issues: [{ id, issue_key, title, type, status, priority, project_key, … }],
jql: true }`, and returns `400 { error, jql: true }` on parse errors. Always
live, never snapshotted into the stored page.

### 34.3 Table

Columns: key (chip-styled, navigates by id exactly like issue chips — the
issue type rides along as a `data-issue-type` attribute so epics route to
/epics), title, status (text), assignee. The table is DOM-built inside the
macro pipeline, so React components (TypeIcon, StatusPill) are out of reach
without extra machinery this feature doesn't justify. The search payload has no assignee today,
so the JQL branch of the search SELECT gains
`u.name AS assignee_name` via a LEFT JOIN — one column in one existing query.
Footer shows "Showing 50 — refine your query" when the row cap is hit
(`issues.length === 50`).

### 34.4 Errors

A parse error renders an inline error box quoting the server's message
("Unknown field 'assignee2'"), styled like the existing callout pattern. Never
silent, never a crash. A network failure renders "Couldn't load results" with
the query preserved as text.

### 34.5 Extractor rule

`extractIssueKeys` (backend) learns to strip `[jql: …]` spans before matching,
so a query like `[jql: project = ATLAS]` never creates page↔issue link rows
from its literal text. Client-side chip walking already skips the rendered
table (it replaces the paragraph node).

## Testing

- **Move logging:** move status → activity row with old/new; move sprint →
  sprint row; pure reorder → no rows; general PUT behaviour unchanged.
- **Metrics:** fixture project with hand-written transitions at known
  timestamps → exact expected averages/percentiles; project with zero history →
  zeros/nulls, never NaN; flat-query-count guard on each endpoint.
- **JQL macro:** unit tests for `[jql:]` block detection and extractor
  stripping; component behaviour exercised through the E2E: a created page with
  a `[jql:]` block shows a table with a known seeded issue, and a bad query
  shows the error box.
- **E2E:** extends `wiki-issue-links.spec.ts` patterns (fixture created via
  API, cleaned up after).

## Rejected alternatives

- **Snapshot tables into stored HTML** — same reason as chip enrichment: stale
  data presented as live.
- **New dedicated JQL endpoint** — the search endpoint already does the exact
  evaluation with the exact cap and error shape; duplicating it invites drift.
- **A transitions side-table** (materialized status history) — activity_log
  already is that table; adding a second copy creates a consistency problem for
  zero read benefit at this scale.
- **Backfilling synthetic transitions for old issues** — fabricated data in a
  metrics feature poisons trust in every chart drawn from it.
