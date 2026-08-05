# Add "Blocked" default issue status

## Problem

Today the built-in issue workflow has four statuses: To Do, In Progress, In Review, Done (`frontend/src/lib/domain.tsx`). There's no way to flag an issue that's stuck on a dependency or impediment without leaving it sitting under a misleading "In Progress" label. Jira's common Scrum/Kanban templates include a "Blocked" status for exactly this case.

Projects can already define fully custom status workflows (`backend/routes/workflows.js`, `project_statuses` table) — this change only affects the **built-in default** workflow used by projects that haven't customized their statuses.

## Approach

Add `blocked` as a fifth built-in status, positioned between `in_progress` and `in_review`:

```
To Do → In Progress → Blocked → In Review → Done
```

### Changes — `frontend/src/lib/domain.tsx`

- `STATUSES`: insert `'blocked'` after `'in_progress'`.
- `STATUS_LABEL`: `blocked: 'Blocked'`.
- `STATUS_TONE`: a distinct destructive/warning tone (e.g. `bg-destructive-muted text-destructive`) so it visually stands out from the other three tones.
- Category: for rollups/reporting (sprint burndown, category-based charts), `blocked` is treated as `in_progress` category — it's still unfinished work, just flagged. It keeps its own distinct `STATUS_TONE` entry regardless, since `STATUS_TONE` is checked before falling back to `CATEGORY_TONE`.

### No other code changes required

- `board.tsx` already renders one column per `workflow.keys.length` — Blocked gets a column automatically for projects on the default workflow.
- `use-workflow.tsx` merges built-ins with per-project custom statuses — no change needed.
- Status dropdowns (`create-issue-dialog.tsx`, filters, etc.) all read from `STATUSES`/`statusLabel`/`statusTone` — no change needed.
- Projects with an existing custom `project_statuses` configuration are unaffected.

## Out of scope

- No automatic transition rules (e.g. auto-unblock when a dependency resolves).
- No "blocked reason" / blocking-issue-link field — this is purely a status value, matching how the other four statuses work today. A richer "why is this blocked" feature would be a separate spec.
- No per-project migration — existing projects on the default workflow simply gain a new available column/status; no data migration needed since it's an additive enum value.

## Testing

- Verify board renders a "Blocked" column with correct tone for a project on the default workflow.
- Verify status dropdown (create/edit issue) includes "Blocked".
- Verify sprint/report rollups still count `blocked` issues as incomplete (same as `in_progress`, `in_review`, `todo`).
- Verify a project with custom `project_statuses` is unaffected (no "Blocked" column appears unless explicitly added to that project's workflow).
