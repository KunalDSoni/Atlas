# Shareable links for issues and wiki pages

## Problem

Issues (bugs, stories, tasks, subtasks) already have a unique key (`ATLAS-3`), a
permanent URL, and a "Copy link" button — but that button only exists once you
open the full detail page or the drawer/peek sheet. It's missing from every
list surface: board cards, backlog rows, the epics list, and filters/search
results. To share a link today you have to open the issue first.

Wiki pages have no equivalent at all: they're identified only by an internal
UUID and a `slug`, with no short human key and no Copy Link button anywhere.

## Goals

- Wiki pages get a short, shareable key in the same style as issue keys.
- Every list surface for issues gets a one-click Copy Link action, not just
  the detail view.
- Opening a copied link you don't have access to says so clearly, instead of
  a generic 404.

## Non-goals

- Right-click context menus or browser-native link copying.
- Changing the issue key scheme itself (`ATLAS-3` is unchanged).

## Design

### Wiki page keys

Each wiki page gets a key of the form `{SPACE_KEY}-WIKI-{n}`, e.g.
`ATLAS-WIKI-12` — mirroring `{PROJECT_KEY}-{n}` for issues, with a `-WIKI-`
segment so a wiki key can never collide with an issue key even when a wiki
space shares its key with a project.

- `wiki_pages` gains `page_number INT`, assigned the same way issue numbers
  are today: `MAX(page_number)+1` scoped to `space_id`, inside the existing
  insert transaction in `backend/routes/wiki.js`.
- A migration (`backend/migrations.js`, alongside the other numbering
  backfills already there) assigns `page_number` to existing pages, ordered
  by `created_at` within each space.
- `pageKey` is derived by joining `space_key` + `page_number`, the same way
  page list/detail queries already join `space_key` in (see
  `backend/routes/wiki.js:170,188,232`) — not stored as a separate denormalized
  column.
- Key lookups are case-insensitive, matching `issueUrl`'s existing
  `.toUpperCase()` behavior.

### Wiki page URLs

- New canonical route `/wiki/:pageKey` (e.g. `/wiki/ATLAS-WIKI-12`), resolved
  server-side by key via a new lookup endpoint.
- The existing `/wiki/page/:pageId` (UUID) route is kept and now redirects to
  the canonical key URL, following the same pattern
  `frontend/src/components/app/legacy-redirect.tsx` already uses for old
  numeric issue ids — so existing bookmarks and links keep working.
- `frontend/src/lib/urls.ts` gains `wikiPageUrl(pageKey)`, mirroring
  `issueUrl`.
- `backend/utils/links.js` gains `wikiPageLink(pageKey)`, mirroring
  `issueLink`, for any server-generated links (comment/mention/watcher
  notifications).

### Copy Link UI

- A shared `CopyLinkButton({ url })` component replaces the
  issue-specific logic currently duplicated in
  `frontend/src/components/app/copy-issue-link.tsx` — same clipboard-write +
  toast behavior, same fallback (show the raw URL in the toast) if
  `navigator.clipboard` is denied or unavailable. `CopyIssueLink` becomes a
  thin wrapper (`issueKey` → `absoluteUrl(issueUrl(issueKey))`) over it.
- Wiki page header (`frontend/src/screens/wiki-page.tsx`) gets a Copy Link
  button next to the existing header actions, using
  `absoluteUrl(wikiPageUrl(pageKey))`.
- Issue Copy Link is added to four list surfaces, as a hover-reveal icon
  button (`Link2`, same icon as the existing button) at the end of each
  row/card — no need to open the detail view first:
  - Board cards (`frontend/src/screens/board.tsx`)
  - Backlog rows (`frontend/src/screens/backlog.tsx`)
  - Epics list (`frontend/src/screens/epics.tsx`)
  - Filters/search results (`frontend/src/screens/filters.tsx`)

### Access errors

- A copied link to a wiki page the recipient can't access (private space,
  restricted page) shows a dedicated "not found or no access" screen, mirroring
  `IssueNotFound`/`ProjectNotFound` in `frontend/src/screens/not-found.tsx`.
  This is a new `WikiPageNotFound` component following the same shape.
- Issues already have this treatment; no change needed there.

## Testing

- Backend: page_number sequencing per space (including concurrent creates),
  migration backfill correctness, key-based wiki lookup route, legacy UUID
  redirect still resolves.
- Frontend: unit tests for `wikiPageUrl` mirroring the existing `urls.ts`
  tests; `CopyLinkButton` unit test (clipboard success/failure); one test per
  new issue-list surface confirming the button renders and copies the
  expected key; `WikiPageNotFound` rendering test.
