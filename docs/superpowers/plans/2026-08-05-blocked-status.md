# Blocked Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Blocked" as a fifth built-in issue status (To Do → In Progress → Blocked → In Review → Done) in the default workflow, with its own label and a visually distinct tone.

**Architecture:** All built-in status vocabulary lives in one file, `frontend/src/lib/domain.tsx` (`STATUSES`, `STATUS_LABEL`, `STATUS_TONE`, `CATEGORY_TONE`). Every screen (board, backlog, filters, dropdowns, reports) reads status metadata through the `statusLabel()`/`statusTone()` helpers in that file rather than hardcoding values, so adding one status key there propagates everywhere automatically. No other file needs code changes.

**Tech Stack:** React + TypeScript frontend, Tailwind CSS for tone classes. No unit test runner exists in this repo (`frontend/`) — only Playwright E2E (`frontend/playwright.config.ts`). Verification for this change is done by running the dev server and checking the board/dropdowns in-browser, per the spec's manual test list.

## Global Constraints

- Status keys are per-project since custom workflows exist; the four (now five) built-ins remain the common default (per `frontend/src/lib/types.ts:5` comment).
- `blocked` is additive only — no changes to `backend/routes/workflows.js` or the `project_statuses` table; existing projects with custom workflows are unaffected.
- `STATUS_TONE` must be checked before `CATEGORY_TONE` in `statusTone()` (already true in existing code at `frontend/src/lib/domain.tsx:41-45`) — `blocked` needs its own entry in `STATUS_TONE` precisely so it doesn't fall back to the `in_progress` category tone.

---

### Task 1: Add "Blocked" to the built-in status vocabulary

**Files:**
- Modify: `frontend/src/lib/domain.tsx:9` (`STATUSES`)
- Modify: `frontend/src/lib/domain.tsx:11-16` (`STATUS_LABEL`)
- Modify: `frontend/src/lib/domain.tsx:19-24` (`STATUS_TONE`)

**Interfaces:**
- Consumes: nothing new — uses the existing `IssueStatus` type (`frontend/src/lib/types.ts:5`, `type IssueStatus = string`).
- Produces: `'blocked'` becomes a valid member of `STATUSES`, resolvable via `statusLabel('blocked')` → `'Blocked'` and `statusTone('blocked')` → its own Tailwind tone string. Every consumer of `STATUSES`/`statusLabel`/`statusTone` (board columns, status dropdowns, filters, reports) picks this up with no further changes, since none of those call sites hardcode the status list.

- [ ] **Step 1: Update `STATUSES`**

In `frontend/src/lib/domain.tsx:9`, change:

```ts
export const STATUSES: IssueStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
```

to:

```ts
export const STATUSES: IssueStatus[] = ['todo', 'in_progress', 'blocked', 'in_review', 'done'];
```

- [ ] **Step 2: Update `STATUS_LABEL`**

In `frontend/src/lib/domain.tsx:11-16`, change:

```ts
export const STATUS_LABEL: Record<IssueStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};
```

to:

```ts
export const STATUS_LABEL: Record<IssueStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  in_review: 'In Review',
  done: 'Done',
};
```

- [ ] **Step 3: Update `STATUS_TONE` with a distinct destructive/warning tone**

In `frontend/src/lib/domain.tsx:19-24`, change:

```ts
export const STATUS_TONE: Record<IssueStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary-muted text-accent-foreground',
  in_review: 'bg-info-muted text-info',
  done: 'bg-success-muted text-success',
};
```

to:

```ts
export const STATUS_TONE: Record<IssueStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary-muted text-accent-foreground',
  blocked: 'bg-destructive-muted text-destructive',
  in_review: 'bg-info-muted text-info',
  done: 'bg-success-muted text-success',
};
```

Note: `bg-destructive-muted` / `text-destructive` follow the same `bg-<x>-muted text-<x>` naming pattern already used by the other three tones (`primary-muted`/`accent-foreground` is the one exception, kept as-is). Grep the Tailwind config/theme (`frontend/tailwind.config.*` or `frontend/src/**/*.css`) for `destructive` to confirm the token exists before using it; if it doesn't exist, use `bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400` instead (matching whatever dark-mode convention the other tones use — check the actual generated CSS for `info-muted`/`success-muted` if unsure).

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. (`Record<IssueStatus, string>` is keyed by `string` since `IssueStatus = string`, so adding a `blocked` key can't break the type — this step just confirms nothing else in the file broke.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/domain.tsx
git commit -m "feat(status): add Blocked as a built-in default status"
```

---

### Task 3: Add "Blocked" to the backend's default status list

> Added after Task 1 landed: manual verification (Task 2) found that the board and status dropdowns actually read default statuses from `backend/routes/workflows.js`'s `DEFAULT_STATUSES` constant via `GET /api/projects/:id/statuses`, not from the frontend's `STATUSES` array directly. The frontend `domain.tsx` change alone (Task 1) does not make "Blocked" appear anywhere in the running app — this was a gap in the original plan, not an implementation defect in Task 1.

**Files:**
- Modify: `backend/routes/workflows.js:22-27` (`DEFAULT_STATUSES`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /api/projects/:projectId/statuses` on a project with no custom `project_statuses` rows now returns 5 default statuses instead of 4, in the same shape as before (`{ key, label, category, position }` plus `id`/`project_id`/`builtin` added by `projectStatuses()`). The frontend's `use-workflow.tsx` hook and board/dropdown components consume this endpoint unchanged — no frontend code needs to change beyond Task 1's `STATUS_LABEL`/`STATUS_TONE` entries (already done), since this endpoint is the source of the board's column list and `statusLabel()`/`statusTone()` resolve the label/tone client-side from the key it returns.

- [ ] **Step 1: Update `DEFAULT_STATUSES`**

In `backend/routes/workflows.js:22-27`, change:

```js
const DEFAULT_STATUSES = [
  { key: 'todo', label: 'To Do', category: 'todo', position: 0 },
  { key: 'in_progress', label: 'In Progress', category: 'in_progress', position: 1 },
  { key: 'in_review', label: 'In Review', category: 'in_progress', position: 2 },
  { key: 'done', label: 'Done', category: 'done', position: 3 },
];
```

to:

```js
const DEFAULT_STATUSES = [
  { key: 'todo', label: 'To Do', category: 'todo', position: 0 },
  { key: 'in_progress', label: 'In Progress', category: 'in_progress', position: 1 },
  { key: 'blocked', label: 'Blocked', category: 'in_progress', position: 2 },
  { key: 'in_review', label: 'In Review', category: 'in_progress', position: 3 },
  { key: 'done', label: 'Done', category: 'done', position: 4 },
];
```

`blocked` uses the `in_progress` category (must be one of `CATEGORIES = ['todo', 'in_progress', 'done']` at `backend/routes/workflows.js:19`) — matching the spec's rollup/reporting requirement that Blocked still counts as incomplete work, consistent with Task 1's frontend category mapping.

- [ ] **Step 2: Check for other hardcoded copies of the 4-status list**

Run: `grep -rn "'todo'.*'in_progress'.*'in_review'.*'done'\|todo.*in_progress.*in_review.*done" backend/ --include=*.js | grep -v node_modules | grep -v tests`

Expected: only the `DEFAULT_STATUSES` array just edited, and possibly seed/migration data (leave seed/migration files alone — they're historical data, not the live default list). If another *live* route or config file hardcodes the same 4-key list, report it in your report rather than silently editing it — flag it as a concern for the controller to decide scope on.

- [ ] **Step 3: Run backend tests**

Run: `cd backend && npm test`
Expected: existing suite passes (no test should assert exactly 4 default statuses in a way that this change breaks; if one does, read it and report what you found rather than editing the test yourself).

- [ ] **Step 4: Commit**

```bash
git add backend/routes/workflows.js
git commit -m "feat(status): add Blocked to backend default workflow statuses"
```

---

### Task 2: Manual verification in the running app

**Files:** none (verification only, no code changes)

**Interfaces:**
- Consumes: the `blocked` status added in Task 1, and the existing board/dropdown/report screens that already read from `STATUSES`/`statusLabel`/`statusTone` (`frontend/src/screens/board.tsx`, `frontend/src/components/app/create-issue-dialog.tsx`, `frontend/src/hooks/use-workflow.tsx`, and any filters/report screens).
- Produces: confidence the change is correct before merging — no new interface for later tasks (this is the last task).

- [ ] **Step 1: Start the dev server and open the app**

Use the `run` skill or the project's normal dev command (check `frontend/package.json` scripts, typically `npm run dev`) and open it in the Browser tool.

- [ ] **Step 2: Verify the board shows a "Blocked" column**

Navigate to a project's board that uses the **default** (non-customized) workflow. Confirm a "Blocked" column appears between "In Progress" and "In Review", styled with the distinct destructive/warning tone from Task 1 Step 3 — visually different from the other four columns.

- [ ] **Step 3: Verify the status dropdown includes "Blocked"**

Open the create-issue dialog (or an existing issue's status dropdown) on a default-workflow project. Confirm "Blocked" appears as a selectable option in the correct position, and selecting it moves the issue to the Blocked column on the board.

- [ ] **Step 4: Verify a custom-workflow project is unaffected**

Find (or note as N/A if none exists in seed data) a project with a custom `project_statuses` configuration. Confirm its board and dropdowns show only its configured statuses — no "Blocked" column appears unless it was explicitly added to that project's custom workflow.

- [ ] **Step 5: Verify reports/rollups still treat Blocked as incomplete**

Open a sprint report or dashboard gadget that rolls up issues by category (e.g. burndown, "issues remaining"). Move an issue to Blocked and confirm it's still counted as incomplete/in-progress work, not as Done, consistent with the spec's category mapping (`blocked` → `in_progress` category).

- [ ] **Step 6: Report results**

If all four checks pass, the feature is complete — no commit needed for this task (verification only). If anything fails, return to Task 1 and fix before considering the plan done.
