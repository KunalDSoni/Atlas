# Product Discovery Wave — Design

**Date:** 2026-07-22
**Wave:** roadmap epics 47–52 — insight capture, revenue-weighted demand, theme
clustering, spec drafting, outcome tracking, portal v2
**Status:** Draft — awaiting review

> Numbering note: epics 42–46 are reserved by the parked service desk wave
> (`2026-07-21-service-desk-design.md`). This wave starts at 47 so the two can
> be built in either order without renumbering. As of `62fae32`, 41 epics are
> seeded, so nothing above 41 exists yet. Migrations start at `015`, leaving
> `012`–`014` to the service desk wave.

> Sequencing note: six epics is more than one implementation plan should carry,
> for the same reason the service desk wave was sliced. Epics 47–48 (capture,
> demand) form the first slice and get the first plan — together they close the
> feedback-to-prioritization loop and need no API key. Epics 49–50 (themes, spec
> drafting) follow as the AI-assisted slice, and 51–52 (outcomes, portal v2)
> close the loop back out to the customer. Each slice leaves the app working and
> is independently useful.

## Problem

Atlas shipped Productboard parity in epics 13–18: features with RICE and a
value/effort matrix, insights with evidence quotes, objectives, customers and
companies with ARR, votes, and a public idea portal. The data model is sound.
The *loop it describes is not closed*, in four specific places:

1. **Nothing flows in.** `pb_insights.source` enumerates `portal`, `email`,
   `support`, `sales`, `interview` — but every insight is typed by hand into a
   form. There is no path from a support conversation to an insight. This got
   sharper with the service desk: epics 39–41 shipped a help center where
   customers describe problems in their own words, and none of it can reach the
   product module.
2. **Money is recorded and ignored.** `pb_companies.arr` and `.tier` are stored,
   and `pb_insight_links.importance` grades each piece of evidence 1–3. Nothing
   multiplies them. Prioritization runs on RICE, where `reach` is a number
   somebody guessed, while the actual answer — which companies asked, worth how
   much — is sitting in the database unqueried.
3. **Volume has no structure.** `pb_insights.processed` is a boolean. Two
   hundred insights is two hundred rows; there is no notion of "these fourteen
   are the same request."
4. **Launch is the end of the story.** `pb_features.status` reaches `launched`
   and stops. Nothing records what the feature was supposed to achieve, and
   nothing checks afterward whether it did.

This wave closes those four gaps and rebuilds the portal, which is currently two
endpoints.

## Architecture decisions

### Captured insights snapshot their source and link back to it

An insight created from a service desk request stores both an excerpt of the
text *as it was captured* and a reference to the origin. The excerpt is the
evidence; the reference is for context.

Snapshotting is not redundancy. Source rows change and get deleted — a request
is resolved and its description edited, a comment is removed, a wiki page is
rewritten. Evidence that silently rewrites itself is not evidence, and a
prioritization decision made on a quote that no longer exists is unauditable.
The backlink handles the other direction: an insight whose origin still exists
renders a chip through to it.

This mirrors `pb_insight_links.quote`, which already snapshots the relevant
fragment when evidence is attached to a feature.

### Demand is derived on read, never stored

Revenue-weighted demand is computed in JavaScript from rows already stored —
`pb_insight_links` → `pb_insights` → `pb_customers` → `pb_companies.arr` — the
same way `utils/flow.js` computes every cycle-time metric.

This is deliberately the **opposite** of the decision taken for service desk
SLAs, where breach state is stored as an absolute `due_at`. The difference is
pagination. A queue is a paginated SQL query over an unbounded issue table, so
its filter has to live in a `WHERE` clause. The prioritize screen ranks a
bounded set — the features in one project — and fetches all of them anyway to
draw the matrix. Computing in JS costs nothing here and keeps one authority for
the formula. Where the set later becomes unbounded, that decision gets revisited
on its own merits rather than by precedent.

### AI proposes; a human commits

`routes/ai.js` is optional — `GET /api/ai/status` reports `enabled: false` when
no key is configured, and the wiki degrades to manual operation. Every AI
feature in this wave holds the same contract: it produces a **draft that a human
accepts, edits, or discards**, and it never writes to `pb_features`,
`pb_insight_links`, or the wiki on its own.

Two reasons, and only one is about trust. Clustering feedback and drafting specs
are judgment calls where a confident wrong answer is worse than no answer. And
an Atlas deployment with no API key must remain a complete product — so every
screen this wave adds has a manual path, and the AI affordance is additive.

### Outcome tracking measures rows we already have

No new telemetry, no event pipeline. A feature's outcome is assessed from
insights linked to it after its launch date, its issues' resolution data, and a
single metric the team declares by hand. Panels are labelled "since tracking
began", inheriting the honesty rule from the flow-metrics spec: nothing is
backfilled for features that launched before a goal existed.

---

## Epic 47: Insight capture

The foundation — every other epic in this wave is starved without it.

### 47.1 Migration `015_insight_origins`

| Object | Shape |
|---|---|
| `pb_insights.origin_kind` | `TEXT` nullable, `CHECK(origin_kind IN ('request','comment','wiki','portal','manual'))` |
| `pb_insights.origin_id` | `TEXT` nullable — the source row's id |
| `pb_insights.origin_excerpt` | `TEXT` nullable — the captured text, snapshotted |
| `pb_insights.dismissed_at` | `TEXT` nullable — triaged as not actionable |

Existing insights get `origin_kind = 'manual'` and a null `origin_id`, so the
inbox treats history uniformly. No CHECK constraint on an existing column is
altered, so this migration avoids the SQLite table rebuild that made service
desk migration 011 the risky one.

`origin_id` is deliberately **not** a foreign key: it points at four different
tables depending on `origin_kind`, and a deleted source must leave the insight
intact with its excerpt. Resolution is a lookup by kind, and a missing target
renders as "source removed" rather than an error.

### 47.2 Capture points

| Source | Where | Who |
|---|---|---|
| Service desk request | Request detail, agent view | agent, `board_admin` |
| Issue comment | Comment action menu | any internal user |
| Wiki selection | Existing comment-on-selection affordance (epic 31) | any internal user |
| Portal idea | Automatic on `POST /api/portal/ideas` | — |

`POST /api/product/insights/capture` takes `{origin_kind, origin_id, excerpt,
customer_id?, title}` and creates the insight unprocessed. The excerpt is
supplied by the caller from the selection; the server re-reads the source row to
verify the caller may see it, and rejects the capture otherwise.

**The security rule that matters here:** capturing from a service desk request
reads customer-authored text into an internal-only surface. That direction is
fine. The reverse must never happen — no insight, feature, or roadmap content
is exposed through any `/api/help/*` route, and `toPublicRequest()` gains no new
fields. A test asserts a client session receives 403 from every
`/api/product/*` endpoint, extending the epic 41 lockdown suite.

### 47.3 Inbox screen

`/product/inbox` — the unprocessed queue, newest first, paginated per epic 28.
Per row: excerpt, source chip linking to origin, customer and company with tier,
and three actions — **link to feature** (existing picker, sets `importance` and
`quote`), **dismiss** (sets `dismissed_at`), **merge into existing insight**.

A count badge on the Product nav group shows unprocessed volume. This is the
screen a PM opens on Monday; it is the wave's most-used surface and should feel
fast rather than complete.

---

## Epic 48: Revenue-weighted demand

No migration. Everything below reads rows that already exist.

### 48.1 The demand score

For a feature, over its linked insights:

```
demand = Σ  arr(company) × importance
```

where `importance` is the existing 1–3 grade on `pb_insight_links` and `arr` is
the company's ARR. The unit is weighted ARR — "roughly $2.4M of revenue asked
for this, some of it emphatically" — not a dimensionless score.

**Null ARR falls back to the median ARR of that company's tier**, computed from
the companies that do have a figure, and to zero when the tier has none. Keeping
one unit throughout is the whole point: a tier fallback expressed as a small
integer would be summed against six-figure ARR values and vanish, which is worse
than no fallback because it looks like it worked. Rows using a fallback are
marked in the breakdown so the number is never mistaken for measured revenue.

Insights with no customer contribute nothing and are counted separately as
"unattributed evidence", surfaced honestly rather than folded in.

Two features with identical RICE and wildly different demand is the signal this
epic exists to produce. Demand does **not** replace RICE or feed into it — a
score that silently mixes a guessed `reach` with real revenue is worse than two
honest numbers side by side.

### 48.2 Surfacing

- **Prioritize screen:** a demand column, sortable, alongside the RICE ranking;
  and a demand-vs-effort matrix as a second view of the existing matrix
  component.
- **Feature detail:** a "Who asked for this" panel — companies ranked by
  contribution, each with tier, ARR, insight count, and expandable quotes.
- **Segment filter:** filter the prioritize view to one tier, so "what do our
  strategic accounts want" is one click rather than an export.

`GET /api/product/features` gains `demand` and `demand_breakdown` alongside the
existing computed `rice`, following the shape of `product-features.js:63`.

---

## Epic 49: Theme clustering

### 49.1 Migration `016_insight_themes`

| Table | Shape |
|---|---|
| `pb_themes` | `id`, `name`, `summary`, `created_by`, `created_at` |
| `pb_insight_themes` | `insight_id`, `theme_id`, `UNIQUE(insight_id, theme_id)` |

A theme is a named grouping of insights, one level above an individual piece of
feedback and one below a feature. Themes may be promoted to features, carrying
their insights' links across.

### 49.2 Manual first, AI second

Themes are created and populated **by hand** — this path is the product, and it
works with no API key. Multi-select in the inbox, "group into theme", done.

`POST /api/product/themes/suggest` then adds the assist: it sends unprocessed
insight titles and excerpts to the model and returns *proposed* groupings, each
with a name, a summary, and the insight ids it covers. Nothing is written. The
PM sees the proposal, edits names, drops insights that do not belong, and
confirms — and only that confirmation writes rows.

Batched to a bounded number of insights per call, with the excerpt truncated, so
a large inbox cannot produce an unbounded prompt. When `GET /api/ai/status`
reports disabled, the suggest button is absent rather than broken.

### 49.3 Trends

A theme's volume over time, from `pb_insights.created_at` of its members — which
themes are accelerating, which have gone quiet. Reuses the `charts.tsx`
primitives. Labelled "since tracking began".

---

## Epic 50: Spec drafting

Productboard's current pitch is turning ideas into delivery-ready specs. Atlas
has the three pieces already and has never connected them: a wiki with
templates and versioning, an AI module that drafts prose, and
`POST /api/product/features/:id/push`, which already creates issues from a
feature.

### 50.1 Migration `017_feature_spec_pages`

`pb_features.spec_page_id` — nullable reference to `wiki_pages(id)`.

### 50.2 Draft, review, deliver

`POST /api/product/features/:id/spec` creates a wiki page in a configured space
from a spec template, pre-filled with what the database already knows: the
feature name and description, its objectives, its top evidence quotes ranked by
`importance`, and its demand breakdown. That much is pure assembly and needs no
model.

With AI enabled, the assembled context is additionally passed to
`routes/ai.js` to draft problem statement, proposed solution, and open
questions — as an ordinary wiki page the PM edits, in a system that already has
version history and page comments for exactly this kind of review.

The feature detail shows a chip through to its spec page; the page shows a chip
back. From there the existing push-to-issues path is unchanged.

**Deliberately not built:** a bespoke spec editor. The wiki is the editor.

---

## Epic 51: Outcome tracking

### 51.1 Migration `018_feature_outcomes`

| Table | Shape |
|---|---|
| `pb_feature_outcomes` | `feature_id` unique, `metric` (text), `target` (text), `baseline` (text), `measured` (text), `verdict` (`achieved`\|`partial`\|`missed`\|`too_early`), `reviewed_at`, `reviewed_by`, `notes` |

Free text for `metric`, `target`, `baseline` and `measured` is the correct
choice, not a shortcut. Atlas has no metrics warehouse and no path to one; a
numeric column would imply a rigour the system cannot deliver and would invite
a fake chart. What the team writes is what the team measured elsewhere.

### 51.2 The loop

- A feature entering `launched` prompts for a success metric, if none is set.
  Prompted, not enforced — a blocking modal on a status change teaches people to
  avoid the status.
- **Post-launch signal**, computed, not declared: insights linked to the feature
  *after* its launch date, counted and listed. Sustained feedback after launch
  is the cheapest available evidence that something missed.
- **Launch review** at `/product/outcomes`: launched features, time since launch,
  declared metric, post-launch insight count, and verdict. Unreviewed launches
  older than a configurable window are flagged — the point is to make an
  unexamined launch visible, not to grade anyone.

---

## Epic 52: Portal v2

`routes/portal.js` is two endpoints: list features, submit an idea. A submitter
cannot see their own idea again, cannot tell whether anyone read it, and is
never told when it ships.

### 52.1 Migration `019_portal_followers`

| Table | Shape |
|---|---|
| `pb_portal_followers` | `feature_id`, `user_id`, `UNIQUE(feature_id, user_id)` |

### 52.2 Scope

- **Idea detail** — one feature, projected to portal-safe fields only: name,
  description, `portal_status`, vote count, follower count. Never `effort`,
  `value`, `reach`, `impact`, `confidence`, `rice`, `demand`, owner, linked
  issues, or evidence.
- **Follow / unfollow**, and a "my submissions and follows" list.
- **Status-change notification** — when `portal_status` changes, followers are
  notified through the existing notifications table and email path. This is the
  loop-closing move: the person who asked finds out it shipped.
- **Public roadmap** — the existing now/next/later grouping, filtered to
  features with a `portal_status`, readable without an internal account.

### 52.3 Projection, again

The service desk wave established that customer-facing responses go through a
single allow-list function rather than being assembled per route
(`toPublicRequest()` in `utils/servicedesk.js`). The portal predates that
discipline and builds its payloads inline.

This epic adds `toPublicFeature()` in `utils/portal.js` and routes every portal
response through it, including the two existing endpoints. A test diffs a raw
`pb_features` row against the projection and asserts every internal field is
absent — the same test shape as the service desk projection test, which is the
point of doing it the same way.

---

## Security rules

Each gets a test.

1. A `client` receives 403 from every `/api/product/*` endpoint. Extends the
   epic 41 lockdown suite.
2. No scoring, evidence, or roadmap internal reaches the portal — asserted by
   diffing a raw feature row against `toPublicFeature()`.
3. Capture verifies source visibility server-side: a user who cannot read the
   request, comment, or wiki page cannot capture an insight from it.
4. Portal endpoints requiring identity (follow, my submissions) reject anonymous
   callers; browsing and voting keep their current access rules.
5. AI endpoints never write to `pb_*` or `wiki_pages`. Asserted by a test that
   calls suggest and asserts row counts are unchanged.

## Testing

Per-epic backend suites in `backend/tests/backend/`, matching existing style:

- `insight-capture.test.js` — capture from each origin kind, excerpt snapshot
  survives source deletion, visibility enforcement, inbox triage transitions.
- `product-demand.test.js` — the demand formula including tier fallback, null
  ARR, unattributed insights, and the breakdown's arithmetic.
- `insight-themes.test.js` — manual theme CRUD and promotion to feature; the
  suggest endpoint stubbed, asserting it writes nothing.
- `feature-spec.test.js` — page creation from template, two-way link, behaviour
  with AI disabled.
- `feature-outcomes.test.js` — outcome CRUD, post-launch insight counting across
  the launch-date boundary.
- `portal-v2.test.js` — projection diff, follow/unfollow, notification on
  `portal_status` change, anonymous access rules.

E2E in `e2e/`: an agent captures an insight from a service desk request; a PM
finds it in the inbox, groups it into a theme, links it to a feature, and sees
demand rise; the feature launches and its portal follower is notified.

## Seeding

Epics 47–52 seed with `status: 'done'` children following the established wave
pattern, moving the epics test count to 47 if the service desk wave has not
landed, or higher if it has — the count assertion is updated to whatever is
actually seeded rather than a number predicted here.

Demo data extends the existing product seed: a dozen insights across origin
kinds (including two captured from the seeded help desk requests), two themes,
ARR spread across the three company tiers so demand ranking differs visibly from
RICE ranking, one launched feature with a recorded outcome, and one portal
follower. Behind `SEED_DEMO_DATA`, as always.

## Out of scope (YAGNI)

- **Custom scoring frameworks** — configurable weighted drivers. RICE plus
  demand plus value/effort is already three lenses; a fourth that each team
  defines differently is a maintenance surface with no current demand.
- **Email and Slack ingestion** — `utils/email.js` is outbound-only, and inbound
  mail is infrastructure Atlas has no counterpart for. Capture covers the
  sources Atlas already holds.
- **Automatic insight-to-feature linking** — the model proposes themes; letting
  it attach evidence to features unattended corrupts the exact data
  prioritization depends on.
- **Sentiment scoring** — a number with no ground truth. Post-launch insight
  volume is a cruder signal that is actually verifiable.
- **Multiple roadmap views** (timeline, by-objective) — the roadmap screen is
  now/next/later and nobody has asked for more. Revisit if they do.
