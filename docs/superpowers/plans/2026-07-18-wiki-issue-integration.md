# Wiki ↔ Issue Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wiki issue-key chips live (real title/status/assignee on hover, always correct navigation) and add the page→issue back-link half that does not exist today.

**Architecture:** A `wiki_page_issues` join table is populated at page-save time by extracting issue keys from the sanitized body and resolving them to issue ids. The forward direction (page → issues) is returned inline on `GET /api/wiki/pages/:id`, so chips render on first paint with no extra round trip. The reverse direction (issue → pages) is a new endpoint filtered through batched page-restriction checks. Chips are built client-side after sanitizing, from `textContent` — the HTML sanitizer is not modified.

**Tech Stack:** Node.js + Express 5, sql.js (dev) / MySQL (prod), Jest + Supertest, React 18 + TypeScript, Radix UI (`radix-ui` unified package), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-18-wiki-issue-integration-design.md`

## Global Constraints

- Run all backend commands from `backend/`. Test command: `npx jest <path> --runInBand --forceExit`.
- Every new migration goes in `backend/migrations.js` as an **append-only** entry. Never edit or reorder a shipped migration id.
- Every migration declares **both** a `sqlite` and a `mysql` form.
- Use `placeholders()` from `backend/utils/sql.js` for all `IN (...)` clauses. Never interpolate values into SQL.
- Do **not** modify `backend/utils/sanitize.js` or `PURIFY_CONFIG` in `frontend/src/components/app/rich-text.tsx`. Chips are constructed after sanitizing, from `textContent`.
- Batched reads only. No per-row queries in list paths (see ATLAS-30 precedent).
- `ATLAS-NN` in commits refers to the roadmap **epic ordinal**, not the seeded issue key.
- Commit after every task. Never commit with failing tests.

---

### Task 1: Issue-key extraction utility

**Files:**
- Create: `backend/utils/issue-keys.js`
- Test: `backend/tests/backend/issue-keys.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractIssueKeys(html: string) → string[]` — deduped uppercase issue keys found in page HTML, excluding those inside `<code>`, `<pre>`, and `<a>` elements. Returns `[]` for empty/non-string input.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/issue-keys.test.js`:

```js
const { extractIssueKeys } = require('../../utils/issue-keys');

describe('extractIssueKeys', () => {
  test('finds keys in prose', () => {
    expect(extractIssueKeys('<p>Fixed in ATLAS-29 today.</p>')).toEqual(['ATLAS-29']);
  });

  test('dedupes repeated keys', () => {
    expect(extractIssueKeys('<p>ATLAS-29 and ATLAS-29 again</p>')).toEqual(['ATLAS-29']);
  });

  test('finds multiple distinct keys in document order', () => {
    expect(extractIssueKeys('<p>ATLAS-29 then PROJ-7</p>')).toEqual(['ATLAS-29', 'PROJ-7']);
  });

  test('ignores keys inside code, pre, and anchor elements', () => {
    expect(extractIssueKeys('<p><code>ATLAS-1</code> <pre>ATLAS-2</pre> <a href="#">ATLAS-3</a></p>')).toEqual([]);
  });

  test('still finds keys outside a code block in the same document', () => {
    expect(extractIssueKeys('<p><code>ATLAS-1</code> but ATLAS-2 is open</p>')).toEqual(['ATLAS-2']);
  });

  test('does not match lowercase keys', () => {
    expect(extractIssueKeys('<p>atlas-29</p>')).toEqual([]);
  });

  test('does not treat an attribute value as prose', () => {
    expect(extractIssueKeys('<p title="ATLAS-99">nothing here</p>')).toEqual([]);
  });

  test('returns [] for empty, null, and non-string input', () => {
    expect(extractIssueKeys('')).toEqual([]);
    expect(extractIssueKeys(null)).toEqual([]);
    expect(extractIssueKeys(undefined)).toEqual([]);
    expect(extractIssueKeys(42)).toEqual([]);
  });

  test('returns pattern-matching non-issues; resolution is what filters them', () => {
    // COVID-19 matches the key pattern. The extractor is deliberately naive —
    // Task 3 resolves keys against the issues table, so junk creates no rows.
    expect(extractIssueKeys('<p>COVID-19 policy</p>')).toEqual(['COVID-19']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/issue-keys.test.js --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../utils/issue-keys'`

- [ ] **Step 3: Write minimal implementation**

Create `backend/utils/issue-keys.js`:

```js
// ===== ISSUE KEY EXTRACTION =====
// Finds issue keys (ATLAS-29) in wiki page HTML so pages can be linked to the
// issues they mention. Deliberately naive about what a key means: anything
// matching the pattern is returned, and the caller resolves it against the
// issues table. That resolution is what stops prose like COVID-19 or ISO-8601
// from becoming a link.

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

// Keys inside code samples and existing links are not references. Mirrors the
// exclusion applyMacros already applies client-side (rich-text.tsx).
const EXCLUDED_BLOCKS_RE = /<(code|pre|a)\b[^>]*>[\s\S]*?<\/\1>/gi;

const TAG_RE = /<[^>]+>/g;

/** Deduped issue keys mentioned in a page body, in document order. */
function extractIssueKeys(html) {
  if (typeof html !== 'string' || !html) return [];
  // Drop excluded blocks, then all remaining markup, so attribute values and
  // tag names can never be mistaken for prose.
  const text = html.replace(EXCLUDED_BLOCKS_RE, ' ').replace(TAG_RE, ' ');
  return [...new Set(text.match(ISSUE_KEY_RE) || [])];
}

module.exports = { extractIssueKeys };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/issue-keys.test.js --runInBand --forceExit`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add backend/utils/issue-keys.js backend/tests/backend/issue-keys.test.js
git commit -m "feat(wiki): issue-key extraction from page HTML"
```

---

### Task 2: `wiki_page_issues` table (migration 008)

**Files:**
- Modify: `backend/migrations.js` — append to the `MIGRATIONS` array, after `007_issue_lookup_indexes`
- Test: `backend/tests/backend/migrations.test.js` (existing file — the `schema_migrations` assertion is data-driven and needs no edit; add one table check)

**Interfaces:**
- Consumes: the migration runner from `backend/migrations.js`.
- Produces: table `wiki_page_issues (page_id, issue_id)` with PK `(page_id, issue_id)` and index `idx_page_issues_issue` on `issue_id`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/backend/migrations.test.js`, inside the `describe('Migration runner against a live SQLite database', ...)` block:

```js
  test('creates the wiki_page_issues join table with both lookup paths indexed', async () => {
    const cols = (await queryAll(db, 'PRAGMA table_info(wiki_page_issues)')).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['page_id', 'issue_id']));

    // Composite PK covers page → issues; the explicit index covers issue → pages.
    const pk = (await queryAll(db, 'PRAGMA table_info(wiki_page_issues)'))
      .filter(c => Number(c.pk) > 0).map(c => c.name);
    expect(pk.sort()).toEqual(['issue_id', 'page_id']);

    const idx = await queryAll(db, 'PRAGMA index_list(wiki_page_issues)');
    expect(idx.some(i => i.name === 'idx_page_issues_issue')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/migrations.test.js --runInBand --forceExit`
Expected: FAIL — `PRAGMA table_info(wiki_page_issues)` returns `[]`, so `cols` is `[]`

- [ ] **Step 3: Write minimal implementation**

In `backend/migrations.js`, append this object to the end of the `MIGRATIONS` array (after the `007_issue_lookup_indexes` entry, inside the closing `];`):

```js
  {
    id: '008_wiki_page_issues',
    description: 'Join table linking wiki pages to the issues they mention',
    steps: [
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS wiki_page_issues (
            page_id TEXT NOT NULL REFERENCES wiki_pages(id),
            issue_id TEXT NOT NULL REFERENCES issues(id),
            PRIMARY KEY (page_id, issue_id)
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS wiki_page_issues (
            page_id VARCHAR(36) NOT NULL,
            issue_id VARCHAR(36) NOT NULL,
            PRIMARY KEY (page_id, issue_id)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_page_issues_issue ON wiki_page_issues(issue_id)',
          mysql: 'CREATE INDEX idx_page_issues_issue ON wiki_page_issues(issue_id)',
        },
      },
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/migrations.test.js --runInBand --forceExit`
Expected: PASS — 9 tests. The existing `initDb records every migration` test now expects 8 ids and passes because it reads from `MIGRATIONS`.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations.js backend/tests/backend/migrations.test.js
git commit -m "feat(wiki): wiki_page_issues join table (migration 008)"
```

---

### Task 3: Populate links on page save

**Files:**
- Modify: `backend/utils/issue-keys.js` — add `syncPageIssueLinks`
- Modify: `backend/routes/wiki.js:156-181` (`POST /wiki/spaces/:spaceId/pages`) and `backend/routes/wiki.js:225-269` (`PUT /wiki/pages/:id`)
- Test: `backend/tests/backend/wiki-issue-links.test.js`

**Interfaces:**
- Consumes: `extractIssueKeys(html)` (Task 1); `wiki_page_issues` (Task 2); `placeholders(values)` from `backend/utils/sql.js`.
- Produces: `syncPageIssueLinks(db, pageId, html) → Promise<string[]>` — replaces the page's link rows to match the body and returns the linked issue ids.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/wiki-issue-links.test.js`:

```js
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb, queryAll } = require('../../database');

let headers, db, spaceId, issueA, issueB;

async function linkRows(pageId) {
  return queryAll(db, 'SELECT issue_id FROM wiki_page_issues WHERE page_id = ?', [pageId]);
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();

  const spaces = await request(getApp()).get('/api/wiki/spaces').set(headers);
  spaceId = spaces.body[0].id;

  const projects = await request(getApp()).get('/api/projects').set(headers);
  const projectId = projects.body[0].id;
  const mk = async (title) => (await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title, type: 'task' })).body;
  issueA = await mk('Linked issue A');
  issueB = await mk('Linked issue B');
});

describe('page save populates issue links', () => {
  test('creates a row for each resolvable key in the body', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Link test', body: `<p>See ${issueA.issue_key} and ${issueB.issue_key}</p>` });
    expect(page.status).toBe(201);

    const rows = await linkRows(page.body.id);
    expect(rows.map(r => r.issue_id).sort()).toEqual([issueA.id, issueB.id].sort());
  });

  test('keys that resolve to no issue create no rows', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Junk keys', body: '<p>COVID-19 and ISO-8601 and ATLAS-99999</p>' });
    expect(await linkRows(page.body.id)).toEqual([]);
  });

  test('re-saving replaces the set rather than accumulating', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Replace test', body: `<p>${issueA.issue_key}</p>` });
    expect((await linkRows(page.body.id)).map(r => r.issue_id)).toEqual([issueA.id]);

    await request(getApp())
      .put(`/api/wiki/pages/${page.body.id}`).set(headers)
      .send({ body: `<p>${issueB.issue_key}</p>` });

    const rows = await linkRows(page.body.id);
    expect(rows.map(r => r.issue_id)).toEqual([issueB.id]);
  });

  test('removing every key clears the rows', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Clear test', body: `<p>${issueA.issue_key}</p>` });
    await request(getApp())
      .put(`/api/wiki/pages/${page.body.id}`).set(headers)
      .send({ body: '<p>nothing here now</p>' });
    expect(await linkRows(page.body.id)).toEqual([]);
  });

  test('a title-only update leaves links untouched', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Title only', body: `<p>${issueA.issue_key}</p>` });
    await request(getApp())
      .put(`/api/wiki/pages/${page.body.id}`).set(headers)
      .send({ title: 'Renamed, body untouched' });
    expect((await linkRows(page.body.id)).map(r => r.issue_id)).toEqual([issueA.id]);
  });

  test('the same key twice creates one row, not two', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Dupe test', body: `<p>${issueA.issue_key} and again ${issueA.issue_key}</p>` });
    expect(await linkRows(page.body.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: FAIL — first test gets `[]` instead of two issue ids

- [ ] **Step 3: Write minimal implementation**

Add to `backend/utils/issue-keys.js` (replace the existing `module.exports` line):

```js
const { queryAll, run } = require('../database');
const { placeholders } = require('./sql');

/**
 * Rebuilds a page's issue links to match its body. Replace-all, matching the
 * idiom page restrictions already use. Returns the linked issue ids.
 *
 * Keys that resolve to no issue are silently dropped — that resolution step is
 * what keeps prose like COVID-19 out of the table.
 */
async function syncPageIssueLinks(db, pageId, html) {
  const keys = extractIssueKeys(html);
  await run(db, 'DELETE FROM wiki_page_issues WHERE page_id = ?', [pageId]);
  if (keys.length === 0) return [];

  const rows = await queryAll(db,
    `SELECT id FROM issues WHERE issue_key IN (${placeholders(keys)})`, keys);
  for (const r of rows) {
    await run(db, 'INSERT INTO wiki_page_issues (page_id, issue_id) VALUES (?, ?)', [pageId, r.id]);
  }
  return rows.map((r) => r.id);
}

module.exports = { extractIssueKeys, syncPageIssueLinks };
```

In `backend/routes/wiki.js`, add to the imports at the top (after the `sanitizeRichText` import on line 7):

```js
const { syncPageIssueLinks } = require('../utils/issue-keys');
```

In `POST /wiki/spaces/:spaceId/pages`, immediately before `const page = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [id]);`:

```js
    await syncPageIssueLinks(db, id, body || '');
```

In `PUT /wiki/pages/:id`, immediately before `const updated = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [req.params.id]);`:

```js
    // Only a body edit can change which issues the page mentions.
    if (body !== undefined) await syncPageIssueLinks(db, req.params.id, body);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add backend/utils/issue-keys.js backend/routes/wiki.js backend/tests/backend/wiki-issue-links.test.js
git commit -m "feat(wiki): populate page-issue links on save"
```

---

### Task 4: Batched page access, and refactor `pageAccess` onto it

**Files:**
- Modify: `backend/routes/wiki.js:14-25` (replace `pageAccess`)
- Test: `backend/tests/backend/page-access.test.js`

**Interfaces:**
- Consumes: `placeholders(values)` from `backend/utils/sql.js`.
- Produces:
  - `pageAccessBatch(db, pageIds: string[], userId, userRole) → Promise<Map<string, {view: boolean, edit: boolean, restricted: boolean}>>`
  - `pageAccess(db, pageId, userId, userRole) → Promise<{view, edit, restricted}>` — unchanged signature and semantics; now delegates to the batch version.

**Why this refactor:** filtering the Task 5 panel with the per-page `pageAccess` costs 2 queries per page. Writing a second implementation of the rules for the batch case would put authorization logic in two places, where it can drift. Drifted authorization is a security bug. So there is one implementation and the singular call delegates to it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/page-access.test.js`:

```js
/**
 * pageAccessBatch must agree with pageAccess across every access case, because
 * pageAccess is being rewritten to delegate to it. These are the live rules
 * gating wiki page reads and edits.
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, loginAs } = require('./setup');
const { getDb, run } = require('../../database');
const { pageAccess, pageAccessBatch } = require('../../routes/wiki');

let db, adminH, spaceId, adminId, priyaId;

async function makePage(title, headers) {
  const res = await request(getApp())
    .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
    .send({ title, body: '<p>body</p>' });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
  adminId = adminH['x-user-id'];
  const priyaH = await loginAs('priya@example.com', 'password123');
  priyaId = priyaH['x-user-id'];
  const spaces = await request(getApp()).get('/api/wiki/spaces').set(adminH);
  spaceId = spaces.body[0].id;
});

describe('pageAccessBatch matches pageAccess', () => {
  test('unrestricted page: everyone views and edits', async () => {
    const id = await makePage('Unrestricted', adminH);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: false });
  });

  test('restricted page: unlisted user is denied', async () => {
    const id = await makePage('Restricted', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, adminId]);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: false, edit: false, restricted: true });
  });

  test('restricted page: the author always retains access', async () => {
    const id = await makePage('Author access', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, priyaId]);
    const single = await pageAccess(db, id, adminId, 'user');
    const batch = (await pageAccessBatch(db, [id], adminId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: true });
  });

  test('restricted page: an admin always retains access', async () => {
    const id = await makePage('Admin access', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, adminId]);
    const single = await pageAccess(db, id, priyaId, 'admin');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'admin')).get(id);
    expect(batch).toEqual(single);
    expect(single.view).toBe(true);
  });

  test('listed read-only user views but cannot edit when another row grants edit', async () => {
    const id = await makePage('Mixed rows', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, priyaId]);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 1)', [id, adminId]);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: false, restricted: true });
  });

  test('listed user edits when no row grants edit', async () => {
    const id = await makePage('No edit rows', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, priyaId]);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: true });
  });

  test('a missing page is permissive, matching the pre-refactor behaviour', async () => {
    const single = await pageAccess(db, 'does-not-exist', priyaId, 'user');
    const batch = (await pageAccessBatch(db, ['does-not-exist'], priyaId, 'user')).get('does-not-exist');
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: false });
  });

  test('an empty id list returns an empty map without querying', async () => {
    expect((await pageAccessBatch(db, [], priyaId, 'user')).size).toBe(0);
  });

  test('resolves many pages in a fixed number of queries', async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await makePage(`Batch page ${i}`, adminH));

    const original = db.prepare.bind(db);
    let n = 0;
    db.prepare = (...a) => { n += 1; return original(...a); };
    const map = await pageAccessBatch(db, ids, priyaId, 'user');
    db.prepare = original;

    expect(map.size).toBe(6);
    expect(n).toBeLessThanOrEqual(2); // one restrictions read, one authors read
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/page-access.test.js --runInBand --forceExit`
Expected: FAIL — `pageAccess is not a function` (neither helper is exported yet)

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/wiki.js`, add to the imports at the top:

```js
const { placeholders } = require('../utils/sql');
```

Replace the whole `pageAccess` function (lines 14-25) with:

```js
/**
 * Access for many pages in two queries. The rules live here and nowhere else —
 * pageAccess() below delegates, so the singular and batch paths cannot drift.
 */
async function pageAccessBatch(db, pageIds, userId, userRole) {
  const result = new Map();
  if (pageIds.length === 0) return result;

  const ph = placeholders(pageIds);
  const [rows, pages] = await Promise.all([
    queryAll(db, `SELECT page_id, user_id, can_edit FROM wiki_page_restrictions WHERE page_id IN (${ph})`, pageIds),
    queryAll(db, `SELECT id, author_id FROM wiki_pages WHERE id IN (${ph})`, pageIds),
  ]);

  const authorOf = new Map(pages.map((p) => [p.id, p.author_id]));
  const byPage = new Map();
  for (const r of rows) {
    if (!byPage.has(r.page_id)) byPage.set(r.page_id, []);
    byPage.get(r.page_id).push(r);
  }

  const isAdmin = userRole === 'admin';
  for (const pageId of pageIds) {
    const pageRows = byPage.get(pageId) || [];
    // A page with no restriction rows — including one that does not exist — is
    // open. This matches the pre-refactor behaviour exactly.
    if (pageRows.length === 0) {
      result.set(pageId, { view: true, edit: true, restricted: false });
      continue;
    }
    const isOwner = authorOf.has(pageId) && authorOf.get(pageId) === userId;
    if (isOwner || isAdmin) {
      result.set(pageId, { view: true, edit: true, restricted: true });
      continue;
    }
    const mine = pageRows.find((r) => r.user_id === userId);
    if (!mine) {
      result.set(pageId, { view: false, edit: false, restricted: true });
      continue;
    }
    const anyEditRows = pageRows.some((r) => Number(r.can_edit) === 1);
    result.set(pageId, {
      view: true,
      edit: anyEditRows ? Number(mine.can_edit) === 1 : true,
      restricted: true,
    });
  }
  return result;
}

// ===== PAGE RESTRICTIONS =====
// Rows grant access: a page with any restriction rows is visible only to the
// listed users, its author, and admins. can_edit=1 rows additionally gate editing.
async function pageAccess(db, pageId, userId, userRole) {
  const map = await pageAccessBatch(db, [pageId], userId, userRole);
  return map.get(pageId);
}
```

At the bottom of `backend/routes/wiki.js`, find the existing `module.exports = router;` line and add below it:

```js
module.exports.pageAccess = pageAccess;
module.exports.pageAccessBatch = pageAccessBatch;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/page-access.test.js --runInBand --forceExit`
Expected: PASS — 9 tests

- [ ] **Step 5: Verify no wiki regressions from touching auth**

Run: `npx jest tests/backend/wiki.test.js tests/backend/wiki-attachments.test.js --runInBand --forceExit`
Expected: PASS — all existing wiki tests still green

- [ ] **Step 6: Commit**

```bash
git add backend/routes/wiki.js backend/tests/backend/page-access.test.js
git commit -m "refactor(wiki): batched page access checks, single source of rules"
```

---

### Task 5: Reverse endpoint — pages mentioning an issue

**Files:**
- Modify: `backend/routes/wiki.js` — add route after the page-delete handler
- Test: `backend/tests/backend/wiki-issue-links.test.js` (extend)

**Interfaces:**
- Consumes: `wiki_page_issues` (Task 2), `pageAccessBatch` (Task 4).
- Produces: `GET /api/issues/:id/pages` → `[{ id, title, slug, space_id, space_name, space_key, updated_at }]`, newest first, excluding pages the caller cannot view.

The route lives in `wiki.js` (not `issues.js`) because it returns wiki data and needs `pageAccessBatch`. `wiki.js` is already mounted at `/api`, so the path resolves correctly.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/wiki-issue-links.test.js`:

```js
describe('GET /api/issues/:id/pages', () => {
  test('lists pages mentioning the issue', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Mentions A', body: `<p>${issueA.issue_key} discussion</p>` });

    const res = await request(getApp()).get(`/api/issues/${issueA.id}/pages`).set(headers);
    expect(res.status).toBe(200);
    const hit = res.body.find(p => p.id === page.body.id);
    expect(hit).toBeDefined();
    expect(hit.title).toBe('Mentions A');
    expect(hit.space_name).toBeTruthy();
    expect(hit.space_key).toBeTruthy();
  });

  test('returns [] for an issue no page mentions', async () => {
    const projects = await request(getApp()).get('/api/projects').set(headers);
    const lonely = (await request(getApp())
      .post(`/api/projects/${projects.body[0].id}/issues`).set(headers)
      .send({ title: 'Unmentioned', type: 'task' })).body;
    const res = await request(getApp()).get(`/api/issues/${lonely.id}/pages`).set(headers);
    expect(res.body).toEqual([]);
  });

  test('a restricted page is hidden from a user who cannot view it', async () => {
    const { run } = require('../../database');
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Secret retro', body: `<p>${issueB.issue_key} postmortem</p>` });

    // Restrict to the admin author only.
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 1)',
      [page.body.id, headers['x-user-id']]);

    const { loginAs } = require('./setup');
    const otherH = await loginAs('priya@example.com', 'password123');
    const other = await request(getApp()).get(`/api/issues/${issueB.id}/pages`).set(otherH);
    expect(other.body.some(p => p.id === page.body.id)).toBe(false);

    // The author still sees it.
    const mine = await request(getApp()).get(`/api/issues/${issueB.id}/pages`).set(headers);
    expect(mine.body.some(p => p.id === page.body.id)).toBe(true);
  });

  test('query count stays flat as the number of mentioning pages grows', async () => {
    const projects = await request(getApp()).get('/api/projects').set(headers);
    const target = (await request(getApp())
      .post(`/api/projects/${projects.body[0].id}/issues`).set(headers)
      .send({ title: 'Widely mentioned', type: 'task' })).body;

    const measure = async () => {
      const original = db.prepare.bind(db);
      let n = 0;
      db.prepare = (...a) => { n += 1; return original(...a); };
      await request(getApp()).get(`/api/issues/${target.id}/pages`).set(headers);
      db.prepare = original;
      return n;
    };

    await request(getApp()).post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Mention 0', body: `<p>${target.issue_key}</p>` });
    const small = await measure();

    for (let i = 1; i <= 8; i++) {
      await request(getApp()).post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
        .send({ title: `Mention ${i}`, body: `<p>${target.issue_key}</p>` });
    }
    const large = await measure();

    expect(large - small).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: FAIL — 404, the route does not exist

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/wiki.js`, add after the `router.delete('/wiki/pages/:id', ...)` handler:

```js
// ===== ISSUE → PAGES =====
// Pages mentioning an issue. Restricted pages the caller cannot view are
// removed: a page title alone can disclose sensitive context (e.g. a page
// named "ATLAS-29 breach retro" reveals both its existence and its subject).
router.get('/issues/:id/pages', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pages = await queryAll(db, `
      SELECT p.id, p.title, p.slug, p.space_id, p.updated_at,
             s.name AS space_name, s.space_key
      FROM wiki_page_issues l
      JOIN wiki_pages p ON p.id = l.page_id
      JOIN wiki_spaces s ON s.id = p.space_id
      WHERE l.issue_id = ? AND p.status = 'current'
      ORDER BY p.updated_at DESC`, [req.params.id]);
    if (pages.length === 0) return res.json([]);

    const access = await pageAccessBatch(db, pages.map((p) => p.id), req.userId, req.userRole);
    res.json(pages.filter((p) => access.get(p.id)?.view));
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add backend/routes/wiki.js backend/tests/backend/wiki-issue-links.test.js
git commit -m "feat(wiki): GET /api/issues/:id/pages with restriction filtering"
```

---

### Task 6: Forward reads — `linked_issues` and the resolve endpoint

**Files:**
- Modify: `backend/routes/wiki.js` — `GET /wiki/pages/:id` (add `linked_issues`)
- Modify: `backend/routes/issues.js` — add `POST /issues/resolve`
- Test: `backend/tests/backend/wiki-issue-links.test.js` (extend)

**Interfaces:**
- Consumes: `wiki_page_issues` (Task 2).
- Produces:
  - `GET /api/wiki/pages/:id` response gains `linked_issues: IssueSummary[]`
  - `POST /api/issues/resolve` body `{ keys: string[] }` → `{ issues: IssueSummary[] }`
  - `IssueSummary = { id, issue_key, title, status, type, priority, assignee_name, assignee_color }`

**Route ordering warning:** `POST /issues/resolve` must be registered **before** any `/issues/:id` POST route in `issues.js`, or Express will match `resolve` as an `:id`. Place it directly after the `enrichIssue` helper, before the first route definition.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/wiki-issue-links.test.js`:

```js
describe('forward reads', () => {
  test('GET a page returns linked_issues with live issue state', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Forward read', body: `<p>Tracking ${issueA.issue_key}</p>` });

    const res = await request(getApp()).get(`/api/wiki/pages/${page.body.id}`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.linked_issues)).toBe(true);
    const hit = res.body.linked_issues.find(i => i.id === issueA.id);
    expect(hit).toMatchObject({
      id: issueA.id,
      issue_key: issueA.issue_key,
      title: 'Linked issue A',
      type: 'task',
    });
    expect(hit).toHaveProperty('status');
    expect(hit).toHaveProperty('priority');
    expect(hit).toHaveProperty('assignee_name');
  });

  test('a page with no keys returns an empty linked_issues array', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'No keys', body: '<p>plain prose</p>' });
    const res = await request(getApp()).get(`/api/wiki/pages/${page.body.id}`).set(headers);
    expect(res.body.linked_issues).toEqual([]);
  });

  test('POST /api/issues/resolve returns summaries for known keys only', async () => {
    const res = await request(getApp())
      .post('/api/issues/resolve').set(headers)
      .send({ keys: [issueA.issue_key, 'COVID-19', 'ATLAS-99999'] });
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].issue_key).toBe(issueA.issue_key);
  });

  test('resolve accepts an empty list', async () => {
    const res = await request(getApp()).post('/api/issues/resolve').set(headers).send({ keys: [] });
    expect(res.status).toBe(200);
    expect(res.body.issues).toEqual([]);
  });

  test('resolve rejects more than 100 keys', async () => {
    const keys = Array.from({ length: 101 }, (_, i) => `ATLAS-${i}`);
    const res = await request(getApp()).post('/api/issues/resolve').set(headers).send({ keys });
    expect(res.status).toBe(400);
  });

  test('resolve rejects a non-array keys field', async () => {
    const res = await request(getApp()).post('/api/issues/resolve').set(headers).send({ keys: 'ATLAS-1' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: FAIL — `linked_issues` is undefined; `/api/issues/resolve` 404s

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/wiki.js`, inside `GET /wiki/pages/:id`, immediately before `page.body = signWikiImages(page.body);`:

```js
    // Issues this page mentions, resolved at write time (see utils/issue-keys.js).
    // Returned inline so chips render on first paint with no extra round trip.
    page.linked_issues = await queryAll(db, `
      SELECT i.id, i.issue_key, i.title, i.status, i.type, i.priority,
             u.name AS assignee_name, u.avatar_color AS assignee_color
      FROM wiki_page_issues l
      JOIN issues i ON i.id = l.issue_id
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE l.page_id = ?`, [req.params.id]);
```

In `backend/routes/issues.js`, add this route immediately after the `enrichIssue` function and before the first `router.get(...)`:

```js
// POST /api/issues/resolve — issue summaries for a batch of keys.
// Serves wiki content that is not saved yet (editor preview, AI drafts), where
// the stored page→issue links are not yet current.
const RESOLVE_MAX_KEYS = 100;

router.post('/issues/resolve', requireAuth, async (req, res) => {
  try {
    const keys = req.body?.keys;
    if (!Array.isArray(keys)) return res.status(400).json({ error: 'keys must be an array' });
    if (keys.length > RESOLVE_MAX_KEYS) {
      return res.status(400).json({ error: `At most ${RESOLVE_MAX_KEYS} keys per request` });
    }
    if (keys.length === 0) return res.json({ issues: [] });

    const db = await getDb();
    const issues = await queryAll(db, `
      SELECT i.id, i.issue_key, i.title, i.status, i.type, i.priority,
             u.name AS assignee_name, u.avatar_color AS assignee_color
      FROM issues i
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.issue_key IN (${placeholders(keys)})`, keys);
    res.json({ issues });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add backend/routes/wiki.js backend/routes/issues.js backend/tests/backend/wiki-issue-links.test.js
git commit -m "feat(wiki): linked_issues on page reads + issue resolve endpoint"
```

---

### Task 7: Lifecycle — cascades, backfill, and seeding

**Files:**
- Modify: `backend/routes/issues.js:401-418` (delete cascade)
- Modify: `backend/routes/wiki.js` (page delete cascade)
- Modify: `backend/utils/issue-keys.js` — add `backfillPageIssueLinks`
- Modify: `backend/database.js` — call the backfill after seeding, in both `initSqlite` and `initMysqlSchema`
- Create: `backend/scripts/backfill-page-issues.js`
- Test: `backend/tests/backend/wiki-issue-links.test.js` (extend)

**Interfaces:**
- Consumes: `syncPageIssueLinks` (Task 3).
- Produces: `backfillPageIssueLinks(db) → Promise<number>` — re-extracts links for every current page, returns the page count processed. Idempotent.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/wiki-issue-links.test.js`:

```js
describe('lifecycle', () => {
  test('deleting an issue removes its link rows', async () => {
    const projects = await request(getApp()).get('/api/projects').set(headers);
    const doomed = (await request(getApp())
      .post(`/api/projects/${projects.body[0].id}/issues`).set(headers)
      .send({ title: 'Doomed', type: 'task' })).body;

    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Mentions doomed', body: `<p>${doomed.issue_key}</p>` });
    expect(await linkRows(page.body.id)).toHaveLength(1);

    await request(getApp()).delete(`/api/issues/${doomed.id}`).set(headers);
    expect(await linkRows(page.body.id)).toEqual([]);
  });

  test('deleting a page removes its link rows', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Doomed page', body: `<p>${issueA.issue_key}</p>` });
    const pageId = page.body.id;
    expect(await linkRows(pageId)).toHaveLength(1);

    await request(getApp()).delete(`/api/wiki/pages/${pageId}`).set(headers);
    expect(await linkRows(pageId)).toEqual([]);
  });

  test('backfill is idempotent and rebuilds links for existing pages', async () => {
    const { backfillPageIssueLinks } = require('../../utils/issue-keys');
    const { run } = require('../../database');

    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Backfill target', body: `<p>${issueA.issue_key}</p>` });

    // Simulate a deployment that predates the feature: rows never written.
    await run(db, 'DELETE FROM wiki_page_issues');
    expect(await linkRows(page.body.id)).toEqual([]);

    const count = await backfillPageIssueLinks(db);
    expect(count).toBeGreaterThan(0);
    expect((await linkRows(page.body.id)).map(r => r.issue_id)).toEqual([issueA.id]);

    // Running it again changes nothing.
    await backfillPageIssueLinks(db);
    expect(await linkRows(page.body.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: FAIL — link rows survive deletion; `backfillPageIssueLinks` is not a function

- [ ] **Step 3: Write minimal implementation**

Add to `backend/utils/issue-keys.js`, before `module.exports`:

```js
/**
 * Rebuilds links for every current page. For deployments that predate this
 * feature, whose pages have no rows until they happen to be re-saved.
 * Idempotent — syncPageIssueLinks replaces each page's set.
 */
async function backfillPageIssueLinks(db) {
  const pages = await queryAll(db, "SELECT id, body FROM wiki_pages WHERE status = 'current'");
  for (const page of pages) {
    await syncPageIssueLinks(db, page.id, page.body || '');
  }
  return pages.length;
}
```

Update the export line to:

```js
module.exports = { extractIssueKeys, syncPageIssueLinks, backfillPageIssueLinks };
```

In `backend/routes/issues.js`, in the delete handler, add after the `issue_links` delete and before `DELETE FROM issues`:

```js
    await run(db, 'DELETE FROM wiki_page_issues WHERE issue_id = ?', [req.params.id]);
```

In `backend/routes/wiki.js`, in the page delete handler, add after the `wiki_page_likes` delete and before `DELETE FROM wiki_pages`:

```js
    await run(db, 'DELETE FROM wiki_page_issues WHERE page_id = ?', [req.params.id]);
```

In `backend/database.js`, **do not** add a top-level require for `issue-keys`.
`utils/issue-keys.js` requires `../database`, so a top-level require here would
form a cycle: `database.js` assigns `module.exports` at the *end* of the file, so
`issue-keys` would receive a partially-initialised module and its `queryAll` /
`run` bindings would be `undefined` at call time. Require it lazily inside each
init function instead — the same pattern `routes/wiki.js` uses for `notify`.

In `initSqlite`, replace the product-seed block at the end with:

```js
  // Product module demo data seeds independently so existing data.db files get
  // it too (the pb_* tables are new; the main seed only runs on a fresh DB).
  if (config.seedDemoData) {
    const feats = db.exec("SELECT COUNT(*) as c FROM pb_features");
    if (feats[0].values[0][0] === 0) seedProductDemoData();
  }

  // Seeded pages are inserted directly, bypassing the route that extracts issue
  // links — so index them here. Existing deployments use scripts/backfill-page-issues.js.
  // Required lazily: utils/issue-keys requires this module back.
  if (config.seedDemoData) {
    const { backfillPageIssueLinks } = require('./utils/issue-keys');
    await backfillPageIssueLinks(db);
  }

  return db;
```

In `initMysqlSchema`, replace the seeding block at the end with:

```js
  const [rows] = await pool.query('SELECT COUNT(*) as c FROM users');
  if (parseInt(rows[0].c, 10) === 0) {
    if (config.seedDemoData) {
      await seedDemoDataMysql(pool);
      // Required lazily: utils/issue-keys requires this module back.
      const { backfillPageIssueLinks } = require('./utils/issue-keys');
      await backfillPageIssueLinks(createMysqlWrapper(pool));
    } else {
      await seedAdminOnlyMysql(pool);
    }
  }
```

Create `backend/scripts/backfill-page-issues.js`:

```js
#!/usr/bin/env node
// One-time backfill of wiki_page_issues for deployments that predate the
// wiki ↔ issue integration. Safe to re-run.
//
//   node backend/scripts/backfill-page-issues.js

const { initDb, getDb } = require('../database');
const { backfillPageIssueLinks } = require('../utils/issue-keys');

(async () => {
  await initDb();
  const db = await getDb();
  const count = await backfillPageIssueLinks(db);
  console.log(`✓ Indexed issue links for ${count} wiki pages`);
  process.exit(0);
})().catch((e) => {
  console.error('Backfill failed:', e.message);
  process.exit(1);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/backend/wiki-issue-links.test.js --runInBand --forceExit`
Expected: PASS — 19 tests

- [ ] **Step 5: Verify the backfill script runs against a real database**

```bash
cp data.db /tmp/backfill-check.db
SQLITE_PATH=/tmp/backfill-check.db SEED_DEMO_DATA=false node scripts/backfill-page-issues.js
```
Expected: `✓ Indexed issue links for N wiki pages` with N > 0, exit 0

- [ ] **Step 6: Commit**

```bash
git add backend/utils/issue-keys.js backend/routes/issues.js backend/routes/wiki.js backend/database.js backend/scripts/backfill-page-issues.js backend/tests/backend/wiki-issue-links.test.js
git commit -m "feat(wiki): link cascades, seed indexing, and backfill script"
```

---

### Task 8: Frontend — live chips with hover cards

**Files:**
- Modify: `frontend/src/components/app/rich-text.tsx` (`applyMacros`, `RichTextView`, delete the fallback at line 161)
- Modify: `frontend/src/lib/types.ts` (add `LinkedIssueSummary`, extend `WikiPage`)
- Modify: `frontend/src/lib/api.ts` (add `issues.resolve`)
- Modify: `frontend/src/screens/wiki-page.tsx:440` (pass the map)

**Interfaces:**
- Consumes: `linked_issues` from `GET /api/wiki/pages/:id` (Task 6).
- Produces: `RichTextView` accepts `issues?: LinkedIssueSummary[]`; chips render only for keys present in that list.

**Why no Radix `HoverCard`:** chips are DOM nodes injected through
`dangerouslySetInnerHTML`, so they cannot be Radix trigger *components*. The card
is therefore a positioned element driven by pointer events on the rendered
container. Do not add `components/ui/hover-card.tsx` — it would be dead code.

- [ ] **Step 1: Add types**

In `frontend/src/lib/types.ts`, add near the other issue types:

```ts
export interface LinkedIssueSummary {
  id: string;
  issue_key: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  assignee_name: string | null;
  assignee_color: string | null;
}

export interface MentioningPage {
  id: string;
  title: string;
  slug: string;
  space_id: string;
  space_name: string;
  space_key: string;
  updated_at: string;
}
```

In the same file, add to the `WikiPage` interface:

```ts
  linked_issues?: LinkedIssueSummary[];
```

- [ ] **Step 2: Add the API methods**

In `frontend/src/lib/api.ts`, add to the `issues` object (after `move`):

```ts
    resolve: (keys: string[]) => post<{ issues: LinkedIssueSummary[] }>('/issues/resolve', { keys }),
    pages: (id: string) => get<MentioningPage[]>(`/issues/${id}/pages`),
```

Add `LinkedIssueSummary` and `MentioningPage` to the type import at the top of the file.

- [ ] **Step 3: Rewrite chip rendering**

In `frontend/src/components/app/rich-text.tsx`:

Change the `applyMacros` signature and the chip-building loop. Replace the function's declaration line:

```ts
function applyMacros(html: string): string {
```

with:

```ts
function applyMacros(html: string, issues: Map<string, LinkedIssueSummary>): string {
```

Replace the chip-building block (the `targets.forEach(...)` loop) with:

```ts
  targets.forEach((text) => {
    const frag = document.createDocumentFragment();
    (text.textContent || '').split(/(\b[A-Z][A-Z0-9]{1,9}-\d+\b)/g).forEach((part) => {
      const issue = /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(part) ? issues.get(part) : undefined;
      // Only a key that resolves to a real issue becomes a chip. Everything else
      // stays prose — which is also what keeps COVID-19 and ISO-8601 from
      // rendering as broken links.
      if (issue) {
        const chip = document.createElement('a');
        chip.href = '#';
        chip.setAttribute('data-issue-id', issue.id);
        chip.setAttribute('data-issue-key', issue.issue_key);
        chip.className =
          'wiki-issue-chip inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 font-mono text-[11px] font-semibold text-primary no-underline hover:bg-primary/20';
        chip.textContent = part;
        frag.appendChild(chip);
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });
    text.replaceWith(frag);
  });
```

Leave the `ISSUE_KEY_RE` tree-walker guard exactly as it is: it only selects
which text nodes are worth splitting, and the resolution check above is what
decides whether a chip is produced.

Replace `RichTextView` with:

```tsx
export function RichTextView({
  html,
  className,
  macros = false,
  issues,
}: {
  html: string;
  className?: string;
  /** Enable [toc] + issue-key chips (wiki pages). */
  macros?: boolean;
  /** Issues mentioned by this content. A key only becomes a chip if it appears here. */
  issues?: LinkedIssueSummary[];
}) {
  const navigate = useNavigate();
  const issueMap = useMemo(
    () => new Map((issues ?? []).map((i) => [i.issue_key, i])),
    [issues],
  );
  const rendered = useMemo(() => {
    const clean = sanitizeHtml(html);
    return macros ? applyMacros(clean, issueMap) : clean;
  }, [html, macros, issueMap]);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const chip = (e.target as HTMLElement).closest?.('a[data-issue-id]');
    if (!chip) return;
    e.preventDefault();
    // The id came from a resolved issue, so navigate directly. The previous
    // implementation searched by key and fell back to the first result, which
    // could open an unrelated issue.
    const id = chip.getAttribute('data-issue-id') ?? '';
    const key = chip.getAttribute('data-issue-key') ?? '';
    const issue = issueMap.get(key);
    navigate(issue?.type === 'epic' ? `/epics?issue=${id}` : `/board?issue=${id}`);
  }

  return (
    <div
      className={cn('wiki-prose', className)}
      onClick={onClick}
      // Sanitised inside `rendered`; the server also cleans on write.
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
```

Remove the now-unused `api` and `toast` imports if nothing else in the file uses them (check first — `RichTextEditor` uses both, so they stay).

Add `LinkedIssueSummary` to the type imports at the top of the file.

- [ ] **Step 4: Attach the hover card**

Still in `rich-text.tsx`, add a hover-card overlay driven by pointer events on chips. Add inside `RichTextView`, before the `return`:

```tsx
  const [hovered, setHovered] = useState<{ issue: LinkedIssueSummary; x: number; y: number } | null>(null);

  function onPointerOver(e: React.PointerEvent<HTMLDivElement>) {
    const chip = (e.target as HTMLElement).closest?.('a[data-issue-key]');
    if (!chip) { setHovered(null); return; }
    const issue = issueMap.get(chip.getAttribute('data-issue-key') ?? '');
    if (!issue) { setHovered(null); return; }
    const r = (chip as HTMLElement).getBoundingClientRect();
    setHovered({ issue, x: r.left, y: r.bottom + 6 });
  }
```

Add `onPointerOver={onPointerOver}` and `onPointerLeave={() => setHovered(null)}` to the rendering `<div>`, and render the card after it by wrapping the return in a fragment:

```tsx
  return (
    <>
      <div
        className={cn('wiki-prose', className)}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerLeave={() => setHovered(null)}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
      {hovered && (
        <div
          role="tooltip"
          className="fixed z-50 w-72 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
          style={{ left: hovered.x, top: hovered.y }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-semibold text-primary">{hovered.issue.issue_key}</span>
            <StatusPill status={hovered.issue.status} />
          </div>
          <p className="mt-1 text-sm font-medium leading-snug">{hovered.issue.title}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {hovered.issue.assignee_name ?? 'Unassigned'} · {hovered.issue.priority}
          </p>
        </div>
      )}
    </>
  );
```

Import `StatusPill` from `./primitives` and add `useState` to the React import.

- [ ] **Step 5: Pass the map from the page screen**

In `frontend/src/screens/wiki-page.tsx:440`, change:

```tsx
            <RichTextView html={page.body} macros />
```

to:

```tsx
            <RichTextView html={page.body} macros issues={page.linked_issues} />
```

- [ ] **Step 6: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(wiki): live issue chips with hover cards, correct navigation"
```

---

### Task 9: Frontend — "Mentioned on pages" panel

**Files:**
- Modify: `frontend/src/components/app/issue-detail-sheet.tsx`

**Interfaces:**
- Consumes: `api.issues.pages(id)` (Task 8, Step 3); `MentioningPage` type.
- Produces: a panel in the issue detail sheet, hidden when the list is empty.

- [ ] **Step 1: Load the data**

In `issue-detail-sheet.tsx`, add state alongside the existing `watchers` state (near line 56):

```tsx
  const [mentioningPages, setMentioningPages] = useState<MentioningPage[]>([]);
```

In the same effect that loads watchers (near line 103), add:

```tsx
      setMentioningPages(await api.issues.pages(issue.id).catch(() => []));
```

Add `MentioningPage` to the type imports.

- [ ] **Step 2: Render the panel**

Add after the `<LinkedIssues ... />` block (near line 475):

```tsx
                  {mentioningPages.length > 0 && (
                    <div className="mt-6">
                      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <FileText className="size-3.5" /> Mentioned on pages
                      </h4>
                      <ul className="space-y-1">
                        {mentioningPages.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => navigate(`/wiki/page/${p.id}`)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                            >
                              <span className="truncate">{p.title}</span>
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.space_key}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
```

Import `FileText` from `lucide-react`. If the component does not already have `navigate`, add `const navigate = useNavigate();` and import `useNavigate` from `react-router-dom`.

- [ ] **Step 3: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/app/issue-detail-sheet.tsx
git commit -m "feat(issues): 'Mentioned on pages' panel on the issue detail sheet"
```

---

### Task 10: Full verification and wave close-out

**Files:**
- Modify: `backend/database.js` — seed epics 31-32
- Modify: `backend/tests/backend/epics.test.js` — expect 32
- Create: `frontend/e2e/wiki-issue-links.spec.ts`

- [ ] **Step 1: Add the E2E spec**

Create `frontend/e2e/wiki-issue-links.spec.ts`, following the patterns in `frontend/e2e/flows.spec.ts` (read it first for the login helper and conventions):

```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('wiki issue links', () => {
  test('an issue key in a page renders as a chip and opens the issue', async ({ page }) => {
    await login(page);
    await page.goto('/wiki');
    // Open the first space, then the first page in it.
    await page.getByRole('link', { name: /engineering/i }).first().click();
    await page.locator('a[href^="/wiki/page/"]').first().click();

    const chip = page.locator('.wiki-issue-chip').first();
    if (await chip.count() === 0) test.skip(true, 'seeded pages mention no issues');
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/\/(board|epics)\?issue=/);
  });
});
```

- [ ] **Step 2: Seed the wave epics**

In `backend/database.js`, after the `perfEpics.forEach(...)` block, add:

```js
  // ===== Wiki ↔ issue integration wave (epics 31-32) — shipped =====
  const wikiLinkEpics = [
    { title: 'Live issue chips', color: 'blue',
      desc: 'Issue keys in wiki pages resolve to real issues: hover shows title, status, assignee and priority, and clicking always opens the issue named. Keys that resolve to nothing stay prose, so COVID-19 and ISO-8601 no longer render as links.',
      children: [
        { title: 'Issue-key extraction from page HTML', type: 'task' },
        { title: 'linked_issues on page reads + resolve endpoint', type: 'task' },
        { title: 'Hover card and correct chip navigation', type: 'story' },
      ] },
    { title: 'Page back-links', color: 'teal',
      desc: 'The reverse direction, which did not exist: an issue shows which wiki pages mention it, filtered through page restrictions so a restricted page never discloses its title.',
      children: [
        { title: 'wiki_page_issues join table + write-time indexing', type: 'task' },
        { title: 'Batched page access checks, single source of rules', type: 'task' },
        { title: 'Mentioned on pages panel', type: 'story' },
      ] },
  ];
  wikiLinkEpics.forEach((epic, i) => {
    const eid = uuid();
    const num = atlasIssueNumber;
    atlasIssueNumber += 1;
    const [startDate, dueDate] = epicWindow(30 + i);
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, epic_color, start_date, due_date, board_order)
      VALUES (?, ?, ?, ?, ?, ?, 'epic', 'done', 'high', ?, ?, ?, ?, ?)`,
      [eid, projId3, `ATLAS-${num}`, num, epic.title, epic.desc, userIds[0], epic.color, startDate, dueDate, 30 + i]);
    epic.children.forEach((c, ci) => {
      const cnum = atlasIssueNumber;
      atlasIssueNumber += 1;
      db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, assignee_id, reporter_id, parent_id, board_order)
        VALUES (?, ?, ?, ?, ?, ?, 'done', 'high', ?, ?, ?, ?)`,
        [uuid(), projId3, `ATLAS-${cnum}`, cnum, c.title, c.type, userIds[0], userIds[0], eid, ci]);
    });
  });
```

- [ ] **Step 3: Update the epics test**

In `backend/tests/backend/epics.test.js`, change every `30` to `32` in the dogfood seed test (the test name, `epics.body.length`, and the done-count assertion), update the comment to append `+ 2 wiki-link`, and add:

```js
    expect(epics.body.some((e) => e.title === 'Page back-links')).toBe(true);
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd backend && npx jest --runInBand --forceExit`
Expected: PASS — all suites, no failures

- [ ] **Step 5: Run the E2E suite**

Run: `cd frontend && npx playwright test`
Expected: PASS — all specs

- [ ] **Step 6: Verify the MySQL migration path**

The migration runner's MySQL branch is not covered by the Jest suite. Verify migration 008 against real MySQL:

```bash
docker run -d --name atlas-mig-008 -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=atlas_008 -p 3399:3306 mysql:8.4
# wait for: docker exec atlas-mig-008 mysqladmin ping -h localhost -ptestpw
cd backend && DB_DRIVER=mysql MYSQL_HOST=127.0.0.1 MYSQL_PORT=3399 MYSQL_USER=root MYSQL_PASSWORD=testpw MYSQL_DATABASE=atlas_008 node -e "
const {initDb,getDb,queryAll}=require('./database');
(async()=>{await initDb();const db=await getDb();
const r=await queryAll(db,'SELECT id FROM schema_migrations ORDER BY id');
console.log('applied:', r.map(x=>x.id).join(', '));
const t=await queryAll(db,\"SHOW TABLES LIKE 'wiki_page_issues'\");
console.log('table present:', t.length===1);
})().catch(e=>{console.error('FAILED',e.message);process.exit(1)})"
docker rm -f atlas-mig-008
```
Expected: `008_wiki_page_issues` in the applied list, `table present: true`

- [ ] **Step 7: Commit and merge**

```bash
git add backend/database.js backend/tests/backend/epics.test.js frontend/e2e/wiki-issue-links.spec.ts
git commit -m "test(wiki-links): seed epics 31-32; epics test expects 32"
git push -u origin feature/wiki-issue-integration
git checkout dev
git merge --no-ff feature/wiki-issue-integration -m "Merge wiki ↔ issue integration wave (epics 31-32)"
cd backend && npx jest --runInBand --forceExit   # verify the merge before pushing
git push origin dev
```

---

## Verification Checklist

Before declaring the wave complete, confirm each of these by running the command and reading the output — not by assumption:

- [ ] Full backend suite passes (`npx jest --runInBand --forceExit` from `backend/`)
- [ ] E2E suite passes (`npx playwright test` from `frontend/`)
- [ ] Frontend typechecks and builds (`npx tsc --noEmit && npm run build`)
- [ ] Migration 008 applies on real MySQL (Task 10, Step 6)
- [ ] Backfill script runs against a copy of `data.db` and reports N > 0
- [ ] A restricted page is absent from `GET /api/issues/:id/pages` for a non-viewer
- [ ] `git status` is clean and `dev` is pushed
