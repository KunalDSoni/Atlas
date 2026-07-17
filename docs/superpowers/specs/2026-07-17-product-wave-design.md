# Product Wave — Productboard Parity (ATLAS-13 → ATLAS-18)

**Date:** 2026-07-17 · **Branch:** `feature/product-wave` · **Status:** approved (separate-module architecture, full 6-epic wave)

## Context

The 12-epic Jira/Confluence parity roadmap is complete. Atlas now covers issue tracking
(board, backlog, sprints, epics, subtasks, workflows, automation, reports, releases,
links, attachments, watchers, activity) and wiki (spaces, trees, versions, templates,
restrictions, export, blogs). The remaining competitive gap is **Productboard**: product
management — capturing customer feedback, prioritizing features with evidence, tying
work to objectives, and closing the loop with customers via a portal.

**Architecture decision (approved):** the product layer is a **separate module** with its
own tables (`pb_*` prefix) and routes, linked to delivery via explicit feature→epic/issue
links — mirroring how Productboard integrates with Jira. No ALTERs to existing tables;
new tables only, so existing `data.db` files keep working (CREATE TABLE IF NOT EXISTS
adds them at startup).

## Data model (all new tables)

- `pb_companies` — id, name, tier CHECK('strategic','growth','standard') default 'standard', arr REAL, notes, created_at. Tier weight: strategic=3, growth=2, standard=1.
- `pb_customers` — id, name, email, company_id → pb_companies, created_at.
- `pb_insights` — id, title, content, source CHECK('portal','email','support','sales','interview','other') default 'other', customer_id → pb_customers (nullable), created_by → users, processed INTEGER default 0, created_at. An insight is a piece of raw feedback.
- `pb_features` — id, project_id → projects, name, description, status CHECK('idea','discovery','planned','in_progress','launched','archived') default 'idea', timeframe CHECK('now','next','later') nullable, portal_status CHECK('under_consideration','planned','launched') nullable (null = not public), owner_id → users, effort INTEGER (1-10), value INTEGER (1-10), reach INTEGER, impact INTEGER (1-3), confidence INTEGER (percent), release_id → versions nullable, created_by, created_at, updated_at.
- `pb_insight_links` — id, insight_id, feature_id, importance CHECK(1..3) default 1, quote TEXT nullable, created_by, created_at. UNIQUE(insight_id, feature_id).
- `pb_feature_issues` — id, feature_id, issue_id, created_at. UNIQUE(feature_id, issue_id). Delivery links to epics or issues.
- `pb_objectives` — id, name, description, status CHECK('on_track','at_risk','off_track','done') default 'on_track', target_date, owner_id, created_at.
- `pb_feature_objectives` — id, feature_id, objective_id. UNIQUE pair.
- `pb_votes` — id, feature_id, user_id, created_at. UNIQUE(feature_id, user_id).

**Computed scores** (in enriched feature payloads, not stored):
- `user_impact` = Σ over linked insights of (importance × company tier weight); insights without a company weigh 1.
- `rice` = reach × impact × (confidence/100) / max(effort, 1).
- Value/effort quadrant derives from `value` and `effort` directly.
- `delivery_progress` = done-category issues / total linked issues (via `pb_feature_issues`).

## API (new route files, mounted under /api)

- `routes/product-companies.js` — CRUD `/product/companies`, `/product/customers`.
- `routes/product-insights.js` — CRUD `/product/insights` (+ `?processed=` filter), `POST/DELETE /product/insights/:id/links` (link to feature with importance + quote).
- `routes/product-features.js` — CRUD `/product/features` (enriched with scores, vote counts, insight counts, delivery progress; filters: project, status, timeframe), `POST /product/features/:id/issues` (link existing) and `POST /product/features/:id/push` (create a new epic/issue in the chosen project and link it), `DELETE /product/feature-issues/:id`, `POST /product/features/:id/vote` (toggle).
- `routes/product-objectives.js` — CRUD `/product/objectives` (enriched with feature rollup: feature count, avg delivery progress), `POST/DELETE /product/objectives/:id/features`.
- `routes/portal.js` — `GET /portal/features` (portal_status non-null only; title/description/status/votes/has_voted only), `POST /portal/ideas` (creates an insight with source='portal' — the PM triages it into a feature).

All routes `requireAuth`; portal endpoints are the one surface also open to the `client` role by design (clients already exist in the users table).

## Screens (new "Product" nav group + portal)

- `/product/insights` — inbox: unprocessed/processed tabs, source badges, detail pane, link-to-feature dialog (feature picker + importance + optional quote), mark processed.
- `/product/features` — table with score columns (user impact, RICE, votes), status/timeframe filters, feature detail sheet (edit fields, linked insights with quotes, linked delivery issues with progress bar, objectives, push-to-delivery).
- `/product/prioritize` — value/effort scatter (quadrant labels: Quick wins / Big bets / Fill-ins / Money pit) + RICE-ranked table.
- `/product/objectives` — objective cards with status, target date, linked-feature rollup progress.
- `/product/roadmap` — Now / Next / Later columns of feature cards (drag between columns = update timeframe), release-grouped secondary view.
- `/product/customers` — companies with tier badges + ARR, customers per company, inline create/edit.
- `/portal` — customer-facing idea portal: Under consideration / Planned / Launched columns, vote buttons, "Submit an idea" form.

## Epic → scope map

| Epic | Scope |
|---|---|
| ATLAS-13 Insights | pb_insights, pb_insight_links, insights routes + inbox screen |
| ATLAS-14 Features & Prioritization | pb_features, scores, features routes, features + prioritize screens |
| ATLAS-15 Customers & Segments | pb_companies, pb_customers, routes, customers screen; tier weighting in user_impact |
| ATLAS-16 Objectives | pb_objectives (+link), routes, objectives screen |
| ATLAS-17 Product Roadmap | timeframe, roadmap screen, push-to-delivery + delivery progress |
| ATLAS-18 Portal + polish | pb_votes, portal routes/screen; JQL-lite text queries in /api/search (`field = value AND …` over project/status/type/assignee/priority/label); epic rollups count done-**category** statuses (project_statuses.category) instead of literal 'done' |

Build order note: ATLAS-14/15 tables land together first (features reference scores that
need companies), then insights, objectives, roadmap, portal — commits stay one-epic-shaped.

## Error handling & constraints

- Same conventions as existing routes: `requireAuth`, 400 on missing required fields, 404 on missing parents, `serverError` wrapper.
- Portal never leaks internal fields (scores, effort, owner) — dedicated projection.
- Deleting a feature cascades its links (insight links, issue links, objective links, votes) in the delete handler (SQLite FKs are not enforced here — match existing delete patterns).
- No changes to existing tables ⇒ zero migration risk for existing DBs.

## Testing

- New `backend/tests/backend/product-wave.test.js`: CRUD per module, score math (user_impact with tier weights, RICE), portal projection + client-role access, vote toggle, push-to-delivery creates linked issue, JQL-lite parser cases, done-category rollup regression.
- Existing 204 tests must stay green; frontend build must pass.

## Seeding & dogfood

- Demo product data (2 companies, 3 customers, ~6 insights, ~8 features across statuses/timeframes, 2 objectives, votes) seeded when `SEED_DEMO_DATA` and `pb_features` is empty (idempotent, works on existing DBs).
- Dogfood: ATLAS-13..18 epics seeded done with children in the ATLAS project, same pattern as previous waves.

## Out of scope

Email ingestion, Slack/Intercom integrations, anonymous (unauthenticated) portal access,
custom scoring formula builder, portfolio/multi-product hierarchy, notification emails.
