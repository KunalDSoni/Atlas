# Permanent Entity URLs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every project screen and every issue a permanent, human-readable URL (`/atlas/board`, `/atlas/ATLAS-3`), with the drawer and the full page rendering the same route.

**Architecture:** The project key becomes the first path segment and the source of truth for which project is open — `ProjectsProvider` derives `currentProject` from `useLocation()` instead of from `localStorage`. A `ProjectScope` layout owns the project-scoped route tree and renders the issue route two ways: as a full page normally, and as a sheet layered over the previous screen when history state carries a `background` location. The 45KB `issue-detail-sheet.tsx` splits so both shells render one body.

**Tech Stack:** React 18, react-router-dom 7, Vite, TypeScript, Tailwind 4; Express 5 + sql.js/mysql2 on the backend; Jest + supertest for backend tests, Playwright for frontend behaviour.

**Spec:** `docs/superpowers/specs/2026-07-22-entity-urls-design.md`

## Global Constraints

- Issue keys match `^[A-Z][A-Z0-9]*-\d+$`. Project keys in URLs are lowercase; matching is case-insensitive.
- A project key is derived from an issue key by splitting on the **last** hyphen — hyphenated project keys must survive.
- `lib/urls.ts` (frontend) and `utils/links.js` (backend) are the only places that format an app route. Nothing else builds a path by string concatenation.
- UUIDs stay the primary key in every API call. They must not appear in any URL the user sees.
- Legacy paths (`/board`, `/backlog`, `/epics`, `/roadmap`, `/sprints`, `/releases`, `/reports`, `/automation`, `/servicedesk/*`) keep working forever via redirect — old notification rows and browser bookmarks hold them.
- The nine project screens move under `/:projectKey/`. `dashboard`, `product/*`, `wiki/*`, `portal`, `admin/*`, `profile`, `settings`, `login`, `help/*` do **not** move.
- Backend tests: `cd backend && npx jest tests/backend/<file> --runInBand --forceExit`.
- E2E: `cd frontend && npx playwright test e2e/<file>`. ⚠️ E2E cannot run from a `.claude/worktrees` checkout — Express `sendFile` 404s on dot-segment paths. From a worktree, boot the main checkout's backend with a scratch config.
- The frontend has no component unit-test runner. Frontend behaviour is proven with Playwright; that is the failing test to write first.

---

# Slice 1 — Foundation

### Task 1: `GET /api/issues/by-key/:key`

**Files:**
- Modify: `backend/routes/issues.js` (add route beside `GET /issues/:id` at line 332)
- Test: `backend/tests/backend/entity-urls.test.js` (create)

**Interfaces:**
- Produces: `GET /api/issues/by-key/:key` → the same enriched issue body as `GET /api/issues/:id`; 404 `{ error: 'Issue not found' }` when no row matches; 401 when unauthenticated.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/entity-urls.test.js`:

```js
/**
 * ENTITY URL TESTS
 * Tests: issue lookup by human-readable key, notification link format,
 * project key immutability. These back the permanent-URL scheme
 * (/atlas/ATLAS-3) — see docs/superpowers/specs/2026-07-22-entity-urls-design.md
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId, seeded;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
  const issues = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
  seeded = issues.body[0];
});

describe('GET /api/issues/by-key/:key', () => {
  test('returns the issue for a human-readable key', async () => {
    const res = await request(app).get(`/api/issues/by-key/${seeded.issue_key}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seeded.id);
    expect(res.body.issue_key).toBe(seeded.issue_key);
  });

  test('matches the key case-insensitively', async () => {
    const res = await request(app)
      .get(`/api/issues/by-key/${seeded.issue_key.toLowerCase()}`)
      .set(headers);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seeded.id);
  });

  test('returns the same body as the by-id endpoint', async () => {
    const byKey = await request(app).get(`/api/issues/by-key/${seeded.issue_key}`).set(headers);
    const byId = await request(app).get(`/api/issues/${seeded.id}`).set(headers);
    expect(byKey.body).toEqual(byId.body);
  });

  test('404s for an unknown key', async () => {
    const res = await request(app).get('/api/issues/by-key/NOPE-9999').set(headers);
    expect(res.status).toBe(404);
  });

  test('401s without a session', async () => {
    const res = await request(app).get(`/api/issues/by-key/${seeded.issue_key}`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js --runInBand --forceExit`
Expected: FAIL — the by-key requests return 404 because no such route exists.

- [ ] **Step 3: Add the route**

In `backend/routes/issues.js`, immediately **before** the existing `// GET /api/issues/:id` block (line 332), insert:

```js
// GET /api/issues/by-key/:key — resolve a human-readable key (ATLAS-3).
// This is what makes /atlas/ATLAS-3 a bootable URL: the page has a key, not a
// UUID, and must not have to guess an id before it can render.
//
// Authorisation is deliberate parity with GET /issues/:id below — requireAuth,
// and clients never arrive because middleware/servicedesk.blockClients is
// mounted ahead of this router. There is no per-project read filter on issues
// today and this endpoint does not invent one.
router.get('/issues/by-key/:key', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE UPPER(issue_key) = ?',
      [String(req.params.key).toUpperCase()]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(await enrichIssue(db, issue));
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js --runInBand --forceExit`
Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm nothing else broke**

Run: `cd backend && npx jest tests/backend/issues.test.js --runInBand --forceExit`
Expected: PASS — `/issues/by-key/X` has three segments and cannot shadow `/issues/:id`.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/issues.js backend/tests/backend/entity-urls.test.js
git commit -m "feat(issues): look an issue up by its human-readable key"
```

---

### Task 2: Notification links point at the new URLs

**Files:**
- Create: `backend/utils/links.js`
- Modify: `backend/routes/comments.js:81,90`, `backend/routes/issues.js:410`, `backend/utils/automation.js:49`
- Test: `backend/tests/backend/entity-urls.test.js` (append)

**Interfaces:**
- Produces: `require('../utils/links').issueLink(issueKey)` → `'/atlas/ATLAS-3'`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/entity-urls.test.js`:

```js
describe('issueLink', () => {
  const { issueLink } = require('../../utils/links');

  test('builds the permanent path for an issue key', () => {
    expect(issueLink('ATLAS-3')).toBe('/atlas/ATLAS-3');
  });

  test('splits on the last hyphen so hyphenated project keys survive', () => {
    expect(issueLink('MY-TEAM-42')).toBe('/my-team/MY-TEAM-42');
  });

  test('tolerates a key with no number suffix rather than throwing', () => {
    expect(issueLink('WEIRD')).toBe('/weird/WEIRD');
  });
});

describe('notification links', () => {
  test('an assignment notification links to the permanent issue URL', async () => {
    const { userHeaders } = require('./setup');
    const assigneeHeaders = await userHeaders();
    const me = await request(app).get('/api/auth/me').set(assigneeHeaders);

    const created = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Notify me', type: 'task' });

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .set(headers)
      .send({ assignee_id: me.body.id });

    const notifications = await request(app).get('/api/notifications').set(assigneeHeaders);
    const hit = notifications.body.find((n) => n.issue_id === created.body.id);
    expect(hit).toBeDefined();
    expect(hit.link).toBe(`/${created.body.issue_key.split('-')[0].toLowerCase()}/${created.body.issue_key}`);
    expect(hit.link).not.toContain('?issue=');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../utils/links'`.

- [ ] **Step 3: Write the helper**

Create `backend/utils/links.js`:

```js
/**
 * In-app paths for entities. The frontend has a mirror of this in
 * frontend/src/lib/urls.ts — these two files are the only places in the system
 * that know how a route is spelled.
 */

/**
 * Permanent path for an issue: ATLAS-3 -> /atlas/ATLAS-3.
 *
 * Splits on the LAST hyphen, not the first: a project key may itself contain
 * hyphens (MY-TEAM-42 belongs to MY-TEAM, not to MY).
 */
function issueLink(issueKey) {
  const key = String(issueKey);
  const cut = key.lastIndexOf('-');
  const projectKey = cut > 0 ? key.slice(0, cut) : key;
  return `/${projectKey.toLowerCase()}/${key}`;
}

module.exports = { issueLink };
```

- [ ] **Step 4: Use it at all four call sites**

`backend/routes/issues.js` — add to the requires at the top:

```js
const { issueLink } = require('../utils/links');
```

and at line 410 replace `link: \`/board?issue=${issue.id}\`,` with:

```js
        link: issueLink(issue.issue_key),
```

`backend/routes/comments.js` — add the same require, then replace **both** occurrences (lines 81 and 90) of `link: \`/board?issue=${issue.id}\`, issueId: issue.id,` with:

```js
          link: issueLink(issue.issue_key), issueId: issue.id,
```

`backend/utils/automation.js` — add the require, then replace line 49's `link: \`/board?issue=${issue.id}\`,` with:

```js
            link: issueLink(issue.issue_key),
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js tests/backend/comments.test.js --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/utils/links.js backend/routes/issues.js backend/routes/comments.js backend/utils/automation.js backend/tests/backend/entity-urls.test.js
git commit -m "feat(notifications): link to permanent issue URLs instead of ?issue=<uuid>"
```

---

### Task 3: Freeze the project key

**Files:**
- Modify: `backend/routes/projects.js:68-72`
- Modify: `frontend/src/screens/admin-projects.tsx`
- Test: `backend/tests/backend/entity-urls.test.js` (append)

**Interfaces:**
- Produces: `PUT /api/projects/:id` silently ignores a `key` in the body. Every other field behaves as before.

Rationale for the reviewer: `issues.issue_key` is denormalised, so a key rename already leaves every issue holding a stale key. Under a URL scheme built on keys, a rename would also break every shared link. A key is an identity, not a label.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backend/entity-urls.test.js`:

```js
describe('project keys are immutable', () => {
  test('PUT ignores an attempt to change the key', async () => {
    const before = await request(app).get(`/api/projects/${projectId}`).set(headers);
    const res = await request(app)
      .put(`/api/projects/${projectId}`)
      .set(headers)
      .send({ key: 'RENAMED' });

    expect(res.status).toBe(200);
    const after = await request(app).get(`/api/projects/${projectId}`).set(headers);
    expect(after.body.key).toBe(before.body.key);
  });

  test('the name is still editable alongside a rejected key', async () => {
    const res = await request(app)
      .put(`/api/projects/${projectId}`)
      .set(headers)
      .send({ key: 'RENAMED', name: 'Renamed Project' });

    expect(res.status).toBe(200);
    const after = await request(app).get(`/api/projects/${projectId}`).set(headers);
    expect(after.body.name).toBe('Renamed Project');
    expect(after.body.key).not.toBe('RENAMED');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js --runInBand --forceExit`
Expected: FAIL — the key comes back as `RENAMED`.

- [ ] **Step 3: Drop `key` from the accepted fields**

In `backend/routes/projects.js`, change the destructure at line 68 and delete the key update at line 72:

```js
    // `key` is deliberately absent: it is an identity, not a label. It is baked
    // into every issue_key (ATLAS-3) and into every shared URL (/atlas/ATLAS-3),
    // so renaming it would strand both. Create a new project instead.
    const { name, description, lead_id, status, wip_limits, is_service_desk } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js tests/backend/projects.test.js --runInBand --forceExit`
Expected: PASS. If `projects.test.js` has a test asserting a key can be renamed, invert it to assert the key is preserved and note the spec in the test name.

- [ ] **Step 5: Make the field read-only in the admin UI**

In `frontend/src/screens/admin-projects.tsx`, find the edit form's key `<Input>` and add `disabled` plus a hint. Leave the create form alone — a key is chosen at creation:

```tsx
<div className="grid gap-1.5">
  <Label htmlFor="edit-key">Key</Label>
  <Input id="edit-key" value={draft.key} disabled />
  <p className="text-xs text-muted-foreground">
    A project key is permanent — it is part of every issue key and every shared link.
  </p>
</div>
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/projects.js frontend/src/screens/admin-projects.tsx backend/tests/backend/entity-urls.test.js
git commit -m "feat(projects): freeze the project key after creation"
```

---

### Task 4: URL helpers and the by-key API client

**Files:**
- Create: `frontend/src/lib/urls.ts`
- Modify: `frontend/src/lib/api.ts:229-242` (the `issues` block)

**Interfaces:**
- Produces:
  - `isIssueKey(s: string): boolean`
  - `projectKeyOf(issueKey: string): string` — `'ATLAS-3'` → `'atlas'`
  - `projectUrl(projectKey: string, screen?: string): string` — default screen `'board'`
  - `issueUrl(issueKey: string): string` — `'/atlas/ATLAS-3'`
  - `absoluteUrl(path: string): string`
  - `PROJECT_SCREENS: readonly string[]`
  - `api.issues.getByKey(key: string): Promise<Issue>`
- Consumes: `GET /api/issues/by-key/:key` from Task 1.

No test of its own — every consumer in Tasks 5–11 exercises it, and the e2e in Task 11 is the gate. Adding a Jest runner to the frontend for three pure functions is not worth the config.

- [ ] **Step 1: Write the helpers**

Create `frontend/src/lib/urls.ts`:

```ts
/**
 * The only place the frontend spells an app route.
 *
 * The project key is the first path segment and the source of truth for which
 * project is open: /atlas/board is project ATLAS whoever opens it, which is
 * what makes a pasted link mean the same thing to two people.
 *
 * backend/utils/links.js mirrors issueUrl for notification links. Keep them
 * in step.
 */

/** ATLAS-3, US-101, MY-TEAM-42. Screen segments are lowercase, so this never
 *  collides with /atlas/board. */
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*-\d+$/;

/** The nine screens that live under a project key. */
export const PROJECT_SCREENS = [
  'board', 'backlog', 'epics', 'roadmap', 'sprints',
  'releases', 'reports', 'automation', 'servicedesk',
] as const;

export function isIssueKey(segment: string): boolean {
  return ISSUE_KEY.test(segment);
}

/**
 * The project an issue key belongs to: ATLAS-3 -> atlas.
 * Splits on the LAST hyphen — MY-TEAM-42 belongs to MY-TEAM, not to MY.
 */
export function projectKeyOf(issueKey: string): string {
  const cut = issueKey.lastIndexOf('-');
  return (cut > 0 ? issueKey.slice(0, cut) : issueKey).toLowerCase();
}

export function projectUrl(projectKey: string, screen: string = 'board'): string {
  return `/${projectKey.toLowerCase()}/${screen}`;
}

/** Permanent path for an issue. The project is derivable from the key, so
 *  callers never have to know which project they are linking into. */
export function issueUrl(issueKey: string): string {
  return `/${projectKeyOf(issueKey)}/${issueKey.toUpperCase()}`;
}

/** For Copy Link — a URL that survives being pasted into Slack. */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
```

- [ ] **Step 2: Add the API client method**

In `frontend/src/lib/api.ts`, inside the `issues` block, below `get:`:

```ts
    get: (id: string) => get<Issue>(`/issues/${id}`),
    /** Boot an issue straight from its URL — /atlas/ATLAS-3 has a key, not an id. */
    getByKey: (key: string) => get<Issue>(`/issues/by-key/${encodeURIComponent(key)}`),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/urls.ts frontend/src/lib/api.ts
git commit -m "feat(urls): one helper module for every app route"
```

---

### Task 5: Project-scoped routing

**Files:**
- Create: `frontend/src/components/app/project-scope.tsx`
- Create: `frontend/src/screens/not-found.tsx`
- Modify: `frontend/src/App.tsx:93-143`
- Modify: `frontend/src/hooks/use-projects.tsx`

**Interfaces:**
- Consumes: `projectUrl`, `isIssueKey`, `PROJECT_SCREENS` from Task 4.
- Produces:
  - `<ProjectScope />` — the layout for `/:projectKey/*`; resolves the key, renders the project route tree.
  - `<ProjectNotFound requestedKey={string} />` and `<IssueNotFound issueKey={string} />` from `screens/not-found.tsx`.
  - `useProjects()` keeps its existing shape; `currentProject` is now derived from the URL and `setCurrentProjectId(id)` navigates.

- [ ] **Step 1: Write the failing e2e test**

Create `frontend/e2e/deep-links.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

test.describe('project-scoped URLs', () => {
  test('the board lives under its project key', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    await expect(page).toHaveURL(/\/atlas\/board/);
    await assertNoCrash(page);
  });

  test('a bare project key lands on the board', async ({ page }) => {
    await login(page);
    await page.goto('/atlas');
    await expect(page).toHaveURL(/\/atlas\/board/);
  });

  test('an unknown project key says so instead of silently redirecting', async ({ page }) => {
    await login(page);
    await page.goto('/nosuchproject/board');
    await expect(page.getByText(/project not found/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts`
Expected: FAIL — `/atlas/board` falls through the catch-all to `/dashboard`.

- [ ] **Step 3: Write the not-found screens**

Create `frontend/src/screens/not-found.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/hooks/use-projects';
import { projectUrl } from '@/lib/urls';

function Shell({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * A wrong link should say it is wrong. Silently redirecting to whatever project
 * the visitor happens to remember is how you end up with two people insisting
 * they are looking at the same page.
 */
export function ProjectNotFound({ requestedKey }: { requestedKey: string }) {
  const { projects } = useProjects();
  const fallback = projects[0];
  return (
    <Shell
      title="Project not found"
      detail={`There is no project with the key "${requestedKey}", or you do not have access to it.`}
    >
      {fallback && (
        <Button asChild>
          <Link to={projectUrl(fallback.key)}>Go to {fallback.name}</Link>
        </Button>
      )}
    </Shell>
  );
}

export function IssueNotFound({ issueKey }: { issueKey: string }) {
  const { currentProject } = useProjects();
  return (
    <Shell
      title="Issue not found"
      detail={`${issueKey} does not exist, or it has been deleted.`}
    >
      {currentProject && (
        <Button asChild variant="outline">
          <Link to={projectUrl(currentProject.key)}>Back to the board</Link>
        </Button>
      )}
    </Shell>
  );
}
```

- [ ] **Step 4: Derive the current project from the URL**

Rewrite `frontend/src/hooks/use-projects.tsx`. The context shape is unchanged so no screen needs touching:

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { isIssueKey } from '@/lib/urls';
import type { Project } from '@/lib/types';

interface ProjectsContextValue {
  projects: Project[];
  currentProject: Project | null;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);
const LAST_PROJECT_KEY = 'atlas_last_project';

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [remembered, setRemembered] = useState<string | null>(
    () => localStorage.getItem(LAST_PROJECT_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.projects.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    void reload();
  }, [user, reload]);

  // The URL is the source of truth. Deriving synchronously rather than syncing
  // into state in an effect matters: an effect would let the board render one
  // frame against the PREVIOUS project and fire a wasted round of fetches.
  const routeKey = location.pathname.split('/')[1] ?? '';
  const fromRoute = projects.find((p) => p.key.toLowerCase() === routeKey.toLowerCase()) ?? null;

  // localStorage now has exactly one job: where a project-less screen points.
  const currentProject = fromRoute
    ?? projects.find((p) => p.id === remembered)
    ?? projects[0]
    ?? null;

  useEffect(() => {
    if (fromRoute) {
      localStorage.setItem(LAST_PROJECT_KEY, fromRoute.id);
      setRemembered(fromRoute.id);
    }
  }, [fromRoute]);

  /**
   * Switching project is a navigation, not a state change — that is the whole
   * point of the scheme. You keep the screen you were on, under the new key.
   */
  const setCurrentProjectId = useCallback((id: string) => {
    const next = projects.find((p) => p.id === id);
    if (!next) return;
    localStorage.setItem(LAST_PROJECT_KEY, id);
    setRemembered(id);

    // On a global screen (/dashboard, /wiki) there is nothing to re-scope.
    if (!fromRoute) return;

    const rest = location.pathname.split('/').filter(Boolean).slice(1);
    // ATLAS-3 has no counterpart in another project, so fall back to the board.
    const screen = rest.length === 0 || isIssueKey(rest[0]) ? 'board' : rest.join('/');
    navigate(`/${next.key.toLowerCase()}/${screen}`);
  }, [projects, fromRoute, location.pathname, navigate]);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      currentProject,
      currentProjectId: currentProject?.id ?? null,
      setCurrentProjectId,
      loading,
      error,
      reload,
    }),
    [projects, currentProject, setCurrentProjectId, loading, error, reload],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}
```

- [ ] **Step 5: Write the project scope layout**

Create `frontend/src/components/app/project-scope.tsx`. The issue route is declared last; React Router ranks static segments above dynamic ones, so `board` always beats `:issueKey`:

```tsx
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useProjects } from '@/hooks/use-projects';
import { ProjectNotFound } from '@/screens/not-found';

const Board = lazy(() => import('@/screens/board'));
const Backlog = lazy(() => import('@/screens/backlog'));
const Epics = lazy(() => import('@/screens/epics'));
const Sprints = lazy(() => import('@/screens/sprints'));
const Releases = lazy(() => import('@/screens/releases'));
const Roadmap = lazy(() => import('@/screens/roadmap'));
const Automation = lazy(() => import('@/screens/automation'));
const Reports = lazy(() => import('@/screens/reports'));
const ServiceDeskQueues = lazy(() => import('@/screens/servicedesk-queues'));
const ServiceDeskSettings = lazy(() => import('@/screens/servicedesk-settings'));
const ServiceDeskReport = lazy(() => import('@/screens/servicedesk-report'));
const IssuePage = lazy(() => import('@/screens/issue'));

function Spinner() {
  return (
    <div className="grid h-64 place-items-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Everything under /:projectKey. The key is resolved once, here. */
export function ProjectScope() {
  const { projectKey = '' } = useParams<{ projectKey: string }>();
  const { projects, loading } = useProjects();

  const known = projects.some((p) => p.key.toLowerCase() === projectKey.toLowerCase());
  if (loading && projects.length === 0) return <Spinner />;
  if (!known) return <ProjectNotFound requestedKey={projectKey} />;

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="" element={<Navigate to="board" replace />} />
        <Route path="board" element={<Board />} />
        <Route path="backlog" element={<Backlog />} />
        <Route path="epics" element={<Epics />} />
        <Route path="roadmap" element={<Roadmap />} />
        <Route path="sprints" element={<Sprints />} />
        <Route path="releases" element={<Releases />} />
        <Route path="reports" element={<Reports />} />
        <Route path="automation" element={<Automation />} />
        <Route path="servicedesk" element={<ServiceDeskQueues />} />
        <Route path="servicedesk/settings" element={<ServiceDeskSettings />} />
        <Route path="servicedesk/report" element={<ServiceDeskReport />} />
        <Route path=":issueKey" element={<IssuePage />} />
      </Routes>
    </Suspense>
  );
}
```

- [ ] **Step 6: Stub the issue page so the route resolves**

Create `frontend/src/screens/issue.tsx` — Task 9 fills it in:

```tsx
import { useParams } from 'react-router-dom';
import { isIssueKey } from '@/lib/urls';
import { IssueNotFound } from '@/screens/not-found';

export default function IssuePage() {
  const { issueKey = '' } = useParams<{ issueKey: string }>();
  if (!isIssueKey(issueKey)) return <IssueNotFound issueKey={issueKey} />;
  return <div className="p-6 font-mono">{issueKey.toUpperCase()}</div>;
}
```

- [ ] **Step 7: Wire the routes into App.tsx**

In `frontend/src/App.tsx`, delete the eleven `lazy()` declarations now owned by `ProjectScope` (Board, Backlog, Epics, Sprints, Releases, Roadmap, Automation, Reports, ServiceDeskQueues, ServiceDeskSettings, ServiceDeskReport), import `ProjectScope`, and replace the route list inside `ProtectedLayout`:

```tsx
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wiki" element={<WikiHome />} />
              <Route path="/wiki/space/:spaceId" element={<WikiSpace />} />
              <Route path="/wiki/page/:pageId" element={<WikiPage />} />
              <Route path="/product/insights" element={<ProductInsights />} />
              <Route path="/product/features" element={<ProductFeatures />} />
              <Route path="/product/prioritize" element={<ProductPrioritize />} />
              <Route path="/product/roadmap" element={<ProductRoadmap />} />
              <Route path="/product/objectives" element={<ProductObjectives />} />
              <Route path="/product/customers" element={<ProductCustomers />} />
              <Route path="/portal" element={<Portal />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={<RequireAdmin><AdminOverview /></RequireAdmin>} />
              <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
              <Route path="/admin/projects" element={<RequireAdmin><AdminProjects /></RequireAdmin>} />
              <Route path="/admin/audit-log" element={<RequireAdmin><AuditLog /></RequireAdmin>} />
              {/*
                Declared after every static path. React Router ranks static
                segments above dynamic ones, so /dashboard and /wiki/... are
                never swallowed by :projectKey.
              */}
              <Route path="/:projectKey/*" element={<ProjectScope />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
```

- [ ] **Step 8: Run the e2e and watch it pass**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/app/project-scope.tsx frontend/src/screens/not-found.tsx frontend/src/screens/issue.tsx frontend/src/hooks/use-projects.tsx frontend/e2e/deep-links.spec.ts
git commit -m "feat(routing): scope the nine project screens under /:projectKey"
```

---

### Task 6: Legacy redirects

**Files:**
- Create: `frontend/src/components/app/legacy-redirect.tsx`
- Modify: `frontend/src/App.tsx` (add legacy routes above `/:projectKey/*`)

**Interfaces:**
- Consumes: `projectUrl`, `issueUrl` from Task 4; `api.issues.get` for resolving a legacy `?issue=<uuid>`.
- Produces: `<LegacyProjectRedirect screen={string} />`.

Every notification row written before Task 2 holds `/board?issue=<uuid>`, and browsers hold bookmarks. These paths must resolve forever.

- [ ] **Step 1: Write the failing test**

Append to `frontend/e2e/deep-links.spec.ts`:

```ts
test.describe('legacy URLs keep working', () => {
  test('a bare legacy screen redirects to the remembered project', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');       // establishes the remembered project
    await page.goto('/backlog');
    await expect(page).toHaveURL(/\/atlas\/backlog/);
  });

});
```

The companion test — that an old `/board?issue=<uuid>` link resolves to the permanent URL — needs the `data-issue-id` attribute that Task 9 adds to the board card, so it is written in Task 9 rather than here. Do not write a test now that cannot pass now.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts -g "bare legacy screen"`
Expected: FAIL — `/backlog` hits the catch-all and lands on `/dashboard`.

- [ ] **Step 3: Write the redirect component**

Create `frontend/src/components/app/legacy-redirect.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { issueUrl, projectUrl } from '@/lib/urls';

/**
 * The pre-URL-scheme paths: /board, /backlog, ... and /board?issue=<uuid>.
 *
 * These are not dead weight. Notification rows written before this change are
 * still in the database holding /board?issue=<uuid>, emails carrying them are
 * still in inboxes, and browsers still hold bookmarks. They resolve forever.
 */
export function LegacyProjectRedirect({ screen }: { screen: string }) {
  const [params] = useSearchParams();
  const { currentProject, loading } = useProjects();
  const legacyIssueId = params.get('issue');
  const [issuePath, setIssuePath] = useState<string | null>(null);
  const [resolved, setResolved] = useState(!legacyIssueId);

  useEffect(() => {
    if (!legacyIssueId) return;
    let live = true;
    api.issues.get(legacyIssueId)
      .then((issue) => { if (live) setIssuePath(issueUrl(issue.issue_key)); })
      .catch(() => undefined)
      .finally(() => { if (live) setResolved(true); });
    return () => { live = false; };
  }, [legacyIssueId]);

  if (loading || !resolved) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (issuePath) return <Navigate to={issuePath} replace />;
  if (!currentProject) return <Navigate to="/dashboard" replace />;
  return <Navigate to={projectUrl(currentProject.key, screen)} replace />;
}
```

- [ ] **Step 4: Register the legacy paths**

In `frontend/src/App.tsx`, import `LegacyProjectRedirect` and `PROJECT_SCREENS`, then insert immediately **above** the `/:projectKey/*` route:

```tsx
              {/* Pre-scheme paths. Static, so they outrank :projectKey. */}
              {PROJECT_SCREENS.map((screen) => (
                <Route
                  key={screen}
                  path={`/${screen}`}
                  element={<LegacyProjectRedirect screen={screen} />}
                />
              ))}
              <Route path="/servicedesk/settings" element={<LegacyProjectRedirect screen="servicedesk/settings" />} />
              <Route path="/servicedesk/report" element={<LegacyProjectRedirect screen="servicedesk/report" />} />
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts -g "bare legacy screen"`
Expected: PASS.

- [ ] **Step 6: Confirm the existing smoke suite still passes**

Run: `cd frontend && npx playwright test e2e/smoke.spec.ts`
Expected: PASS — `smoke.spec.ts:18-25` navigates to `/board`, `/backlog`, … and now goes through the redirects.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/app/legacy-redirect.tsx frontend/src/App.tsx frontend/e2e/deep-links.spec.ts
git commit -m "feat(routing): keep every pre-scheme URL resolving"
```

---

### Task 7: Every link goes through `urls.ts`

**Files:**
- Modify: `frontend/src/components/app/app-shell.tsx:36-65` (nav tables), and the `NavSection` render
- Modify: `frontend/src/components/app/command-palette.tsx:112,135,158`
- Modify: `frontend/src/components/app/rich-text.tsx:352`
- Modify: `frontend/src/components/app/app-shell.tsx:251-254` (notification click)

**Interfaces:**
- Consumes: `issueUrl`, `projectUrl` from Task 4; `useProjects()` for the current key.
- Produces: no new exports. Every in-app link is built by `lib/urls.ts`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/e2e/deep-links.spec.ts`:

```ts
test.describe('navigation carries the project', () => {
  test('sidebar links are project-scoped', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    await page.getByRole('link', { name: 'Backlog' }).click();
    await expect(page).toHaveURL(/\/atlas\/backlog/);
  });

  test('switching project rewrites the URL and keeps the screen', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/backlog');
    await page.getByRole('button', { name: /switch project|atlas/i }).first().click();
    const other = page.getByRole('menuitem').filter({ hasNotText: /atlas/i }).first();
    await other.click();
    await expect(page).toHaveURL(/\/(?!atlas)[a-z0-9-]+\/backlog/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts -g "sidebar links"`
Expected: FAIL — the sidebar still points at `/backlog`, so the URL ends up `/atlas/backlog` only after a redirect round-trip, or at `/dashboard`.

- [ ] **Step 3: Make the project nav relative to the current project**

In `frontend/src/components/app/app-shell.tsx`, change `PROJECT_NAV` to carry screen names rather than paths, and move Dashboard into its own global entry:

```tsx
const GLOBAL_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
];

// `to` is a screen name here, resolved against the current project key at render.
const PROJECT_NAV: NavItem[] = [
  { to: 'board', label: 'Board', icon: Columns3 },
  { to: 'backlog', label: 'Backlog', icon: ListTodo },
  { to: 'epics', label: 'Epics', icon: Zap },
  { to: 'roadmap', label: 'Roadmap', icon: CalendarRange },
  { to: 'sprints', label: 'Sprints', icon: Rocket },
  { to: 'releases', label: 'Releases', icon: Package },
  { to: 'reports', label: 'Reports', icon: Gauge },
  { to: 'automation', label: 'Automation', icon: Zap },
];

const SERVICE_DESK_NAV: NavItem[] = [
  { to: 'servicedesk', label: 'Queues', icon: Headphones },
  { to: 'servicedesk/report', label: 'Report', icon: Gauge },
  { to: 'servicedesk/settings', label: 'Configuration', icon: SlidersHorizontal },
];
```

Where `PROJECT_NAV` and `SERVICE_DESK_NAV` are rendered, map through `projectUrl` first. Add near the top of the sidebar component, after `const { projects, currentProject, ... } = useProjects();`:

```tsx
  // A nav item without a project is a link to nowhere — hide the section until
  // projects have loaded rather than emitting /undefined/board.
  const scoped = (items: NavItem[]) =>
    currentProject ? items.map((i) => ({ ...i, to: projectUrl(currentProject.key, i.to) })) : [];
```

and pass `scoped(PROJECT_NAV)` / `scoped(SERVICE_DESK_NAV)` to `NavSection`, leaving `GLOBAL_NAV`, `PRODUCT_NAV`, `WIKI_NAV` and `ADMIN_NAV` as they are.

- [ ] **Step 4: Point the command palette at permanent URLs**

In `frontend/src/components/app/command-palette.tsx`, import `issueUrl` and replace both occurrences of the type-conditional navigation (lines 112 and 135):

```tsx
                  onSelect={() => run(() => navigate(issueUrl(i.issue_key)))}
```

```tsx
                      navigate(issueUrl(i.issue_key));
```

The `i.type === 'epic' ? '/epics?issue=' : '/board?issue='` branch disappears entirely — one URL serves every type, which was the point.

- [ ] **Step 5: Point rich-text issue chips at permanent URLs**

In `frontend/src/components/app/rich-text.tsx:352`, replace:

```tsx
    navigate(issueUrl(issueKey));
```

using the chip's `data-issue-key` attribute (already set at lines 159, 185 and 304) instead of the id. Import `issueUrl` from `@/lib/urls`.

- [ ] **Step 6: Notification clicks need no change**

`openNotification` already does `navigate(n.link)` (`app-shell.tsx:254`), and Task 2 changed what the server writes. Old rows are covered by Task 6. Verify by reading the function — no edit.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts -g "navigation carries"`
Expected: PASS, 2 tests.

- [ ] **Step 8: Typecheck and commit**

```bash
cd frontend && npm run lint
git add frontend/src/components/app/app-shell.tsx frontend/src/components/app/command-palette.tsx frontend/src/components/app/rich-text.tsx frontend/e2e/deep-links.spec.ts
git commit -m "feat(nav): build every in-app link from the URL helpers"
```

---

### Task 8: Split `issue-detail-sheet.tsx`

**Files:**
- Create: `frontend/src/components/app/issue-detail/use-issue-detail.ts`
- Create: `frontend/src/components/app/issue-detail/issue-detail-body.tsx`
- Create: `frontend/src/components/app/issue-detail/issue-fields.tsx`
- Create: `frontend/src/components/app/issue-detail/issue-tabs.tsx`
- Modify: `frontend/src/components/app/issue-detail-sheet.tsx` (down to the Sheet chrome)

**Interfaces:**
- Produces:
  - `useIssueDetail(issueId: string | null)` → `{ issue, comments, attachments, activity, watchers, members, sprints, epics, children, candidates, mentioningPages, worklogs, versions, components, loading, reload }`
  - `<IssueDetailBody detail={ReturnType<typeof useIssueDetail>} variant="sheet" | "page" onOpenIssue?={(issueKey: string) => void} />` — `onOpenIssue` receives an issue **key**, not an id, so the caller can build a URL from it
  - `<IssueFields …>` and `<IssueTabs …>` — consumed only by `IssueDetailBody`
  - `IssueDetailSheet` keeps its current props (`issueId`, `onOpenChange`, `onChanged`, `onOpenIssue`) and its import path, so Tasks 9's callers change once, deliberately.

This is a pure refactor: no behaviour changes, no test changes. The gate is that the existing suites stay green.

- [ ] **Step 1: Capture the current behaviour as a baseline**

Run: `cd frontend && npx playwright test`
Expected: PASS. Record the count. If anything is already red, stop and report it — do not refactor on top of a broken baseline.

- [ ] **Step 2: Extract the data layer**

Move the `load` callback and all sixteen `useState` declarations from `issue-detail-sheet.tsx:52-84` into `use-issue-detail.ts`, returning them as one object. Keep the thirteen-way `Promise.all` exactly as it is — it is already batched and its `.catch(() => [])` per call is deliberate. Export `reload` as the former `load`.

- [ ] **Step 3: Run the suite**

Run: `cd frontend && npx playwright test`
Expected: same PASS count as Step 1.

- [ ] **Step 4: Extract the field editors**

Move the right-hand column (status, assignee, priority, sprint, epic, story points, version, component, plus `LabelsEditor` and `CustomFieldsEditor`) into `issue-fields.tsx`. The `UNASSIGNED` / `NO_SPRINT` / `NO_EPIC` / `NO_VERSION` / `NO_COMPONENT` sentinels move with it.

- [ ] **Step 5: Extract the tabs**

Move the comments, activity, worklog and attachments tab panels into `issue-tabs.tsx`, along with the log-work dialog state (`logOpen`, `logHours`, `logComment`, `loggingWork`).

- [ ] **Step 6: Assemble the body**

`issue-detail-body.tsx` renders the header, description, subtasks and `LinkedIssues`, and composes `IssueFields` and `IssueTabs`. `variant` controls layout only — `"sheet"` stacks, `"page"` uses a two-column grid at `lg:`.

- [ ] **Step 7: Reduce the sheet to chrome**

`issue-detail-sheet.tsx` becomes the `Sheet` / `SheetContent` / `SheetHeader` wrapper around `<IssueDetailBody variant="sheet" />`, plus the `EditIssueDialog` and delete `AlertDialog` it already owns.

- [ ] **Step 8: Run the suite and the typechecker**

Run: `cd frontend && npm run lint && npx playwright test`
Expected: no type errors; same PASS count as Step 1.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/app/issue-detail frontend/src/components/app/issue-detail-sheet.tsx
git commit -m "refactor(issues): split the 45KB detail sheet into data, fields, tabs and body"
```

---

### Task 9: The issue page and the URL-backed drawer

**Files:**
- Modify: `frontend/src/screens/issue.tsx` (replace the Task 5 stub)
- Modify: `frontend/src/components/app/project-scope.tsx` (background-location rendering)
- Modify: `frontend/src/screens/board.tsx:138,148-166,720-725`
- Modify: `frontend/src/screens/backlog.tsx:345`, `frontend/src/screens/epics.tsx:152`, `frontend/src/screens/roadmap.tsx:229`

**Interfaces:**
- Consumes: `useIssueDetail`, `IssueDetailBody` (Task 8); `issueUrl`, `isIssueKey` (Task 4).
- Produces: clicking an issue anywhere calls `navigate(issueUrl(key), { state: { background: location } })`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/e2e/deep-links.spec.ts`:

```ts
test.describe('an issue is a place', () => {
  test('clicking a card pushes its URL and opens the drawer', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    const card = page.locator('[data-issue-key]').first();
    const key = await card.getAttribute('data-issue-key');
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/atlas/${key}$`));
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('back closes the drawer and returns to the board', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    await page.locator('[data-issue-key]').first().click();
    await page.goBack();
    await expect(page).toHaveURL(/\/atlas\/board/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the same URL opened cold renders a full page, not a drawer', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    const key = await page.locator('[data-issue-key]').first().getAttribute('data-issue-key');
    await page.goto(`/atlas/${key}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(key!, { exact: false }).first()).toBeVisible();
    await assertNoCrash(page);
  });

  test('an unknown issue key says so', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/ATLAS-999999');
    await expect(page.getByText(/issue not found/i)).toBeVisible();
  });

  // Deferred from Task 6: this needs the data-issue-id attribute added below.
  test('an old ?issue=<uuid> link resolves to the permanent URL', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    const card = page.locator('[data-issue-key]').first();
    const key = await card.getAttribute('data-issue-key');
    const id = await card.getAttribute('data-issue-id');
    await page.goto(`/board?issue=${id}`);
    await expect(page).toHaveURL(new RegExp(`/atlas/${key}`));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts -g "an issue is a place"`
Expected: FAIL — the cards have no `data-issue-key`, and `screens/issue.tsx` is still the stub.

- [ ] **Step 3: Write the issue page**

Replace `frontend/src/screens/issue.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { useIssueDetail } from '@/components/app/issue-detail/use-issue-detail';
import { IssueDetailBody } from '@/components/app/issue-detail/issue-detail-body';
import { CopyIssueLink } from '@/components/app/copy-issue-link';
import { IssueNotFound } from '@/screens/not-found';
import { isIssueKey, issueUrl, projectUrl } from '@/lib/urls';

/**
 * The full-page rendering of /:projectKey/:issueKey. Same route and same body
 * as the drawer — the only difference is that nothing is layered underneath,
 * which is exactly what "opened cold" means.
 */
export default function IssuePage() {
  const { issueKey = '' } = useParams<{ issueKey: string }>();
  const { currentProject } = useProjects();
  const navigate = useNavigate();
  const [issueId, setIssueId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isIssueKey(issueKey)) { setMissing(true); return; }
    let live = true;
    setMissing(false);
    api.issues.getByKey(issueKey)
      .then((issue) => { if (live) setIssueId(issue.id); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [issueKey]);

  const detail = useIssueDetail(issueId);

  if (missing) return <IssueNotFound issueKey={issueKey} />;
  if (!detail.issue) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to={projectUrl(currentProject?.key ?? '')}>
            <ChevronLeft className="size-4" /> Board
          </Link>
        </Button>
        <CopyIssueLink issueKey={detail.issue.issue_key} />
      </div>
      <IssueDetailBody
        detail={detail}
        variant="page"
        onOpenIssue={(key) => navigate(issueUrl(key))}
      />
    </div>
  );
}
```

- [ ] **Step 4: Render the drawer from the layout when there is a background**

In `frontend/src/components/app/project-scope.tsx`, add above the `<Routes>`:

```tsx
  const location = useLocation();
  const navigate = useNavigate();
  // Pushed by every issue link that had a screen underneath it. Its absence is
  // what a pasted link looks like — same route, no background, full page.
  const background = (location.state as { background?: Location } | null)?.background;
  const last = location.pathname.split('/').filter(Boolean)[1] ?? '';
  const asDrawer = Boolean(background) && isIssueKey(last);
```

then render the screens against the background and layer the sheet:

```tsx
    <Suspense fallback={<Spinner />}>
      <Routes location={asDrawer ? background : location}>
        {/* …unchanged route list… */}
      </Routes>
      {asDrawer && (
        <IssueSheetRoute issueKey={last} onClose={() => navigate(-1)} />
      )}
    </Suspense>
```

`IssueSheetRoute` is a small component in the same file that resolves the key to an id with `api.issues.getByKey` and renders `<IssueDetailSheet issueId={id} onOpenChange={(open) => !open && onClose()} />`.

> If React Router's descendant `<Routes location={…}>` misbehaves here — the background location is absolute while this tree is mounted under `/:projectKey/*` — hoist `asDrawer` and the sheet into `ProtectedLayout` in `App.tsx` and pass `location` to the top-level `<Routes>` instead. Same design, one level up.

- [ ] **Step 5: Write the copy-link button (needed by Step 3)**

Create `frontend/src/components/app/copy-issue-link.tsx`:

```tsx
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { absoluteUrl, issueUrl } from '@/lib/urls';

/** The point of the whole scheme: a link you can paste into Slack. */
export function CopyIssueLink({ issueKey }: { issueKey: string }) {
  async function copy() {
    const url = absoluteUrl(issueUrl(issueKey));
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
    <Button variant="outline" size="sm" className="gap-1.5" onClick={copy}>
      <Link2 className="size-3.5" /> Copy link
    </Button>
  );
}
```

Also render `<CopyIssueLink issueKey={issue.issue_key} />` in `issue-detail-sheet.tsx`'s `SheetHeader`, beside the existing edit and delete controls.

- [ ] **Step 6: Make the board navigate instead of setting state**

In `frontend/src/screens/board.tsx`:

- Add `data-issue-key={issue.issue_key}` and `data-issue-id={issue.id}` to the `IssueCard` root element.
- Delete `const [openIssueId, setOpenIssueId] = useState<string | null>(null);` (line 138), the `?issue=` effect (lines 155-158), `closeIssue` (lines 160-166), and the `<IssueDetailSheet>` block (lines 720-725).
- Change the card's `onOpen` to:

```tsx
  const location = useLocation();
  const openIssue = (issue: Issue) =>
    navigate(issueUrl(issue.issue_key), { state: { background: location } });
```

The board's existing `useLiveEvents` subscription (line 189) already refreshes it when an issue changes, so dropping `onChanged={load}` loses nothing.

- [ ] **Step 7: Do the same for backlog, epics and roadmap**

Each drops its `IssueDetailSheet` block and its `openIssueId` state and navigates instead. None of the three subscribes to live events, so `onChanged` did real work there — replace it by adding the same subscription the board uses, near their `load` callback:

```tsx
  useLiveEvents((e) => {
    if (e.type === 'issue' && e.projectId === currentProjectId) void load();
  });
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts`
Expected: PASS — including the `?issue=<uuid>` test from Task 6, which needed `data-issue-id`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/screens/issue.tsx frontend/src/components/app/project-scope.tsx frontend/src/components/app/copy-issue-link.tsx frontend/src/components/app/issue-detail-sheet.tsx frontend/src/screens/board.tsx frontend/src/screens/backlog.tsx frontend/src/screens/epics.tsx frontend/src/screens/roadmap.tsx frontend/e2e/deep-links.spec.ts
git commit -m "feat(issues): give every issue a page, and back the drawer with its URL"
```

---

### Task 10: Full verification and cleanup

**Files:**
- Modify: `frontend/e2e/smoke.spec.ts:18-25` (add the new canonical routes)
- Modify: `README.md` (document the URL scheme)

- [ ] **Step 1: Add the canonical routes to the smoke sweep**

In `frontend/e2e/smoke.spec.ts`, extend the `routes` array with the project-scoped forms, keeping the legacy ones so both paths stay covered:

```ts
    '/atlas', '/atlas/board', '/atlas/backlog', '/atlas/epics', '/atlas/roadmap',
    '/atlas/sprints', '/atlas/releases', '/atlas/reports', '/atlas/automation',
```

- [ ] **Step 2: Run every frontend test**

Run: `cd frontend && npx playwright test`
Expected: PASS, all specs.

- [ ] **Step 3: Run every backend test**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "?issue=" frontend/src backend/routes backend/utils`
Expected: matches only inside `legacy-redirect.tsx`. Anything else is a link that was missed.

- [ ] **Step 5: Document the scheme**

Add a short "URLs" section to `README.md` giving the route table from the spec and the rule that `lib/urls.ts` / `utils/links.js` are the only places routes are spelled.

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e/smoke.spec.ts README.md
git commit -m "test(e2e): cover the canonical project-scoped routes"
```

---

# Slice 2 — Sprints and releases

Do not start this until Slice 1 is merged. It depends on `ProjectScope` existing.

### Task 11: Slugs for sprints and releases

**Files:**
- Modify: `backend/migrations.js` (add migration `016`)
- Modify: `backend/routes/sprints.js`, `backend/routes/releases.js` (generate on create, return in payloads)
- Create: `backend/utils/slug.js`
- Test: `backend/tests/backend/entity-urls.test.js` (append)

**Interfaces:**
- Produces: `slugify(name: string): string`; `sprints.slug` and `versions.slug` columns, unique per project; both entities' API payloads carry `slug`.

- [ ] **Step 1: Write the failing test**

```js
describe('sprint and release slugs', () => {
  test('slugify makes a URL-safe segment', () => {
    const { slugify } = require('../../utils/slug');
    expect(slugify('Sprint 1')).toBe('sprint-1');
    expect(slugify('v1.2')).toBe('v1-2');
    expect(slugify('  Q3 — Hardening  ')).toBe('q3-hardening');
  });

  test('every seeded sprint has a slug', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    expect(res.status).toBe(200);
    for (const sprint of res.body) expect(sprint.slug).toMatch(/^[a-z0-9-]+$/);
  });

  test('slugs are unique within a project', async () => {
    const a = await request(app).post(`/api/projects/${projectId}/sprints`).set(headers).send({ name: 'Dupe' });
    const b = await request(app).post(`/api/projects/${projectId}/sprints`).set(headers).send({ name: 'Dupe' });
    expect(a.body.slug).toBe('dupe');
    expect(b.body.slug).toBe('dupe-2');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js --runInBand --forceExit`
Expected: FAIL — no `utils/slug`, no `slug` column.

- [ ] **Step 3: Write the slug helper**

Create `backend/utils/slug.js`:

```js
/** A URL segment from a human name: "Sprint 1" -> "sprint-1", "v1.2" -> "v1-2". */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}

/** Appends -2, -3, … until the slug is free within its project. */
function uniqueSlug(base, taken) {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

module.exports = { slugify, uniqueSlug };
```

- [ ] **Step 4: Add migration 016**

In `backend/migrations.js`, following the shape of migrations 011–015 (both the SQLite and MySQL arms):

```js
  {
    id: '016',
    name: 'sprint and release slugs',
    // Permanent URLs need a stable, human-readable segment. Backfilled from the
    // name once; generated on create thereafter and frozen, for the same reason
    // project keys are frozen — a slug is in every shared link.
    up: async (db) => {
      await addColumn(db, 'sprints', 'slug', 'TEXT');
      await addColumn(db, 'versions', 'slug', 'TEXT');
      for (const table of ['sprints', 'versions']) {
        const rows = await queryAll(db, `SELECT id, project_id, name FROM ${table} ORDER BY created_at`);
        const seen = {};
        for (const row of rows) {
          seen[row.project_id] = seen[row.project_id] || [];
          const slug = uniqueSlug(slugify(row.name), seen[row.project_id]);
          seen[row.project_id].push(slug);
          await run(db, `UPDATE ${table} SET slug = ? WHERE id = ?`, [slug, row.id]);
        }
      }
    },
  },
```

Match the existing file's exact `addColumn` / migration-record helpers — read migrations 011–015 first and follow them rather than inventing a shape.

- [ ] **Step 5: Generate slugs on create**

In `routes/sprints.js` and `routes/releases.js`, in each `POST` handler, before the `INSERT`:

```js
    const taken = (await queryAll(db, `SELECT slug FROM ${table} WHERE project_id = ?`, [projectId]))
      .map((r) => r.slug).filter(Boolean);
    const slug = uniqueSlug(slugify(name), taken);
```

and include `slug` in the insert columns. Do **not** accept a `slug` in `PUT` — it is frozen after creation.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd backend && npx jest tests/backend/entity-urls.test.js tests/backend/migrations.test.js tests/backend/sprints.test.js --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations.js backend/utils/slug.js backend/routes/sprints.js backend/routes/releases.js backend/tests/backend/entity-urls.test.js
git commit -m "feat(sprints,releases): stable slugs for permanent URLs"
```

---

### Task 12: Sprint and release detail pages

**Files:**
- Create: `frontend/src/screens/sprint-detail.tsx`
- Create: `frontend/src/screens/release-detail.tsx`
- Modify: `frontend/src/components/app/project-scope.tsx` (two routes)
- Modify: `frontend/src/screens/sprints.tsx`, `frontend/src/screens/releases.tsx` (link rows)
- Modify: `frontend/src/lib/urls.ts` (two helpers)
- Test: `frontend/e2e/deep-links.spec.ts` (append)

**Interfaces:**
- Consumes: `slug` on the sprint and version payloads (Task 11).
- Produces: `sprintUrl(projectKey, slug)`, `releaseUrl(projectKey, slug)`; routes `sprints/:sprintSlug` and `releases/:releaseSlug`.

- [ ] **Step 1: Write the failing test**

```ts
test.describe('sprints and releases are places', () => {
  test('a sprint row opens its own URL', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/sprints');
    await page.locator('[data-sprint-slug]').first().click();
    await expect(page).toHaveURL(/\/atlas\/sprints\/[a-z0-9-]+/);
    await assertNoCrash(page);
  });

  test('a release row opens its own URL', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/releases');
    await page.locator('[data-release-slug]').first().click();
    await expect(page).toHaveURL(/\/atlas\/releases\/[a-z0-9-]+/);
    await assertNoCrash(page);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts -g "are places"`
Expected: FAIL — no `data-sprint-slug` attribute and no route.

- [ ] **Step 3: Add the URL helpers**

In `frontend/src/lib/urls.ts`:

```ts
export const sprintUrl = (projectKey: string, slug: string) =>
  `/${projectKey.toLowerCase()}/sprints/${slug}`;

export const releaseUrl = (projectKey: string, slug: string) =>
  `/${projectKey.toLowerCase()}/releases/${slug}`;
```

- [ ] **Step 4: Write the sprint detail screen**

`frontend/src/screens/sprint-detail.tsx` reads `:sprintSlug`, finds the sprint in `api.sprints.list(currentProjectId)` by slug, and renders: name as the heading, goal, status pill, start and end dates, a `CopyLink` button built on `sprintUrl`, and the sprint's issues via `api.issues.list(projectId, sprint.id)` using the same `IssueCard`-style row the backlog uses. A slug with no match renders a not-found shell from `screens/not-found.tsx`.

- [ ] **Step 5: Write the release detail screen**

`frontend/src/screens/release-detail.tsx` is the same shape against `api.versions.list`: name, description, status, release date, Copy Link, and the issues whose `version_id` matches.

- [ ] **Step 6: Register the routes**

In `project-scope.tsx`, above the `:issueKey` route:

```tsx
        <Route path="sprints/:sprintSlug" element={<SprintDetail />} />
        <Route path="releases/:releaseSlug" element={<ReleaseDetail />} />
```

- [ ] **Step 7: Link the list rows**

In `sprints.tsx`, add `data-sprint-slug={sprint.slug}` to each row and wrap it in a `<Link to={sprintUrl(currentProject.key, sprint.slug)}>`. Same for `releases.tsx` with `data-release-slug`.

- [ ] **Step 8: Run the tests and watch them pass**

Run: `cd frontend && npx playwright test e2e/deep-links.spec.ts`
Expected: PASS, whole file.

- [ ] **Step 9: Full suite and commit**

```bash
cd frontend && npm run lint && npx playwright test
cd ../backend && npm test
git add frontend/src/screens/sprint-detail.tsx frontend/src/screens/release-detail.tsx frontend/src/components/app/project-scope.tsx frontend/src/screens/sprints.tsx frontend/src/screens/releases.tsx frontend/src/lib/urls.ts frontend/e2e/deep-links.spec.ts
git commit -m "feat(sprints,releases): dedicated pages at permanent URLs"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| URL scheme, nine screens move | 5 |
| Type not in the path | 5 (single `:issueKey` route) |
| Disambiguating board from ATLAS-3 | 4 (`isIssueKey`), 5 (route order) |
| Route param is the source of truth | 5 (`use-projects.tsx` rewrite) |
| `GET /api/issues/by-key/:key` | 1 |
| Drawer and page share one route | 9 |
| Splitting `issue-detail-sheet.tsx` | 8 |
| `lib/urls.ts` is the only formatter | 4, 7, 10 (grep gate) |
| Copy Link | 9 |
| Cross-project links | 4 (`projectKeyOf`), 7 |
| Back-compat for `?issue=<uuid>` and bare paths | 2, 6 |
| Project keys frozen | 3 |
| Error handling table | 5 (not-found screens), 9 (unknown key) |
| Backend tests | 1, 2, 3, 11 |
| Frontend e2e | 5, 6, 7, 9, 10, 12 |
| Slice 2 — slugs and detail pages | 11, 12 |
