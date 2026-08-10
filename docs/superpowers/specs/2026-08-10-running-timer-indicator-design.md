# Running-timer indicator

**Status:** approved, ready to implement
**Date:** 2026-08-10
**Related:** `2026-08-08-issue-stopwatch-timer-design.md`

## Why

The stopwatch has no presence outside the issue it was started on. Start a timer,
navigate anywhere else, and nothing in the application indicates it is still
running — no badge, no banner, no count. You rediscover it only by returning to
that exact issue.

This is the upstream cause of the timer complaints that motivated the fixes in
`05e3f08`. Those addressed what happens *after* someone forgets a timer: the
overcounting, the silent auto-stops, the corrections that would not stick.
None of them stop the forgetting, because the forgetting is a consequence of the
timer being invisible.

`GET /api/me/timer` was built for exactly this. Its own comment says it exists to
"let a running timer survive a refresh and follow the user between web and
mobile." It is fully implemented, tested, exposed through `api.timers.mine()` —
and has never had a single caller. So has `api.timers.totals()`. This is the same
latent defect class as `api.timers.commit()`, whose zero callers meant tracked
time never reached `work_logs` at all until `05e3f08`. An endpoint nothing calls
is indistinguishable from an endpoint that does not work.

## What ships

A chip in the application header, left of the notification bell, rendered only
while the current user has a running timer.

**Normal state** — quiet, informational:

```
┌─ header ────────────────────────────────────────────┐
│ ☰   Search… ⌘K            [⏱ ATL-42 · 1h 12m]  🔔 👤 │
└─────────────────────────────────────────────────────┘
```

The whole chip is a link to the issue. There is deliberately no pause control
here: a global, always-present "stop my tracking" target is easy to hit by
accident, and an accidentally stopped timer reproduces the original
"it stopped by itself" complaint — this time by design.

**Escalated state** — once the server reports `runaway: true`:

```
│ ☰   Search… ⌘K   [⏱ ATL-42 · 14h 03m  Pause it]  🔔 👤 │
                                        ^^^^^^^^ explicit target
```

Destructive styling, plus an explicit `Pause it` button. One click to stop,
exactly at the moment someone has genuinely forgotten and speed matters.

The 12-hour threshold is **not** reimplemented in the frontend. `/api/me/timer`
already returns `runaway`, derived from `RUNAWAY_MINUTES` in
`backend/utils/timers.js`. The rule stays in one place.

## Structure

One new component, `frontend/src/components/app/running-timer-chip.tsx`,
rendered in `app-shell.tsx`'s header beside `<NotificationBell />`. It owns its
own fetching and state and returns `null` when no timer is running, so the shell
change is a single line and the chip can be understood and tested on its own.

It links via the existing `issueUrl()` from `lib/urls.ts`, which derives the
project from the issue key — so a timer running in a project other than the one
currently on screen links correctly with no special handling.

## Freshness

Mirrors `NotificationBell`, the established pattern in this shell:

- fetch on mount, then poll every 60s
- tick the displayed elapsed minutes locally between polls, so the number
  advances smoothly without a request per minute

Polling alone is too slow in one case: starting or pausing a timer on an issue
page must update the chip immediately, not up to a minute later. A `window`
event, `atlas:timer-changed`, carries that signal. `use-issue-detail.ts`
dispatches it from its start and pause handlers; the chip listens and refetches.

The event runs both directions. Pausing *from* the chip now writes a work log
(as of `05e3f08`, pausing commits), so an open issue page's `time_spent` and
worklog list go stale the moment the chip pauses. The chip dispatches the same
event; `use-issue-detail` listens and reloads when the event names the issue it
is showing.

A `window` event rather than a context or store: the codebase already dispatches
a synthetic DOM event for the ⌘K palette, so this is an existing idiom, and it
keeps a single chip from requiring global state plumbing.

## Error handling

- Poll failures are swallowed; the chip keeps its last known state rather than
  flickering out on one bad response. Same as `NotificationBell`.
- A failed pause shows a toast and leaves the chip running. It must never show a
  stopped timer that is still running on the server.
- No timer, or a request that has not resolved yet, renders nothing. The chip
  never occupies header space speculatively.

## Accessibility

The chip is a link labelled with both the issue and the elapsed time, e.g.
`aria-label="Timer running on ATL-42, 1h 12m"`. The elapsed figure itself is not
in a live region — it changes every minute, and announcing that on a loop is
hostile. The escalation is announced once, through a `role="status"` node that
renders only in the runaway state.

## Testing

Vitest, `running-timer-chip.test.tsx`:

- renders nothing when `api.timers.mine()` resolves null
- renders the issue key and formatted elapsed time when a timer is running
- shows no pause control in the normal state
- escalates and reveals `Pause it` when `runaway` is true
- clicking `Pause it` calls `api.timers.pause` with the running issue's id
- a failed poll leaves the previously rendered timer in place

Playwright, extending `e2e/timer.spec.ts`:

- start a timer on an issue, navigate to the board, assert the chip shows the
  issue key, click it, and land back on the issue

## Deliberately not building

- no dropdown, timer history, or switching timers from the chip
- no sound or desktop notification
- no server push for timer events — polling plus the local event is sufficient
  and adds no backend surface
- no mobile app indicator; React Navigation headers are a separate structure and
  a separate change

## Side effect worth recording

`/api/me/timer` calls `closeStaleSegments`, so a 60-second poll makes the
abandoned-timer repair run promptly instead of waiting for someone to open the
issue. Forgotten timers get capped and committed sooner. When that happens the
chip disappears — which is correct, and is explained by the auto-stop notice on
the issue rail added in `05e3f08`.
