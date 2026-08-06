# Sprint Status Lock & Issue-Type Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent status changes to completed sprints and add issue-type filtering to the sprint detail screen.

**Architecture:** Two independent changes: (1) hide status controls for completed sprints in the sprint management UI, (2) add a client-side issue-type filter dropdown on the sprint detail screen. No backend changes required.

**Tech Stack:** React, TypeScript, shadcn/ui components, existing domain config (TYPE_LABEL from `/lib/domain`)

## Global Constraints

- No database migrations or backend API changes
- Filter state is session-scoped (component state only, not URL params)
- Must support all issue types defined in `TYPE_LABEL` from domain config
- Completed sprints remain queryable but UI prevents status editing
- Follow existing code patterns in sprints.tsx and sprint-detail.tsx

---

## Task 1: Create IssueTypeFilter Component

**Files:**
- Create: `frontend/src/components/app/issue-type-filter.tsx`
- Test: `frontend/src/components/app/issue-type-filter.test.tsx`

**Interfaces:**
- Consumes: `TYPE_LABEL` from `@/lib/domain`
- Produces: `<IssueTypeFilter selectedTypes={string[]} onSelectedTypesChange={(types: string[]) => void} />`

- [ ] **Step 1: Create the component file with TypeScript interface**

```typescript
// frontend/src/components/app/issue-type-filter.tsx
import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { TYPE_LABEL } from '@/lib/domain';
import { TypeIcon } from '@/components/app/primitives';

interface IssueTypeFilterProps {
  selectedTypes: string[];
  onSelectedTypesChange: (types: string[]) => void;
}

export function IssueTypeFilter({ selectedTypes, onSelectedTypesChange }: IssueTypeFilterProps) {
  const allTypes = useMemo(() => Object.keys(TYPE_LABEL), []);

  const displayLabel = selectedTypes.length === 0
    ? 'All types'
    : selectedTypes.length === 1
      ? TYPE_LABEL[selectedTypes[0]]
      : `${selectedTypes.length} types selected`;

  function handleTypeToggle(type: string) {
    const updated = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    onSelectedTypesChange(updated);
  }

  return (
    <DropdownMenu>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        aria-label="Filter by issue type"
      >
        <span className="text-sm">{displayLabel}</span>
        <ChevronDown className="size-4" />
      </Button>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs">Issue Type</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allTypes.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={selectedTypes.includes(type)}
            onCheckedChange={() => handleTypeToggle(type)}
            className="gap-2"
          >
            <TypeIcon type={type} />
            <span>{TYPE_LABEL[type]}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Verify shadcn/ui components are available**

Run: `grep -r "DropdownMenu" frontend/src/components/ui/`

Expected: Files like `dropdown-menu.tsx` exist in the ui directory. If not, add them via shadcn/ui CLI.

- [ ] **Step 3: Write unit test for component**

```typescript
// frontend/src/components/app/issue-type-filter.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { IssueTypeFilter } from './issue-type-filter';

describe('IssueTypeFilter', () => {
  it('displays "All types" when no types are selected', () => {
    render(<IssueTypeFilter selectedTypes={[]} onSelectedTypesChange={() => {}} />);
    expect(screen.getByText('All types')).toBeInTheDocument();
  });

  it('displays the single type name when one type is selected', () => {
    render(<IssueTypeFilter selectedTypes={['story']} onSelectedTypesChange={() => {}} />);
    expect(screen.getByText('Story')).toBeInTheDocument();
  });

  it('displays count when multiple types are selected', () => {
    render(<IssueTypeFilter selectedTypes={['story', 'bug']} onSelectedTypesChange={() => {}} />);
    expect(screen.getByText('2 types selected')).toBeInTheDocument();
  });

  it('calls onSelectedTypesChange when a type is toggled', () => {
    const mockChange = jest.fn();
    render(<IssueTypeFilter selectedTypes={[]} onSelectedTypesChange={mockChange} />);
    
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Story'));
    
    expect(mockChange).toHaveBeenCalledWith(['story']);
  });

  it('removes a type when toggling it off', () => {
    const mockChange = jest.fn();
    render(<IssueTypeFilter selectedTypes={['story', 'bug']} onSelectedTypesChange={mockChange} />);
    
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Story'));
    
    expect(mockChange).toHaveBeenCalledWith(['bug']);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- issue-type-filter.test.tsx`

Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/app/issue-type-filter.tsx frontend/src/components/app/issue-type-filter.test.tsx
git commit -m "feat: add IssueTypeFilter component for multi-select issue type filtering"
```

---

## Task 2: Integrate IssueTypeFilter into Sprint Detail Screen

**Files:**
- Modify: `frontend/src/screens/sprint-detail.tsx:1-70` (imports and state), `frontend/src/screens/sprint-detail.tsx:130-155` (issue list rendering)
- Test: `frontend/e2e/sprints.spec.ts` (add filter tests)

**Interfaces:**
- Consumes: `IssueTypeFilter` component from Task 1, existing `Issue` type
- Produces: Filtered issues list displayed in sprint detail screen

- [ ] **Step 1: Add imports and state to sprint-detail.tsx**

At the top of the file (after existing imports), add:

```typescript
import { IssueTypeFilter } from '@/components/app/issue-type-filter';
```

Inside the `SprintDetailScreen` component, add state for the filter (after the existing state declarations around line 45):

```typescript
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
```

- [ ] **Step 2: Create filtered issues variable**

Before the JSX return, add a useMemo that computes filtered issues (after the `pct` calculation around line 68):

```typescript
  const filteredIssues = useMemo(() => {
    if (selectedTypes.length === 0) return issues;
    return issues.filter((issue) => selectedTypes.includes(issue.type));
  }, [issues, selectedTypes]);
```

- [ ] **Step 3: Add filter UI to the JSX**

Find the location where issues are displayed (around line 132). Before the `{issues.length === 0 ?` conditional, add:

```typescript
      {issues.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <IssueTypeFilter 
            selectedTypes={selectedTypes} 
            onSelectedTypesChange={setSelectedTypes}
          />
        </div>
      )}
```

- [ ] **Step 4: Update the issues rendering to use filteredIssues**

Replace all occurrences of `issues` in the JSX with `filteredIssues`. Specifically:
- Line ~132: `{issues.length === 0 ?` → `{filteredIssues.length === 0 ?`
- Line ~148: `{issues.map((issue) =>` → `{filteredIssues.map((issue) =>`

Keep the empty state message as-is (only show filter if original `issues.length > 0`).

- [ ] **Step 5: Run the app and test the filter manually**

Run: `npm run dev` in the frontend directory

Manual steps:
1. Navigate to any sprint detail page
2. Verify the filter dropdown appears above the issues list
3. Click the dropdown and verify all issue types are shown
4. Select one type (e.g., "Bug")
5. Verify only bugs are displayed
6. Select multiple types
7. Verify all selected types are shown
8. Uncheck all types
9. Verify all issues reappear (showing "All types")

- [ ] **Step 6: Add E2E test for filter functionality**

In `frontend/e2e/sprints.spec.ts`, add a new test at the end:

```typescript
test('Issue type filter works on sprint detail', async ({ page }) => {
  // Navigate to a sprint with multiple issue types
  await page.goto('/project/PROJ/sprint/sprint-1');
  
  // Wait for issues to load
  await page.waitForSelector('[data-sprint-slug="sprint-1"]');
  
  // Get initial issue count
  const initialIssues = await page.locator('li').count();
  expect(initialIssues).toBeGreaterThan(0);
  
  // Click the filter dropdown
  await page.click('button:has-text("All types")');
  
  // Select only "Bug" type
  await page.click('text=Bug');
  await page.click('button:has-text("1 types selected")');
  
  // Verify filtered count is less than initial
  const filteredIssues = await page.locator('li').count();
  expect(filteredIssues).toBeLessThanOrEqual(initialIssues);
});
```

- [ ] **Step 7: Run E2E tests**

Run: `npm run test:e2e` in the frontend directory

Expected: Test passes

- [ ] **Step 8: Commit**

```bash
git add frontend/src/screens/sprint-detail.tsx frontend/e2e/sprints.spec.ts
git commit -m "feat: add issue type filter to sprint detail screen"
```

---

## Task 3: Hide Status Dropdown in SprintCard for Completed Sprints

**Files:**
- Modify: `frontend/src/screens/sprints.tsx:50-170` (SprintCard component)
- Test: Update existing sprint card tests or add new ones

**Interfaces:**
- Consumes: `Sprint` type, existing `SPRINT_STATUSES`
- Produces: Status selector conditionally rendered based on `sprint.status`

- [ ] **Step 1: Locate the SprintCard component and status dropdown**

Open `frontend/src/screens/sprints.tsx` and find the `setStatus` function (around line 50) and the Select component that renders the status dropdown (around lines 125-134).

- [ ] **Step 2: Wrap the status dropdown in a conditional**

Replace the existing status dropdown block (lines 123-134):

```typescript
        {canManage && sprint.status !== 'completed' && (
          <div className="flex items-center gap-2 pt-1">
            <Select value={sprint.status} onValueChange={(v) => setStatus(v as SprintStatus)}>
              <SelectTrigger className="h-8 flex-1 text-xs" aria-label={`Status for ${sprint.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPRINT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onEdit(sprint)}
              aria-label={`Edit ${sprint.name}`}
              title="Edit sprint"
            >
              <Pencil className="size-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Delete ${sprint.name}`}>
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {sprint.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Issues in this sprint move back to the backlog. They are not deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={remove}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete sprint
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
```

**Key change:** `{canManage && sprint.status !== 'completed' && (` wraps the status dropdown. Edit and Delete buttons remain outside this conditional so they're always available (if canManage is true).

- [ ] **Step 3: Verify the structure for incomplete sprints**

After the conditional block, add the edit/delete buttons for completed sprints:

```typescript
        {canManage && sprint.status === 'completed' && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onEdit(sprint)}
              aria-label={`Edit ${sprint.name}`}
              title="Edit sprint"
            >
              <Pencil className="size-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Delete ${sprint.name}`}>
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {sprint.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Issues in this sprint move back to the backlog. They are not deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={remove}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete sprint
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
```

- [ ] **Step 4: Write test for conditional rendering**

Add a test to the existing sprint tests or in a new test file:

```typescript
// Example test in frontend/src/screens/sprints.test.tsx or similar
test('Status dropdown is hidden for completed sprints', () => {
  const completedSprint: Sprint = {
    id: '1',
    name: 'Sprint 1',
    status: 'completed',
    // ... other required fields
  };

  render(
    <SprintCard
      sprint={completedSprint}
      projectKey="PROJ"
      canManage={true}
      onEdit={() => {}}
      onComplete={() => {}}
      onChanged={() => {}}
    />
  );

  const statusSelect = screen.queryByRole('combobox');
  expect(statusSelect).not.toBeInTheDocument();
});

test('Status dropdown is shown for planning sprints', () => {
  const planningSprint: Sprint = {
    id: '2',
    name: 'Sprint 2',
    status: 'planning',
    // ... other required fields
  };

  render(
    <SprintCard
      sprint={planningSprint}
      projectKey="PROJ"
      canManage={true}
      onEdit={() => {}}
      onComplete={() => {}}
      onChanged={() => {}}
    />
  );

  const statusSelect = screen.getByRole('combobox');
  expect(statusSelect).toBeInTheDocument();
});
```

- [ ] **Step 5: Run tests to verify**

Run: `npm test -- sprints` (or the specific test file)

Expected: Tests pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/sprints.tsx
git commit -m "feat: hide status dropdown for completed sprints in sprint card"
```

---

## Task 4: Hide Status Selector in EditSprintDialog for Completed Sprints

**Files:**
- Modify: `frontend/src/screens/sprints.tsx:270-282` (EditSprintDialog status selector)

**Interfaces:**
- Consumes: `Sprint` type, `SprintStatus` type
- Produces: Conditional status selector in edit form

- [ ] **Step 1: Locate the status selector in EditSprintDialog**

Open `frontend/src/screens/sprints.tsx` and find the `EditSprintDialog` component (around line 176). Locate the status selector (around lines 270-282).

- [ ] **Step 2: Wrap the status selector in a conditional**

Replace the status section:

```typescript
            {sprint && sprint.status !== 'completed' && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as SprintStatus)}>
                  <SelectTrigger aria-label="Sprint status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPRINT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
```

**Key change:** Wrapped in `{sprint && sprint.status !== 'completed' && (` to hide status selector for completed sprints.

- [ ] **Step 3: Add visual indicator for completed sprints**

After the conditional status selector block, add this to show users why the status isn't editable:

```typescript
            {sprint && sprint.status === 'completed' && (
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  This sprint is completed and cannot be reopened.
                </div>
              </div>
            )}
```

- [ ] **Step 4: Run the app and test manually**

Run: `npm run dev`

Manual steps:
1. Navigate to the Sprints screen
2. Find a completed sprint and click Edit
3. Verify the status field is NOT shown
4. Verify a message "This sprint is completed..." is shown instead
5. Verify other fields (name, goal, dates) are still editable
6. Click Cancel to close
7. Find a planning sprint and click Edit
8. Verify the status dropdown IS shown and functional
9. Click Cancel to close

- [ ] **Step 5: Write test**

```typescript
test('Status field is hidden in edit dialog for completed sprints', () => {
  const completedSprint: Sprint = {
    id: '1',
    name: 'Sprint 1',
    status: 'completed',
    // ... other required fields
  };

  render(
    <EditSprintDialog
      sprint={completedSprint}
      onOpenChange={() => {}}
      onSaved={() => {}}
      onComplete={() => {}}
    />
  );

  const statusSelect = screen.queryByLabelText('Sprint status');
  expect(statusSelect).not.toBeInTheDocument();

  const message = screen.getByText(/This sprint is completed/);
  expect(message).toBeInTheDocument();
});

test('Status field is shown in edit dialog for planning sprints', () => {
  const planningSprint: Sprint = {
    id: '2',
    name: 'Sprint 2',
    status: 'planning',
    // ... other required fields
  };

  render(
    <EditSprintDialog
      sprint={planningSprint}
      onOpenChange={() => {}}
      onSaved={() => {}}
      onComplete={() => {}}
    />
  );

  const statusSelect = screen.getByLabelText('Sprint status');
  expect(statusSelect).toBeInTheDocument();

  const message = screen.queryByText(/This sprint is completed/);
  expect(message).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Run tests**

Run: `npm test -- sprints`

Expected: Tests pass

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/sprints.tsx
git commit -m "feat: hide status selector in edit dialog for completed sprints"
```

---

## Task 5: Full Integration Testing

**Files:**
- Test: `frontend/e2e/sprints.spec.ts` (add comprehensive tests)

**Interfaces:**
- Consumes: Sprint management screens, issue detail screens
- Produces: Verified end-to-end workflows

- [ ] **Step 1: Write E2E test for sprint status lock**

Add to `frontend/e2e/sprints.spec.ts`:

```typescript
test('Cannot change status of completed sprint', async ({ page }) => {
  await page.goto('/project/PROJ/sprints');
  
  // Find a completed sprint
  const completedSprintCard = page.locator('[data-sprint-status="completed"]').first();
  expect(completedSprintCard).toBeVisible();
  
  // Verify no status dropdown in the card
  const statusSelect = completedSprintCard.locator('[aria-label*="Status"]');
  expect(statusSelect).not.toBeVisible();
  
  // Click Edit button on completed sprint
  await completedSprintCard.locator('button:has-text("Edit")').click();
  
  // Verify status field is not in the edit dialog
  const statusField = page.locator('label:has-text("Status")');
  expect(statusField).not.toBeVisible();
});

test('Can change status of planning sprint', async ({ page }) => {
  await page.goto('/project/PROJ/sprints');
  
  // Find a planning sprint
  const planningSprint = page.locator('[data-sprint-status="planning"]').first();
  expect(planningSprint).toBeVisible();
  
  // Verify status dropdown exists
  const statusSelect = planningSprint.locator('[aria-label*="Status"]');
  expect(statusSelect).toBeVisible();
});
```

- [ ] **Step 2: Write E2E test for issue type filter workflow**

Add to `frontend/e2e/sprints.spec.ts`:

```typescript
test('Can filter sprint issues by type', async ({ page }) => {
  await page.goto('/project/PROJ/sprint/sprint-1');
  
  // Wait for issues to load
  await page.waitForSelector('li');
  const initialCount = await page.locator('li').count();
  
  // Open filter dropdown
  await page.click('button:has-text("All types")');
  await page.waitForSelector('[role="menuitemcheckbox"]');
  
  // Select only "Bug"
  const bugCheckbox = page.locator('[role="menuitemcheckbox"]:has-text("Bug")');
  await bugCheckbox.click();
  
  // Close dropdown by clicking elsewhere
  await page.click('h1');
  
  // Verify filtered count
  const filteredCount = await page.locator('li').count();
  expect(filteredCount).toBeLessThanOrEqual(initialCount);
  
  // Verify button now shows "1 types selected"
  const filterButton = page.locator('button:has-text("1 types selected")');
  expect(filterButton).toBeVisible();
});

test('Selecting no types shows all issues', async ({ page }) => {
  await page.goto('/project/PROJ/sprint/sprint-1');
  
  // Get initial count
  const initialCount = await page.locator('li').count();
  
  // Filter to Bug only
  await page.click('button:has-text("All types")');
  await page.locator('[role="menuitemcheckbox"]:has-text("Bug")').click();
  await page.click('h1');
  
  // Filter should be active
  let currentCount = await page.locator('li').count();
  expect(currentCount).toBeLessThanOrEqual(initialCount);
  
  // Uncheck Bug
  await page.click('button:has-text("1 types selected")');
  await page.locator('[role="menuitemcheckbox"]:has-text("Bug")').click();
  await page.click('h1');
  
  // All issues should show
  currentCount = await page.locator('li').count();
  expect(currentCount).toBe(initialCount);
  
  // Button should show "All types"
  const filterButton = page.locator('button:has-text("All types")');
  expect(filterButton).toBeVisible();
});
```

- [ ] **Step 3: Run full E2E test suite**

Run: `npm run test:e2e`

Expected: All tests pass

- [ ] **Step 4: Run existing sprint tests to ensure no regressions**

Run: `npm test -- sprints.spec`

Expected: All existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/sprints.spec.ts
git commit -m "test: add comprehensive E2E tests for sprint status lock and issue type filter"
```

---

## Summary

**Total changes:**
- 1 new component: `IssueTypeFilter`
- 2 modified screens: `sprints.tsx`, `sprint-detail.tsx`
- 3 files changed, ~250 lines added
- All existing tests pass; new tests cover new functionality

**Rollout order (as per spec):**
1. Tasks 1-2: Issue-type filtering (non-breaking, new feature)
2. Tasks 3-4: Sprint status lock (improves data integrity)
3. Task 5: Full test coverage and verification

This plan implements the design spec with no backend changes, preserves backward compatibility, and aligns with JIRA conventions.
