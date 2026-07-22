# Permanent entity URLs

**Date:** 2026-07-22
**Status:** approved

## Problem

An issue exists only as a drawer over the board. Close it and it is gone; there
is no URL naming it. Nobody can paste a task into Slack, bookmark a bug, or link
one from a commit message. The deeper cause is that *no* screen is addressable:
`/board`, `/backlog` and `/sprints` carry no project, so which project you are
looking at lives in React state seeded from `localStorage`
(`frontend/src/hooks/use-projects.tsx`). Two people on the same URL can be
looking at different projects.

There is already a half-built deep link — `/board?issue=<uuid>`, emitted by the
command palette, by issue chips in rich text, and stored in every notification
row. It exposes a UUID, it hardcodes which screen the issue is "on", and it
breaks for epics (which need `/epics?issue=`) and for issues in another project.

## Goal

Every project screen and every issue has a permanent, human-readable,
shareable URL. The drawer and the full page are two renderings of one route.

## URL scheme

```
/                          → redirect to /:remembered/board
/:projectKey/              → redirect to /:projectKey/board
/:projectKey/board         /:projectKey/backlog     /:projectKey/epics
/:projectKey/roadmap       /:projectKey/sprints     /:projectKey/releases
/:projectKey/reports       /:projectKey/automation  /:projectKey/servicedesk/*
/:projectKey/:issueKey     → issue page, any type (ATLAS-3, epic or bug alike)

/dashboard  /product/*  /wiki/*  /portal  /admin/*  /profile  /settings
/login      /help/*
```

The nine screens that move are exactly the nine that read `currentProjectId`.
`dashboard` reads it too but stays global: it is the cross-project landing page,
and it keeps using the remembered project for its widgets. The product
discovery, wiki, admin, profile and settings screens never read it, so they
stay where they are.

### Why type is not in the path

The prompt suggested `/project/x/task/ATL-3` and `/project/x/story/US-101`.
Rejected: an issue's type is mutable (a task gets promoted to a story), so a
type segment makes the URL break on an ordinary edit, and it forces every link
site to know the type before it can build a href. `issue_key` alone is
sufficient — `projects.key` is `UNIQUE` and `issue_key` is `${project.key}-${n}`,
so keys are globally unique already.

### Disambiguating `/atlas/board` from `/atlas/ATLAS-3`

Issue keys match `^[A-Z][A-Z0-9]*-\d+$`; screen segments are lowercase words.
The issue route is declared last and guarded by that pattern. No reserved-word
list to maintain. Project keys are matched case-insensitively and canonicalised
to lowercase for display.

## Architecture

### Route param becomes the source of truth

`ProjectsProvider` inverts. Today `currentProjectId` is state seeded from
`localStorage`; it becomes derived from `:projectKey`.

- A `ProjectRoute` layout reads the param, resolves it against the loaded
  project list, and provides `currentProject` downstream. Screens keep using
  `useProjects()` unchanged.
- `setCurrentProjectId` becomes a `navigate()` to the same screen under the new
  key. The project switcher changes the URL rather than hidden state.
- `localStorage` keeps exactly one job: where bare `/` lands.
- An unknown or unauthorised key renders a "project not found" screen with a
  link back to the last known project. Not a silent redirect — a wrong link
  should say it is wrong.

### One new endpoint

`GET /api/issues/by-key/:key` returns the same shape as `GET /api/issues/:id`
so a page can boot straight from the URL. UUIDs remain the primary key
internally; they just stop appearing in URLs. An issue whose project the caller
cannot see returns 404, not 403 — a 403 would confirm the key exists.

### Drawer and page

Clicking a card calls
`navigate('/atlas/ATLAS-3', { state: { background: location } })`. The app
renders its route tree against `state.background` when present and layers a
sheet-only route tree on top. Pasting the URL into a fresh tab has no
`background` in history state, so the same route resolves to the full page.
One route, two shells, selected by whether there is anything to layer over.

Esc and Back both pop the drawer, because closing it is `navigate(-1)`.

### Splitting issue-detail-sheet.tsx

The file is 45KB and owns data loading, every field editor, four tabs and the
Sheet chrome. Both shells need all of it except the chrome:

```
components/app/issue-detail/
  use-issue-detail.ts      loads + mutations + reload
  issue-detail-body.tsx    header, description, subtasks, linked issues
  issue-fields.tsx         status, assignee, priority, sprint, epic, points,
                           version, component, labels, custom fields
  issue-tabs.tsx           comments · activity · worklog · attachments
components/app/issue-detail-sheet.tsx   Sheet chrome only — path unchanged
screens/issue.tsx                       page chrome: breadcrumb, wider layout
```

The four screens importing `IssueDetailSheet` keep the same import path. Their
local `openIssueId` state and `?issue=` handling disappear.

### URL construction has one home

`lib/urls.ts` exports `issueUrl(projectKey, issueKey)`, `projectUrl(key, screen)`
and friends. The sidebar, command palette, rich-text chips, notification
handler and Copy Link all go through it. Nothing else formats a route.

`copy-issue-link.tsx` writes `${origin}${issueUrl(...)}` to the clipboard and
confirms with a `sonner` toast. It appears in both shells' headers and in the
card context menu.

Cross-project links work by construction: a linked issue's key carries its
project (`BETA-9` → `/beta/BETA-9`), so opening a linked issue stops being
same-project-only.

## Back-compat

Notification rows already in the database hold `/board?issue=<uuid>`, and old
bookmarks exist in browsers. The legacy paths stay registered, handled by one
`LegacyProjectRedirect`:

- `/board?issue=<uuid>` → resolve the UUID, redirect to `/atlas/ATLAS-3`
- `/board` bare → `/:remembered/board`

New notifications write the new form. `backend/utils/links.js` exports
`issueLink(issueKey)`, splitting on the **last** hyphen so a hyphenated project
key survives. Call sites: `routes/comments.js`, `routes/issues.js`,
`utils/automation.js`. Email notifications read the same stored `link` field
and are fixed by the same change.

## Project keys are frozen

`PUT /api/projects/:id` currently accepts `key`, but `issues.issue_key` is
denormalised — renaming `ATLAS`→`ATL` today already leaves every issue holding
a stale key. Under a URL scheme built on keys, that is worse. `key` is dropped
from the accepted fields and rendered read-only in `admin-projects.tsx`.
`name` stays freely editable. A project key is an identity, not a label.

## Error handling

| Case | Behaviour |
|---|---|
| Unknown project key | "Project not found" screen, link to last known project |
| Project exists, caller not a member | same screen — do not distinguish |
| Unknown issue key | "Issue not found" screen inside the project shell |
| Issue in an invisible project | 404 from the API, same screen |
| Malformed key (`/atlas/foo-bar`) | does not match the issue pattern → falls through to not-found |

## Testing

Tests first, per the repo's practice.

**Backend**
- `by-key`: found; unknown key; key in a project the caller cannot see (404);
  unauthenticated (401).
- Notification links are written in `/atlas/ATLAS-3` form.
- `issueLink` splits on the last hyphen.
- A `PUT` attempting to change a project key leaves the key unchanged.

**Frontend e2e** — new `frontend/e2e/deep-links.spec.ts`
- Clicking a card changes the URL and opens the drawer.
- Reloading that URL renders the full page.
- Back closes the drawer and returns to the board.
- Copy Link places a URL that resolves when opened.
- An unknown key shows not-found.
- The project switcher rewrites the URL.
- `/board?issue=<uuid>` redirects to the canonical URL.

⚠️ e2e cannot run from a `.claude/worktrees` checkout — Express `sendFile` 404s
on dot-segment paths. From a worktree, use the scratch config that boots the
main checkout's backend.

## Slices

**Slice 1 — foundation.** Everything above.

**Slice 2 — sprints and releases.** Migration `016` adds a `slug` column to
`sprints` and `versions`, unique per project, backfilled from the name
(`Sprint 1`→`sprint-1`, `v1.2`→`v1-2`, collisions suffixed `-2`). Generated on
create, frozen after — same reasoning as project keys. Then
`/atlas/sprints/sprint-1` and `/atlas/releases/v1-2` detail pages (goal, dates,
status, scope, issue list), with the existing list screens linking rows into
them.

## Out of scope

- A **workspace** tier. No such entity exists in the data model; projects are
  the top level. `/workspace/atlas` would be inventing a concept, which is its
  own project.
- Wiki page URLs. They already have stable routes, albeit UUID-based.
- Redirecting renamed project keys. Keys are frozen instead, which removes the
  case rather than serving it.
