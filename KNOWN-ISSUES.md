# Known Issues

## OPEN — an abandoned stopwatch timer without a business-hours profile logs its full wall-clock span on Done

**Symptom.** If a user starts the issue stopwatch (`docs/superpowers/specs/2026-08-08-issue-stopwatch-timer-design.md`)
and never pauses it — the issue reaches a Done-category status days later,
still with an open `timer_segments` row — the committed work log records the
entire multi-day wall-clock span as tracked time (e.g. a segment opened
Friday and left running is committed as ~64 hours on Monday), rather than
being clipped to real working hours. This is the same overcounting problem
the pre-existing auto-tracking feature already solves for its own derived
calculation via `businessMinutesBetween`.

**Root cause.** `closeStaleSegments(db, { issueId })` — the path used by the
Done-transition handler in `backend/routes/issues.js` — correctly delegates
to the per-tracker, business-hours-aware repair
(`closeStaleSegments(db, { userId })`) before doing its own unconditional
close. That per-user repair clips a stale segment to its workday end
**only when a `business_hours` profile resolves** for that
project/user. When no profile resolves — the case `workdayEndFor` returns
`null` for (`backend/utils/timers.js`): no profile configured, the
segment's start day isn't a work day, or the start is already after that
day's close hour — the segment is deliberately left open rather than
truncated, per the spec's rule against fabricating an implicit cutoff. It
then falls through to the Done handler's unconditional close, which commits
the segment's raw span with no clipping at all.

This iteration ships **no settings UI** for `business_hours` (an explicit,
documented non-goal of the design), so on an unconfigured project — the
default — every abandoned timer hits the unclipped path, not the clipped
one.

**Why this shipped anyway.** The fix implemented during the final review
(commit `5262268`) correctly closes the gap for the case a business-hours
profile *is* configured, and the multi-day-abandoned-segment reproduction
that motivated the fix is a real regression test now
(`backend/tests/backend/auto-worklog.test.js`, "a segment abandoned days
ago is clipped to its workday end on Done"). Closing the remaining,
unconfigured-project case is a product decision — whether an unclippable
abandoned segment should fall back to the pre-existing derived
auto-calculation, be flagged for human review instead of auto-committing,
or something else — not a mechanical fix, and the spec's explicit
"never fabricate a cutoff" rule forecloses the simplest options. Shipping
with this documented, rather than picking one of those design directions
unreviewed, was the deliberate call.

**Mitigation until fixed.** The live-timer UI (web and mobile) already
surfaces a "still running past 12 hours" warning while the issue is open —
the practical exposure is bounded by how long an issue stays open with an
unpaused timer before someone notices, not the theoretical worst case.
Configuring a `business_hours` profile via the API (no UI yet) fully
eliminates this for a given project or user today.

**If you pick this up:** the fix point is the Done-transition handler in
`backend/routes/issues.js`, right after the per-tracker repair loop and
before the unconditional `closeStaleSegments(db, { issueId: updated.id })`
call — decide there whether a still-open, unclippable segment should be
excluded from `commitTimer` and let `applyAutoWorklog` cover that tracker's
share instead, consistent with the non-goal that this feature must never
invent a business-hours default.

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
