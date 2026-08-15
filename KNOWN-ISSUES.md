# Known Issues

## RESOLVED — an abandoned stopwatch timer credited 12 hours nobody worked

**Symptom.** A person started the stopwatch, forgot to pause, and was recorded as
having worked exactly twelve hours. Someone who worked half an hour and forgot
was overstated 24x. The figure reached `work_logs`, `issues.time_spent`, the
time-tracking report and its CSV export.

Reported as "the timer doesn't work", which is how it feels from the outside: the
stopwatch itself started, paused, resumed and displayed correctly, but nobody
could trust a number it produced once they had found hours in their own timesheet
they had not worked.

**Root cause.** The fix for the entry below replaced an unbounded open segment
with a flat `RUNAWAY_MINUTES` cap and committed it. That traded an obviously
wrong value for a plausible wrong one. Three properties made it worse than what
it replaced:

1. **It fired on a read.** `closeStaleSegments` runs at the top of `timerState`
   and `GET /api/me/timer`, and the header chip polls the latter every 60
   seconds — so the fabricated figure was written by the app merely being open.
2. **Configuring `business_hours` did not prevent it.** That was this document's
   recommended mitigation. `workdayEndFor` returns `null` on a non-work day and
   for a start after that day's close, so evening and weekend starts fell
   through to the same cap with a profile fully configured.
3. **The repair script could not see it.** `findTimerOvercounts` flagged spans
   over `ABANDONED_AFTER_MINUTES` (24h); a row the cap had already written was
   exactly 12h and slipped underneath.

**Resolution.** The server may **bound** a timer using evidence — a configured
workday end — but may never **invent** a duration. An abandoned segment now
credits zero: `segmentMinutes` returns 0 when `auto_stopped = 'abandoned'`.

`ended_at` still records when the segment was *found*, not a synthesised end,
because `recentAutoStop` drops stops older than a day and the rail renders
`timeAgo(stopped_at)` — back-dating it to force the zero would have silenced the
explanation on exactly the timers that need one. The rail now states that nothing
was logged and offers **Log the time you worked**, which opens the existing Log
work dialog.

Deriving the zero from `auto_stopped` rather than a new column means historical
rows heal themselves as their issues are recomputed; no migration was needed.

The workday-end path is unchanged — that boundary is evidence, and bounded.

**Historical data.** `node backend/scripts/repair-timer-overcounts.js` now
defines damage as a committed timer work log claiming more than its segments
credit, so it catches both the pre-cap multi-day commits and the 12-hour rows the
old threshold missed. Dry run by default; `--apply` removes fabricated time
rather than re-capping it, and can only ever reduce a total. Segments a human has
corrected (`settled_at`) are never touched.

**Spec.** `docs/superpowers/specs/2026-08-15-abandoned-timer-credits-zero-design.md`

## RESOLVED — an abandoned stopwatch timer logged its full wall-clock span on Done

**Symptom.** A user started the issue stopwatch
(`docs/superpowers/specs/2026-08-08-issue-stopwatch-timer-design.md`) and never
paused it. The issue reached a Done-category status days later with the
`timer_segments` row still open, and the committed work log recorded the entire
multi-day wall-clock span as tracked time — a segment opened Friday and left
running was committed as ~64 hours on Monday.

**Root cause.** Two, and only the first was understood when this was written.

1. `closeStaleSegments(db, { userId })` clipped a stale segment to its workday
   end **only when a `business_hours` profile resolved**. When
   `workdayEndFor` returned `null` — no profile configured, the start day not a
   work day, or a start after that day's close — the segment was deliberately
   left open rather than truncated, per the spec's rule against fabricating an
   implicit cutoff. It then fell through to the Done handler's unconditional
   close, which committed the raw span with no clipping. With no settings UI for
   `business_hours`, the unconfigured project was the default, so nearly every
   abandoned timer took the unclipped path.

2. `localMidnightUtc` in `backend/utils/flow.js` inferred a timezone's UTC
   offset by rendering `Y-M-D 00:00Z` in that zone and reading back the hour,
   which silently assumed east of Greenwich. In New York that guess renders as
   19:00 on the *previous* day, so an offset of -5h was read as +19h and every
   result landed a full calendar day early. `workdayEndFor` therefore rejected
   every boundary it computed for any user west of Greenwich, and
   `businessMinutesBetween` returned 0 for a whole workday. Configuring a
   profile — the mitigation this document recommended — did not help those
   users at all. Every fixture in the repo used `timezone: 'UTC'`, where the
   sign error is invisible.

**Resolution** (`05e3f08`). The offset is now derived with its sign, refined
once for DST-transition days, and covered across ten zones including half-hour
and quarter-hour offsets.

For the design question this entry deferred — what to do with a segment that has
no defensible business-hours boundary — the call went the other way from what it
anticipated. A segment open longer than `ABANDONED_AFTER_MINUTES` is now capped
at `RUNAWAY_MINUTES` of credited time. Leaving it open was never the
conservative option it appeared to be: an open segment re-measures against `now`
on every read, so it inflated per-user totals without bound and committed the
whole span at Done. Capping is a smaller error than that, and unlike the open
segment it is *visible* — every automatic close records why in
`timer_segments.auto_stopped`, the issue rail explains it, and a human
correction now sticks (`timer_segments.settled_at`) instead of being rewritten
by the next commit.

The rule against fabricating a cutoff is preserved where it matters: the cap
never truncates a live same-day timer, and the threshold is deliberately twice
the runaway-warning threshold so the user gets a full 12 hours to see the
warning and pause it themselves, keeping their real elapsed time.

**Historical data.** Segments already closed and committed with an impossible
span keep it — the cap only applies to segments still open. `node
backend/scripts/repair-timer-overcounts.js` rewrites the affected work logs.
Dry run by default; `--apply` to write.

**Superseded.** The cap this entry introduced is itself the subject of the entry
above: crediting `RUNAWAY_MINUTES` was still fabricating a duration, and an
abandoned segment now credits zero. The script no longer re-caps.

## RESOLVED — a fresh deployment had no way to create the first project

**Symptom.** On a real deployment (`SEED_DEMO_DATA=false`) an admin logged in and
got a dashboard reading "No project selected · Create a project to get started."
with nothing to click. No Create button on Board, Backlog, or any other screen,
and no project switcher in the sidebar. Locally everything worked, because local
runs with `SEED_DEMO_DATA=true` and therefore always has projects.

**Root cause.** Two things compounded, both only reachable at zero projects:

1. `ProjectSwitcher` in `components/app/app-shell.tsx` opened with
   `if (!projects.length) return null` — the switcher deleted itself in exactly
   the state where it was the only way forward.
2. Every project screen short-circuits on `if (!currentProjectId)` and returns a
   bare `EmptyState` **before** the `PageHeader` that owns its Create button. So
   the per-screen Create actions were unreachable too.

That left `/admin/projects` as the only entry point — buried under
Administration, and admin-only despite `POST /api/projects` accepting
`board_admin` as well.

**Fix.** The create-project dialog moved out of `screens/admin-projects.tsx` into
`components/app/create-project-dialog.tsx` and is now shared. The switcher always
renders and carries a "Create project" item; the dashboard zero state carries the
same action. Both select the new project on success, so the app is usable without
a reload. Visibility is gated by a new `canCreateProjects()` in `lib/domain.tsx`
that mirrors the API's `requireBoardAdmin` instead of guessing.

**Regression cover.** `frontend/e2e-empty/` runs the same backend with
`SEED_DEMO_DATA=false` (`npm run test:e2e:empty`). The seeded suite structurally
cannot catch this class of bug — it always has projects. Any future zero-state
work belongs in that config.

## RESOLVED — Radix popper menus rendered off-screen

**Symptom.** Every `DropdownMenu` opened (`data-state="open"`) but was positioned
outside the viewport, so clicking a trigger appeared to do nothing. The project
switcher was unusable and the account menu — with Settings inside it — was
unreachable.

**Measured before the fix** (Chromium, 1280x720, `/dashboard`):

| Menu | content height | rendered y | wrapper transform |
|---|---|---|---|
| Project switcher | 159px | -318 | `matrix(1, 0, 0, 1, 0, -318)` |
| Account menu | 337px | -674 | `matrix(1, 0, 0, 1, 0, -674)` |

Always **exactly -2x the menu's own height** — which is the tell. Radix's popper
renders unpositioned content at `translate3d(0, -200%, 0)` until floating-ui
reports `isPositioned`. The menus were never positioned at all; they sat in the
placeholder transform forever.

**Root cause.** `components/ui/button.tsx` shipped in shadcn's React 19 style —
a plain function component, no `forwardRef` — because React 19 accepts `ref` as
an ordinary prop. This project runs **React 18.3.1**, where a plain function
component cannot receive a ref: it silently arrives as `null`.

Every popper trigger uses `asChild` and forwards its anchor ref to `Button`
(`<DropdownMenuTrigger asChild><Button/></DropdownMenuTrigger>`). With the ref
dropped, floating-ui had no reference element to measure, `isPositioned` stayed
`false`, and the placeholder transform was never replaced.

**Fix.** `Button` is wrapped in `React.forwardRef` and passes `ref` to its
underlying element. One change; every popper in the app positions correctly.

**Regression cover.** `e2e/project-switcher.spec.ts` and `e2e/account-menu.spec.ts`
assert menus lie fully **inside the viewport** rather than merely existing in the
DOM — the distinction that made this bug invisible to the previous tests.

**If you add UI primitives:** anything used as an `asChild` trigger must forward
its ref while this project stays on React 18. `input.tsx` and `textarea.tsx`
have the same missing-`forwardRef` shape; they are not popper anchors today, so
they are not currently broken, but they will bite the moment one is used with
`asChild` or given a ref.
