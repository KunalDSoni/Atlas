# Board Customization Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Allow teams to customize kanban board layout: reorder columns, add swimlanes (group by assignee, priority, epic), save multiple board views, toggle visibility.

**Architecture:** Extend `projects` table with `board_config` (JSON). New table `board_layouts` stores named saved views. Frontend board component reads config and renders swimlanes dynamically. Backend validates swimlane fields exist.

**Tech Stack:** React state management, JSON config storage, Tailwind CSS for styling.

## Global Constraints

- At least 1 column must always be visible
- Swimlane field must exist in project schema
- If swimlane field is deleted, reset swimlanes to "none"
- WIP limits per column (enforced on drag-drop)
- Multiple layouts per project, 1 default

---

## File Structure

**Backend:**
- `backend/migrations.js` — Add board config fields
- `backend/routes/projects.js` — Extend with board endpoints
- `backend/models/board-layout.js` — Layout CRUD (new)
- `backend/tests/backend/board-customization.test.js` — Tests (new)

**Frontend:**
- `frontend/src/screens/BoardScreen.tsx` — Update to use config
- `frontend/src/screens/ProjectSettings.tsx` — Add Board Layout tab
- `frontend/src/components/BoardSettingsPanel.tsx` — Config UI (new)
- `frontend/src/components/ColumnReorderer.tsx` — Drag-to-reorder (new)
- `frontend/src/components/SwimlaneSelectorPanel.tsx` — Grouping UI (new)
- `frontend/src/components/BoardPreview.tsx` — Live preview (new)
- `frontend/src/components/LayoutSwitcher.tsx` — Save/load layouts (new)
- `frontend/tests/e2e/board-customization.spec.ts` — E2E tests (new)

---

## Task Breakdown

### Task 1: Database Schema

- [ ] Add to `backend/migrations.js`:

```javascript
{
  id: '013_board_customization',
  description: 'Add board configuration to projects',
  steps: [
    {
      addColumn: {
        table: 'projects',
        column: 'board_config',
        sqlite: "ALTER TABLE projects ADD COLUMN board_config TEXT DEFAULT '{}'",
        mysql: "ALTER TABLE projects ADD COLUMN board_config JSON DEFAULT (JSON_OBJECT())",
      },
    },
  ],
},
{
  id: '014_board_layouts',
  description: 'Create board layouts table',
  steps: [
    {
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS board_layouts (
          id VARCHAR(36) PRIMARY KEY,
          project_id VARCHAR(36) NOT NULL,
          layout_name VARCHAR(255),
          description TEXT,
          board_config TEXT,
          is_default BOOLEAN DEFAULT false,
          created_by_id VARCHAR(36),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME,
          KEY idx_project (project_id)
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS board_layouts (
          id VARCHAR(36) PRIMARY KEY,
          project_id VARCHAR(36) NOT NULL,
          layout_name VARCHAR(255),
          description TEXT,
          board_config JSON,
          is_default BOOLEAN DEFAULT false,
          created_by_id VARCHAR(36),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME,
          KEY idx_project (project_id)
        )`,
      },
    },
  ],
}
```

- [ ] Commit: `git commit -m "feat: add board customization schema"`

---

### Task 2: Board Layout Model & API

**Files:**
- Create: `backend/models/board-layout.js`

- [ ] Create model with CRUD operations and validation

- [ ] Add to `backend/routes/projects.js`:
  - `PUT /api/projects/:id/board-config` - Update board config
  - `GET /api/projects/:id/board-config` - Get current config
  - `POST /api/projects/:id/board-layouts` - Save layout
  - `GET /api/projects/:id/board-layouts` - Get all layouts
  - `PUT /api/projects/:id/board-layouts/:layoutId` - Update layout
  - `DELETE /api/projects/:id/board-layouts/:layoutId` - Delete layout
  - `POST /api/projects/:id/board-layouts/:layoutId/apply` - Apply layout

- [ ] Validate:
  - At least 1 column visible
  - Swimlane field exists in project schema
  - WIP limits are non-negative integers

- [ ] Commit: `git commit -m "feat: add board layout API"`

---

### Task 3: Frontend Board Configuration UI

**Files:**
- Create: `frontend/src/components/BoardSettingsPanel.tsx`
- Create: `frontend/src/components/ColumnReorderer.tsx`
- Create: `frontend/src/components/SwimlaneSelectorPanel.tsx`
- Create: `frontend/src/components/BoardPreview.tsx`
- Create: `frontend/src/components/LayoutSwitcher.tsx`

- [ ] **ColumnReorderer:** Drag-to-reorder columns, set WIP limits

```typescript
// Shows list of columns with drag handles
// Allow reorder, toggle visibility, set WIP limit
// At least 1 must be visible
```

- [ ] **SwimlaneSelectorPanel:** Dropdown to select grouping (None, Assignee, Priority, Epic, custom field)

```typescript
// Show swimlane selector
// Preview how many swimlanes will be created
// Optional: sort swimlanes (alphabetical, custom)
```

- [ ] **BoardPreview:** Live preview of board with current config

```typescript
// Use existing board rendering code
// Apply current board_config to preview
// Show swimlanes, columns, sample issues
```

- [ ] **LayoutSwitcher:** Dropdown in board header to switch saved layouts

```typescript
// List saved layouts
// Show default indicator
// Quick-apply button
```

- [ ] **BoardSettingsPanel:** Main settings UI in ProjectSettings

```typescript
// Integrate above components
// Save/Apply button
// Reset to default button
```

- [ ] Commit: `git commit -m "feat: add board customization UI components"`

---

### Task 4: Update Board Screen

**Files:**
- Modify: `frontend/src/screens/BoardScreen.tsx`

- [ ] Read `board_config` from project
- [ ] Render columns dynamically based on config
- [ ] Render swimlanes if configured
- [ ] Apply visibility filters
- [ ] Display layout switcher in header
- [ ] Show WIP limit badges

- [ ] Commit: `git commit -m "feat: update board screen to use config"`

---

### Task 5: E2E Tests

- [ ] Test: Open board settings → reorder columns → save → verify board order
- [ ] Test: Select swimlane grouping → save → verify swimlanes render
- [ ] Test: Save board layout with name → switch layouts → verify config applied
- [ ] Test: Hide column → verify hidden → try to hide last column → error
- [ ] Test: Reset to default → verify reset

- [ ] Commit: `git commit -m "test: add E2E tests for board customization"`

---

## Key Implementation Details

**Board Config JSON Structure:**
```json
{
  "columns": [
    { "id": "to-do", "visible": true, "order": 0, "wipLimit": 10 },
    { "id": "in-progress", "visible": true, "order": 1, "wipLimit": 5 }
  ],
  "swimlanes": { "enabled": true, "groupBy": "assignee", "order": "alphabetical" },
  "visibility": { "hideEmptyColumns": false, "hideEmptySwimlines": false, "showLabels": true }
}
```

**Swimlane Groups:**
- None (no swimlanes)
- Assignee (group by team member)
- Priority (High, Medium, Low)
- Epic (group by epic)
- Custom Field (any custom field)

**Rendering Logic:**
- If swimlanes enabled: render swimlanes as horizontal groups, columns vertical
- If swimlanes disabled: render columns only
- Empty swimlanes show "No issues in {{swimlane}}"
- Drag-drop within swimlane or across swimlanes

---

## Summary

✅ Non-technical users can customize without code  
✅ Multiple saved layouts per project  
✅ Board renders dynamically based on config  
✅ Swimlanes/grouping fully supported  
✅ Existing drag-drop functionality preserved  

Ready for execution.
