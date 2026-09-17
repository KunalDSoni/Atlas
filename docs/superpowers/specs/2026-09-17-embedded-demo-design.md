# Embedded Demo Design

**Date:** September 17, 2026
**Status:** Design Approved
**Scope:** The landing page's product frame shows the real Atlas UI running on
sample data, and "Try the live demo" opens it full-page, with no login screen

---

## Summary

Today the landing page hero shows a hand-drawn board (`product-frame-views.tsx`),
and "Try the live demo" signs the visitor into a real account on the server's
database, where anyone can change what the next visitor sees.

This replaces both with the approach open-sale.com uses (Spartan ADR-054): a
second build of the real frontend whose API client answers from recorded sample
data in the browser instead of the network. The landing frame embeds it in an
`<iframe>`; the demo buttons link to it. It opens signed in. There is no server
involved, so nothing a visitor does reaches a database.

## Decisions Made During Design

| Decision | Choice | Rationale |
|---|---|---|
| Fidelity | Doesn't need to be real | User's call; rules out running the backend in the browser |
| Changes | Four actions stick until reload; others are no-ops | Covers what visitors actually try, without ~145 hand-written handlers |
| Data source | Responses recorded off a freshly seeded local backend | The seed already exists; the recording is the demo's only data |
| Signed in as | The seeded admin | Every menu, including admin, is visible |
| Where | Landing product frame + full page at `/demo/` | Same build serves both |
| Backend `POST /api/auth/demo` | Left in place, unused by the frontend | No backend behaviour change in this work; remove separately |

## What visitors get

- **Landing page:** `ProductFrame` keeps its browser chrome and its Board /
  Roadmap / Insights tabs. The drawn views are replaced by an `<iframe>` of the
  demo. Tabs navigate the frame rather than swapping drawings. The visitor can
  click anything inside it.
- **`/demo/`:** all three "Try the live demo" buttons (nav, hero, closing CTA —
  every use of `DemoButton`) become plain links here. It opens on the
  dashboard, signed in.
- **Locally:** the same, at `http://localhost:<PORT>/demo/` and on `/`.

## Architecture

### One swap point

`request()` in `frontend/src/lib/api.ts` is the only place the SPA touches the
network for data. In the demo build it calls `demoRequest(path, options)` from
`src/demo/demo-api.ts` instead of `fetch`. No screen, hook or component knows it
is in a demo.

The switch is Vite's mode: `import.meta.env.MODE === 'demo'`. In the normal
build that condition is statically false, so the demo module and its fixtures
are dropped from the bundle.

### Demo-only adjustments

Each is a small branch on the same mode check:

| Where | Normal | Demo |
|---|---|---|
| `lib/api.ts` token | `localStorage['atlas_token']` | constant `'demo'`; never read from or written to storage |
| `hooks/use-projects.tsx` last project | `LAST_PROJECT_KEY` | `atlas_demo_` prefixed key |
| `hooks/use-live-events.tsx` | opens `EventSource('/api/stream')` | no-op |
| `App.tsx` router | `BrowserRouter` | `BrowserRouter basename="/demo"` |
| `App.tsx` `/login` | `LoginScreen` | `<Navigate to="/dashboard" replace />` |
| Sign out | clears token | reloads `/demo/` (resets the demo) |
| `lib/urls.ts` absolute URLs | origin + path | origin + `/demo` + path |
| Reports CSV export (`fetch` in `reports.tsx`) | downloads | no-op |

Because the demo never uses `atlas_token` or the real last-project key, a
visitor who is also signed in to the real app on the same origin is never
signed out or re-pointed by it.

### Build and serving

- `vite.config.ts`: in `demo` mode, `base: '/demo/'`, `outDir: 'build/demo'`,
  `emptyOutDir: false`.
- `frontend/package.json` `build`: `tsc -b && vite build && vite build --mode demo`.
  Order matters: the normal build empties `build/`, then the demo build writes
  into `build/demo/`. The Playwright configs already run `npm run build`, so e2e
  covers both.
- `backend/server.js`: `express.static` already serves `/demo/assets/*` and
  `/demo/`. Add one route before the SPA catch-all so deep links
  (`/demo/atl/board`) get `build/demo/index.html`, using the same
  `{ root }` form the existing fallback uses. `tests/backend/setup.js` mounts
  no SPA fallback, so it needs no change.

### Sample data

`frontend/scripts/capture-demo-fixtures.mjs`, run as `npm run demo:capture`:

1. Boots `backend/server.js` on a free port against a new temp SQLite file with
   `SEED_DEMO_DATA=true` — never against an existing database, so no real data
   can enter the fixtures.
2. With Playwright's Chromium, signs in as the seeded admin and visits every
   sidebar screen, plus each ATL issue page, recording every `GET /api/*`
   response body keyed by path + query string.
3. Writes `frontend/src/demo/fixtures.json` (committed).

Re-run it when screens start requesting new endpoints. Seeded dates are relative
to the capture day, so the sample sprint reads as dated months later; re-capture
refreshes it.

### In-memory store

`src/demo/demo-store.ts` holds a deep copy of the fixtures for the life of the
page. Pure functions, no DOM, unit-tested.

**Reads.** `GET` resolves in order:
1. Recorded response for the exact path + query.
2. `GET /issues/:id` or `/issues/by-key/:key` not recorded → the matching issue
   object found in any recorded response.
3. `GET /issues/:id/<collection>` not recorded (comments, activity, links,
   watchers, worklogs, attachments) → `[]`.
4. Anything else → 404 `ApiError`, which screens already handle.

**Writes that stick:**

| Action | Request | Effect |
|---|---|---|
| Move a card | `PUT /issues/:id/move` | merge body fields into every copy of that issue |
| Edit an issue | `PUT /issues/:id` | same |
| Create an issue | `POST /projects/:id/issues` | new issue (new id, next `KEY-n`, reporter = demo user, `created_at` now) appended to that project's recorded issue lists; returned |
| Add a comment | `POST /issues/:id/comments` | new comment (author = demo user) appended to that issue's comment list, creating it if absent; returned |

"Every copy" means a walk of all stored responses replacing fields on any object
whose `id` matches, so board, backlog, epics and the issue page agree.

**Every other write** returns success without changing the store: `POST`/`PUT`/
`PATCH` return the request body plus an `id` (from the path, or a new one);
`DELETE` returns `{ ok: true }`.

**Not recalculated:** dashboard counts, reports and sprint totals keep their
recorded values after a change.

### Landing frame

`product-frame.tsx` renders one `<iframe src="/demo/atl/board">` inside the
existing chrome (`title="A live Atlas workspace running on sample data"`,
`h-[40rem]` desktop, `h-[34rem]` below `md`). Tab clicks don't reload the frame,
which would discard the visitor's changes; they `postMessage`
`{ type: 'atlas-demo:navigate', path }` to it. The demo build listens for that
message, accepts it only when `event.origin === window.location.origin`, and
calls `navigate(path)`. Tab URLs move to `LANDING_COPY.frame.tabs` as a `path`
field beside the existing display `url`.

`product-frame-views.tsx` is deleted. `demo-button.tsx` becomes a link to
`/demo/`; `api.auth.demoLogin` and `AuthProvider.adoptSession` lose their only
caller and are removed. `backend/tests/backend/auth-demo.test.js` still covers
the backend route, which stays.

## Error handling

- Unrecorded read → 404 through the normal `ApiError` path; the screen shows
  its existing error state rather than crashing.
- Malformed fixture file → the demo build fails at import, not at runtime.
- A `postMessage` from another origin, or with an unknown `type`, is ignored.

## Testing

- **Unit (`src/demo/demo-store.test.ts`, vitest):** each sticking write updates
  every copy of the issue; create assigns the next key and appears in the
  project list; comment appears in the issue's list; an unhandled write leaves
  the store unchanged; the read fallbacks return the issue, `[]`, and 404.
- **E2E (`frontend/e2e/demo.spec.ts`):**
  - `/demo/` shows the dashboard with no redirect to `/login`
  - the landing frame's iframe renders ATL board cards; clicking the Roadmap tab
    changes the frame's screen
  - dragging a card to another column survives navigating away and back
  - a real session's `atlas_token` in localStorage is untouched after visiting
    `/demo/`
- **Bundle check:** the normal build's `build/assets` contains no fixture
  marker string.
- `npm run test:e2e`, `npm run test:e2e:empty`, `npm run lint` and the backend
  jest suite still pass.
