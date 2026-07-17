# Epic Support — Design

**Date:** 2026-07-16
**Status:** Approved
**Scope:** Epic #1 of the Jira/Confluence parity roadmap (list below)

## Context

Atlas is a full-stack Jira clone (Express + SQLite/MySQL backend, Vite/React/TS/shadcn
frontend). A gap analysis against Jira and Confluence produced a 12-epic parity roadmap.
The epics are dogfooded: they live inside Atlas itself as real issues in a seeded
"Atlas Development" project. That requires Epic support to exist first — hence this spec.

### Parity roadmap (locked)

| # | Epic | Covers |
|---|------|--------|
| 1 | Epic support | `epic` issue type, epic assignment, Epics screen, badges — this spec |
| 2 | Subtasks | Child issues under stories/bugs/tasks, progress rollup |
| 3 | Global search & filters | Quick search across issues/wiki, JQL-lite filtering, saved filters |
| 4 | Notifications & @mentions | In-app inbox, mentions in comments, wiki page watching |
| 5 | Time tracking | Estimates, work logs, remaining time |
| 6 | Releases & components | Fix versions, components, release hub |
| 7 | Roadmap / timeline | Gantt-style epic and sprint timeline |
| 8 | Board power-ups | Swimlanes, WIP limits, bulk edit |
| 9 | Custom workflows | Configurable statuses/columns per project |
| 10 | Automation rules | Trigger → condition → action rules |
| 11 | Wiki: collaboration | Inline comments, page restrictions/permissions |
| 12 | Wiki: publishing | Export (PDF/Markdown), macros, blog posts |

Each epic gets its own spec → plan → implementation cycle. This document specifies
Epic #1 only.

## Approach

Epic is a first-class **issue** of type `epic`, linked to children via the existing
`issues.parent_id` column (Jira's model). Rejected alternatives: a separate `epics`
table (duplicates comments/attachments/watchers machinery) and label-based grouping
(no integrity, no rollup, doesn't prepare subtasks).

The schema already permits `'epic'` and `'subtask'` in the type CHECK constraint and
already has `parent_id`; the API and frontend simply never use them. This design
finishes that wiring.

## 1. Data model

- **New column:** `issues.epic_color TEXT DEFAULT 'purple'` — added in both the SQLite
  and MySQL schema blocks in `backend/database.js`, with an idempotent
  `ALTER TABLE ... ADD COLUMN` migration for existing databases. Meaningful only when
  `type = 'epic'`; drives badge color.
- **Hierarchy rule (API-enforced, not DB):** `parent_id` may only reference an issue of
  type `epic` in the same project. Epics themselves may not have a `parent_id`.
  When Epic #2 (subtasks) lands, the rule generalizes by type (subtask → story/task/bug)
  using the same column.
- **Behavior rules:** epics never have a `sprint_id` and never appear as board cards.
  A type change to/from `epic` is rejected if it would violate a rule (issue with
  children can't stop being an epic; an issue in a sprint or with a parent can't
  become an epic).

## 2. API (`backend/routes/issues.js`)

- `POST /api/projects/:projectId/issues` and `PUT /api/issues/:id` accept `parent_id`
  and `epic_color`.
- Validation (400 with a specific message on failure):
  - parent must exist, be type `epic`, and belong to the same project
  - an issue of type `epic` rejects `sprint_id` and `parent_id`
  - type-change guard per the behavior rules above
- Issue list and detail queries LEFT JOIN the parent so each issue carries
  `epic_key`, `epic_title`, `epic_color` — board/backlog badges render with no extra
  requests.
- **New endpoints:**
  - `GET /api/projects/:projectId/epics` — epics with rollup per epic: child issue
    count, done count, story points total/done (single grouped query)
  - `GET /api/issues/:id/children` — the child issues of an epic (reused later by
    subtasks)
- Deleting an epic **orphans** children (`parent_id → NULL`); no cascade delete.
- Permissions unchanged: create/delete gated on admin/board_admin as today.
- Activity log records `parent_id` changes as an "Epic" field change; comments,
  attachments, watchers, and links work on epics automatically because an epic is
  an issue.

## 3. Frontend UI

**Shared vocabulary** (`lib/types.ts`, `lib/domain.tsx`):
- `IssueType` gains `'epic'`; registries gain label "Epic", lucide `Zap` icon,
  purple styling — all screens pick it up via the shared registries.
- New `EPIC_COLORS` map (~8 named colors → Tailwind classes) for badges and the
  color picker.
- `Issue` gains `parent_id` join fields `epic_key / epic_title / epic_color`;
  new `EpicSummary` type for the rollup endpoint.

**New Epics screen** (`screens/epics.tsx`, route `/epics`, sidebar entry between
Backlog and Sprints): lists the selected project's epics — colored badge, title,
assignee, status, and progress bars for issue count and story points. "Create epic"
reuses the existing create-issue dialog with type preset to Epic and the sprint
picker hidden.

**Issue detail sheet** (extended, not forked):
- Non-epic issues: an **Epic picker** in the sidebar (dropdown of the project's
  epics, clearable).
- Epic issues: a **color picker** and a **Child issues** section — progress bar plus
  child list (key, type icon, title, status pill, assignee) and an "add existing
  issue" dropdown.

**Board & backlog:** cards/rows show a small tinted epic badge (epic name colored by
`epic_color`). Epics are excluded from board columns, backlog rows, and sprint
assignment — they surface only on the Epics screen.

## 4. Seeding (dogfood)

In the `SEED_DEMO_DATA` block of `backend/database.js`: a new project
**"Atlas Development" (key ATLAS)**, lead Kunal, containing all 12 roadmap epics with
real scope descriptions and distinct colors. `ATLAS-1 Epic support` is seeded as
**Done**; `ATLAS-2`–`ATLAS-12` as To Do. Subsequent epics get child issues created
under them as they are built.

## 5. Error handling & testing

- API 400s with specific messages for every validation failure listed in §2.
- **Backend tests** (existing suite in `backend/tests`): parent validation matrix
  (missing parent, non-epic parent, cross-project parent), epic sprint/parent
  rejection, type-change guards, rollup endpoint math, delete-orphans behavior,
  children endpoint, permissions unchanged.
- **End-to-end verification:** run the app; create an epic, assign issues to it,
  confirm badges on board/backlog, confirm rollup math on the Epics screen.

## Out of scope (later epics)

Subtasks (#2), epic filtering in search (#3), roadmap/timeline visualization (#7),
backlog group-by-epic, epic start dates.
