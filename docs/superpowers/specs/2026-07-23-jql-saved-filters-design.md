# Personal JQL saved filters — Epic 55

**Date:** 2026-07-23
**Status:** implemented 2026-07-23

## Problem

Atlas has two halves of a useful feature but not the complete workflow. JQL v2
can express rich issue searches, while the backlog can persist simple local UI
controls in `saved_filters`. There is no place to compose a JQL search, see its
results, save it, rename it, and return to it later. The existing API also
accepts arbitrary JSON and cannot update a filter.

Epic 55 completes that unfinished vertical slice. It keeps legacy backlog
presets working and adds first-class, personal JQL filters for each project.

## Decisions

### One table, two explicit filter kinds

The existing `saved_filters.params` JSON remains the storage boundary. A
normalized `kind` field distinguishes the two contracts:

- `backlog`: `query`, `status`, `type`, `assignee`, and `label` controls.
- `jql`: one required `jql` string.

Rows written before this epic have no `kind`; they normalize to `backlog` on
read. This preserves existing databases without a migration and prevents JQL
filters from appearing in the backlog preset picker.

### The server owns validation

Create and update accept only the documented keys, cap names and query text,
and run JQL through the same parser/compiler used by search and service-desk
queues. Invalid JQL returns its offset-aware 400 response before any row is
written. Names are unique case-insensitively per user and project so the filter
list never contains ambiguous duplicates.

### Personal and project-scoped

Every filter belongs to one `(user_id, project_id)` pair. List only returns the
caller's rows; update and delete require ownership (with the existing admin
delete override retained). Search execution always sends the current project
id, even if the query itself mentions no project.

### A dedicated screen, not another modal

`/:projectKey/filters` gets a permanent navigation entry. The screen has a
saved-filter rail, editable name and JQL, inline parser errors, field/operator
help, explicit Run and Save actions, and a result table whose issue links use
the permanent issue URL scheme. New filters start with `category != done`, a
useful query that exercises project workflow categories rather than assuming a
literal status name.

## API

Existing endpoints remain compatible:

- `GET /api/projects/:projectId/filters`
- `POST /api/projects/:projectId/filters`
- `DELETE /api/filters/:id`

This epic adds:

- `PUT /api/filters/:id` — rename and/or replace the validated params document.

All successful responses include normalized `params_parsed`, including the
explicit `kind`. Missing projects return 404. Deleting a project removes its
saved filters before the project row.

## Validation contract

- Name: trimmed, 1–80 characters.
- Params: a plain object, never an array or scalar.
- JQL: trimmed, 1–2,000 characters, valid under JQL v2.
- Backlog values: strings only, with bounded search text.
- Unknown kinds and unknown keys: 400.
- Duplicate personal name in the same project: 409.
- An update with neither `name` nor `params`: 400.

## Testing

- Pure contract tests cover legacy normalization and every validation boundary.
- Route tests cover create, update, duplicate rejection, invalid-query atomicity,
  ownership, user/project isolation, project 404s, and deletion cleanup.
- Browser coverage creates a JQL filter, runs it, saves it, reloads the page,
  edits it, and removes it.
- The full backend suite, TypeScript, production build, and browser suite remain
  release gates.

## Seeding

Epic 55 is seeded done with children for the normalized contract, validated
write API, dedicated screen, project-scoped result execution, and regression
coverage.

## Out of scope

- Shared/team filters and administrator-managed subscriptions.
- Scheduled email delivery or notifications for newly matching issues.
- JQL autocomplete or a visual query builder.
- Ordering clauses in JQL; results keep the search endpoint's recent-update
  order.
- A schema migration solely to move typed JSON fields into columns.
