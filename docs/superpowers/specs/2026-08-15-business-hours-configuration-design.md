# Configuring business hours

**Status:** approved, ready to implement
**Date:** 2026-08-15
**Related:** `2026-08-15-abandoned-timer-credits-zero-design.md`,
`2026-07-29-auto-time-tracking-business-hours-design.md`

**Spec 1 of 3** in the timer follow-up sequence:

1. **Configure business hours** — this document.
2. Recover unresolved time — the unresolved-timer surface, and per-user
   attribution on an issue.
3. My time — a cross-project personal timesheet.

The order is deliberate. Nothing but this spec changes what a forgotten timer
*costs*; the later two present time that this one makes trustworthy.

## Problem

`business_hours` has no write path. Grepping the routes, it appears only in
`backend/routes/issues.js`, where it is read. It is absent from `projects.js`,
`users.js`, `profile.js` and `settings.js`. The only way to configure a profile
on a running deployment is raw SQL against the database.

Everything downstream of the value already exists and works: `parseBusinessHours`
defines the shape, `resolveBusinessHours` resolves user-over-project,
`workdayEndFor` derives the boundary, and `applyAutoWorklog` clips derived time
to it. The feature is complete except for the one screen that would let anyone
turn it on.

This became urgent with the abandoned-timer fix. Previously an unconfigured
project silently credited 12 fabricated hours to a forgotten timer. Now it
correctly credits **zero** — which means that on an unconfigured project, every
forgotten timer loses all of its real work. A configured profile is what turns
"lost the afternoon" into "credited to the end of the working day". That fix
traded a wrong number for a missing one; this spec is what makes the missing
number rare.

## Non-goals

- **No change to the profile shape**, the resolver, or any consumer.
- **No holiday calendars** — inherited from the business-hours spec.
- **No org-wide default.** Project and user are the two levels that exist.
- **No backfill.** A saved profile takes effect on the next timer read.

## Design

### 1. Writes validate strictly; reads stay tolerant

`parseBusinessHours` returns `null` for anything malformed. That is right for a
reader — "unconfigured, fall back to wall-clock" — and exactly wrong for a
writer. Someone who enters 5pm–9am by mistake would get a silent save that reads
back as unconfigured, leaving their timers losing time while the settings page
displays what they typed.

Writes therefore get a separate, strict validator in `backend/utils/flow.js`
beside the parser it mirrors:

```js
validateBusinessHours(value)  // -> { ok: true, json } | { ok: false, error }
```

Rules, each rejecting with the offending field named:

- `timezone` — a real IANA zone, probed by constructing an
  `Intl.DateTimeFormat` with it and catching the `RangeError`.
- `work_days` — a non-empty array of unique integers in 1–7.
- `start_hour`, `end_hour` — integers in 0–24 with **`end_hour > start_hour`**.

The last rule is not cosmetic. `workdayEndFor` computes `midnight + end_hour`
and returns `null` when `end <= start`, so an inverted profile behaves
identically to no profile at all — the exact silent failure this spec exists to
remove.

`validateBusinessHours` returns the serialised JSON rather than the object, so
routes never re-stringify and the stored form has one producer.

### 2. API

Folded into the existing routes rather than added as new endpoints: the
permissions are already correct and the update pattern already exists.

| Route | Guard | Field |
|---|---|---|
| `PUT /api/projects/:id` | `requireBoardAdmin` (existing) | `business_hours` |
| `PUT /api/profile` | self only (existing) | `business_hours` |

Both routes already build their `UPDATE` from `!== undefined` checks, so the
convention this needs is the one they already follow:

- **omitted** → unchanged;
- **explicit `null`** → cleared, back to unconfigured;
- **an object** → validated, and `400` with the offending field if invalid.

The omitted-versus-null distinction matters beyond tidiness: without it, any
existing client sending a partial body — the profile form, which today posts
seven unrelated fields — would silently wipe a project's hours.

### 3. UI

**Project** — in the project edit form in `frontend/src/screens/admin-projects.tsx`,
beside the existing WIP limits, since that is where project configuration lives.

**User** — in `frontend/src/screens/profile.tsx`, defaulting to "Use project
default" so the override is opt-in and the common case needs no interaction.

Both use the same control: a timezone select, Mon–Sun day toggles, and start/end
hour pickers.

The unconfigured state is the important one, and it renders as a warning rather
than an empty form:

> Not set. A timer left running overnight will be stopped without logging any
> time.

That sentence is what connects this screen to the behaviour someone actually
experienced. A settings page that merely offers empty fields does not tell
anyone why they should fill them in.

### 4. What changes downstream

Nothing in `backend/utils/timers.js`. Once a profile resolves, `workdayEndFor`
starts returning boundaries, and two existing behaviours switch on by
themselves: a forgotten timer closes at the end of its working day and **credits
those minutes** instead of zero, and the status-derived calculation clips to
business hours rather than raw wall-clock.

## Testing

`backend/tests/backend/business-hours.test.js` (new) for the validator: a valid
profile round-trips; each rule rejects with its field named — inverted hours, a
bad timezone, empty `work_days`, duplicate days, out-of-range hours, non-integer
hours.

Route tests: a `board_admin` sets project hours and a plain member cannot; a user
sets their own; an omitted field leaves the stored value unchanged; an explicit
`null` clears it; an invalid profile returns 400 and writes nothing.

One integration test carries the whole point of the spec, and is the direct
counterpart to the abandoned-timer regression tests: **with a profile
configured, a timer left running overnight closes at that day's business-day end
and credits those minutes**, where the same timer without a profile credits
zero.

Frontend: the form renders a stored profile, saves a changed one, and shows the
unconfigured warning when nothing is set.
