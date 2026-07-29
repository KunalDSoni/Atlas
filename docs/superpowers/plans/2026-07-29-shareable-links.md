# Shareable Links for Issues and Wiki Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give wiki pages a short shareable key (`SPACE_KEY-WIKI-n`) and a Copy Link button like issues already have, and add Copy Link to the four issue list surfaces (board, backlog, epics, filters) that currently require opening an issue before it can be shared.

**Architecture:** Wiki pages get a per-space `page_number` (mirroring how issue numbers work), exposed as a derived `page_key` by joining `space_key`. A new `GET /api/wiki/pages/by-key/:pageKey` route resolves a key to the same enriched page payload `GET /api/wiki/pages/:id` returns today — both share one extracted helper so the enrichment logic isn't duplicated. The frontend gets a canonical `/wiki/:pageKey` route; the old `/wiki/page/:pageId` route becomes a legacy redirect, the same pattern already used for old issue links. Copy Link becomes a shared `CopyLinkButton` component used by both the issue and wiki call sites, plus four new call sites in the issue list screens.

**Tech Stack:** Express + SQLite/MySQL (via the existing migration runner), React Router, React + TypeScript, Vitest/Jest for tests.

## Global Constraints

- Migrations are append-only: never edit or reorder a shipped migration id. The next free id is `023` (last one used is `022_dashboard_layouts` in `backend/migrations.js`).
- Both a `sqlite` and `mysql` form are required for every schema-changing migration step (Atlas runs sql.js in dev, MySQL in production).
- Key lookups are case-insensitive, matching `issueUrl`'s existing `.toUpperCase()` behavior (spec section "Wiki page keys").
- `frontend/src/lib/urls.ts` and `backend/utils/links.js` are the only two places allowed to spell an app route — every new route helper goes in one of these two files, per the header comments already in both.
- No new right-click context menus or browser-native "copy link" — only an explicit button (spec "Non-goals").

---

## File Structure

- `backend/migrations.js` — new migration `023_wiki_page_numbers`: adds `wiki_pages.page_number`, backfills existing rows per space ordered by `created_at`, adds a unique index on `(space_id, page_number)`.
- `backend/routes/wiki.js` — extract the existing `GET /wiki/pages/:id` handler body into a `getPageDetail(db, req, whereClause, params)` helper; add `GET /wiki/pages/by-key/:pageKey`; assign `page_number` on page creation.
- `backend/utils/links.js` — add `wikiPageLink(pageKey)`.
- `frontend/src/lib/urls.ts` — add `wikiPageUrl(pageKey)` and `isWikiPageKey(segment)`.
- `frontend/src/lib/api.ts` — add `wiki.pageByKey(pageKey)`.
- `frontend/src/lib/types.ts` — add `page_number` and `page_key` to `WikiPage`.
- `frontend/src/components/app/copy-link-button.tsx` — new shared component (extracted from `copy-issue-link.tsx`).
- `frontend/src/components/app/copy-issue-link.tsx` — becomes a thin wrapper over `CopyLinkButton`.
- `frontend/src/screens/wiki-page.tsx` — resolve route param as a key via `pageByKey`, add `CopyLinkButton` to the header, show `WikiPageNotFound` on lookup failure.
- `frontend/src/screens/not-found.tsx` — add `WikiPageNotFound`.
- `frontend/src/components/app/legacy-wiki-redirect.tsx` — new component, same shape as `legacy-redirect.tsx`, for the old `/wiki/page/:pageId` route.
- `frontend/src/App.tsx` — add `/wiki/:pageKey` route; change `/wiki/page/:pageId` to render the legacy redirect.
- `frontend/src/screens/board.tsx`, `backlog.tsx`, `epics.tsx`, `filters.tsx` — add `CopyLinkButton` to each row/card.

---

### Task 1: Wiki page numbering (backend schema + migration)

**Files:**
- Modify: `backend/migrations.js` (append after line 883-ish, following the `022_dashboard_layouts` entry)
- Modify: `backend/database.js:750-767` (fresh-install schema for `wiki_pages` — add `page_number` so new databases don't rely on the migration alone, matching how other numbered columns are already baked into `CREATE TABLE IF NOT EXISTS`)
- Test: `backend/tests/backend/migrations.test.js`

**Interfaces:**
- Produces: `wiki_pages.page_number INTEGER`, unique per `(space_id, page_number)`. Task 2 reads/writes this column.

- [ ] **Step 1: Write the failing migration test**

Add to `backend/tests/backend/migrations.test.js` (open the file first to match its existing test setup — it already has a pattern of running migrations against a fresh in-memory db and asserting columns/indexes exist; follow that exact pattern). Add:

```javascript
test('023_wiki_page_numbers backfills page_number and enforces uniqueness per space', async () => {
  const db = await freshTestDb(); // use whatever helper the existing tests in this file use to get a migrated-from-scratch db
  const spaceId = await createTestWikiSpace(db, 'ATLAS'); // use existing test helpers/conventions in this file; if none exist, insert directly via run(db, ...) matching backend/routes/wiki.js's INSERT INTO wiki_spaces
  const p1 = await insertRawWikiPage(db, spaceId, 'First');
  const p2 = await insertRawWikiPage(db, spaceId, 'Second');

  const rows = await queryAll(db, 'SELECT id, page_number FROM wiki_pages WHERE space_id = ? ORDER BY page_number', [spaceId]);
  expect(rows.map(r => r.id)).toEqual([p1, p2]);
  expect(rows.map(r => r.page_number)).toEqual([1, 2]);
});
```

Read `backend/tests/backend/migrations.test.js` in full before writing this — copy its existing helper names and setup exactly rather than inventing new ones; the pseudocode above names the shape the test needs, not literal helper functions that may not exist yet.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/backend/migrations.test.js -t "023_wiki_page_numbers"`
Expected: FAIL — `page_number` column does not exist yet.

- [ ] **Step 3: Add the migration**

In `backend/migrations.js`, append this object to the `MIGRATIONS` array, after the `022_dashboard_layouts` entry:

```javascript
{
  id: '023_wiki_page_numbers',
  description: 'Per-space sequence number for wiki pages (shareable SPACE-WIKI-n keys)',
  steps: [
    {
      addColumn: {
        table: 'wiki_pages', column: 'page_number',
        sqlite: 'ALTER TABLE wiki_pages ADD COLUMN page_number INTEGER',
        mysql: 'ALTER TABLE wiki_pages ADD COLUMN page_number INT NULL',
      },
    },
    {
      run: async (adapter) => {
        if (!['sqlite', 'mysql'].includes(adapter.driver)) {
          throw new Error(`023: unsupported driver ${adapter.driver}`);
        }
        const rows = await adapter.all(
          'SELECT id, space_id FROM wiki_pages ORDER BY space_id, created_at, id');
        const next = {};
        for (const row of rows) {
          next[row.space_id] = (next[row.space_id] || 0) + 1;
          await adapter.exec('UPDATE wiki_pages SET page_number = ? WHERE id = ?', [next[row.space_id], row.id]);
        }
      },
    },
    {
      sql: {
        sqlite: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_pages_space_number ON wiki_pages(space_id, page_number)',
        mysql: 'CREATE UNIQUE INDEX idx_wiki_pages_space_number ON wiki_pages(space_id, page_number)',
      },
    },
  ],
},
```

- [ ] **Step 4: Add `page_number` to the fresh-install schema**

In `backend/database.js`, find both `CREATE TABLE IF NOT EXISTS wiki_pages` statements (there are two — one per DB driver branch, at line 750 and line 174 per earlier grep). Add `page_number INT,` right after the `position INT DEFAULT 0,` line in both.

- [ ] **Step 5: Run the migration test again**

Run: `cd backend && npx jest tests/backend/migrations.test.js -t "023_wiki_page_numbers"`
Expected: PASS

- [ ] **Step 6: Run the full backend test suite for regressions**

Run: `cd backend && npx jest tests/backend/migrations.test.js tests/backend/wiki.test.js`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add backend/migrations.js backend/database.js backend/tests/backend/migrations.test.js
git commit -m "feat(backend): add per-space page_number to wiki_pages"
```

---

### Task 2: Assign page_number on page creation + expose page_key

**Files:**
- Modify: `backend/routes/wiki.js:201-226` (`POST /wiki/spaces/:spaceId/pages`)
- Modify: `backend/routes/wiki.js:228-280` (`GET /wiki/pages/:id` — extract into a shared helper)
- Test: `backend/tests/backend/wiki.test.js`

**Interfaces:**
- Consumes: `wiki_pages.page_number` from Task 1.
- Produces: every wiki page API response that already includes `space_key` (page create, page get, page list, recent, starred, search) now also includes `page_number`. `getPageDetail(db, req, whereClause, params)` — an internal helper, not exported — returns `{ status, body }` where `status` is the HTTP status to send and `body` is the JSON payload (so both the by-id and by-key routes in Task 3 can send it directly). Task 3 depends on this exact signature.

- [ ] **Step 1: Write the failing test for page_number assignment**

Add to `backend/tests/backend/wiki.test.js` (match its existing request-agent/auth-token setup exactly — read the top of the file first):

```javascript
test('creating pages assigns an increasing page_number per space', async () => {
  const space = await createSpace(agent, token, { name: 'Docs', space_key: 'DOCS' }); // use this file's existing space-creation helper
  const p1 = await createPage(agent, token, space.id, { title: 'One' });
  const p2 = await createPage(agent, token, space.id, { title: 'Two' });
  expect(p1.page_number).toBe(1);
  expect(p2.page_number).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/backend/wiki.test.js -t "increasing page_number"`
Expected: FAIL — `page_number` is `undefined` on the response.

- [ ] **Step 3: Assign page_number on create**

In `backend/routes/wiki.js`, inside `router.post('/wiki/spaces/:spaceId/pages', ...)` (around line 210-214), change:

```javascript
    const id = uuidv4();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const maxPos = await queryOne(db, 'SELECT COALESCE(MAX(position),0)+1 as p FROM wiki_pages WHERE space_id = ? AND parent_id IS ?', [req.params.spaceId, parent_id || null]);
    await run(db, `INSERT INTO wiki_pages (id, space_id, parent_id, title, slug, body, body_format, author_id, last_editor_id, position, page_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.params.spaceId, parent_id || null, title, slug, body || '', body_format || 'html', req.userId, req.userId, maxPos.p, pageType]);
```

to:

```javascript
    const id = uuidv4();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const maxPos = await queryOne(db, 'SELECT COALESCE(MAX(position),0)+1 as p FROM wiki_pages WHERE space_id = ? AND parent_id IS ?', [req.params.spaceId, parent_id || null]);
    const maxNum = await queryOne(db, 'SELECT COALESCE(MAX(page_number),0)+1 as n FROM wiki_pages WHERE space_id = ?', [req.params.spaceId]);
    await run(db, `INSERT INTO wiki_pages (id, space_id, parent_id, title, slug, body, body_format, author_id, last_editor_id, position, page_type, page_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.params.spaceId, parent_id || null, title, slug, body || '', body_format || 'html', req.userId, req.userId, maxPos.p, pageType, maxNum.n]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/backend/wiki.test.js -t "increasing page_number"`
Expected: PASS

- [ ] **Step 5: Write the failing test for `page_key` on page detail**

Add to `backend/tests/backend/wiki.test.js`:

```javascript
test('GET /api/wiki/pages/:id includes page_key derived from space_key and page_number', async () => {
  const space = await createSpace(agent, token, { name: 'Docs', space_key: 'DOCS' });
  const page = await createPage(agent, token, space.id, { title: 'One' });
  const res = await agent.get(`/api/wiki/pages/${page.id}`).set('Authorization', `Bearer ${token}`);
  expect(res.body.page_key).toBe('DOCS-WIKI-1');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npx jest tests/backend/wiki.test.js -t "page_key derived"`
Expected: FAIL — `page_key` is `undefined`.

- [ ] **Step 7: Extract `getPageDetail` and add `page_key`**

In `backend/routes/wiki.js`, replace the entire body of `router.get('/wiki/pages/:id', requireAuth, async (req, res) => { ... })` (lines 228-280) with an extracted helper plus a thin route, so Task 3's by-key route can reuse it:

```javascript
/**
 * Full enrichment for one page: access check, view count, labels, breadcrumb,
 * children, approval, tasks, linked issues, image re-signing. `whereClause`
 * and `params` select the row (by id in one caller, by key in another) —
 * everything after that row lookup is identical between the two callers.
 */
async function getPageDetail(db, req, whereClause, params) {
  const page = await queryOne(db, `
    SELECT p.*, s.name as space_name, s.space_key, s.icon as space_icon, s.id as space_id,
      u.name as author_name, u.avatar_color as author_color,
      e.name as editor_name, e.avatar_color as editor_color,
      (SELECT COUNT(*) FROM wiki_page_likes WHERE page_id = p.id) as like_count,
      EXISTS(SELECT 1 FROM wiki_page_likes WHERE page_id = p.id AND user_id = ?) as liked,
      EXISTS(SELECT 1 FROM wiki_stars WHERE page_id = p.id AND user_id = ?) as starred
    FROM wiki_pages p
    JOIN wiki_spaces s ON p.space_id = s.id
    LEFT JOIN users u ON p.author_id = u.id
    LEFT JOIN users e ON p.last_editor_id = e.id
    WHERE ${whereClause}
  `, [req.userId, req.userId, ...params]);
  if (!page) return { status: 404, body: { error: 'Page not found' } };
  const access = await pageAccess(db, page.id, req.userId, req.userRole);
  if (!access.view) return { status: 403, body: { error: 'This page is restricted' } };
  page.restricted = access.restricted ? 1 : 0;
  page.can_edit_page = access.edit ? 1 : 0;
  page.page_key = `${page.space_key}-WIKI-${page.page_number}`;
  // Increment view
  await run(db, 'UPDATE wiki_pages SET view_count = view_count + 1 WHERE id = ?', [page.id]);
  // Labels
  page.labels = (await queryAll(db, 'SELECT label FROM wiki_labels WHERE page_id = ?', [page.id])).map(l => l.label);
  // Breadcrumb
  const breadcrumb = [];
  let current = page;
  while (current.parent_id) {
    const parent = await queryOne(db, 'SELECT id, title, parent_id FROM wiki_pages WHERE id = ?', [current.parent_id]);
    if (!parent) break;
    breadcrumb.unshift({ id: parent.id, title: parent.title });
    current = parent;
  }
  page.breadcrumb = breadcrumb;
  // Children
  page.children = await queryAll(db, "SELECT id, title, slug, status FROM wiki_pages WHERE parent_id = ? AND status = 'current' ORDER BY position, title", [page.id]);
  page.approval = await pageApproval(db, page);
  page.tasks = await pageTasks(db, page);
  // Issues this page mentions, resolved at write time (see utils/issue-keys.js).
  // Returned inline so chips render on first paint with no extra round trip.
  page.linked_issues = await queryAll(db, `
    SELECT i.id, i.issue_key, i.title, i.status, i.type, i.priority,
           u.name AS assignee_name, u.avatar_color AS assignee_color
    FROM wiki_page_issues l
    JOIN issues i ON i.id = l.issue_id
    LEFT JOIN users u ON u.id = i.assignee_id
    WHERE l.page_id = ?`, [page.id]);
  // Re-sign inline wiki images so the browser can load them for this session.
  page.body = signWikiImages(page.body);
  return { status: 200, body: page };
}

router.get('/wiki/pages/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { status, body } = await getPageDetail(db, req, 'p.id = ?', [req.params.id]);
    res.status(status).json(body);
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && npx jest tests/backend/wiki.test.js`
Expected: all PASS, including the new `page_key` test.

- [ ] **Step 9: Commit**

```bash
git add backend/routes/wiki.js backend/tests/backend/wiki.test.js
git commit -m "feat(backend): assign page_number on create, derive page_key, extract getPageDetail"
```

---

### Task 3: `GET /wiki/pages/by-key/:pageKey` route

**Files:**
- Modify: `backend/routes/wiki.js` (add route near the existing `GET /wiki/pages/:id`, after Task 2's extraction)
- Test: `backend/tests/backend/wiki.test.js`

**Interfaces:**
- Consumes: `getPageDetail(db, req, whereClause, params)` from Task 2.
- Produces: `GET /api/wiki/pages/by-key/:pageKey` → same JSON shape as `GET /api/wiki/pages/:id`, including `page_key`. Case-insensitive. Task 4 (frontend) calls this via `api.wiki.pageByKey`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/backend/wiki.test.js`:

```javascript
test('GET /api/wiki/pages/by-key/:pageKey resolves case-insensitively', async () => {
  const space = await createSpace(agent, token, { name: 'Docs', space_key: 'DOCS' });
  const page = await createPage(agent, token, space.id, { title: 'One' });
  const res = await agent.get('/api/wiki/pages/by-key/docs-wiki-1').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.id).toBe(page.id);
  expect(res.body.page_key).toBe('DOCS-WIKI-1');
});

test('GET /api/wiki/pages/by-key/:pageKey 404s for an unknown key', async () => {
  const res = await agent.get('/api/wiki/pages/by-key/NOPE-WIKI-99').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/backend/wiki.test.js -t "by-key"`
Expected: FAIL — 404 (route not found)/route mismatch since `by-key` will otherwise be parsed as an `:id`.

- [ ] **Step 3: Add the route**

In `backend/routes/wiki.js`, add this immediately **before** `router.get('/wiki/pages/:id', ...)` (route order matters — Express matches `/wiki/pages/by-key/:pageKey` only if it is declared before the more general `/wiki/pages/:id`, otherwise `:id` would greedily match the literal segment `by-key` first... actually `:id` matches one segment so `/wiki/pages/by-key/docs-wiki-1` has two segments after `/pages/` and would not match `/wiki/pages/:id` at all; still declare `by-key` first for clarity and to match the `issues.js` precedent at `backend/routes/issues.js:343`, which declares `/issues/by-key/:key` before `/issues/:id`):

```javascript
// GET /api/wiki/pages/by-key/:pageKey — resolve a human-readable key
// (DOCS-WIKI-1), the wiki mirror of GET /api/issues/by-key/:key.
router.get('/wiki/pages/by-key/:pageKey', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const key = String(req.params.pageKey).toUpperCase();
    const cut = key.lastIndexOf('-WIKI-');
    if (cut < 0) return res.status(404).json({ error: 'Page not found' });
    const spaceKey = key.slice(0, cut);
    const pageNumber = Number(key.slice(cut + '-WIKI-'.length));
    if (!Number.isInteger(pageNumber)) return res.status(404).json({ error: 'Page not found' });
    const { status, body } = await getPageDetail(
      db, req,
      'UPPER(s.space_key) = ? AND p.page_number = ?',
      [spaceKey, pageNumber]);
    res.status(status).json(body);
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest tests/backend/wiki.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/wiki.js backend/tests/backend/wiki.test.js
git commit -m "feat(backend): add GET /wiki/pages/by-key/:pageKey"
```

---

### Task 4: `backend/utils/links.js` wiki link helper

**Files:**
- Modify: `backend/utils/links.js`
- Test: create `backend/tests/backend/links.test.js` if no such test file exists yet (check first — search for existing tests of `issueLink` before creating a new file)

**Interfaces:**
- Produces: `wikiPageLink(pageKey)` → `/{space-key-lowercased}/wiki/{PAGE_KEY}`... **do not use this path shape** — see Step 3 note. Produces the exact path `wikiPageUrl` in Task 5 will also produce, so the two must be kept identical (this is the same constraint the file's own top comment already states about `issueLink`/`issueUrl`).

- [ ] **Step 1: Check for an existing links test**

Run: `grep -rn "issueLink" backend/tests/`

If a test file exists, add to it. If not, create `backend/tests/backend/links.test.js`.

- [ ] **Step 2: Write the failing test**

```javascript
const { issueLink, wikiPageLink } = require('../../utils/links');

test('wikiPageLink builds a canonical wiki page path', () => {
  expect(wikiPageLink('DOCS-WIKI-12')).toBe('/wiki/DOCS-WIKI-12');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest tests/backend/links.test.js`
Expected: FAIL — `wikiPageLink` is not exported.

- [ ] **Step 4: Implement**

In `backend/utils/links.js`, add below `issueLink`:

```javascript
/**
 * Permanent path for a wiki page: DOCS-WIKI-12 -> /wiki/DOCS-WIKI-12.
 * Unlike issues, wiki pages are not scoped under a project-key path segment —
 * mirrors frontend/src/lib/urls.ts's wikiPageUrl, which must stay in step.
 */
function wikiPageLink(pageKey) {
  return `/wiki/${String(pageKey).toUpperCase()}`;
}

module.exports = { issueLink, wikiPageLink };
```

(Replace the existing `module.exports = { issueLink };` line rather than adding a second `module.exports`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/backend/links.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/utils/links.js backend/tests/backend/links.test.js
git commit -m "feat(backend): add wikiPageLink helper"
```

---

### Task 5: Frontend URL helpers + types

**Files:**
- Modify: `frontend/src/lib/urls.ts`
- Modify: `frontend/src/lib/types.ts:477-513` (`WikiPage` interface)
- Test: create/extend `frontend/src/lib/urls.test.ts` (check if it exists first: `find frontend/src/lib -name "urls.test.ts"`)

**Interfaces:**
- Produces: `wikiPageUrl(pageKey: string): string` → `/wiki/{PAGE_KEY}` (uppercased). `isWikiPageKey(segment: string): boolean`. Task 7 and Task 6 consume both.
- Produces: `WikiPage.page_number: number` and `WikiPage.page_key: string`.

- [ ] **Step 1: Check for an existing urls test file**

Run: `find frontend/src/lib -name "urls.test.ts"`. If it exists, read it fully first to match its style before adding to it.

- [ ] **Step 2: Write the failing test**

```typescript
import { isWikiPageKey, wikiPageUrl } from './urls';

test('wikiPageUrl builds the canonical path, uppercased', () => {
  expect(wikiPageUrl('docs-wiki-12')).toBe('/wiki/DOCS-WIKI-12');
});

test('isWikiPageKey recognizes the SPACE-WIKI-n shape only', () => {
  expect(isWikiPageKey('DOCS-WIKI-12')).toBe(true);
  expect(isWikiPageKey('docs-wiki-12')).toBe(true);
  expect(isWikiPageKey('space')).toBe(false);
  expect(isWikiPageKey('ATLAS-3')).toBe(false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/urls.test.ts` (use whichever test runner the existing `urls.test.ts` — or the project's `package.json` `test` script — actually uses; check `frontend/package.json` first if unsure)
Expected: FAIL — `wikiPageUrl`/`isWikiPageKey` not exported.

- [ ] **Step 4: Implement**

In `frontend/src/lib/urls.ts`, add near `ISSUE_KEY`:

```typescript
/** DOCS-WIKI-12. Distinct from ISSUE_KEY so a wiki key can never be mistaken
 * for an issue key even when a space shares its key with a project. */
const WIKI_PAGE_KEY = /^[A-Za-z][A-Za-z0-9]*-WIKI-\d+$/i;

export function isWikiPageKey(segment: string): boolean {
  return WIKI_PAGE_KEY.test(segment);
}
```

And near `issueUrl`:

```typescript
/**
 * Permanent path for a wiki page. Unlike issues, wiki pages are not scoped
 * under a project-key path segment.
 * backend/utils/links.js mirrors this for notification links.
 */
export function wikiPageUrl(pageKey: string): string {
  return `/wiki/${pageKey.toUpperCase()}`;
}
```

In `frontend/src/lib/types.ts`, in the `WikiPage` interface, add after `page_type?: 'page' | 'blog' | string;`:

```typescript
  page_number?: number;
  /** Derived server-side: `${space_key}-WIKI-${page_number}`. */
  page_key?: string;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/urls.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/urls.ts frontend/src/lib/types.ts frontend/src/lib/urls.test.ts
git commit -m "feat(frontend): add wikiPageUrl/isWikiPageKey and WikiPage.page_key"
```

---

### Task 6: Shared `CopyLinkButton` component

**Files:**
- Create: `frontend/src/components/app/copy-link-button.tsx`
- Modify: `frontend/src/components/app/copy-issue-link.tsx` (becomes a thin wrapper)
- Test: `frontend/src/components/app/copy-link-button.test.tsx` (check if `copy-issue-link` already has a test file to model this on: `find frontend/src -name "copy-issue-link.test*"`)

**Interfaces:**
- Produces: `CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string })`. Tasks 7, 8, and 9 all consume this exact signature.
- Produces: `CopyIssueLink({ issueKey }: { issueKey: string })` — unchanged public signature, now implemented via `CopyLinkButton`.

- [ ] **Step 1: Check for an existing test to model**

Run: `find frontend/src -iname "*copy-issue-link*"`. Read any existing test file in full to copy its clipboard-mocking approach exactly.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/app/copy-link-button.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopyLinkButton } from './copy-link-button';

test('copies the given url and shows a success toast', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(<CopyLinkButton url="https://app.example.com/wiki/DOCS-WIKI-1" />);
  fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.example.com/wiki/DOCS-WIKI-1'));
});

test('falls back to showing the url when clipboard write fails', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('denied'));
  Object.assign(navigator, { clipboard: { writeText } });

  render(<CopyLinkButton url="https://app.example.com/wiki/DOCS-WIKI-1" />);
  fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalled());
});
```

Adjust imports (`vi` vs `jest.fn`) to match whatever the codebase's existing frontend tests actually use — check any existing `.test.tsx` file under `frontend/src/components` for the real import style before finalizing this step.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/app/copy-link-button.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `CopyLinkButton`**

Create `frontend/src/components/app/copy-link-button.tsx`:

```typescript
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** The point of the whole scheme: a link you can paste into Slack. */
export function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', { description: url });
    } catch {
      // Clipboard access is denied outside a secure context — show the URL so
      // it can still be copied by hand rather than failing silently.
      toast.error('Could not copy', { description: url });
    }
  }

  return (
    <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={copy} aria-label={label}>
      <Link2 className="size-3.5" /> {label}
    </Button>
  );
}
```

Note the added `e.stopPropagation()` — Task 8/9 place this button inside clickable rows/cards, so a click on the button must not also trigger the row's own `onClick` navigation. This is a deliberate behavior change from the original `copy-issue-link.tsx`, which never needed it because it wasn't nested inside a clickable container.

- [ ] **Step 5: Rewrite `CopyIssueLink` as a wrapper**

Replace the full contents of `frontend/src/components/app/copy-issue-link.tsx`:

```typescript
import { absoluteUrl, issueUrl } from '@/lib/urls';
import { CopyLinkButton } from './copy-link-button';

export function CopyIssueLink({ issueKey }: { issueKey: string }) {
  return <CopyLinkButton url={absoluteUrl(issueUrl(issueKey))} />;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/app/copy-link-button.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full frontend test suite for regressions**

Run: `cd frontend && npx vitest run`
Expected: all PASS (confirms `issue.tsx` and `issue-detail-sheet.tsx`, which import `CopyIssueLink`, still work unchanged)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/app/copy-link-button.tsx frontend/src/components/app/copy-issue-link.tsx frontend/src/components/app/copy-link-button.test.tsx
git commit -m "refactor(frontend): extract shared CopyLinkButton from CopyIssueLink"
```

---

### Task 7: Wiki page canonical URL, Copy Link, and not-found handling

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `wiki.pageByKey`)
- Modify: `frontend/src/screens/wiki-page.tsx`
- Modify: `frontend/src/screens/not-found.tsx` (add `WikiPageNotFound`)
- Create: `frontend/src/components/app/legacy-wiki-redirect.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api.wiki.pageByKey(pageKey)` (new), `wikiPageUrl` and `isWikiPageKey` from Task 5, `CopyLinkButton` from Task 6.
- Produces: canonical route `/wiki/:pageKey`; `/wiki/page/:pageId` now redirects to it.

- [ ] **Step 1: Add `api.wiki.pageByKey`**

In `frontend/src/lib/api.ts`, in the `wiki` object, add next to the existing `page: (id: string) => ...` line:

```typescript
    pageByKey: (pageKey: string) => get<WikiPage>(`/wiki/pages/by-key/${encodeURIComponent(pageKey)}`),
```

- [ ] **Step 2: Add `WikiPageNotFound`**

In `frontend/src/screens/not-found.tsx`, add after `IssueNotFound`:

```typescript
export function WikiPageNotFound({ pageKey }: { pageKey: string }) {
  return (
    <Shell
      title="Page not found"
      detail={`${pageKey} does not exist, or you do not have access to it.`}
    >
      <Button asChild variant="outline">
        <Link to="/wiki">Back to wiki</Link>
      </Button>
    </Shell>
  );
}
```

- [ ] **Step 3: Switch `WikiPageScreen` to resolve by key**

In `frontend/src/screens/wiki-page.tsx`:

- Change the import line `import { Link, useNavigate, useParams } from 'react-router-dom';` — no change needed to this line itself.
- Add imports: `import { WikiPageNotFound } from '@/screens/not-found';` and `import { absoluteUrl, wikiPageUrl } from '@/lib/urls';` and `import { CopyLinkButton } from '@/components/app/copy-link-button';`.
- Change line 77 from `const { pageId = '' } = useParams();` to `const { pageKey = '' } = useParams();` and add `const [missing, setMissing] = useState(false);` next to the other `useState` declarations.
- Change the `load` callback (lines 108-132) from:

```javascript
  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.wiki.page(pageId);
```

to:

```javascript
  const load = useCallback(async () => {
    if (!pageKey) return;
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const p = await api.wiki.pageByKey(pageKey);
```

and change the dependency array at the end of `load` from `[pageId]` to `[pageKey]`, and the `useEffect` at line 134-138 dependency stays `[load]` (unchanged).

- Everywhere else in the file that currently reads `pageId` directly (only the two call sites already found: `RichTextEditor value={draftBody} onChange={setDraftBody} pageId={page.id}` at line 547 and `VersionHistory pageId={page.id}` at line 694) — **no change needed**, since both already use `page.id`, not the route param.
- In the `catch` block of `load`, add a check that sets `missing` on a 404 specifically. Find:

```javascript
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load page');
    } finally {
```

Change to:

```javascript
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 404) setMissing(true);
      else setError(e instanceof Error ? e.message : 'Failed to load page');
    } finally {
```

(Check `frontend/src/lib/api.ts`'s error-throwing shape first — confirm whatever error class the `get<T>()` helper throws actually carries a `status` field before writing this; if it uses a different field name, e.g. `statusCode`, use that instead.)

- Near the top of the component's render (find where `error` is currently checked and rendered — read the file's render section around where `loading`/`error` gate the UI before `page` is used), add a `missing` check that renders `<WikiPageNotFound pageKey={pageKey} />` before the existing error/loading UI.
- In the page header, next to the existing title/actions (find the header `<div>` containing the page title, likely near where `page.title` and action buttons like Like/Star/Export are rendered), add:

```jsx
<CopyLinkButton url={absoluteUrl(wikiPageUrl(page.page_key ?? ''))} />
```

- [ ] **Step 4: Create the legacy redirect for `/wiki/page/:pageId`**

Create `frontend/src/components/app/legacy-wiki-redirect.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { wikiPageUrl } from '@/lib/urls';

/**
 * The pre-key wiki path: /wiki/page/<uuid>. Old bookmarks, comment links, and
 * notification rows written before this change still hold this shape and
 * must resolve forever — same reasoning as LegacyProjectRedirect for issues.
 */
export function LegacyWikiPageRedirect() {
  const { pageId = '' } = useParams();
  const [path, setPath] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!pageId) { setMissing(true); return; }
    let live = true;
    api.wiki.page(pageId)
      .then((page) => { if (live && page.page_key) setPath(wikiPageUrl(page.page_key)); else if (live) setMissing(true); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [pageId]);

  if (missing) return <Navigate to="/wiki" replace />;
  if (path) return <Navigate to={path} replace />;
  return (
    <div className="grid h-64 place-items-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}
```

- [ ] **Step 5: Wire up the routes**

In `frontend/src/App.tsx`:
- Add import: `import { LegacyWikiPageRedirect } from '@/components/app/legacy-wiki-redirect';`
- Change line 106 from `<Route path="/wiki/page/:pageId" element={<WikiPage />} />` to `<Route path="/wiki/page/:pageId" element={<LegacyWikiPageRedirect />} />`
- Add a new line directly after it: `<Route path="/wiki/:pageKey" element={<WikiPage />} />`

- [ ] **Step 6: Update every internal link that currently points at `/wiki/page/:id`**

Run: `grep -rn "wiki/page/" frontend/src` — for every call site found (this plan expects at least the notification link built at `backend/routes/wiki.js:317` — that one is backend, not frontend, and is handled in Step 7 below — plus any frontend `Link to={`/wiki/page/${...}`}}` usages), change it to build the URL via `wikiPageUrl(page.page_key)` instead, importing `wikiPageUrl` from `@/lib/urls` where not already imported. If a call site only has a page id in scope and not a `page_key`, leave it pointed at `/wiki/page/:id` — the legacy redirect from Step 4 makes that still work correctly, it's just one extra hop.

- [ ] **Step 7: Update the backend notification link builder**

In `backend/routes/wiki.js`, find the watcher-notification block inside `PUT /wiki/pages/:id` (around line 308-320):

```javascript
        await notify(db, {
          userId: w.user_id, actorId: req.userId, type: 'wiki_update',
          message: `${actor?.name || 'Someone'} updated "${title || page.title}"`,
          link: `/wiki/page/${req.params.id}`, wikiPageId: req.params.id,
        });
```

Change `link: `/wiki/page/${req.params.id}`,` to use the new helper so new notifications carry the canonical link directly:

```javascript
        await notify(db, {
          userId: w.user_id, actorId: req.userId, type: 'wiki_update',
          message: `${actor?.name || 'Someone'} updated "${title || page.title}"`,
          link: wikiPageLink(`${page.space_key || (await queryOne(db, 'SELECT space_key FROM wiki_spaces WHERE id = ?', [page.space_id])).space_key}-WIKI-${page.page_number}`),
          wikiPageId: req.params.id,
        });
```

Add `const { wikiPageLink } = require('../utils/links');` to the top of `backend/routes/wiki.js` alongside the other `require`s. (`page` here is the row fetched at the top of the `PUT` handler via `SELECT * FROM wiki_pages WHERE id = ?`, which does not join `space_key` — the inline subquery above compensates; if this reads awkwardly when actually writing the code, fetch `space_key` once at the top of the handler alongside the existing `page` query instead, e.g. change that query to a join, and reference `page.space_key` directly. Either is acceptable; prefer whichever keeps the diff smaller.)

- [ ] **Step 8: Manually verify in the browser**

Run the dev server (check `frontend/package.json` / root README for the exact command — likely `npm run dev` in `frontend/`), then:
- Open a wiki page, confirm the URL bar shows `/wiki/SPACE-WIKI-n`.
- Click Copy Link, confirm a toast appears and the clipboard holds an absolute URL.
- Paste that URL directly into the browser address bar in a fresh tab, confirm the same page loads.
- Visit an old `/wiki/page/<uuid>` URL (grab a uuid from the network tab or the database), confirm it redirects to the canonical URL.
- Visit `/wiki/NOPE-WIKI-999`, confirm `WikiPageNotFound` renders instead of a blank/crashed page.

- [ ] **Step 9: Run the full frontend and backend test suites**

Run: `cd frontend && npx vitest run && cd ../backend && npx jest`
Expected: all PASS

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/screens/wiki-page.tsx frontend/src/screens/not-found.tsx frontend/src/components/app/legacy-wiki-redirect.tsx frontend/src/App.tsx backend/routes/wiki.js
git commit -m "feat: canonical /wiki/:pageKey URL with Copy Link and legacy redirect"
```

---

### Task 8: Copy Link on board cards and backlog rows

**Files:**
- Modify: `frontend/src/screens/board.tsx`
- Modify: `frontend/src/screens/backlog.tsx`
- Test: check for existing screen tests first (`find frontend/src/screens -iname "board.test*" -o -iname "backlog.test*"`); extend if present, otherwise a manual browser check (Step 5 below) is the verification for this task since these two files have no existing unit test scaffold to extend without inventing new infrastructure — do not create new test infrastructure beyond what Task 6 already proved works, to keep this task's diff focused. If a test file *does* already exist for either screen, add a test asserting the Copy Link button renders with the right `aria-label` and calls `navigator.clipboard.writeText` with the issue's URL, following the exact pattern from Task 6 Step 2.

**Interfaces:**
- Consumes: `CopyLinkButton` (Task 6), `absoluteUrl`/`issueUrl` (existing, from `@/lib/urls`).

- [ ] **Step 1: Add Copy Link to board cards**

In `frontend/src/screens/board.tsx`:
- Add import: `import { CopyLinkButton } from '@/components/app/copy-link-button';` and `import { absoluteUrl } from '@/lib/urls';` (note `issueUrl` is already imported at line 3).
- In the `IssueCard` component, the row at line 106-124 (`<div className="flex items-center gap-1.5">...`) currently ends with the assignee avatar. Change the closing of that row so the Copy Link button appears only on hover, using the same `group` class the outer `<article>` already declares (line 71: `'group relative cursor-pointer ...'`). Add, right before the assignee avatar block (before line 117's `{issue.assignee_name ? (`):

```jsx
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          <CopyLinkButton url={absoluteUrl(issueUrl(issue.issue_key))} label={`Copy link to ${issue.issue_key}`} />
        </span>
```

The `article`'s existing `onClick={onOpen}` navigates on any click inside it; `CopyLinkButton`'s own `e.stopPropagation()` (added in Task 6) prevents that button's click from also triggering `onOpen`.

- [ ] **Step 2: Convert backlog rows from `<button>` to a `div[role=button]` so the Copy Link button can nest inside**

In `frontend/src/screens/backlog.tsx`, the row at lines 328-358 is a `<button onClick={() => openIssue(issue.issue_key)} ...>` wrapping all row content — a `<button>` cannot contain another interactive `<button>` (invalid HTML, and `CopyLinkButton` renders one). Change it to the same `role="button"` pattern `board.tsx`'s `<article>` already uses:

Change:
```jsx
                <button
                  onClick={() => openIssue(issue.issue_key)}
                  className={cn('flex w-full items-center gap-3 px-4 text-left transition-colors hover:bg-muted/60', compact ? 'py-1.5' : 'py-2.5')}
                >
```
to:
```jsx
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openIssue(issue.issue_key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIssue(issue.issue_key); } }}
                  className={cn('group flex w-full cursor-pointer items-center gap-3 px-4 text-left transition-colors hover:bg-muted/60', compact ? 'py-1.5' : 'py-2.5')}
                >
```
and change the row's closing `</button>` (line 358) to `</div>`.

- [ ] **Step 3: Add the Copy Link button to the backlog row**

Add imports as in Step 1. Inside the row, right before the assignee avatar block (before line 353's `{issue.assignee_name ? (`), add:

```jsx
                  <span className="opacity-0 transition-opacity group-hover:opacity-100">
                    <CopyLinkButton url={absoluteUrl(issueUrl(issue.issue_key))} label={`Copy link to ${issue.issue_key}`} />
                  </span>
```

(Confirm `issueUrl` is already imported in `backlog.tsx` — check its import list; if not, add it.)

- [ ] **Step 4: TypeScript and lint check**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/screens/board.tsx src/screens/backlog.tsx`
Expected: no errors (in particular, confirm the `div[role=button]` change didn't break any existing type expecting a `HTMLButtonElement` ref elsewhere in the file — search for `useRef<HTMLButtonElement`  in `backlog.tsx` first).

- [ ] **Step 5: Manually verify in the browser**

Run the dev server, open the board — hover a card, confirm a Copy Link icon fades in near the assignee avatar and clicking it copies the link without opening the card. Open the backlog — same check on a row, and confirm clicking anywhere else on the row (not the button) still opens the issue, and keyboard Enter/Space on a focused row still opens it too.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/board.tsx frontend/src/screens/backlog.tsx
git commit -m "feat(frontend): add Copy Link to board cards and backlog rows"
```

---

### Task 9: Copy Link on epics list and filters/search results

**Files:**
- Modify: `frontend/src/screens/epics.tsx`
- Modify: `frontend/src/screens/filters.tsx`

**Interfaces:**
- Consumes: `CopyLinkButton` (Task 6), `absoluteUrl`/`issueUrl` (existing).

- [ ] **Step 1: Convert the epics row from `<button>` to `div[role=button]`**

In `frontend/src/screens/epics.tsx`, `EpicRow` (lines 20-51) has the same nested-button problem as backlog. Change:

```jsx
    <button
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/60"
    >
```
to:
```jsx
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="group flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/60"
    >
```
and change the closing `</button>` (line 50) to `</div>`.

- [ ] **Step 2: Add the Copy Link button**

Add imports `import { CopyLinkButton } from '@/components/app/copy-link-button';` and `import { absoluteUrl, issueUrl } from '@/lib/urls';` (check whether `issueUrl` is already imported in this file — `epics.tsx` calls `issueUrl` via `openIssue` in the parent, confirm the import exists at file scope, not just inside the parent component, since `EpicRow` needs it too).

Inside `EpicRow`, right before the assignee avatar block (before line 44's `{epic.assignee_name ? (`), add:

```jsx
      <span className="opacity-0 transition-opacity group-hover:opacity-100">
        <CopyLinkButton url={absoluteUrl(issueUrl(epic.issue_key))} label={`Copy link to ${epic.issue_key}`} />
      </span>
```

- [ ] **Step 3: Add a Copy Link column to the filters results table**

In `frontend/src/screens/filters.tsx`, add imports as in Step 2. In the table header (around the `<thead>` block preceding line 367), add a new column header after the existing headers:

```jsx
                        <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground"><span className="sr-only">Actions</span></th>
```

In the `<tbody>` row (the `<tr key={issue.id} ...>` block, around lines 365-373), add a new `<td>` at the end of the row's existing cells:

```jsx
                          <td className="whitespace-nowrap px-3 py-2">
                            <CopyLinkButton url={absoluteUrl(issueUrl(issue.issue_key))} label={`Copy link to ${issue.issue_key}`} />
                          </td>
```

(Read the full `<tr>` block in `filters.tsx` before editing — the earlier `grep`/`sed` output only showed the first few cells; add the new `<td>` after the last existing one, matching the existing `<th>`/`<td>` count exactly so the table stays aligned.)

- [ ] **Step 4: TypeScript and lint check**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/screens/epics.tsx src/screens/filters.tsx`
Expected: no errors.

- [ ] **Step 5: Manually verify in the browser**

Open the epics list — hover a row, confirm Copy Link appears and works without opening the epic; keyboard Enter/Space still opens it. Open filters, run a search, confirm every result row has a working Copy Link button in its own column.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/epics.tsx frontend/src/screens/filters.tsx
git commit -m "feat(frontend): add Copy Link to epics list and filters results"
```

---

### Task 10: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npx jest`
Expected: all PASS

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all PASS

- [ ] **Step 3: Run frontend typecheck and lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src`
Expected: no errors

- [ ] **Step 4: Manual end-to-end walkthrough**

Using the running dev servers: create a wiki page, copy its link from the page header, open that link in a private/incognito-equivalent second session (or log out and back in as a different user without space access, if a restricted space exists) to confirm the access-denied path renders sensibly; copy an issue link from each of board, backlog, epics, and filters and confirm all four resolve to the same issue when pasted into a fresh tab.

- [ ] **Step 5: No commit for this task** — it is verification only. If any step fails, return to the relevant earlier task, fix, and re-commit there.
