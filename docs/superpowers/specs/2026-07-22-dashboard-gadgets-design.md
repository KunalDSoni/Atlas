# Customizable dashboard gadgets — Epic 54

**Date:** 2026-07-22
**Status:** implemented 2026-07-22
**Source:** explicitly deferred as a follow-up candidate by the approved Platform
& Depth Wave design.

## Problem

Atlas's dashboard is useful but fixed. Every user sees the same four sections
in the same order, even when a product manager wants recent work and issue mix,
an engineering lead wants sprint progress and workload, or a support lead wants
only headline counts. The data already exists; what is missing is a durable,
personal composition layer.

This epic makes the existing project dashboard customizable without turning it
into a free-form page builder.

## Decisions

### Personal and project-specific

A layout belongs to one `(user_id, project_id)` pair. Switching projects must
not carry an irrelevant layout across, and one person's edits must never change
another person's dashboard.

### One atomic JSON document

Migration 022 adds `dashboard_layouts`:

```text
id, user_id, project_id, gadgets, updated_at
UNIQUE(user_id, project_id)
```

`gadgets` is a small ordered JSON array of `{key, span}`. A full replacement is
one database write, so the server cannot save half a reorder. A stored empty
array is intentionally different from no row: no row receives the default;
empty means the user chose an empty dashboard.

The server owns a closed catalogue and rejects unknown keys, duplicate gadgets,
invalid spans, non-array documents, and documents larger than the catalogue.
Extra object properties are discarded rather than persisted.

### A closed, useful catalogue

The first version has seven gadgets, all backed by the three requests the old
dashboard already made (`stats`, `issues`, `sprints`):

| Key | View | Default width |
|---|---|---|
| `summary` | total, in progress, in review, done | full |
| `status` | completion and status distribution | half |
| `active_sprint` | sprint goal, issue and point progress | half |
| `recent_activity` | six most recently updated issues | full |
| `priority_breakdown` | issue count by priority | half |
| `type_breakdown` | issue count by type | half |
| `team_workload` | assigned work per person plus unassigned | full |

No gadget creates its own polling or report fan-out. Customization changes the
view, not the dashboard's request count.

### Explicit editing, no drag dependency

`Customize` enters a draft mode. Each card exposes accessible controls to move
up/down, toggle half/full width, and remove. `Add gadget` presents unused items;
`Reset` restores the default draft. Nothing persists until `Save layout`, and
`Cancel` discards the draft.

Arrow controls are deliberate: they work with keyboard and touch, avoid a new
drag-and-drop dependency, and make order changes deterministic in browser tests.

### Responsive layout

The desktop grid has two columns. `span: 1` occupies one column and `span: 2`
occupies both. Below the desktop breakpoint every gadget is one readable column,
regardless of its stored span.

## API

### `GET /api/projects/:projectId/dashboard-layout`

Returns:

```json
{
  "gadgets": [{ "key": "summary", "span": 2 }],
  "customized": false,
  "updated_at": null
}
```

When no row exists, `gadgets` is the default and `customized` is false. Stored
layouts return `customized: true`, including a stored empty array.

### `PUT /api/projects/:projectId/dashboard-layout`

Body: `{ "gadgets": [...] }`. Validates the complete replacement, inserts or
updates the caller's row, and returns the normalized stored document. Missing
projects return 404; invalid layouts return 400.

The routes sit after the service-desk client boundary in `server.js`, matching
the dashboard itself: internal staff may use them, customer-only accounts may
not.

## Dogfood seed

Epic 54 is seeded done with six children covering migration/API, catalogue,
editor, responsive/accessibility work, and regression coverage. Default layout
rows are not seeded: deriving defaults on read keeps all current and future
users consistent while preserving the meaning of an explicitly empty layout.

## Testing

- Pure contract tests pin the default catalogue and every validation boundary.
- Route tests prove default behavior, atomic persistence, empty persistence,
  user isolation, project isolation, normalization, 400s, and project 404s.
- Migration tests cover SQLite and the MySQL schema job.
- Browser coverage customizes the dashboard, reloads, and verifies the saved
  order/visibility remains.
- Full backend tests, TypeScript, production build, and the existing browser
  suite remain release gates.

## Out of scope

- Arbitrary third-party gadgets or executable gadget code.
- Gadget-specific JQL/configuration; the first catalogue uses current-project
  data and earns configuration only when a real use case appears.
- Free-form pixel placement, drag-and-drop, or more than two desktop columns.
- Shared/team dashboards and administrator-enforced layouts.
- Background refresh beyond Atlas's existing live-update behavior.
