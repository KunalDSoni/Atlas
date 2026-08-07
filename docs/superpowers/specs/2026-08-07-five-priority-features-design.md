# Five High-Priority Features Implementation Design
**Date:** August 7, 2026  
**Status:** Design Approved  
**Implementation Order:** B (Business Value-First)

---

## Executive Summary

This document specifies the design for 5 high-priority features to be implemented sequentially and pushed to main individually:

1. **Feature Request Aggregation** — Combine duplicate feature requests, track total demand
2. **Feature Impact Measurement** — Measure post-launch impact (adoption, satisfaction, revenue)
3. **Advanced Audit Logging** — Export, filtering, retention policies, compliance dashboards
4. **No-code Automation Builder** — Visual drag-and-drop workflow rule creation
5. **Board Customization** — Swimlanes, grouping, column reordering, saved layouts

**Total Estimated Effort:** 6-8 weeks (1-2 weeks per feature)  
**Architecture:** All features follow existing patterns (modular routes, migrations, activity logging)

---

## Overall Implementation Strategy

### Git Workflow
- Each feature gets its own feature branch: `claude/feature-name-hash`
- Individual PR to main for each feature
- Merge to main immediately after approval (one feature at a time)
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

### Technology Stack (All Existing)
- **Backend:** Express.js, SQLite (dev) / MySQL (prod)
- **Frontend:** React, Tailwind CSS, existing component patterns
- **Database:** Schema migrations via `migrations.js`
- **Visualization:** Existing charting (Recharts), React Flow for automation builder
- **Testing:** Jest (backend), Playwright (E2E)

### Architecture Principles
1. **Modular Routes:** Each feature adds routes in `/backend/routes/`
2. **Database Migrations:** Schema changes via numbered migrations (never ALTER directly)
3. **Activity Logging:** All mutations logged via `auditlog.js`
4. **Permission Checks:** Middleware validates user role before operations
5. **Error Handling:** Consistent error responses, no data loss on failures

### Frontend Patterns
- Screens in `/frontend/src/screens/`
- Reusable components in `/frontend/src/components/`
- Context hooks for state management
- Tailwind utilities for styling
- E2E tests for user flows

---

## Feature 1: Feature Request Aggregation

### Purpose
Combine duplicate feature requests into one canonical feature, automatically track total customer demand count per feature, and maintain merge history for audit trail.

### Data Model

**Schema Changes:**
```
ALTER TABLE product_features ADD COLUMN merged_from_ids TEXT (JSON array)
ALTER TABLE product_features ADD COLUMN request_count INT DEFAULT 0
ALTER TABLE product_features ADD COLUMN merged_at DATETIME
ALTER TABLE product_features ADD COLUMN merged_by_id VARCHAR(36)

CREATE TABLE feature_merge_history (
  id VARCHAR(36) PRIMARY KEY,
  parent_feature_id VARCHAR(36),
  child_feature_id VARCHAR(36),
  merged_at DATETIME,
  merged_by_id VARCHAR(36),
  child_request_count INT,
  notes TEXT
)
```

**Field Semantics:**
- `merged_from_ids`: Array of feature IDs merged into this one (immutable, append-only)
- `request_count`: Total customer feedback count for this feature
- `merged_at`: Timestamp of most recent merge
- `merged_by_id`: User who performed the most recent merge

### Backend API

**Endpoints:**

1. `POST /api/product-features/:id/merge`
   - Body: `{ targetFeatureId: string, childFeatureIds: string[], reason?: string }`
   - Action: Merge multiple features into target
   - Returns: Updated target feature
   - Permissions: Product Manager or Admin

2. `GET /api/product-features/:id/merge-candidates`
   - Query: `{ limit: number }`
   - Action: Suggest similar features using text similarity (Levenshtein or embeddings)
   - Returns: Array of candidate features with similarity score
   - Permissions: Product Manager

3. `GET /api/product-features/:id/merge-history`
   - Returns: Timeline of all merges for this feature
   - Permissions: Any authenticated user

4. `POST /api/product-features/:id/unmerge`
   - Body: `{ childFeatureId: string }`
   - Action: Reverse a merge (only within 24h)
   - Returns: Unmerged feature with restored request_count
   - Permissions: Original merger or Admin

**Business Logic:**
- When merging:
  - Sum `request_count` from child → parent
  - Transfer all linked feedback records to parent feature
  - Set `merged_from_ids` array on parent
  - Create entry in `feature_merge_history`
  - Log activity: "User merged Feature X into Feature Y"
  
- Prevent cycles: if A merged into B, cannot merge B into A

- Unmerge (within 24h):
  - Restore child feature
  - Restore `request_count` to original value
  - Remove from `merged_from_ids`
  - Log activity

### Frontend Implementation

**Components:**
- `FeatureMergePanel` — Shows duplicate/merge candidates in feature detail
- `MergeSuggestions` — Table of similar features with "Merge" action
- `MergeConfirmDialog` — Confirmation with rollup preview
- `MergeHistoryTimeline` — Timeline of merges + undo button (24h window)
- `RequestCountBadge` — Display on feature cards

**Screens:**
- Enhance `ProductFeatureDetail` with merge candidates section
- New "Manage Duplicates" view in product features (bulk merge UI)

**UX Flow:**
1. User views feature detail → sees "Duplicates (3)" badge
2. Clicks "Show Duplicates" → sees merge candidates with similarity score
3. Selects duplicates to merge → confirmation dialog shows combined request count
4. Confirms → features merge, activity logged
5. Can undo within 24h via merge history timeline

### Error Handling

| Scenario | Response |
|----------|----------|
| Merging already-merged feature | 400: "Cannot merge already-merged feature X. Unmerge first." |
| Circular merge (A→B, then B→A) | 400: "Cannot merge: would create cycle" |
| User lacks permission | 403: Forbidden |
| Feature not found | 404: Not found |
| Undo after 24h | 400: "Merge too old to undo (>24h)" |

### Testing Strategy
- **Unit:** Merge logic (sum counts, prevent cycles, history creation)
- **E2E:** User merges features → sees combined count → undoes within 24h
- **Data:** Verify `merged_from_ids` array immutability

### Success Criteria
✓ Users can merge duplicate features in UI  
✓ Request counts roll up correctly  
✓ Merge history is immutable and auditable  
✓ Undo works within 24h window  
✓ No data loss on merge/unmerge

---

## Feature 2: Feature Impact Measurement

### Purpose
Measure and track post-launch impact of shipped features (adoption, satisfaction, revenue impact) and compare actual vs forecasted metrics.

### Data Model

**Schema Changes:**
```
ALTER TABLE product_features ADD COLUMN impact_status VARCHAR(50) 
  (not_launched | launched | measuring | analyzed)
ALTER TABLE product_features ADD COLUMN forecast_adoption FLOAT
ALTER TABLE product_features ADD COLUMN forecast_revenue FLOAT
ALTER TABLE product_features ADD COLUMN actual_adoption FLOAT
ALTER TABLE product_features ADD COLUMN actual_revenue FLOAT

CREATE TABLE feature_impact_metrics (
  id VARCHAR(36) PRIMARY KEY,
  feature_id VARCHAR(36) NOT NULL,
  metric_type VARCHAR(50) (adoption | satisfaction | revenue | bug_rate | engagement),
  forecast_value FLOAT,
  actual_value FLOAT,
  unit VARCHAR(50) (percentage | count | dollars | score),
  measurement_date DATE,
  data_source VARCHAR(50) (manual | api | survey),
  notes TEXT,
  created_at DATETIME,
  created_by_id VARCHAR(36)
)
```

**Field Semantics:**
- `impact_status`: Lifecycle state (not_launched → measuring → analyzed)
- `forecast_*`: Pre-launch predictions (user input)
- `actual_*`: Post-launch measurements
- `metric_type`: Category of measurement
- `data_source`: How the metric was obtained

### Backend API

**Endpoints:**

1. `POST /api/product-features/:id/impact-metrics`
   - Body: `{ metricType, actualValue, unit, dataSource, notes? }`
   - Action: Record impact measurement for feature
   - Returns: Created metric object
   - Permissions: Product Manager

2. `GET /api/product-features/:id/impact-metrics`
   - Returns: All metrics for feature (grouped by type)
   - Includes: forecast vs actual comparison, variance %
   - Permissions: Any authenticated user

3. `GET /api/product-features/impact-dashboard`
   - Query: `{ status?: string, dateRange?: [start, end] }`
   - Returns: Aggregated impact data (forecast vs actual across features)
   - Used for dashboard charts
   - Permissions: Product Manager

4. `PUT /api/product-features/:id/forecast-metrics`
   - Body: `{ forecastAdoption, forecastRevenue, forecastNotes? }`
   - Action: Set pre-launch forecast
   - Permissions: Product Manager

5. `PUT /api/product-features/:id/impact-status`
   - Body: `{ status: string }`
   - Action: Transition feature between impact states
   - Permissions: Product Manager

**Business Logic:**
- Auto-populate `actual_adoption` from linked releases/usage data (if available)
- Calculate variance: `(actual - forecast) / forecast * 100`
- Prevent editing measurements older than 30 days (read-only in audit)
- Transition rules:
  - not_launched → launched (when feature shipped)
  - launched → measuring (manual or time-based)
  - measuring → analyzed (when all metrics collected)

### Frontend Implementation

**Components:**
- `ImpactMetricsPanel` — Shows forecast vs actual in feature detail
- `ImpactDashboard` — Charts comparing predicted vs measured impact
- `MetricsInput` — Form for recording post-launch metrics
- `ForecastCard` — Shows pre-launch predictions with edit capability
- `ImpactChart` — Recharts visualization of actual vs forecast

**Screens:**
- Enhance `ProductFeatureDetail` with "Impact" tab
- New `ImpactAnalysisDashboard` screen (reports view)

**UX Flow:**
1. Feature shipped → status auto-changes to "launched"
2. PM enters forecast (adoption %, revenue $) → stored
3. After launch window (e.g., 30 days), PM enters actual metrics
4. Dashboard shows actual vs forecast with variance %
5. Can drill into impact detail per feature

### Error Handling

| Scenario | Response |
|----------|----------|
| Invalid metric type | 400: "Invalid metric type. Allowed: adoption, satisfaction, revenue, bug_rate" |
| Actual value < 0 | 400: "Actual value must be ≥ 0" |
| Measurement date > today | 400: "Measurement date cannot be in future" |
| Edit after 30 days | 403: "Cannot edit metrics >30d old. View audit trail instead." |
| Missing forecast | 200: Allow actual-only measurement |

### Testing Strategy
- **Unit:** Variance calculation, status transitions, field validation
- **E2E:** PM sets forecast → records actual → sees dashboard chart
- **Data:** Verify immutability of old measurements

### Success Criteria
✓ PMs can set forecast and actual metrics  
✓ Dashboard shows forecast vs actual comparison  
✓ Variance calculations are accurate  
✓ Measurements >30d are read-only (audit only)  
✓ Auto-transitions work (not_launched → launched on release)

---

## Feature 3: Advanced Audit Logging

### Purpose
Enhance existing audit log system with export (CSV/JSON), advanced filtering, retention policies, and compliance report builders.

### Data Model

**Schema Changes:**
```
-- Existing auditlog table stays unchanged (immutable)

CREATE TABLE audit_log_exports (
  id VARCHAR(36) PRIMARY KEY,
  created_by_id VARCHAR(36) NOT NULL,
  created_at DATETIME,
  export_format VARCHAR(20) (csv | json),
  filter_criteria TEXT (JSON: date_range, user_ids, action_types, resource_types),
  row_count INT,
  file_path TEXT,
  file_size INT,
  expiration_date DATETIME,
  downloaded_at DATETIME
)

CREATE TABLE audit_retention_policies (
  id VARCHAR(36) PRIMARY KEY,
  retention_days INT DEFAULT 365,
  auto_archive_enabled BOOLEAN DEFAULT false,
  archive_storage_type VARCHAR(50) (s3 | local),
  created_at DATETIME,
  updated_by_id VARCHAR(36)
)
```

**Field Semantics:**
- `audit_log_exports`: Track generated exports (for cleanup, usage tracking)
- `audit_retention_policies`: Global retention rules (admins set once)

### Backend API

**Endpoints:**

1. `POST /api/admin/audit-log/export`
   - Body: `{ format: string, filters: { dateRange?, userIds?, actionTypes?, resourceTypes? } }`
   - Action: Generate export file (async job)
   - Returns: `{ exportId, status: 'processing', estimatedRows }`
   - Permissions: Admin
   - Async: Job enqueued, file generated in background, notification sent when ready

2. `GET /api/admin/audit-log/exports`
   - Returns: List of generated exports (with download links)
   - Permissions: Admin
   - Link expires after retention period

3. `DELETE /api/admin/audit-log/exports/:id`
   - Action: Delete export file
   - Permissions: Admin

4. `PUT /api/admin/audit-log/retention-policy`
   - Body: `{ retentionDays, autoArchiveEnabled }`
   - Action: Set global retention policy
   - Permissions: Admin

5. `GET /api/admin/audit-log/compliance-report`
   - Query: `{ template: string (soc2 | gdpr | hipaa), dateRange? }`
   - Returns: Pre-built compliance report (HTML or PDF)
   - Permissions: Admin

**Business Logic:**
- Export filters:
  - Date range: default last 30 days
  - User IDs: specific users only (comma-separated)
  - Action types: CREATE, UPDATE, DELETE, etc.
  - Resource types: issue, project, user, etc.
- Redact sensitive fields from export (passwords, tokens, API keys)
- Async export (background job): 
  - Query audit log with filters
  - Stream to CSV/JSON file
  - Store file path
  - Send notification to admin when complete
- Retention: auto-archive logs older than `retentionDays` to cold storage

### Frontend Implementation

**Components:**
- `AuditLogExportPanel` — UI for building export with filters
- `ExportHistory` — Table of past exports (download links, expiration)
- `RetentionPolicyEditor` — Admin settings for retention
- `ComplianceReportBuilder` — Template selector + date range

**Screens:**
- New `AdminAuditLog` screen (admin panel)
- Advanced filter UI (date picker, multi-select users, action types)

**UX Flow:**
1. Admin → Audit Log screen
2. Clicks "Export" → filter panel appears
3. Selects date range, users, action types
4. Clicks "Generate Export" → processing state
5. Notification when ready → download CSV/JSON
6. File expires after retention period (default 30 days)

### Error Handling

| Scenario | Response |
|----------|----------|
| Non-admin attempts export | 403: Forbidden |
| Invalid filter format | 400: "Invalid filter criteria" |
| Export >1M rows | 202: "Export too large. Running async. Check notifications." |
| File expired | 410: "Export expired. Generate new one." |
| Archive failed | 500: Alert admin, retry async |

### Testing Strategy
- **Unit:** Filter logic, redaction of sensitive fields, retention calculation
- **E2E:** Admin exports audit log → receives file → verifies content
- **Integration:** Async job (mock job queue)

### Success Criteria
✓ Admins can export audit log with filters  
✓ Export supports CSV and JSON formats  
✓ Sensitive data is redacted  
✓ Async exports don't block UI  
✓ Retention policies work (archive/delete old logs)  
✓ Compliance reports are pre-built

---

## Feature 4: No-code Automation Builder

### Purpose
Visual drag-and-drop workflow builder for creating if-then automation rules without code. Supports triggers (event), conditions (if X), and actions (then Y).

### Data Model

**Schema Changes:**
```
ALTER TABLE automations ADD COLUMN rule_config TEXT (JSON DAG)
ALTER TABLE automations ADD COLUMN visual_layout TEXT (JSON node positions)
ALTER TABLE automations ADD COLUMN enabled BOOLEAN DEFAULT true
ALTER TABLE automations ADD COLUMN last_executed_at DATETIME
ALTER TABLE automations ADD COLUMN execution_count INT DEFAULT 0
ALTER TABLE automations ADD COLUMN error_count INT DEFAULT 0

CREATE TABLE automation_executions (
  id VARCHAR(36) PRIMARY KEY,
  automation_id VARCHAR(36) NOT NULL,
  triggered_at DATETIME,
  triggered_by VARCHAR(50) (manual | event | schedule),
  success BOOLEAN,
  error_message TEXT,
  changes_made TEXT (JSON array of changes),
  execution_time_ms INT,
  created_at DATETIME
)

CREATE TABLE automation_templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255),
  description TEXT,
  rule_config TEXT (JSON),
  category VARCHAR(50) (feature_management | issue_tracking | notifications),
  usage_count INT DEFAULT 0
)
```

**Field Semantics:**
- `rule_config`: DAG (directed acyclic graph) of trigger → conditions → actions
- `visual_layout`: X/Y positions for React Flow canvas
- `automation_executions`: Audit trail of each rule execution
- `automation_templates`: Pre-built rule templates

### Rule Engine Design

**Rule Config Structure (JSON):**
```json
{
  "id": "auto-1",
  "name": "Notify on Feature Ship",
  "trigger": {
    "type": "feature_status_changed",
    "from_status": "in_progress",
    "to_status": "shipped"
  },
  "conditions": [
    {
      "type": "AND",
      "clauses": [
        { "field": "feature.request_count", "operator": ">", "value": 10 },
        { "field": "feature.impact_status", "operator": "!=", "value": "measured" }
      ]
    }
  ],
  "actions": [
    {
      "type": "send_message",
      "target": "slack",
      "template": "Feature shipped: {{feature.name}}, {{feature.request_count}} requests"
    },
    {
      "type": "update_feature",
      "field": "impact_status",
      "value": "launched"
    }
  ]
}
```

**Supported Nodes:**
- **Triggers:** Feature created, Feature status changed, Feature merged, Issue created, Release published
- **Conditions:** Field comparison (=, !=, >, <, contains), AND/OR logic
- **Actions:** Send message (Slack, email), Update feature/issue field, Create issue, Send webhook, Update custom field

### Backend API

**Endpoints:**

1. `POST /api/automations` (enhanced)
   - Body: `{ name, description, rule_config, enabled? }`
   - Validates: No cycles in DAG, all fields exist, valid operators
   - Returns: Created automation with ID
   - Permissions: Automation Admin

2. `PUT /api/automations/:id` (enhanced)
   - Body: `{ name?, description?, rule_config?, enabled? }`
   - Validates: DAG is valid (no cycles)
   - Permissions: Automation Admin

3. `POST /api/automations/:id/test`
   - Body: `{ sampleData: object }`
   - Action: Evaluate rule against sample (dry-run, no side effects)
   - Returns: `{ wouldExecute: bool, actionsPreview: [...], errors?: [...] }`
   - Permissions: Automation Admin

4. `POST /api/automations/:id/execute`
   - Action: Manually trigger automation
   - Returns: Execution result
   - Permissions: Automation Admin

5. `GET /api/automations/:id/executions`
   - Query: `{ limit: 50, offset: 0 }`
   - Returns: History of executions (success/failure)
   - Permissions: Automation Admin

6. `GET /api/automations/templates`
   - Returns: List of pre-built templates
   - Permissions: Automation Admin

**Rule Engine (Backend):**
- Evaluate trigger: Check if event matches trigger condition
- Evaluate conditions: Apply AND/OR logic to field comparisons
- Execute actions: Apply mutations atomically (all-or-nothing)
- Log execution: Record in `automation_executions`
- Error handling: If any action fails, mark execution as failed, don't rollback (for visibility)
- Timeout: Max 30s per execution
- Retry: Failed rules retry up to 3 times over 1h, then disable with alert

### Frontend Implementation

**Components:**
- `AutomationBuilder` — React Flow canvas (main editor)
- `TriggerNode` — Selectable trigger types
- `ConditionNode` — AND/OR conditions with field comparisons
- `ActionNode` — Selectable actions with templates
- `TemplateLibrary` — Browse pre-built rule templates
- `ExecutionHistory` — Table of rule executions (logs)
- `TestPanel` — Dry-run rule with sample data

**Screens:**
- New `AutomationBuilderScreen` (full-page editor)
- New `AutomationListScreen` (list with enable/disable toggles)

**UX Flow:**
1. Admin → Automation Builder
2. Choose template or start blank
3. Drag nodes onto canvas: Trigger → Condition → Action
4. Configure each node (dropdowns, field selectors)
5. Click "Test" → preview what rule would do
6. Click "Save" → rule active
7. View execution history in sidebar

### Error Handling

| Scenario | Response |
|----------|----------|
| Invalid DAG (cycle) | 400: "Cannot save: rule has circular dependency" |
| Unknown field in condition | 400: "Field 'issue.invalid_field' not found" |
| Unsupported operator | 400: "Operator 'contains' not supported for numeric field" |
| Execution timeout (>30s) | 504: "Rule execution timed out. Check conditions." |
| Disable after 3 failures | 200: Rule auto-disabled, admin notified |
| Non-admin access | 403: Forbidden |

### Testing Strategy
- **Unit:** DAG validation, condition evaluation, action execution
- **E2E:** Admin builds rule → tests → enables → trigger fires → action executes
- **Integration:** Mock Slack API for action testing

### Success Criteria
✓ Non-technical admins can build automation via UI  
✓ Test feature shows dry-run results  
✓ Rules execute reliably (99%+ success rate)  
✓ Execution history is queryable  
✓ Pre-built templates speed up common tasks  
✓ Failed rules auto-disable with alerting

---

## Feature 5: Board Customization

### Purpose
Allow teams to customize kanban board layout: reorder columns, add swimlanes (group by assignee, priority, epic, etc.), save multiple board views, and toggle column visibility.

### Data Model

**Schema Changes:**
```
ALTER TABLE projects ADD COLUMN board_config TEXT (JSON configuration)

CREATE TABLE board_layouts (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  layout_name VARCHAR(255),
  description TEXT,
  board_config TEXT (JSON),
  is_default BOOLEAN DEFAULT false,
  created_by_id VARCHAR(36),
  created_at DATETIME,
  updated_at DATETIME
)
```

**Field Semantics:**
- `board_config`: JSON with columns, swimlanes, visibility rules, grouping
- `board_layouts`: Saved board views (users can switch between them)

**Board Config Schema:**
```json
{
  "columns": [
    { "id": "to-do", "name": "To Do", "visible": true, "order": 0, "wipLimit": 10 },
    { "id": "in-progress", "name": "In Progress", "visible": true, "order": 1, "wipLimit": 5 },
    { "id": "done", "name": "Done", "visible": true, "order": 2, "wipLimit": null }
  ],
  "swimlanes": {
    "enabled": true,
    "groupBy": "assignee",
    "order": "alphabetical"
  },
  "visibility": {
    "hideEmptyColumns": false,
    "hideEmptySwimlines": false,
    "showLabels": true,
    "showEstimates": true
  }
}
```

### Backend API

**Endpoints:**

1. `PUT /api/projects/:id/board-config`
   - Body: `{ columns, swimlanes, visibility }`
   - Validates: Column IDs match workflow states, groupBy field exists
   - Returns: Updated project with board config
   - Permissions: Project Admin

2. `GET /api/projects/:id/board-config`
   - Returns: Current board configuration
   - Permissions: Any project member

3. `POST /api/projects/:id/board-layouts`
   - Body: `{ layoutName, boardConfig, isDefault? }`
   - Action: Save board layout as named view
   - Returns: Created layout
   - Permissions: Project Admin

4. `GET /api/projects/:id/board-layouts`
   - Returns: List of saved layouts for project
   - Permissions: Any project member

5. `PUT /api/projects/:id/board-layouts/:layoutId`
   - Body: `{ layoutName, isDefault? }`
   - Action: Update layout metadata or set as default
   - Permissions: Project Admin

6. `DELETE /api/projects/:id/board-layouts/:layoutId`
   - Action: Delete saved layout
   - Returns: 204 No Content
   - Permissions: Project Admin

7. `POST /api/projects/:id/board-layouts/:layoutId/apply`
   - Action: Apply layout to project board
   - Returns: Updated board config
   - Permissions: Project Admin

**Business Logic:**
- Validate swimlane field exists (assignee, priority, epic, custom_field, etc.)
- Prevent hiding all columns (keep at least 1 visible)
- If swimlane field references deleted field, reset to "none"
- Allow only 1 layout as default per project
- WIP limits are per-column, enforced when moving issues

### Frontend Implementation

**Components:**
- `BoardSettingsPanel` — UI for customizing board (in project settings)
- `ColumnReorderer` — Drag-to-reorder columns
- `SwimLaneSelector` — Dropdown to select grouping (None, Assignee, Priority, Epic, etc.)
- `VisibilityTogglePanel` — Show/hide labels, estimates, etc.
- `LayoutSaver` — Save current config as named view
- `LayoutSwitcher` — Dropdown to switch between saved layouts
- `PreviewBoard` — Live preview of board with current config
- `BoardResetButton` — Reset to default 1-click

**Screens:**
- Enhance `ProjectSettings` with "Board Layout" tab
- Enhance `BoardScreen` with layout switcher in header

**UX Flow:**
1. PM opens Project Settings → Board Layout tab
2. Sees current columns, swimlane config
3. Drags to reorder columns
4. Clicks "Add Swimlanes" → selects "Assignee"
5. Clicks "Preview" → sees swimlanes render live
6. Clicks "Save as Layout" → names it "By Team Member"
7. Goes to Board → sees swimlanes rendered
8. Can switch to other saved layouts via dropdown

### Error Handling

| Scenario | Response |
|----------|----------|
| Hiding all columns | 400: "At least 1 column must be visible" |
| Swimlane field not found | 400: "Field 'custom_field_123' not found. Reset swimlanes." |
| Invalid column ID | 400: "Column 'invalid' does not exist in workflow" |
| Non-admin customizing | 403: "Only project admins can customize board" |
| Swimlane with no issues | 200: Show empty state "No issues in this {{groupBy}}" |
| Layout name too long | 400: "Layout name must be <255 characters" |

### Testing Strategy
- **Unit:** Board config validation, column/swimlane logic
- **E2E:** PM customizes board → saves layout → switches layouts → board renders correctly
- **Performance:** Large swimlanes (100+ assignees) render in <500ms

### Success Criteria
✓ Users can reorder columns without code  
✓ Swimlanes render dynamically (grouping, sorting)  
✓ Multiple saved layouts per project  
✓ Board renders correctly with custom config  
✓ Layout switching is instant  
✓ Empty swimlanes/columns handled gracefully

---

## Implementation Timeline

| Phase | Features | Duration | Dependencies |
|-------|----------|----------|--------------|
| Phase 1 | Feature Request Aggregation | 1-2 weeks | None (product-features exists) |
| Phase 2 | Feature Impact Measurement | 1-2 weeks | Phase 1 (builds on features) |
| Phase 3 | Advanced Audit Logging | 1 week | None (audit log exists) |
| Phase 4 | No-code Automation Builder | 2-3 weeks | None (automations exist) |
| Phase 5 | Board Customization | 1-2 weeks | None (board exists) |
| **Total** | **5 Features** | **6-8 weeks** | Sequential delivery to main |

---

## Git & Deployment Strategy

### Per-Feature Release
1. Create feature branch: `claude/feature-name-<hash>`
2. Implement feature (backend API + frontend)
3. Write tests (unit + E2E)
4. Create PR to main
5. Get approval (code review)
6. Merge to main
7. Deploy to production
8. Delete feature branch

### No Blocking
- Each feature is independent (can be released in any order)
- Database migrations are backward-compatible
- API routes are additive (no breaking changes)
- Frontend gracefully handles missing features

### Rollback Plan
- If issue detected post-merge: revert commit, deploy previous version
- Database: migrations are append-only, data persists

---

## Success Metrics

| Feature | Key Metrics |
|---------|------------|
| Aggregation | Duplicate requests merged, request count accuracy |
| Impact Measurement | Forecast vs actual variance tracked, PM adoption |
| Audit Logging | Export success rate, compliance report generation |
| Automation Builder | Rule execution success rate (99%+), template usage |
| Board Customization | Custom layouts created, user engagement |

---

## Appendix: API Response Formats

### Standard Error Response
```json
{
  "error": true,
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "status": 400
}
```

### Standard Success Response
```json
{
  "data": { /* resource data */ },
  "message": "Optional success message",
  "status": 200
}
```

### Paginated Response
```json
{
  "data": [ /* array of resources */ ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1234,
    "hasMore": true
  }
}
```

---

## Next Steps

1. ✅ Design approved
2. ⬜ Implementation plan (writing-plans skill)
3. ⬜ Feature 1 implementation + PR
4. ⬜ Feature 2 implementation + PR
5. ⬜ Feature 3 implementation + PR
6. ⬜ Feature 4 implementation + PR
7. ⬜ Feature 5 implementation + PR
8. ⬜ Deploy all to production

---

**Design Document Written:** August 7, 2026  
**Version:** 1.0 (Initial design approval)
