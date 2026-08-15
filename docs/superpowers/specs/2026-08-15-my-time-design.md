# My time

**Status:** approved, ready to implement
**Date:** 2026-08-15
**Related:** `2026-08-15-abandoned-timer-credits-zero-design.md`,
`2026-08-15-business-hours-configuration-design.md`,
`2026-08-15-recovering-unresolved-time-design.md`

**Spec 3 of 3.** Specs 1 and 2 made the numbers trustworthy. This one presents
them.

## Problem

Every time report in Atlas is scoped to one project:
`GET /projects/:projectId/reports/time-tracking` and its CSV twin.

The question a person actually needs to answer is not "how much time went into
this project" but **"what did I work on this week?"** — across every project
they touch. Today that requires opening each project's report in turn and
adding up the rows that happen to carry their name. Nothing in Atlas answers it
directly.

## Scope assumption

Designed for **estimates and reporting**, not billing. No approval workflow, no
audit trail on time edits, no rounding rules. This was flagged twice and not
contradicted; if the data ever feeds payroll or client invoices, the bar rises
and this design should be revisited before it is relied on.

## Design

### 1. One endpoint

`GET /api/me/time?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns the caller's work logs across every project they can see, in the
half-open range `[from, to)`. Both parameters are required — a defaulted range
is a silent decision about what "this week" means, and the client already knows
which week it is showing.

```
{
  "from": "2026-08-10", "to": "2026-08-17",
  "total_minutes": 1860,
  "by_day":   [{ "date": "2026-08-10", "minutes": 420 }, ...],
  "entries":  [{ id, issue_id, issue_key, title, project_key,
                 minutes, source, comment, created_at }, ...]
}
```

`by_day` covers **every** date in the range, zeros included. A caller that has
to reconstruct missing days to draw a week is a caller that will get it wrong;
the server knows the range and can say so completely.

Entries carry `source` (`manual` | `auto` | `timer`) so a person can tell what
they measured from what Atlas inferred. That distinction is the whole point of
the preceding two specs and must survive into the view.

**Scoped to `req.userId` with no override.** There is no `user_id` parameter:
this endpoint answers "what did *I* do". A manager's view of someone else's
time is a different feature with different permissions, and adding a parameter
here would be the whole of its access control.

### 2. Day bucketing

Work logs carry `created_at` (UTC) and nothing else — there is no "worked on"
date distinct from when the entry was written. Days are therefore bucketed by
`created_at` **in the user's resolved timezone**, using `users.timezone`, which
already exists and is already editable in the profile form.

This is worth stating because it is a real limitation rather than an oversight:
a session logged at 1am is attributed to the day it was *recorded*, which for
late-night work is the following day. Introducing a separate worked-on date
would mean a schema change and a new field in every logging path, and it is not
justified by a reporting view. The bucketing rule is documented in the UI
through the timezone the totals are labelled with.

### 3. The screen

`/my-time`, in the sidebar under the personal section, showing one week at a
time:

- a week picker with previous/next and a "This week" reset;
- seven day columns with per-day totals, the current day marked;
- under each day, its entries: issue key, title, duration, and a `timer` /
  `auto` badge matching the rail's existing badges;
- a week total.

Issue keys link through `issueUrl()`, so the view is a way back into the work
as well as a summary of it.

**Empty weeks say so plainly** rather than rendering seven empty columns — and
where the week is empty *and* the person has unresolved timers, it points at
them, because that is very likely where the missing time went.

### 4. What this reuses

Nothing new is computed. `work_logs` is already the single source the rail, the
project report, and `issues.time_spent` all read; this adds a per-user,
cross-project, date-bucketed view of the same rows. The three-way
`manual`/`auto`/`timer` split matches `reports.js`, deliberately — two different
answers to "how much timer time did I log" would be worse than none.

## Non-goals

- **No CSV export.** The project report already has one, and no one has asked
  for this view in a file.
- **No editing from this screen.** Entries link to their issue, where the
  existing edit and delete paths already live with their `settleSegments`
  handling. A second write path to the same rows is a second place for that to
  go wrong.
- **No month or quarter views.** A week is the unit people are asked about.
- **No team or manager view.** Different feature, different permissions.

## Error handling

A missing or malformed `from`/`to` returns 400 naming the parameter. A range
longer than 31 days returns 400 rather than streaming an unbounded result. The
screen surfaces a load failure with a retry, following the existing
`ErrorState` pattern.

## Testing

Backend:

- entries and totals cover only the caller, never another user's logs;
- the range is half-open — a log at exactly `to` is excluded, one at `from` is
  included;
- `by_day` includes zero-minute days across the whole range;
- logs from several projects appear together, each with its `project_key`;
- `source` survives onto each entry;
- a missing, malformed, or over-long range 400s.

Frontend: renders a week's totals, moves between weeks, shows the empty state,
and links an entry to its issue.
