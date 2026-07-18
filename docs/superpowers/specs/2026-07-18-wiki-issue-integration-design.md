# Wiki ↔ Issue Integration — Design

**Date:** 2026-07-18
**Wave:** roadmap epics 31–32 — live issue chips, page back-links
**Status:** Approved for planning

> Numbering note: `ATLAS-NN` in commit messages and this document refers to the
> roadmap **epic ordinal**, following the convention of earlier waves. It is not
> the seeded issue key — the dogfood seed assigns keys sequentially across epics
> and their children, so epic 29 ("Schema migration runner") is seeded as
> `ATLAS-104`. Epic ordinal is the stable identifier; issue keys shift whenever
> seed content changes.

## Problem

Atlas ships an issue tracker and a wiki in one app, but they barely know each
other exists. What is there today lives entirely in the browser, in
`applyMacros` (`frontend/src/components/app/rich-text.tsx`):

- Issue keys in page text become clickable chips.
- A `[toc]` macro builds a table of contents.

That client-side text matching has three concrete defects:

1. **Chips are not live.** A chip shows `ATLAS-29` and nothing else — no title,
   status, or assignee. It is a link, not an embed. The value of an embed is
   seeing state without leaving the page.

2. **Chip clicks can navigate to the wrong issue.** `rich-text.tsx:161` resolves
   a chip by calling search and then falls back to `results.issues[0]` when no
   exact key match is found. A chip for a deleted or renamed issue silently
   opens an unrelated issue, with no error shown.

3. **The regex over-matches.** `\b[A-Z][A-Z0-9]{1,9}-\d+\b` matches `COVID-19`,
   `ISO-8601`, `RFC-2119`, and `UTF-8`. All render as clickable issue chips.

And the reverse direction does not exist at all: an issue has no idea which wiki
pages reference it. There is no table associating pages with issues, so every
association is recomputed from text on each render and vanishes on navigation.

## Goals

- Chips show real issue state (title, status, assignee, priority) on hover.
- Clicking a chip always opens the issue it names, or the chip is not a chip.
- An issue shows which wiki pages mention it, respecting page restrictions.
- Text that merely looks like an issue key renders as prose.

## Non-goals

- The JQL table macro (embedding a live filtered issue table in a page). Worth
  building, deferred: it raises its own pagination and permission questions.
- Editor UI for deliberately inserting an embed. Authors keep typing keys.
- Changing issue-level visibility. See "Known limitation" below.
- Chips in wiki page *comments*. Comments render through `RichTextView` without
  `macros` today (`wiki-page.tsx:539`) and keep that behaviour; only page bodies
  are extracted and chipped.

## Design

### 1. Schema — migration `008_wiki_page_issues`

Appended to `backend/migrations.js`, in both SQLite and MySQL forms, using the
migration runner added in ATLAS-29.

```sql
CREATE TABLE IF NOT EXISTS wiki_page_issues (
  page_id  TEXT NOT NULL REFERENCES wiki_pages(id),
  issue_id TEXT NOT NULL REFERENCES issues(id),
  PRIMARY KEY (page_id, issue_id)
);
CREATE INDEX idx_page_issues_issue ON wiki_page_issues(issue_id);
```

The composite primary key makes writes idempotent. The index serves the reverse
lookup (`issue → pages`); the primary key's leading column serves the forward
lookup (`page → issues`).

**The sanitizer is unchanged.** `backend/utils/sanitize.js` uses a strict tag
allowlist with `disallowedTagsMode: 'discard'`, so a custom `<atlas-issue>` tag
would be stripped on write. This design never needs one: chips are constructed
client-side *after* sanitizing, from `textContent`, exactly as `applyMacros`
does today. The feature inherits that safety property instead of relaxing it.

### 2. Write path — extraction on save

New module `backend/utils/issue-keys.js`:

```js
extractIssueKeys(html) → ['ATLAS-29', 'ATLAS-3']
```

- Strips `<code>`, `<pre>`, and `<a>` blocks before matching, so keys inside
  code samples and existing links are not treated as references. This mirrors
  the exclusion `applyMacros` already applies client-side.
- Matches `\b[A-Z][A-Z0-9]{1,9}-\d+\b` and dedupes. No case folding: the pattern
  is uppercase-only by construction, matching the client-side regex, so a
  lowercase `atlas-29` is not a reference.
- Returns `[]` for empty or non-string input.

Wired into `POST /api/wiki/spaces/:spaceId/pages` and
`PUT /api/wiki/pages/:id`, after sanitizing:

1. `extractIssueKeys(cleanBody)`
2. Resolve to ids in one batched query:
   `SELECT id, issue_key FROM issues WHERE issue_key IN (...)`
3. Replace-all: `DELETE FROM wiki_page_issues WHERE page_id = ?`, then insert
   the resolved set. This matches the replace-all idiom already used by page
   restrictions.

Resolution is the junk filter: `COVID-19` matches the regex but resolves to no
issue, so no row is written and no chip is ever rendered for it.

### 3. Read path — forward (page → issues)

`GET /api/wiki/pages/:id` gains a `linked_issues` array, from one indexed join:

```sql
SELECT i.id, i.issue_key, i.title, i.status, i.type, i.priority,
       u.name AS assignee_name, u.avatar_color AS assignee_color
FROM wiki_page_issues l
JOIN issues i ON i.id = l.issue_id
LEFT JOIN users u ON u.id = i.assignee_id
WHERE l.page_id = ?
```

One extra query per page view, indexed, no extra round trip from the client and
no visible pop-in — chips render fully-formed on first paint.

`POST /api/issues/resolve` (body: `{ keys: [...] }`, returns the same summary
shape) is the secondary path for content that is not saved yet: the editor's
live preview and AI-inserted drafts. Capped at 100 keys per request.

Issue summaries are deliberately *not* baked into the stored page body. Doing so
would snapshot issue state into prose, so a page saved in March would show
March's status forever. An embed that silently lies is worse than no embed.

### 4. Read path — reverse (issue → pages)

New `GET /api/issues/:id/pages`:

```sql
SELECT p.id, p.title, p.slug, p.space_id, p.updated_at,
       s.name AS space_name, s.space_key
FROM wiki_page_issues l
JOIN wiki_pages p ON p.id = l.page_id
JOIN wiki_spaces s ON s.id = p.space_id
WHERE l.issue_id = ? AND p.status = 'current'
ORDER BY p.updated_at DESC
```

Results are then filtered through page restrictions. A restricted page must not
appear — its title alone can leak sensitive context (a page named
"ATLAS-29 breach retro" discloses both the page's existence and its subject to
anyone viewing that issue).

### 5. Batched access checks, and the `pageAccess` refactor

`pageAccess(db, pageId, userId, userRole)` in `backend/routes/wiki.js` costs two
queries per page. Filtering an M-page panel with it would cost 2M queries —
reintroducing exactly the N+1 pattern removed in ATLAS-30.

Add `pageAccessBatch(db, pageIds, userId, userRole) → Map<pageId, {view, edit, restricted}>`,
which does it in two queries total:

- `SELECT page_id, user_id, can_edit FROM wiki_page_restrictions WHERE page_id IN (...)`
- `SELECT id, author_id FROM wiki_pages WHERE id IN (...)`

**`pageAccess` is then rewritten to delegate to `pageAccessBatch`.** The
authorization rules must exist in exactly one place. The alternative — a second
implementation of the same rules for the batch case — invites drift, and drifted
authorization logic is a security bug rather than a performance one.

This is the only refactor in scope. It is guarded by a parity test (§7).

The existing rules are preserved exactly:

| Condition | view | edit |
|---|---|---|
| No restriction rows | true | true |
| Page author or admin | true | true |
| Not listed in restrictions | false | false |
| Listed, some row grants edit | true | own `can_edit` |
| Listed, no row grants edit | true | true |

### 6. Frontend

**`rich-text.tsx`**

- `applyMacros(html, issues)` takes a `Map<issueKey, IssueSummary>` and chips
  **only** keys present in that map. This single rule fixes both the false
  positives (`ISO-8601` stays prose) and the unresolved case (a deleted issue's
  key stays prose).
- The chip carries `data-issue-id`, so the click handler navigates directly by
  id. **The search-and-guess fallback at `rich-text.tsx:161` is deleted** — the
  wrong-navigation bug is removed by construction, not patched.
- `RichTextView` gains an optional `issues` prop. When omitted, macros behave as
  today minus chipping (no map ⇒ no chips), so non-wiki callers are unaffected.

**Hover card** — shadcn `HoverCard`, rendering from the already-fetched map. No
fetch on hover. Shows type icon, key, status pill, title, assignee, priority.

**`issue-detail-sheet.tsx`** — a "Mentioned on pages" panel calling
`GET /api/issues/:id/pages`, each row linking to the page. Hidden when empty.

### 7. Integrity and lifecycle

| Event | Handling |
|---|---|
| Issue deleted | `DELETE FROM wiki_page_issues WHERE issue_id = ?` added to the existing cascade in `routes/issues.js` |
| Page deleted | `DELETE FROM wiki_page_issues WHERE page_id = ?` added to the existing cascade in `routes/wiki.js` |
| Page re-saved | Replace-all rebuilds the set |
| Issue key referenced but deleted | No link row ⇒ absent from map ⇒ renders as plain text |
| Page restricted after linking | Row persists; the read-path access filter hides it |

**Backfill.** Existing pages have no rows until re-saved. A one-time script
`backend/scripts/backfill-page-issues.js` walks all current pages, runs the
extractor, and populates the table; it is idempotent and safe to re-run. Demo
seeding calls the extractor directly, so fresh installs start correct without
the script.

### 8. Testing

**Unit — `extractIssueKeys`**
- Extracts keys from prose; dedupes repeats; uppercases.
- Ignores keys inside `<code>`, `<pre>`, and `<a>`.
- Returns `[]` for empty, null, and non-string input.
- Junk that matches the pattern (`COVID-19`) is returned by the extractor but
  produces no row, because resolution finds no issue.

**API**
- Saving a page with keys creates exactly the resolved rows.
- Re-saving with different keys replaces the set (no orphans).
- `GET /api/wiki/pages/:id` returns `linked_issues` with correct summaries.
- `GET /api/issues/:id/pages` returns mentioning pages, newest first.
- **A restricted page is absent for a non-viewer and present for its author.**
  This is the security-critical assertion.
- Deleting an issue removes its rows; deleting a page removes its rows.
- `POST /api/issues/resolve` returns summaries and rejects >100 keys.

**Parity — the refactor guard**
- `pageAccessBatch` agrees with the pre-refactor `pageAccess` across the full
  matrix in §5: unrestricted, author, admin, listed-with-edit, listed-read-only,
  and unlisted.

**Performance**
- The back-link panel's query count stays constant as the number of mentioning
  pages grows, asserted the same way as the ATLAS-30 batching test.

## Known limitation

Issue read access is not project-scoped in Atlas today — `GET /api/issues/:id`
requires authentication only, not project membership. So chip resolution needs
no per-issue visibility filter. If granular RBAC lands later, both
`POST /api/issues/resolve` and the `linked_issues` join must be revisited to
filter by project visibility. Recorded here so that work is not missed.

## Rejected alternatives

**Compute back-links on read.** A `LIKE '%ATLAS-29%'` scan of `wiki_pages` per
issue view. No schema change and always current, but unindexable and a full
table scan on every issue open.

**Explicit links only.** Users attach pages to issues through a picker. Precise,
but ignores the keys already present in page text, so the feature starts empty
and stays empty until manually populated.

**Bake enriched HTML at save time.** Fastest reads, no join — but freezes issue
state into prose, as described in §3.

**Client-side batch resolve as the primary path.** The client scans the DOM and
POSTs the keys it finds. Self-contained and identical in edit preview, but adds
a round trip to every page view and re-derives on each render what the server
already stores. Retained as the *secondary* path only, for unsaved content.
