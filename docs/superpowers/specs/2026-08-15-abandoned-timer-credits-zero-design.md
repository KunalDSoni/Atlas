# Abandoned timers credit zero

**Status:** approved, ready to implement
**Date:** 2026-08-15
**Related:** `2026-08-08-issue-stopwatch-timer-design.md`,
`2026-08-10-running-timer-indicator-design.md`, `KNOWN-ISSUES.md`

## Problem

A timer left running is closed by `closeStaleSegments` and credited **exactly 12
hours**, which is then committed to `work_logs` and `issues.time_spent`
(`backend/utils/timers.js:205`). The number is invented. Measured on a fresh
database, a person who worked half an hour and forgot to pause is recorded as
having worked twelve:

```
=== USER ACTUALLY WORKED 30 MIN ===
Atlas logged  : 720 min = 12.0 hours
overstatement : 24x
```

Three properties make this worse than the open segment it replaced.

**It fires on a read.** `closeStaleSegments` runs at the top of `timerState` and
of `GET /api/me/timer`. The header chip polls the latter every 60 seconds, so
the fabricated figure is written by the application merely being open, with
nobody touching the timer.

**Configuring business hours does not prevent it.** That is the mitigation
`KNOWN-ISSUES.md` recommends. `workdayEndFor` returns `null` for a non-work day
and for a start after that day's close (`backend/utils/timers.js:92`), so
evening and weekend starts fall through to the 12-hour cap with a profile fully
configured:

```
=== PROFILE CONFIGURED, SATURDAY START ===
started_at    : 2026-08-08 15:00:00 (Saturday)
auto_stopped  : abandoned
time_spent    : 720 min = 12.0 hours
```

**It reaches reporting.** `commitTimer` writes the row and calls
`recomputeTimeSpent`, so the figure flows into the time-tracking report and its
CSV export.

The cap was a deliberate decision, argued in `backend/utils/timers.js:126` as
"a smaller and, unlike the open segment, a *visible* error". That reasoning
weighs two bad options against each other and picks the wrong one for a
timesheet: an unbounded open segment is wrong in a way that looks wrong, while
a confident 12-hour entry is wrong in a way that looks right. Once a person
finds hours they did not work in their own timesheet, they stop trusting every
number the feature produces — which is why a mechanically functional stopwatch
gets reported as "the timer doesn't work".

## Principle

The server may **bound** a timer using evidence. It may never **invent** a
duration.

A configured workday end is evidence: the organisation has stated when work
stops. "Twelve hours" is not evidence about anything. Where no defensible
boundary exists, the truthful record is that the duration is unknown, and the
only party who can resolve it is the person who ran the timer.

This is the rule the original stopwatch spec already claimed — "explicit action
wins", and never "a fabricated implicit default" — applied to the one path that
did not honour it.

## Design

### 1. An abandoned segment credits nothing

`segmentMinutes` returns `0` for a segment whose `auto_stopped` is
`'abandoned'`, whatever its span.

`ended_at` keeps recording **when the segment was found**, not a synthesised
end. That matters for two existing behaviours: `recentAutoStop` drops stops
older than a day, and the rail's notice renders `timeAgo(stopped_at)`. Writing
a back-dated `ended_at` to force a zero credit would silence the explanation
precisely when it is most needed.

Deriving the zero from `auto_stopped` rather than from a new column means
**historical rows heal themselves**: segments already marked `'abandoned'` stop
contributing fabricated minutes the next time their issue is recomputed. No
migration is required, and `031_timer_segments_settled` remains the last one.

Segments a human has settled (`settled_at`) are excluded from every total
already, so a correction someone has made by hand is unaffected.

### 2. The workday-end path is unchanged

A segment started on an earlier calendar day, on a work day, under a configured
profile is still closed at that day's business-day end and still credits the
time up to it. That boundary is evidence, it is bounded, and it is already
explained to the user. Only the invented fallback changes.

### 3. Asking the user

`recentAutoStop` already reports the reason and the time. For `'abandoned'` it
gains `started_at`, so the rail can name the session it could not measure.

The rail notice (`issue-fields.tsx:273`) currently reads, for this reason,
"left running for more than a day, so it was capped at 12 hours". It becomes a
statement that nothing was logged, plus the action that fixes it — a **Log the
time you worked** button opening the existing Log work dialog. No new dialog,
no new endpoint: the correction path is the one already there.

Time that is genuinely lost when a person ignores the prompt is the accepted
cost. Zero is recoverable by the one person who knows the answer; twelve hours
is not recoverable at all, because nobody knows it is wrong.

### 4. Reporting the existing damage

`findTimerOvercounts` stays **dry-run by default** and is extended, because it
currently cannot see most of the damage: it flags only segments whose raw span
exceeds `ABANDONED_AFTER_MINUTES` (1440), while a row already capped by the
current rule is exactly 720 and slips underneath the threshold.

The report gains, per affected issue and user: the issue key, the person, the
start, the raw span, and the minutes currently credited — computed from the raw
span, not from the new zero-crediting `segmentMinutes`, which would otherwise
report the damage as nil.

Two classes are reported:

- any unsettled segment marked `auto_stopped = 'abandoned'` — credited a
  fabricated figure under the old rule, regardless of size;
- any unsettled closed segment whose raw span exceeds
  `ABANDONED_AFTER_MINUTES` — the pre-cap multi-day commits.

Whether to write is a separate decision, taken once the blast radius on
production is known. `--apply` therefore recomputes affected issues under the
new rule rather than re-capping to 720, so running it can only remove
fabricated time, never mint more.

## Non-goals

- **No change to the runaway warning.** `RUNAWAY_MINUTES` still drives the
  12-hour UI warning; it never writes data.
- **No scheduler.** Repair stays lazy, on read and write.
- **No business-hours settings UI.** Still absent, and the fix no longer
  depends on it — that is the point.
- **No retroactive write to production.** Report first.

## Testing

Extending `backend/tests/backend/timers.test.js`:

- an abandoned segment credits 0 minutes and writes **no** work log;
- a profile-configured **Saturday** start credits 0 — the regression guard for
  the case where the documented mitigation failed;
- a profile-configured start **after close** credits 0;
- the workday-end path still credits to close of business (guard on §2);
- a real tracked segment on the same issue still commits its own minutes
  alongside an abandoned one;
- a settled abandoned segment is untouched;
- `findTimerOvercounts` reports a row capped to exactly 720, which the current
  threshold misses.

Frontend: the rail renders the "nothing was logged" notice and its Log work
action for `reason: 'abandoned'`.
