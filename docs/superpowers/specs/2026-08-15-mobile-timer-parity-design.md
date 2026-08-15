# Mobile timer parity

**Status:** approved, ready to implement
**Date:** 2026-08-15
**Related:** `2026-08-15-abandoned-timer-credits-zero-design.md`,
`2026-08-15-recovering-unresolved-time-design.md`

**Spec 4.** Specs 1–3 landed on web. This carries the two that matter to the
phone.

## Problem

`mobile/src/api/timers.ts` has no `auto_stopped` field. The server has returned
it since migration `030`, the web rail renders it, and mobile cannot see it —
so `IssueDetailScreen` shows the runaway warning and nothing else.

When the server stops a mobile user's timer, they get **silence**. The Pause
button reverts to Start, the tracked figure changes, and nothing says why.

That is exactly the complaint this whole line of work began with — a timer that
"stopped by itself" — still fully reproducible on the platform where people are
most likely to leave one running. Web now explains the stop and offers to log
the real time; mobile does neither.

Second gap: the unresolved list from Spec 2 has no mobile surface at all, so a
timer abandoned on the phone is invisible on the phone.

## Environment

Expo SDK 57.0.8, React Native 0.86, React 19.2.3, per `mobile/AGENTS.md`'s
requirement to check the versioned docs. Nothing here touches an Expo SDK
package: the work uses `Text`, `Button`, `Pressable`, `StyleSheet` and the
existing `@tanstack/react-query` v5 patterns already in the screen.

Note React **19** here against React **18.3.1** on web — the missing-`forwardRef`
hazard recorded in `KNOWN-ISSUES.md` is a web concern and does not apply.

## Design

### 1. The mobile timer type learns what the server already sends

`TimerState` in `mobile/src/api/timers.ts` gains `auto_stopped`, matching the
web type:

```ts
export type TimerStopReason = 'workday_end' | 'abandoned' | 'issue_done' | 'switched_issue';
export type TimerAutoStop = { reason: TimerStopReason; stopped_at: string };
```

The field is `TimerAutoStop | null`. No endpoint changes — the data has been on
the wire all along.

### 2. Explaining a stop nobody asked for

Below the timer control, when `auto_stopped` is set and nothing is running:

> Your timer was left running for more than a day, so it was stopped without
> logging any time. **Log the time you worked**

The reason strings are the web ones, kept identical deliberately: the same event
described two different ways on two devices reads as two different bugs.

An unknown reason falls back to "stopped automatically", the same defensive
default web uses — an older client against a newer server must not render a
sentence with a hole in it.

For `'abandoned'` the action is **Log the time you worked**, because nothing was
recorded and there is no entry to correct. For every other reason the text just
explains, matching web.

### 3. Logging the real time

Mobile has no work-log UI at all today. This adds the minimum: a prompt
accepting a duration in minutes, posting to the existing
`POST /issues/:id/worklogs`.

`Alert.prompt` is iOS-only, so this uses a small controlled `Modal` with a
numeric `TextInput` — one component, `TimeEntryModal`, usable later by any
other screen that needs to log time.

Posting settles the abandoned segments for that user on that issue (Spec 2
wired this into the route), so the prompt clears itself with no extra call.

### 4. Unresolved timers on mobile

`SettingsScreen` gains a section listing `GET /me/timer/unresolved`: issue key,
how long it ran, and a **Dismiss** action calling
`POST /timer-segments/:id/resolve`.

Settings rather than a header badge: React Navigation headers are a separate
structure per the running-timer spec's own note, and a list somebody can find is
worth more than a badge that needs new navigation plumbing. Tapping an entry
navigates to the issue, where §3's prompt lives.

The section renders nothing when the list is empty.

## Non-goals

- **No mobile business-hours editor.** Configuration is comfortable on web and
  is a per-project admin act, not something done from a phone.
- **No mobile My time.** A seven-column week is a desktop shape.
- **No header badge or running-timer indicator.** Deferred again, deliberately —
  it needs navigation-level structure this change does not require.
- **No offline queueing.** A failed post surfaces an error and keeps the prompt.

## Error handling

A failed work-log post keeps the modal open with the entered value, so a bad
connection never silently discards what someone typed. A failed dismiss leaves
the row in place — a row that vanishes without settling would misrepresent
resolved time. Both surface the server's message.

## Testing

`mobile/src/__tests__/IssueDetailScreen.test.tsx` already exists and is
extended:

- an `auto_stopped` of `'abandoned'` renders the explanation and the log action;
- a running timer renders no explanation, even when `auto_stopped` is present;
- an unknown reason falls back to "stopped automatically" rather than a gap;
- submitting the modal posts the minutes and closes it;
- a failed post keeps the modal open with the value intact.

New `mobile/src/__tests__/SettingsScreen.test.tsx`: the section is absent when
the list is empty, lists an entry when it is not, and dismissing removes it.
