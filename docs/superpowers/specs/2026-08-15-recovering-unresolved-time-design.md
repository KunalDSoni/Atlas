# Recovering unresolved time

**Status:** approved, ready to implement
**Date:** 2026-08-15
**Related:** `2026-08-15-abandoned-timer-credits-zero-design.md`,
`2026-08-15-business-hours-configuration-design.md`

**Spec 2 of 3.** Spec 1 configured business hours so fewer timers end up
unbounded. This one deals with the ones that still do.

## Problem

An abandoned timer now credits nothing, which is truthful, and the issue rail
offers **Log the time you worked** so the person can supply the figure the
server refused to invent.

That prompt is reachable from exactly one place: the issue it happened on.
`recentAutoStop` is served only by `GET /api/issues/:id/timer`, so someone who
forgets a timer and does not return to that specific issue never learns there
is anything to resolve. The time is not merely uncredited — it is invisible.

Forgetting the timer and forgetting the issue are the same act of attention.
Expecting the second to repair the first is not a plan.

A second, smaller gap: `timerState` and `issueTimerTotals` both compute per-user
totals, and nothing renders them. On an issue two people tracked, neither can
see the split.

## Design

### 1. What "unresolved" means

An abandoned segment (`auto_stopped = 'abandoned'`, `settled_at IS NULL`) is a
question the server asked and nobody answered: *how long was this session?* It
stays unresolved until the person answers it, in one of two ways.

- **They log work on the issue.** The natural signal, and it needs no new
  gesture: `POST /issues/:id/worklogs` settles that user's abandoned segments on
  that issue. Someone who returns to the issue and logs their afternoon has
  answered the question, and the prompt should not survive the answer.
- **They dismiss it.** `POST /api/timer-segments/:id/resolve` settles it with
  nothing logged — the "I did not really work on that" answer, which is a
  legitimate outcome and must not require logging a lie to clear.

`settled_at` already carries exactly this meaning — a human has taken ownership
of the time — so both paths reuse `settleSegments` rather than adding a state.

### 2. Surfacing them

`GET /api/me/timer/unresolved` returns the caller's unresolved abandoned
segments, newest first: segment id, issue id and key, title, `started_at`, and
when it was stopped.

**Bounded to the last 30 days.** An unresolved list that grows without limit
becomes a second thing to ignore, and time nobody has accounted for within a
month is not going to be remembered accurately anyway. The segments are not
deleted; they simply stop being presented as actionable.

In the header, beside `RunningTimerChip`: a chip rendered only when the count is
non-zero, opening a popover that lists each one — issue key, when it started,
how long it ran before being stopped — with a link to the issue and a
**Dismiss** action.

The two chips are separate components. A running timer and an unresolved one are
different states with different urgency, and one component switching between
them would be harder to read than two that each render or return `null`.

### 3. Who tracked what

The issue rail's Time section lists per-user totals whenever more than one
person has tracked time on the issue. Below one person it stays hidden — a
single-name list is noise.

**No new request:** `timerState` already returns `by_user`, and the issue page
already calls it.

That makes `GET /api/issues/:id/timer/totals` and `api.timers.totals()`
redundant, and they are **deleted**. Spec 2 was originally scoped to "give
`totals()` its first caller"; on inspection the data already arrives on a call
the page makes, so the honest fix is to remove the duplicate endpoint rather
than manufacture a reason to keep it. `issueTimerUserIds` and
`issueTimerTotals` are retained only if the Done path still needs them.

## Non-goals

- **No notifications or email.** The chip is present when there is something to
  resolve; a forgotten timer does not warrant an interruption.
- **No editing the segment's times.** The answer is "how long did you work",
  which is a work log, not a correction to a measurement nobody trusts.
- **No admin view of other people's unresolved timers.** Only the person who
  ran it can answer the question.

## Error handling

A failed poll leaves the chip's last known state, matching `RunningTimerChip`
and `NotificationBell` — flickering the count out on one bad response would
misrepresent resolved work. `resolve` on a segment the caller does not own
returns 404, not 403: the existence of another person's segment is not the
caller's business.

## Testing

Backend:

- an abandoned segment appears in the unresolved list; a settled one does not;
- one older than 30 days is excluded;
- another user's segment never appears in my list;
- logging work on the issue settles that user's abandoned segments there, and
  leaves another user's alone;
- `resolve` settles without writing a work log, and is idempotent;
- `resolve` on someone else's segment 404s and changes nothing;
- a segment closed at workday end is **not** unresolved — it credited its time
  and needs no answer.

Frontend: the chip renders nothing at zero, shows a count above zero, lists an
entry linking to its issue, dismisses one, and holds its state through a failed
poll. The rail shows the per-user split for two trackers and hides it for one.
