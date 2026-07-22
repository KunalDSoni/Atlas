# Editing epics, stories and tasks

**Date:** 2026-07-22
**Status:** approved

## Problem

Once an issue is created there is no way to change what it says. The detail
sheet renders the title as a plain `SheetTitle` and the description as a plain
`<p>`; neither is editable, for any issue type. `epics.tsx` lists and creates
epics but never updates one. A typo in an epic title is permanent from the UI.

The backend has supported this all along: `PUT /api/issues/:id` allow-lists
`title`, `description`, `type`, `story_points`, `start_date` and `due_date`
(`backend/routes/issues.js:372`). Only the UI is missing.

## Scope

One edit dialog, reachable from the issue detail sheet, covering every issue
type — epic, story, task, bug, subtask. Epics, stories and tasks are rows in
the same `issues` table distinguished by `type`, so a single dialog serves all
of them.

## Design

### Entry point

An **Edit** button in the detail sheet header, shown when
`canCreateIssues(user?.role)` — admin, board_admin and user, not client. Board,
backlog, epics, roadmap and search all open that sheet, so one affordance
covers every screen and there is a single code path to test.

### Component

`frontend/src/components/app/edit-issue-dialog.tsx`, following
`create-issue-dialog.tsx`: a `Dialog` wrapping a form, with state seeded from
the issue and reset whenever `open` becomes true. Props: `issue`, `open`,
`onOpenChange`, `onSaved`. Submitting makes one `api.issues.update` call and
then `onSaved()`, which triggers the sheet's existing refetch.

Fields, chosen because nothing else in the UI can change them:

| Field | Control |
|---|---|
| `type` | select — story, bug, task, epic, subtask |
| `title` | text input, required |
| `description` | textarea |
| `story_points` | number input (display-only today at `issue-detail-sheet.tsx:828`) |
| `start_date`, `due_date` | date inputs (absent from the UI entirely) |

Epic colour is deliberately excluded: the sheet sidebar already has a working
swatch picker for it, and two controls for one field is a bug waiting to
happen. Status, assignee, priority, sprint, epic, fix version, component and
estimate stay in the sidebar for the same reason. The dialog fills gaps; it
does not duplicate.

### Errors

The server validates type changes through `validateHierarchy`
(`routes/issues.js:34`): an epic that still has children cannot become
something else, and an issue with subtasks cannot become a type that may not
parent them. The dialog renders the returned message inline and stays open, so
a rejected edit is not lost. Other failures use the existing toast pattern.

Sending unchanged fields is safe — the route compares old and new per field
before writing activity entries (`routes/issues.js:383`), so a no-op edit
writes no activity.

### Permission gate on the API

No backend change is needed. `PUT /api/issues/:id` declares only `requireAuth`,
which reads as "any session may edit any issue" — but `app.use('/api',
blockClients)` at `server.js:130` already refuses the client role for every
route registered after it, and the issues routes are. The design originally
proposed adding `requireRole` here; that was based on reading the route in
isolation rather than the middleware chain, and the test written to prove the
hole passed on first run. The gate exists. The tests stay as regression cover
for it.

## Testing

- Backend: a client is refused (403) and an ordinary user is allowed (200) on
  `PUT /api/issues/:id`; title, description and type round-trip.
- E2E: edit a story's title and description and see the sheet update; attempt
  an epic-to-task conversion on an epic with children and assert the inline
  error.

## Out of scope

Two adjacent defects found while investigating, both left alone:

1. `canCreateIssues` grants create to `user`, but `POST /api/projects/:id/issues`
   requires board_admin — a user sees a button that 403s.
2. `enrichSprint` does not COALESCE `done_count`, so an empty sprint reports
   `null` and its card reads "/0" instead of "0/0".
