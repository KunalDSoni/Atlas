# Subtasks — Design

**Date:** 2026-07-17
**Status:** Approved
**Scope:** Epic #2 of the Jira/Confluence parity roadmap (ATLAS-2)

## Context

Atlas is a full-stack Jira clone (Express + SQLite/MySQL backend, Vite/React/TS/shadcn
frontend). Epic #1 delivered epic support: `type='epic'` issues linked to children via
`issues.parent_id`, validated by `validateHierarchy` in `backend/routes/issues.js` —
deliberately built as the single choke point to extend for subtasks.

This spec adds the third hierarchy level: subtasks under stories/tasks/bugs, with
progress rollup on the parent.

Decisions locked with Kunal:
- Subtasks appear **only inside the parent's detail sheet** — not on the board, not in
  the backlog. Parent cards/rows show a small progress chip instead.
- Subtasks have **no sprint of their own** — they follow the parent implicitly.
- Epic rollups count **direct children only** — subtasks roll up to their parent issue,
  never to the epic. No double counting.
- Creation is **quick-add in the parent sheet** (title only); the create-issue dialog
  does not offer the subtask type.

## Approach

A subtask is a first-class **issue** of type `subtask` with `parent_id` pointing at a
story/task/bug — the same column and validation choke point as epics. Rejected
alternatives: a separate `subtasks` table (duplicates comments/attachments/watchers
machinery, same reason it was rejected for epics) and lightweight checklist items
(no assignee/status/comments; roadmap requires real child issues).

The schema already permits `'subtask'` in the type CHECK constraint. **No schema
change.**

## 1. Data model & hierarchy rules

Strict 3-level tree, enforced in `validateHierarchy` (API-level, not DB):

| Type | Parent | Sprint |
|------|--------|--------|
| `epic` | none allowed | rejected |
| `story` / `task` / `bug` | optional; must be an `epic` in the same project | allowed |
| `subtask` | **required**; must be a `story`/`task`/`bug` in the same project | rejected |

- Depth is capped structurally: nothing accepts a subtask as its parent, so a subtask
  can never have children.
- **Type changes** re-validate against next state: an issue with subtask children may
  change among story/task/bug but not to `subtask` or `epic`; a subtask may change
  type only if the parent reference remains valid for the new type (in practice:
  clear or change `parent_id` in the same request).
- **Reparenting** a subtask to another story/task/bug in the same project is allowed.
- **Deleting a parent orphans its subtasks** (`parent_id → NULL`, existing behavior).
  An orphaned subtask remains functional and can be reparented. (Orphaned subtasks
  still don't appear on board/backlog; they're reachable via search/detail.)

## 2. API (`backend/routes/issues.js`)

- `validateHierarchy` generalized per the table above; 400 with a specific message per
  failure (parent missing, parent wrong type, cross-project, sprint on subtask,
  parent required, type-change guard).
- `POST /api/projects/:projectId/issues` and `PUT /api/issues/:id` accept
  `type='subtask'`; validation runs through the same choke point.
- `PUT /api/issues/:id/move` rejects `sprint_id` for subtasks (today it guards only
  epics). Status/board_order moves remain allowed.
- `enrichIssue` gains:
  - `parent_key`, `parent_title`, `parent_type` — generic parent join fields
    (the existing `epic_key`/`epic_title`/`epic_badge_color` stay, meaningful when the
    parent is an epic);
  - `subtask_count`, `subtask_done_count` — so board/backlog show progress chips with
    no extra requests (coerced to Number for mysql2).
- `GET /api/issues/:id/children` already returns any issue's children — reused as-is
  for the subtask list.
- Epic rollups (`GET /api/projects/:projectId/epics`) are untouched: subtasks hang off
  stories/tasks/bugs, so `parent_id = epic.id` naturally excludes them.
- Activity log: `parent_id` changes are logged as field `parent` when the issue is a
  subtask (today's label `epic` stays for non-subtasks). Permissions unchanged.

## 3. Frontend UI

**Shared vocabulary** (`lib/types.ts`, `lib/domain.tsx`):
- `IssueType` gains `'subtask'`; registries gain label "Subtask", lucide `SquareStack`
  icon, sky-blue styling — all screens pick it up via shared registries.
- `Issue` gains `parent_key`, `parent_title`, `parent_type`, `subtask_count`,
  `subtask_done_count`.

**Issue detail sheet** (extended, not forked):
- Story/task/bug issues: a **Subtasks section** mirroring the epic children section —
  progress bar (`done/total`), rows with type icon, key, title, status pill, assignee;
  clicking a row opens that subtask in the sheet. Below the list, a **quick-add
  input**: title + Enter creates `type='subtask'` under this issue (other fields
  edited later by opening the subtask). Quick-add is hidden for viewers who can't
  create issues (same `canCreateIssues` gate as elsewhere).
- Subtask issues: a **parent breadcrumb** at the top (parent key + title, click to
  open the parent); the epic picker and sprint controls are hidden — both derive from
  the parent. Epic-only controls (color picker, child list) never show. Other fields
  (status, assignee, priority, points, labels, comments, links…) work as on any issue.

**Board & backlog:** subtasks are excluded from board columns and backlog rows (same
filter style as epics). Parent cards/rows with `subtask_count > 0` show a small
`✓ 2/5` progress chip.

**Create-issue dialog & command palette:** dialog unchanged (no subtask in the type
picker). Palette needs no change; subtasks are issues and resolve like any other.

## 4. Seeding (dogfood)

In the `SEED_DEMO_DATA` block of `backend/database.js`:
- Child issues under **ATLAS-2** describing this epic's real work (backend hierarchy
  generalization, detail-sheet subtasks UI, board/backlog chips, tests), seeded Done
  when this ships.
- A handful of demo subtasks under existing demo-project stories (mixed statuses) so
  progress chips and the subtasks section are visible on first login.

## 5. Error handling & testing

- API 400s with specific messages for every rule in §1/§2.
- **Backend tests** — new `backend/tests/backend/subtasks.test.js`: parent matrix
  (missing parent, epic parent rejected, subtask parent rejected, cross-project
  parent), sprint rejection on create/update/move, type-change guards both directions,
  reparenting, orphan-on-delete, `subtask_count`/`subtask_done_count` math,
  `parent_key`/`parent_title`/`parent_type` join fields, epic rollup excludes
  subtasks, permissions unchanged. Existing `epics.test.js` must stay green.
- **End-to-end verification:** run the app; quick-add subtasks on a story, toggle
  statuses, confirm the parent progress chip on board/backlog, confirm the subtask's
  breadcrumb and hidden epic/sprint controls, confirm epic rollup unchanged.

## Out of scope (later epics)

Subtasks as board cards, auto-transitioning the parent when all subtasks are done
(Epic 10 automation), subtask drag-reordering, bulk conversion of existing issues to
subtasks, epic filtering in search (Epic 3).
