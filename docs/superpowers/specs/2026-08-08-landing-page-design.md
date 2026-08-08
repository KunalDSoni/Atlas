# Public Landing Page Design

**Date:** August 8, 2026
**Status:** Design Approved
**Scope:** One-page public marketing site at `/`, plus one-click demo access

---

## Executive Summary

`open-atlas.xyz` currently has no homepage. A visitor to `/` falls through
`ProtectedLayout` → `RequireAuth` → `/login` and meets a password form for a
product they have never heard of. There is nothing to read, nothing to look at,
and no way in.

This spec designs a single-page public site that replaces that front door. It
describes Atlas's full capability surface, and hands anonymous visitors a
one-click route into a working, populated demo workspace.

**Visual reference:** Productboard's layout discipline (white ground, centred
oversized headline, one dominant product visual, heavy whitespace), rendered in
Atlas's existing blue palette.

**Approved layout mockup:** `https://claude.ai/code/artifact/3548c25b-dd62-4d84-ad41-b4119aae20c6`
The mockup is the visual contract for this spec. Where prose here and the mockup
disagree, the mockup wins on appearance; this document wins on behaviour.

---

## Decisions Made During Design

These were settled explicitly. They are recorded so implementation does not
relitigate them.

| Decision | Choice | Rationale |
|---|---|---|
| Primary CTA | Try the live demo | No self-serve signup exists; a demo beats a password wall |
| Demo access | Dedicated demo account, env-gated | Keeps `SEED_DEMO_DATA=false` and production data untouched |
| Demo freshness | Lazy re-seed, throttled to 6h | Self-healing without a scheduler or new dependency |
| Feature honesty | Everything, undifferentiated | User's explicit call — see Accepted Risks |
| Visual direction | Productboard clean, Atlas blue | Landing and app must read as one product |
| Product imagery | Built in HTML/CSS | Sharp, themeable, weightless, never stale |
| Architecture | React route inside the SPA | Page needs auth state, theme and the API client |

---

## Architecture

### Routing

`/` is currently swallowed by the `*` catch-all at
[App.tsx:163](../../../frontend/src/App.tsx). Add an explicit route above it:

```
<Route path="/" element={<LandingGate />} />
```

`LandingGate` reads `useAuth()`:

- `loading` → the existing `FullPageSpinner`
- no user → `<Landing />`
- user present → `<Navigate to="/dashboard" replace />`

Signed-in users never see marketing. Anonymous visitors never hit a password
wall. `/login` is unchanged and remains the real sign-in for the team; it simply
stops being the front door.

`Landing` is lazy-loaded via `React.lazy`, matching every other screen, so the
authenticated app bundle does not grow.

### Demo authentication

New endpoint `POST /api/auth/demo` in
[backend/routes/auth.js](../../../backend/routes/auth.js), placed beside
`/login` and reusing its exact session machinery: a `crypto.randomBytes(32)`
token, an insert into `sessions`, and the identical JSON response body. Because
the shape matches `/login`, the existing `AuthProvider` consumes it with no
changes.

Guards, all required:

1. **Env-gated.** If `DEMO_EMAIL` is unset the route responds `404`. Deployments
   that do not opt in behave exactly as they do today.
2. **Rate limited** using the existing `loginRateLimit` middleware, so the
   endpoint cannot be used to farm sessions.
3. **Role `user`, never `admin` or `board_admin`** — enforced at the route, not
   assumed from the seed. The lookup filters on `role = 'user'`, and the seeder
   refuses to adopt a pre-existing account whose role is anything else. Without
   both, pointing `DEMO_EMAIL` at an existing admin's address would hand an
   unauthenticated admin session to any visitor. A demo visitor can move cards
   and file issues inside the demo project; they cannot reach `/admin`, delete
   accounts, or read the audit log.
4. **Audit logged** as `Demo session started`, matching the `/login` pattern.

### Demo seeding and reset

A dedicated seed module, independent of `SEED_DEMO_DATA`, creates:

- one user from `DEMO_EMAIL` / `DEMO_NAME` with role `user`
- one project (`DEMO`) with a populated board, one active sprint, an epic,
  a handful of closed sprints for velocity history, a few wiki pages and a
  small set of product insights

The seed is idempotent — running it twice is a no-op.

**Reset is lazy, not scheduled.** `POST /api/auth/demo` reads the demo project's
`created_at`. If it is older than the reset interval, the project is dropped and
re-seeded before the session is issued.

No new table and no new column: because a reset deletes and recreates the
project, `created_at` *is* the last-reset timestamp by construction. There is no
global settings table in this schema — only `user_settings` — and deriving the
value avoids inventing one that would need migrating.

This self-heals vandalism, runs only when someone actually visits, needs no cron
process or new dependency, and cannot drift out of sync with the data it
describes.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DEMO_EMAIL` | no | Enables the demo route. Unset → `404` |
| `DEMO_NAME` | no | Display name, defaults to `Demo user` |
| `DEMO_RESET_HOURS` | no | Reset interval, defaults to `6` |

`render.yaml` gains `DEMO_EMAIL` with `sync: false`. `SEED_DEMO_DATA` stays
`"false"`. `.env.example` documents all three.

---

## Page Structure

Twelve blocks, top to bottom — eight distinct kinds, since blocks 5 through 9
are five instances of the same alternating row component.

**1 · Navigation.** Sticky, translucent, hairline bottom border. Atlas wordmark,
four anchor links, `Sign in` ghost button, `Try the live demo` primary button.
Below 860px the links collapse into a sheet. No theme toggle — see the note on
light theme below.

**2 · Hero.** Centred. Eyebrow pill, headline, sub-headline, dual CTA, then a
small-caps trust strip naming the seven product areas.

Headline: **"Your backlog and your roadmap, finally in the same tool"** — this
attacks the seam Atlassian and Productboard each leave open, which is the one
claim Atlas can make that neither competitor can.

**3 · Product frame.** The page's centrepiece: an Atlas application window built
entirely in HTML and CSS, with three working tabs.

| Tab | Content |
|---|---|
| Board | Sidebar rail, four workflow columns, realistic cards with keys, points, priority chips and assignee avatars |
| Roadmap | Four-quarter gantt, five themes, bars spanning quarters |
| Insights | Feedback inbox with demand meters, company chips, and a linked objective with progress |

Tab state is React state. The frame reads from the same design tokens as the
app, so it can never go stale the way a committed screenshot does. Under
`prefers-reduced-motion` all transitions are suppressed.

**Light theme only.** `theme-provider.tsx` states that Atlas is light-theme only
and strips any `.dark` class on mount. Dark values exist in `index.css` but
nothing consumes them. The landing page matches the app: no theme toggle in the
nav, no dark styling. If dark mode is ever enabled product-wide, the landing
page inherits it for free because it uses only semantic tokens — but turning it
on is separate work and out of scope here.

**4 · Delivery / Discovery split.** Two cards on a tinted band, stating the
product's actual thesis: the discovery-to-delivery handoff is where most teams
lose information, and Atlas removes it by keeping both halves on the same
objects.

**5–9 · Five alternating feature rows.** Copy one side, a purpose-built CSS
visual the other, flipping each row. Plan and track (a sprint board), Discovery
(a request inbox), Report (stat tiles and a burndown SVG), Support and knowledge
(an SLA queue), Platform (a webhook payload).

**10 · Capability index.** Every capability, ten pillars, multi-column, with a
live client-side filter. Match highlighting, per-pillar counts that recount as
the user types, and an empty state. The total is computed from the data at
render time so it cannot drift from the list.

**11 · Closing CTA.** Full-bleed accent band, one button.

**12 · Footer.** Wordmark, six links, copyright.

---

## Capability Index Content

**165 capabilities across ten pillars**, derived from the two existing
comparison documents:

| Pillar | Count |
|---|---|
| Plan | 16 |
| Track | 20 |
| Deliver | 11 |
| Discover | 26 |
| Collaborate | 12 |
| Automate | 7 |
| Report | 15 |
| Support and knowledge | 17 |
| Administer | 17 |
| Platform and integrations | 24 |

Sources: [JIRA_FEATURES_COMPARISON.md](../../JIRA_FEATURES_COMPARISON.md) (112
entries), [PRODUCTBOARD_FEATURES_COMPLETE.md](../../PRODUCTBOARD_FEATURES_COMPLETE.md)
(44) and [PRODUCTBOARD_FEATURES_REMAINING.md](../../PRODUCTBOARD_FEATURES_REMAINING.md)
(44), de-duplicated across the overlap between the two comparisons.

Ten pillars rather than the eight originally sketched: Automate and Platform
were distorting the groups they were nested inside, and ten balances the
columns.

**Entries carry no shipped / partial / planned distinction.** This is a
deliberate, user-approved choice — see Accepted Risks.

---

## Components and Files

Each file has one job. No file exceeds roughly 150 lines.

| Path | Responsibility |
|---|---|
| `frontend/src/screens/landing.tsx` | Composition only — imports sections, renders in order |
| `frontend/src/components/landing/landing-gate.tsx` | Auth branch: spinner, landing, or redirect |
| `frontend/src/components/landing/site-nav.tsx` | Sticky nav, mobile sheet, theme toggle |
| `frontend/src/components/landing/hero.tsx` | Eyebrow, headline, CTAs, trust strip |
| `frontend/src/components/landing/product-frame.tsx` | Tabbed app window; owns tab state |
| `frontend/src/components/landing/product-frame-views.tsx` | Board, roadmap and insights markup |
| `frontend/src/components/landing/split-section.tsx` | Delivery / discovery cards |
| `frontend/src/components/landing/feature-row.tsx` | One reusable alternating row, prop-driven |
| `frontend/src/components/landing/capability-index.tsx` | Pillars, columns, filter, empty state |
| `frontend/src/components/landing/demo-button.tsx` | CTA with loading and error states |
| `frontend/src/components/landing/site-footer.tsx` | Footer |
| `frontend/src/lib/landing-content.ts` | All copy and the 165 capabilities as typed data |
| `backend/routes/auth.js` | Add `POST /api/auth/demo` |
| `backend/seed-demo.js` | Idempotent demo seed and reset |

Splitting content into `landing-content.ts` means marketing copy edits never
touch layout code, and the capability list stays a reviewable diff against the
comparison docs.

Styling uses existing Tailwind utilities and the tokens already defined in
[index.css](../../../frontend/src/index.css). **No new colour values are
introduced.** The landing page adds no design tokens; if a shade is needed that
does not exist, that is a signal the design is drifting from the app.

---

## Data Flow

**Demo sign-in.** `demo-button.tsx` calls a new `api.demoLogin()` →
`POST /api/auth/demo` → server re-seeds if stale, creates the session, returns
the user plus token → the existing `AuthProvider.setUser` runs → navigate to
`/dashboard`.

**Capability filter.** Entirely client-side over the in-memory array from
`landing-content.ts`. No network, no debounce needed at 165 items.

**Product frame tabs.** Local `useState` in `product-frame.tsx`. No routing, no
URL state — the tabs are illustrative, not navigational.

---

## Error Handling

| Failure | Behaviour |
|---|---|
| Demo route returns 404 (unconfigured) | Button falls back to navigating to `/login`; no error shown |
| Demo route returns 429 (rate limited) | Inline message: "Too many demo sessions right now. Try again in a minute." |
| Demo route 5xx | Inline message with a `Sign in` link as the escape hatch |
| Re-seed throws | Logged server-side; the session is still issued against whatever data exists — a stale demo beats a broken button |
| Filter matches nothing | "No capability matches that." |

The demo button shows a spinner and is disabled while in flight, matching the
existing login form.

---

## SEO and Metadata

[index.html](../../../frontend/index.html) currently contains
`<title>Atlas</title>` and nothing else, so every link to open-atlas.xyz
previews as a blank card. Add: description, canonical, `og:title`,
`og:description`, `og:type`, `og:url`, `og:image`, `twitter:card`,
`twitter:title`, `twitter:description`, and `theme-color`.

The OG image is a static asset committed to `frontend/public/`.

Because `/` is the landing page, these tags describe the marketing page
correctly. Authenticated routes inherit them, which is harmless — they sit
behind a login and are not indexed.

---

## Accessibility

- Exactly one `h1`, on the hero. Heading levels descend without skipping.
- Semantic landmarks: `header`, `main`, `section`, `footer`, `nav`.
- Product frame tabs use `role="tablist"` / `role="tab"` with `aria-selected`,
  and are reachable and operable by keyboard.
- The filter input has a real label; the result count is announced via
  `aria-live="polite"`.
- Visible focus rings on every interactive element.
- Contrast checked at WCAG AA for body text and UI elements in the light theme,
  which is the only theme the app ships.
- All motion gated behind `prefers-reduced-motion`.
- Decorative SVG is `aria-hidden`; the burndown chart carries a text
  description.

---

## Testing

**Playwright — `frontend/e2e/landing.spec.ts`** (seeded config)

1. Anonymous visitor to `/` sees the hero headline and both CTAs.
2. Signed-in visitor to `/` is redirected to `/dashboard` without the landing
   page flashing.
3. Product frame tabs switch content and maintain `aria-selected`.
4. Capability filter narrows the list and shows the empty state for nonsense
   input.
5. `/login` still renders and still authenticates.

**Playwright — `frontend/e2e-empty/`**

6. The landing page renders on a fresh install with zero projects.

**Jest — `backend/tests/backend/auth-demo.test.js`**

7. `404` when `DEMO_EMAIL` is unset.
8. `200` with a valid session when set.
9. The issued session's user has role `user`, not `admin`.
10. Rate limiting engages after the configured threshold.
11. Re-seeding is skipped when the last reset is under the interval.
12. Seeding twice produces one demo user, not two.

---

## Accepted Risks

**Undifferentiated feature claims.** The capability index lists SSO, SAML, LDAP,
Slack, GitHub, Salesforce, Figma, AI-generated insights, offline mode, SOC 2 and
the no-code automation builder alongside shipped features, with no visual
distinction. Per `JIRA_FEATURES_COMPARISON.md` and
`PRODUCTBOARD_FEATURES_REMAINING.md`, roughly 60 of the 165 are not built.

This was raised during design and explicitly chosen by the project owner. The
exposure is concrete: the demo button sits on the same page, so a visitor can
click through and find the gap in under a minute. Mitigation, if this is ever
revisited, is one line of data — a `status` field on each capability entry and a
muted "planned" treatment. The data structure in `landing-content.ts` should
leave room for that field so the change stays cheap.

**Shared, mutable demo workspace.** Between resets, visitors see each other's
edits. The six-hour lazy reset bounds the damage rather than preventing it. A
visitor arriving five minutes after a vandal sees the vandalism. Acceptable for
a showcase deployment; not acceptable if the demo ever becomes a sales tool.

**No self-serve signup.** The page's only conversion path is the demo. There is
no lead capture, so an interested visitor who does not want a demo has no way to
make contact. Out of scope by decision.

---

## Out of Scope

Lead capture forms, pricing tables, blog or changelog, customer logos and
testimonials (there are no customers to cite), analytics instrumentation,
A/B testing, i18n, a cookie banner (nothing is tracked), and any change to
authenticated screens.

---

## Success Criteria

1. An anonymous visitor to `open-atlas.xyz` sees a complete marketing page, not
   a login form.
2. That visitor reaches a populated Atlas workspace in one click.
3. All 165 capabilities are present and searchable.
4. The page is correct and legible in the light theme, matching the rest of the
   app, and introduces no theme toggle.
5. A signed-in user never sees the landing page.
6. `cd frontend && npm run lint` passes.
7. `cd backend && npm test` passes.
8. `cd frontend && npm run test:e2e` and `npm run test:e2e:empty` pass.
9. No new colour tokens were added to `index.css`.
