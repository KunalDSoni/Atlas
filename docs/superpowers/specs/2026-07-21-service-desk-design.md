# Service Desk (JSM parity) — Design

**Date:** 2026-07-21
**Wave:** roadmap epics 39–45 — wiki focus mode bookkeeping, service desk foundation,
help center, agent queues, SLAs, KB deflection, CSAT & reporting
**Status:** Approved (design approved in-session)

> Numbering note: `ATLAS-NN` here is the roadmap **epic ordinal**, matching the
> commit convention. Seeded issue keys differ — `atlasIssueNumber` in
> `backend/database.js` runs sequentially across epics *and* their children, so
> the 39th epic does not carry the key `ATLAS-39`.

> Sequencing note: seven epics is more than one implementation plan should
> carry. Epics 39–41 (bookkeeping, foundation, help center) form the first
> shippable slice and get the first plan; 42–43 (queues, SLAs) and 44–45
> (deflection, CSAT) follow as their own plans against this spec. Each slice
> leaves the app working.

## Problem

The 38-epic roadmap is complete: Jira core, Confluence core, Productboard
parity, and a platform wave (SSE, webhooks, custom fields, migrations,
pagination, rate limiting, E2E). The largest remaining product-shaped hole is
**service management**. Atlas can track work raised by the people who build it,
but has no way for someone outside the team to ask for help and follow what
happened.

Three things make this the right next wave rather than a rewrite:

1. `users.role` already permits `'client'` (`database.js:21`, `:478`, and
   `frontend/src/lib/types.ts:3`) and **no route or middleware references it**.
   The role is a hook with nothing on the other end.
2. Requests are issues. Workflows, comments, attachments, watchers, automation
   rules, activity log, JQL, and flow metrics all apply to them unchanged.
3. `backend/routes/portal.js` establishes the projection discipline a customer
   surface needs — "only public-safe fields are projected" — but serves the
   *idea* portal (product feedback). The service desk is a separate surface that
   reuses the discipline, not that file.

## Architecture decisions

### A request is an issue

`type='request'` on `issues`, with `request_type_id` pointing at the form it was
raised through. The alternative — a standalone `sd_requests` table like the
`pb_*` product tables — was rejected: comments, attachments, watchers, activity,
and SLA-on-transition would each need reimplementing against it, roughly
doubling the wave for isolation we do not need.

The cost of this choice is that **every customer-facing response must be an
explicit projection**. An issue row carries assignee, story points, internal
labels, and comment threads that a customer must never see. This is handled once
(§41.1) rather than per-endpoint.

### Customers are users with `role='client'`

No second auth stack, no self-signup, no magic links. Customers log in through
the existing session-token flow and are confined to the help center. Rejected
alternatives: separate customer accounts (a second session model and a much
wider security surface — verification tokens, password reset, signup rate
limits — before any service desk feature ships) and anonymous email+token
requests (request history, watching, and identity all rebuilt around tokens).

### SLA clocks are derived, never fired

The backend has **no scheduler** — no `cron`, no `setInterval`, verified across
`server.js`, `routes/automations.js`, and `utils/`. So SLAs store timestamps and
compute state on read:

```
elapsed = (stopped_at ?? now) - started_at - paused_total
breached = elapsed > target_minutes
```

Nothing to fire, nothing to drift, no background job to keep alive across a
restart. Business-hours calendars are explicitly out of scope (§Out of scope).

## Epic 39: Wiki focus mode (bookkeeping)

Focus mode shipped in commit `8000025` but was never seeded, so the roadmap
under-reports by one epic and `backend/tests/backend/epics.test.js:211` still
asserts 38.

- Seed the epic with its three real children (full-width page, collapsed
  sidebars, state persisted per user), `status: 'done'`, following the
  `taskEpics` block at `database.js:1679`.
- Update the epics test to the new count.

No production code changes. This epic exists so the roadmap tells the truth
before seven more epics land on top of it.

## Epic 40: Service desk foundation

### 40.1 Migration `011_service_desk_core`

| Object | Shape |
|---|---|
| `projects.is_service_desk` | `INTEGER`/`TINYINT` default 0 |
| `sd_request_types` | `id`, `project_id`, `name`, `description`, `icon`, `fields` (JSON), `position`, `created_at` |
| `issues.request_type_id` | nullable FK to `sd_request_types` |
| `issues.sd_fields` | JSON, the submitted form values |
| `comments.visibility` | `'public'` \| `'internal'`, default `'public'` |
| `project_statuses.waiting_for_customer` | `INTEGER`/`TINYINT` default 0 |

`fields` is a JSON array of `{key, label, type, required, options?}` with
`type ∈ {text, textarea, select, date}`. It describes the *raise* form only;
submitted values are stored in `issues.sd_fields` and rendered into the issue
description as a readable summary, so an agent reading the issue in a normal
Atlas screen sees the whole request without the service desk UI. Custom fields
(epic 25) are a separate,
internal-facing system and are deliberately not reused — request forms are
public input and need their own validation surface.

`visibility` defaults to `'public'` so every pre-existing comment keeps its
current meaning. Internal notes are opt-in.

### 40.2 The `type` CHECK constraint — the wave's riskiest step

`issues.type` carries `CHECK(type IN ('story','task','bug','epic','subtask'))` at
`database.js:12` (SQLite) and `:478` (MySQL). Fresh databases pick up
`'request'` from the schema for free; **existing databases need the constraint
changed**, and SQLite cannot alter a CHECK in place.

- **SQLite:** the standard 12-step rebuild — `PRAGMA foreign_keys=off`, create
  `issues_new` with the extended CHECK, `INSERT INTO … SELECT`, drop, rename,
  recreate the indexes from `007_issue_lookup_indexes`, `PRAGMA foreign_keys=on`.
- **MySQL:** `ALTER TABLE issues DROP CHECK <name>` then `ADD CONSTRAINT … CHECK`.

Two facts lower this risk from how it first looks:

- **SQLite foreign keys are not enforced here.** `database.js` issues no
  `PRAGMA foreign_keys=ON`, and sql.js defaults it off, so the `REFERENCES`
  clauses on the ten tables pointing at `issues` are documentation. The rebuild
  has no enforcement to suspend and no cascade behaviour to preserve.
- Child tables reference `issues` **by name**, so dropping the old table and
  renaming `issues_new` into its place leaves them resolving to the new table.

The rebuild still gets a dedicated test that seeds issues of every type, runs
the migration, and asserts row count, join integrity from every referencing
table, and index survival. The migration suite already runs against a real
MySQL service in CI (epic 35).

**A correction to an earlier draft of this spec:** the stated fallback — "drop
the CHECK and validate in the route layer" — is not a fallback at all. SQLite
cannot drop a CHECK constraint in place either; that path needs the same table
rebuild. The genuine alternative, if the rebuild is rejected, is to leave
`issues.type` untouched and identify a request by `request_type_id IS NOT NULL`,
rendering a "Request" badge in the UI. That avoids schema surgery entirely at
the cost of requests reading as `task` in the database and in JQL.

**Trap this creates for testing:** `backend/tests/backend/setup.js` builds every
suite from a throwaway database, so tests get `'request'` from the schema in
`database.js` whether or not the migration works. A broken migration would pass
the entire suite and fail only on a real deployment. The migration test is the
only thing standing between this change and that outcome, so it is not
optional.

### 40.3 Request types API

```
GET    /api/projects/:id/request-types    list (agents)
POST   /api/projects/:id/request-types    create      requireBoardAdmin
PUT    /api/request-types/:id             update      requireBoardAdmin
DELETE /api/request-types/:id             delete      requireBoardAdmin  (409 if requests exist)
```

### 40.4 Comment visibility

`POST /api/issues/:id/comments` accepts `visibility`. Rules, enforced in the
route rather than the client:

- A `client` may only ever create `public` comments; a `visibility: 'internal'`
  from a client is rejected, not silently downgraded.
- `GET` on an issue filters `visibility='internal'` out for clients.
- Agents see both, with internal notes visually distinct.

## Epic 41: Help center

### 41.1 The boundary

Two mechanisms, both required:

1. **`requireClientSafe` middleware** (`middleware/servicedesk.js`) — mounted on
   every `/api/help/*` route. Confirms the caller may see the target request:
   they are its reporter, or a row in `issue_watchers` for it. "Participant" has
   no looser meaning than that; commenting on a request adds the commenter as a
   watcher, which is how a second customer gains access.
2. **`toPublicRequest()` projection** (`utils/servicedesk.js`) — a single
   allow-list function that names the fields a customer may see: key, request
   type, summary, description, status label and category, created/updated,
   public comments, attachments they can access, and SLA goal state. Assignee,
   story points, internal labels, sprint, estimates, and internal comments have
   no path through it.

Every help center response goes through the projection. No route builds a
customer payload by hand.

### 41.2 Routes

```
GET  /api/help/request-types            types the caller may raise against
POST /api/help/requests                 raise (validated against fields schema)
GET  /api/help/requests                 my requests, open/closed
GET  /api/help/requests/:key            one request, projected
POST /api/help/requests/:key/comments   reply (always public)
POST /api/help/requests/:key/resolve    customer closes their own request
```

### 41.3 Client lockdown

`role='client'` is redirected to `/help` by the shell and rejected by every
internal API. This is asserted by test, not assumed: a client session is pointed
at board, backlog, admin, wiki, reports, and product endpoints and must receive
403 from each.

### 41.4 Screens

`/help` (browse request types, raise), `/help/requests` (mine),
`/help/requests/:key` (detail with conversation). Lazy-loaded in `App.tsx`
alongside the existing screens. Deliberately plain — the help center is not the
place for the app chrome a customer has no use for.

## Epic 42: Agent queues

Migration `012_sd_queues`: `sd_queues` (`id`, `project_id`, `name`, `jql`,
`columns` JSON, `order_by`, `position`).

A queue is a stored JQL string evaluated through the existing
`utils/jql.js::parseJql`, which returns `{where, params}` and supports `=`/`!=`
clauses joined by AND. That grammar has no `ORDER BY` and no `IN`, so:

- Ordering is a separate `order_by` column on the queue, not part of the query.
- Queue definitions that need richer logic are out of scope until JQL grows.

Named queues carry live counts (one grouped count query for the whole sidebar,
not N queries), a table honouring the queue's `columns`, and bulk actions
reusing the board's existing multi-select bulk edit.

`GET /api/projects/:id/queues`, `GET /api/queues/:id/issues` (paginated per
epic 28), plus board-admin CRUD.

## Epic 43: SLAs

Migration `013_sd_slas`:

| Table | Shape |
|---|---|
| `sd_sla_goals` | `request_type_id`, `priority` (nullable = any), `metric` (`first_response`\|`resolution`), `target_minutes` |
| `sd_sla_clocks` | `issue_id`, `metric`, `started_at`, `stopped_at`, `paused_at`, `paused_total_minutes`, `breached_at` |

### 43.1 Lifecycle

- Raising a request starts a clock per goal matching its type and priority.
- The first **public agent** comment stops `first_response`. An internal note
  does not — that is the point of the distinction.
- Reaching a `done`-category status (via `project_statuses`, epic 9) stops
  `resolution`; reopening restarts it.
- Entering a status whose `project_statuses.waiting_for_customer` flag is set
  (§40.1; toggled in the existing workflow editor from epic 9) sets `paused_at`;
  a customer reply accumulates the interval into `paused_total_minutes` and
  clears it. A request can pause and resume any number of times.

`breached_at` is written opportunistically when a read observes a breach, so
breach *time* survives even though breach *state* is derived. Reads never
depend on it.

### 43.2 Surfacing

A shared `slaState(clock, goal, now)` helper returns
`{elapsed_minutes, remaining_minutes, status: ok|at_risk|breached, paused}`,
where `at_risk` is ≥80% of target. Used identically by queue rows, the request
detail, and the report — one implementation, so a badge can never disagree with
a report.

## Epic 44: KB deflection

Migration `014_sd_deflection_csat` (deflection half): `sd_type_articles`
(`request_type_id`, `page_id`, `position`), `sd_article_hits`
(`page_id`, `request_type_id`, `helped`, `created_at`).

As a customer types a summary, `GET /api/help/suggestions?type=…&q=…` returns up
to three wiki pages — curated articles for that request type first, then results
from the existing `/api/search` index restricted to spaces the request type
draws from. Debounced at 300ms, and it never blocks submission.

Opening a suggestion logs a hit; a "this solved my problem" action logs
`helped=1` and abandons the draft. Deflection rate becomes a real measured
number rather than a claim.

Articles are ordinary wiki pages. No new content type.

## Epic 45: CSAT & service desk report

`sd_satisfaction` (`issue_id` unique, `rating` 1–5, `comment`, `created_at`).

Resolution surfaces a rating prompt on the customer's request detail; one rating
per request, editable while the request stays resolved. Only the reporter may
rate, enforced server-side.

`/servicedesk/report` reuses the existing `charts.tsx` primitives:

- request volume by type over time
- median time to first response and to resolution
- SLA breach rate by request type
- deflection rate: `helped` hits ÷ (`helped` hits + requests raised) over the
  period — both terms come from rows we actually store, so the denominator
  needs no form-open telemetry
- CSAT average and distribution

Honesty rule, inherited from the flow-metrics spec: panels compute only from
recorded rows and are labelled "since tracking began". No backfill is
fabricated for requests that predate a goal.

## Security rules

These are the wave's non-negotiables, each with a test:

1. No internal field reaches a customer — enforced by projection, asserted by a
   test that diffs a raw issue row against `toPublicRequest()` output.
2. A `client` never sees an `internal` comment, on any endpoint.
3. A `client` cannot reach any internal API — 403 across board, backlog, admin,
   wiki, reports, product.
4. A customer may only read requests they reported or participate in — asserted
   by requesting another customer's request key and expecting 404, not 403,
   so the endpoint does not confirm the key exists.
5. Request form input is validated against the type's `fields` schema
   server-side; unknown keys are dropped, not stored.

## Testing

Per-epic backend suites in `backend/tests/backend/`, matching existing style:

- `servicedesk-core.test.js` — request types CRUD, comment visibility, the
  migration rebuild (row count, FK integrity, indexes).
- `help-center.test.js` — raise/list/detail/reply/resolve, plus all five
  security rules above.
- `sd-queues.test.js` — JQL evaluation, counts, pagination.
- `sd-sla.test.js` — clock arithmetic including pause/resume across multiple
  cycles, at-risk threshold, internal note does *not* stop first response.
- `sd-deflection-csat.test.js` — suggestions, hit logging, one-rating-per-request.

E2E in `e2e/`: a client raises a request and sees it; an agent picks it from a
queue, adds an internal note (invisible to the client) and a public reply
(visible), resolves it; the client rates it.

## Out of scope (YAGNI)

- **Business-hours SLA calendars** — timezone and holiday math, its own epic if
  ever wanted.
- **Customer self-signup / SSO** — clients are provisioned by an admin.
- **Email-to-request ingestion** — needs inbound mail infrastructure Atlas has
  no counterpart for; `utils/email.js` is outbound-only.
- **Approval workflows on requests** — distinct from wiki page approvals
  (epic 36); revisit after the lifecycle is proven.
- **Asset/CMDB management** — a different product.

## Seeding

Epics 39–45 are seeded with `status: 'done'` children describing the real work,
following the established wave pattern, and the epics test count moves to 45. A
demo service desk project ("Help Desk", `is_service_desk=1`) seeds three request
types, a handful of requests across states, one SLA breach, and one CSAT rating,
so the screens have shape on a fresh database. Seeding stays behind
`SEED_DEMO_DATA`, which real deployments set to `false`.

---

## Slice 2 — decisions taken, design paused

**Status:** slice 1 (epics 39–41) is merged and green (`191c757`, 441 tests
passing, 41 epics seeded). Slice 2 was brainstormed to the points below and then
parked. Everything here is **decided**, except the restructure at the end, which
was proposed and never approved.

### Three decisions

**1. Queue filters extend JQL rather than introducing a second filter language.**

The spec above says a queue is "a stored JQL string evaluated through
`parseJql`". The grammar in `utils/jql.js` supports only `=` and `!=` joined by
`AND`, over seven fields (`project`, `status`, `type`, `priority`, `assignee`,
`reporter`, `label`). Of the five canonical service desk queues, exactly one —
"unassigned" — is expressible. "All open requests" needs status *category*;
"breaching SLA" needs SLA fields that do not exist; "hardware requests" needs
`request_type`, since `issues.type` is just `'request'` for every one of them;
"waiting for customer" needs the `project_statuses.waiting_for_customer` flag.

So JQL grows: `OR`, `IN`, `IS EMPTY`, grouping, and new fields. Global search,
saved filters, and the `[jql:]` wiki macro inherit the additions.

**2. SLA breach state is filterable via a stored absolute `due_at`, not a SQL
predicate over the breach rule.**

Decision 1 forces this. A queue is a *paginated* SQL query (epic 28), so
`sla = breached` must be expressible in a `WHERE` clause — JS-side filtering
after the fetch would break page counts and totals. But `utils/flow.js:45`
establishes that this codebase computes derived time metrics in JavaScript, and
`utils/sql.js` is 29 lines of trivial helpers with no dialect abstraction at all.

Rather than write the breach rule a second time in dialect-specific SQL
(`julianday` vs `TIMESTAMPDIFF`) and maintain two implementations that must
agree forever, the JS helper stays the single authority: when a clock starts,
pauses, or resumes it computes and stores `due_at`. SQL only ever compares a
timestamp — identical in both dialects, indexes well, cannot drift from the
badge. This extends the spec's existing instinct to persist `breached_at`,
moving it from "written when observed" to "computed when the clock changes".

The cost is a derived column that must be recomputed on every lifecycle
transition, and it needs tests proving it.

**3. Queue sidebar counts come from one `UNION ALL` of N count subqueries.**

§Epic 42 above specifies "one grouped count query for the whole sidebar, not N
queries". That is only possible when every queue filters the same shape of
thing. Once each queue carries arbitrary JQL, the `WHERE` clauses differ and
cannot be grouped into a single aggregate — the stated approach does not work.

Instead: one statement per sidebar load, `SELECT 'q1', COUNT(*) … UNION ALL
SELECT 'q2', COUNT(*) …`. One round trip, exact counts, nothing to cache or
invalidate, bounded by a cap on queues per project.

### Proposed restructure — NOT approved

Slice 2 was proposed as three epics rather than two, resequenced:

| # | Epic | Depends on |
|---|---|---|
| 42 | **JQL v2** — `OR`, `IN`, `IS EMPTY`, grouping; `category` and `request_type` fields; a `FIELDS` registry later epics extend rather than edit | — |
| 43 | **SLAs** — goals, clocks, computed `due_at`, pause/resume lifecycle, `slaState()`, request-detail badges; registers the `sla` field into JQL | 42 |
| 44 | **Agent queues** — `sd_queues`, sidebar counts, columns, bulk actions, CRUD | 42, 43 |

Two reasons. JQL v2 is a cross-cutting change to a query language that four
surfaces run through, so it should not hide inside a feature epic named after
none of them. And queues-before-SLAs is circular: queues need `sla = breached`
expressible, which needs SLA fields, which need the SLA tables. Inverting the
order also lets queues launch complete rather than shipping a broken headline
queue that a later epic repairs.

Under this proposal deflection becomes epic 45 and CSAT epic 46, both deferred
behind the Identity & Governance wave. Renumbering is free: 41 epics are seeded,
so nothing above 41 exists yet.

**Open question when this resumes:** is that restructure right? Also unresolved
— a queue stores its JQL as text, so deleting a status via
`DELETE /api/statuses/:id?migrate_to=` leaves every queue referencing the old
key silently returning zero rows, with nothing detecting it.
