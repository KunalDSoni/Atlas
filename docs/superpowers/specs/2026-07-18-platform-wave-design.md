# Platform & Depth Wave (ATLAS-21 → ATLAS-25)

**Date:** 2026-07-18 · **Branch:** `feature/platform-wave` · **Status:** approved (autonomous build)

## Context

Atlas now has full feature parity with the *core* of Jira, Confluence, and Productboard
(20 epics shipped). The remaining gaps are platform-level depth features. This wave builds
the self-contained, high-value ones. Same conventions as prior waves: `pb_*`/new tables,
`requireAuth`, `serverError`, graceful degradation, tests gating every commit, dogfood epics.

## In scope

| Epic | Scope |
|---|---|
| ATLAS-21 Email notifications | SMTP delivery layer (nodemailer), gated on SMTP config like AI is gated on a key; HTML email templates for assignment/mention/comment/watch/wiki; respects each user's notification settings; degrades to no-op when unconfigured. Dev "outbox" capture for testing without a real server. |
| ATLAS-22 Wiki page attachments & inline images | Reuse the existing attachments infra for wiki pages: upload files to a page, list/download/delete, and insert uploaded images inline in the editor. |
| ATLAS-23 Public API tokens & outbound webhooks | Per-user API tokens (hashed, `atlas_pat_` prefix) that authenticate the existing `/api` surface; a webhooks subsystem (per-project endpoints, HMAC-signed deliveries) firing on issue lifecycle events. Settings UI to manage both. |
| ATLAS-24 Real-time updates (SSE) | A lightweight in-process event bus + `GET /api/stream` Server-Sent Events endpoint (no socket.io dependency). Frontend `useLiveEvents` subscribes; board and notification bell update live. |
| ATLAS-25 Custom fields | Per-project custom field definitions (text/number/select/date/checkbox) + values on issues; admin UI to define them; render + edit on the issue detail sheet and create dialog. |

## Deferred (with rationale)

- **SSO / SAML** — requires an external identity provider and is security-sensitive; not buildable or verifiable in this environment.
- **Full block editor (slash commands, drag blocks)** — a multi-week rewrite of the editor; high regression risk. The current editor plus AI writer is sufficient for now.
- **Whiteboards / databases** — large new subsystems (canvas engine, structured-data grid) beyond a single wave.
- **Service desk (JSM: queues, SLAs, request portal)** — effectively a separate product.
- **External feedback integrations (Slack/Intercom/Zendesk)** — need third-party API credentials and live endpoints to build against.
- **Customizable dashboard gadgets** — valuable but lower priority than the above; candidate for a follow-up wave.

## Architecture notes

- **Email** (`utils/email.js`): `config.email` gated on `SMTP_HOST`/`SMTP_URL`. `sendMail()` is a no-op returning `{skipped:true}` when unconfigured, so the app and `utils/notify.js` work unchanged. Notify hooks call it best-effort (never block the request). In test/dev without SMTP, deliveries are captured to an in-memory outbox for assertions.
- **Wiki attachments**: new `wiki_attachments` table mirroring `attachments`; routes under `/api/wiki/pages/:id/attachments`; images embedded as `<img src="/api/wiki/attachments/:id/raw">` (same-origin, auth-checked).
- **API tokens**: `api_tokens` table (id, user_id, name, token_hash, prefix, last_used, created_at). `authMiddleware` also accepts `Authorization: Bearer atlas_pat_…`, resolving to the owning user. Tokens shown once on creation.
- **Webhooks**: `webhooks` table (project_id, url, secret, events, enabled); `utils/webhooks.js` dispatches HMAC-SHA256-signed JSON on `issue.created/updated/deleted` (fire-and-forget). Delivery log table optional.
- **SSE**: `utils/events.js` is a tiny `EventEmitter` bus. `routes/stream.js` holds an SSE connection per client (auth via token query param since EventSource can't set headers), forwards bus events scoped to the user/project. Publishers (`issues.js`, `notify.js`) emit to the bus. Heartbeat every 25s.
- **Custom fields**: `custom_fields` (project_id, name, type, options JSON, position) + `issue_field_values` (issue_id, field_id, value). Enriched onto issues; validated by type on write.

## Testing & seeding

- Per-epic backend tests (`platform-wave.test.js` or per-feature files); existing 234 tests stay green; frontend builds.
- Seed ATLAS-21..25 dogfood epics done with children; `epics.test.js` expects 25.

## Out of scope

Everything in "Deferred" above; changing existing table shapes; anything requiring a live external service.
