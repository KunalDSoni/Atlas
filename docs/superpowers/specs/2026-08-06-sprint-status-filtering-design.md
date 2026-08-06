# Sprint Status Lock & Issue-Type Filtering Design

**Date:** 2026-08-06  
**Status:** Draft  
**Priority:** Medium

## Overview

This design addresses two related improvements to sprint management:
1. **Completed Sprint Status Lock** — prevent accidental status changes to completed sprints by making them read-only
2. **Issue-Type Filtering** — replace sprint-based filtering with issue-type filtering on the sprint detail screen, aligned with JIRA's approach

## Problem Statement

Currently:
- Users can change a completed sprint's status back to "active" or "planning", which shouldn't be allowed
- The sprint filtering UI focuses on sprint selection instead of issue-type filtering within a sprint
- Sprint is already fixed/shown in the board name, but filtering UI suggests it's variable

## Design Goals

1. Make completed sprints immutable (status cannot change)
2. Add discoverable issue-type filtering to sprint detail view
3. Align UI/UX with JIRA Atlassian's sprint board conventions
4. Keep filter state simple (session-scoped, not persisted)

## Architecture

### 1. Completed Sprint Status Lock

**Scope:** `sprints.tsx` and the edit/management dialogs

**Changes:**
- Hide status dropdown in `SprintCard` component when `sprint.status === 'completed'`
- Remove status selector from `EditSprintDialog` for completed sprints
- Status badge (showing "completed") remains visible for context
- Completed sprints can still be deleted (if user has permissions)

**Behavior:**
- Planning → Active: allowed
- Active → Completed: allowed (via complete sprint dialog with unfinished work handling)
- Completed → (anything): blocked (no selector shown)

**User Experience:**
- Completed sprints look visually distinct (no editable status)
- Users see a "completed" badge on the sprint card
- Edit dialog for completed sprints shows all fields except status

### 2. Issue-Type Filter Component

**Scope:** `sprint-detail.tsx`

**UI Location:** Above the issues list, between the sprint header/stats and the issues table

**Component Structure:**
```
Filter Button: "All types" | "Bug, Story, Epic" (depends on selection)
  ↓ opens
Filter Menu with Checkboxes:
  ☐ Epic
  ☐ Story
  ☐ Bug
  ☐ Task
  ☑ Subtask
  (includes all issue types from domain config)
```

**Behavior:**
- Multi-select: user can check/uncheck multiple types
- "All types" shown when nothing is filtered or when reset
- Selected types persist during the session (component state, not URL/storage)
- Unchecking all types shows all issues (equivalent to "All types")
- Filter applies immediately without a submit button

**Implementation Details:**
1. Query available issue types from `TYPE_LABEL` in `/lib/domain`
2. Add `selectedTypes: string[]` state to component
3. Filter issues array: `issues.filter(i => selectedTypes.length === 0 || selectedTypes.includes(i.type))`
4. Use existing UI primitives (dropdown/select or custom checkbox menu)

### 3. Data Flow

**Sprint Detail Screen:**
1. Load sprint and its issues (existing behavior)
2. Render filter UI with all available types
3. On type selection change, update local state
4. Filter displayed issues client-side
5. No API changes required

**Sprints Overview:**
1. Load all sprints
2. Group by status (Active, Planned, Completed)
3. For each sprint, render card with:
   - Status badge
   - Management controls (edit/delete buttons)
   - Status dropdown (hidden for completed sprints)

## UI Changes

### Sprint Card (sprints.tsx)
```
Before:
┌─────────────────────────────────────┐
│ Sprint 1                   [Completed]
│ Sprint goal...                       │
│ Progress: 5/5 · 100%                │
│ Points: 20/20                       │
│ [Status dropdown ▼] [Edit] [Delete] │
└─────────────────────────────────────┘

After (completed sprint):
┌─────────────────────────────────────┐
│ Sprint 1                   [Completed]
│ Sprint goal...                       │
│ Progress: 5/5 · 100%                │
│ Points: 20/20                       │
│ [Edit] [Delete]                     │
└─────────────────────────────────────┘
(No status dropdown for completed sprints)
```

### Sprint Detail Screen (sprint-detail.tsx)
```
Before:
Sprint 1
[Filter: All issues ▼] [Backlog only ▼] [Sprint 1 ▼] [Sprint 2 ▼]

Issues:
  [Issue rows...]

After:
Sprint 1
[Filter by type: All types ▼]

Issues:
  [Issue rows...]
```

## Testing Strategy

### Unit/Component Tests
- [ ] Completed sprint cards don't render status dropdown
- [ ] Status selector not present in edit dialog for completed sprints
- [ ] Issue filter correctly filters by selected types
- [ ] Unchecking all types shows all issues
- [ ] Filter state resets on component unmount

### Integration Tests
- [ ] Cannot change completed sprint status via API (backend validation)
- [ ] Sprint detail page loads and displays all issue types
- [ ] Filtering by type correctly reduces issue count
- [ ] Issue counts in sprint stats match filtered view

### Manual Testing
- [ ] View a completed sprint — no status dropdown visible
- [ ] Edit a completed sprint — status field not present
- [ ] On sprint detail, filter by one type — verify only that type shown
- [ ] Filter by multiple types — verify all selected types shown
- [ ] Reset filter — verify all issues reappear

## Migration & Rollout

**Backward Compatibility:**
- No data model changes
- Completed sprints remain queryable
- Status field still exists and populated

**Rollout:**
- Implement sprint detail filtering first (non-breaking)
- Then implement status lock (improves data integrity)
- No database migrations needed

## Edge Cases & Open Questions

1. **What if an issue type has no icon in the domain config?** Use a generic icon or label-only display
2. **Should filter be in URL for deep-linking?** No — per requirement, session-scoped only
3. **Can admins override the completed sprint lock?** Not in scope; assume backend enforces it
4. **What about future sprint status values?** Current enum is `['planning', 'active', 'completed']` — this design handles all three

## Success Criteria

- ✓ Completed sprints show status badge but no editable status selector
- ✓ Sprint detail screen has working issue-type filter
- ✓ Filter supports multi-select and shows all available types from domain
- ✓ No broken tests; existing sprint management tests still pass
- ✓ UI matches JIRA conventions (sprint fixed, type-based filtering available)
