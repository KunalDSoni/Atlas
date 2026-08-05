# Reports Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new reports to Atlas (Created vs Resolved, Epic Burndown, Version Report, Control Chart, Average Age) following existing report architecture patterns.

**Architecture:** All backend endpoints go in `backend/routes/reports.js` following existing query/aggregate/respond patterns. Frontend uses existing ChartCard wrapper and chart primitives (LineChart, HBarChart, StackedBar, DataTable) with one new ScatterChart primitive added to `frontend/src/components/app/charts.tsx`. All reports render in `frontend/src/screens/reports.tsx`.

**Tech Stack:** Backend (Express/SQLite, percentile/flow utilities), Frontend (React, SVG charts using existing design tokens).

## Global Constraints

- All reports remain single-project scoped (no cross-project portfolio reporting)
- No custom date-range filtering; all reports use fixed windows ("since tracking began" / epoch to now)
- No CSV export for new reports; only the existing `export/csv` and `time-tracking/export/csv` endpoints remain
- Backend tests follow existing `backend/tests/backend/*.test.js` patterns, verifying response shape and math against seed data
- Frontend manual verification only (chart renders with real data, dropdowns populate/switch, themes render correctly)

---

## Task 1: Add ScatterChart Primitive

**Files:**
- Modify: `frontend/src/components/app/charts.tsx` (export new ScatterChart component)

**Interfaces:**
- Consumes: Existing `seriesColor()`, `Legend`, `DataTable`, chart sizing/axis patterns
- Produces: `ScatterChart` component exported from charts.tsx. Props: `{ data: Array<{x: string, y: number, label: string}>, p50?: number, p85?: number, xLabel?: string, yLabel?: string }`

- [ ] **Step 1: Understand existing chart scale/axis patterns**

Read the LineChart and HBarChart implementations in charts.tsx to understand SVG scale helpers, axis rendering, and legend generation. Note: scatterplots need both x and y axis labels, reference lines for p50/p85.

- [ ] **Step 2: Write the ScatterChart component**

Add `export function ScatterChart()` after the existing chart exports. Takes `{data, p50, p85, xLabel, yLabel}` props. Render as SVG scatter plot with:
  - X-axis: date labels from `data[].x` strings (e.g., "2026-08-05"), evenly spaced
  - Y-axis: numeric values from `data[].y` (cycle time in days)
  - Each point: small circle (3px radius) colored by `seriesColor(0)`, hover shows label
  - Reference lines: horizontal dashed lines at p50 and p85 with labels on right edge
  - Responsive: viewBox auto-scales to data bounds with padding

Use the existing SVG pattern: `<svg viewBox="0 0 800 400">` with `<g transform>` for axes and points. Follow the text-label-not-color rule: label each reference line with its value.

- [ ] **Step 3: Export ScatterChart from charts.tsx**

Add `ScatterChart` to the component exports at the top of reports.tsx import statement.

- [ ] **Step 4: Verify ScatterChart renders in both themes**

Open `frontend/src/components/app/charts.tsx` and visually confirm the component type-checks (no TypeScript errors). This task is complete once the primitive compiles and exports without errors.

---

## Task 2: Epic Report Backend

**Files:**
- Modify: `backend/routes/reports.js` (add endpoint)
- Create: `backend/tests/backend/reports-epics.test.js`

**Interfaces:**
- Consumes: `queryAll`, `queryOne`, `requireAuth`, `serverError`, `projectStatuses`, `hoursBetween`, `statusTimeline`, `byIssue` flow data loader
- Produces: `GET /api/projects/:projectId/reports/epics/:epicId` endpoint returning `{ epic: {id, name, created_at}, children: [{id, issue_key, title, status, points}], done_count, total_count, done_points, total_points, burndown: [{date, remaining_points}] }`

- [ ] **Step 1: Write failing test for epic children + rollup**

Create `backend/tests/backend/reports-epics.test.js` with a seed epic (type='epic') and 4 child issues (parent_id=epic.id, with mixed statuses: 2 done, 2 todo, points 3,5,2,8). Test `GET /api/projects/:projectId/reports/epics/:epicId` returns:
```javascript
{
  epic: { id, name, created_at },
  children: [ {id, issue_key, title, status, points} ],
  done_count: 2,
  total_count: 4,
  done_points: 8,
  total_points: 18
}
```

- [ ] **Step 2: Implement epic endpoint (children + rollup)**

In `backend/routes/reports.js`, add:
```javascript
router.get('/projects/:projectId/reports/epics/:epicId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const epic = await queryOne(db, 'SELECT * FROM issues WHERE id = ? AND type = ?', [req.params.epicId, 'epic']);
    if (!epic) return res.status(404).json({error: 'Epic not found'});
    
    const children = await queryAll(db, 'SELECT id, issue_key, title, status, story_points FROM issues WHERE parent_id = ?', [epic.id]);
    const done = children.filter(i => i.status === 'done');
    const totalPoints = children.reduce((s, i) => s + (i.story_points || 0), 0);
    const donePoints = done.reduce((s, i) => s + (i.story_points || 0), 0);
    
    res.json({
      epic: {id: epic.id, name: epic.name, created_at: epic.created_at},
      children: children.map(c => ({id: c.id, issue_key: c.issue_key, title: c.title, status: c.status, points: c.story_points || 0})),
      done_count: done.length,
      total_count: children.length,
      done_points: donePoints,
      total_points: totalPoints
    });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 3: Run test to verify it passes**

Run `npm test -- backend/tests/backend/reports-epics.test.js` and confirm the rollup values match expected totals.

- [ ] **Step 4: Add burndown series to epic endpoint**

Extend the test to verify a `burndown` array in the response with daily remaining points. Extend the endpoint to compute daily series: load status-change history for all children, compute remaining points per day from epic's `created_at` to today using the same technique as the sprint burndown endpoint.

Add to the endpoint:
```javascript
const { issues, byIssue } = await loadFlowData(db, req.params.projectId);
const statuses = await projectStatuses(db, req.params.projectId);
const start = new Date(epic.created_at);
const today = new Date();
const burndown = [];
for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
  const dateStr = d.toISOString().split('T')[0];
  const doneByDate = children.filter(c => c.status === 'done' && c.updated_at && c.updated_at.split('T')[0] <= dateStr);
  const donePts = doneByDate.reduce((s, c) => s + (c.story_points || 0), 0);
  burndown.push({date: dateStr, remaining_points: totalPoints - donePts});
}
// add burndown to response
```

- [ ] **Step 5: Commit backend**

```bash
git add backend/routes/reports.js backend/tests/backend/reports-epics.test.js
git commit -m "feat: add Epic Report endpoint with burndown series"
```

---

## Task 3: Epic Report Frontend

**Files:**
- Modify: `frontend/src/screens/reports.tsx`

**Interfaces:**
- Consumes: `ChartCard`, `LineChart`, `DataTable`, `api.reports.epics(projectId)`, `api.reports.epicBurndown(projectId, epicId)`, `STATUSES`, `STATUS_LABEL`
- Produces: No new exports. Renders `<ChartCard>` with epic-picker dropdown, burndown LineChart, and children DataTable in the reports screen.

- [ ] **Step 1: Add epic-picker state and data fetching**

In `ReportsScreen`, add state:
```javascript
const [epics, setEpics] = useState<Array<{id, name}> | null>(null);
const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
const [epicReport, setEpicReport] = useState<EpicReportResponse | null>(null);
```

Add to the `load()` effect after existing reports: fetch epics list and the first epic's burndown if any exist:
```javascript
const epicsList = await api.get(`/projects/${currentProjectId}/epics`);
setEpics(epicsList);
if (epicsList.length > 0) {
  const firstBurndown = await api.get(`/projects/${currentProjectId}/reports/epics/${epicsList[0].id}`);
  setEpicReport(firstBurndown);
  setSelectedEpicId(epicsList[0].id);
}
```

- [ ] **Step 2: Add epic picker UI and reload handler**

Create an epic dropdown selector (using HTML select or existing UI component pattern) that sets `selectedEpicId` on change. When the selection changes, refetch the burndown:
```javascript
const handleEpicChange = async (newEpicId: string) => {
  setSelectedEpicId(newEpicId);
  const burndown = await api.get(`/projects/${currentProjectId}/reports/epics/${newEpicId}`);
  setEpicReport(burndown);
};
```

- [ ] **Step 3: Render Epic Report ChartCard**

In the reports grid, add:
```jsx
{epicReport && (
  <ChartCard
    title="Epic Burndown"
    description={selectedEpicId ? `${epicReport.epic.name}` : 'Select an epic'}
    children={
      <div className="space-y-4">
        <select value={selectedEpicId || ''} onChange={(e) => handleEpicChange(e.target.value)}>
          <option value="">Select epic...</option>
          {epics?.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <LineChart
          data={epicReport.burndown.map(d => ({label: d.date, value: d.remaining_points}))}
          series={[{label: 'Remaining', color: seriesColor(0)}]}
        />
      </div>
    }
    table={
      epicReport.children?.length ? (
        <DataTable
          caption="Epic children"
          columns={['Key', 'Title', 'Status', 'Points']}
          rows={epicReport.children.map(c => [c.issue_key, c.title, STATUS_LABEL[c.status], c.points])}
        />
      ) : undefined
    }
  />
)}
```

- [ ] **Step 4: Commit frontend**

```bash
git add frontend/src/screens/reports.tsx
git commit -m "feat: add Epic Report UI with burndown chart and children table"
```

---

## Task 4: Version Report Backend

**Files:**
- Modify: `backend/routes/reports.js` (add endpoint)
- Create: `backend/tests/backend/reports-versions.test.js`

**Interfaces:**
- Consumes: `queryAll`, `queryOne`, `requireAuth`, `serverError`
- Produces: `GET /api/projects/:projectId/reports/versions/:versionId` endpoint returning `{ version: {id, name}, issues: [{id, issue_key, title, status, points}], done_count, total_count, done_points, total_points }`

- [ ] **Step 1: Write failing test for version issues + rollup**

Create `backend/tests/backend/reports-versions.test.js` with a seed version and 4 linked issues (fix_version_id=version.id, mixed statuses: 2 done, 2 in progress, points 3,5,2,8). Test `GET /api/projects/:projectId/reports/versions/:versionId` returns version, issues list, and rollup (done_count: 2, total_count: 4, done_points, total_points).

- [ ] **Step 2: Implement version endpoint**

In `backend/routes/reports.js`, add:
```javascript
router.get('/projects/:projectId/reports/versions/:versionId', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const version = await queryOne(db, 'SELECT * FROM versions WHERE id = ?', [req.params.versionId]);
    if (!version) return res.status(404).json({error: 'Version not found'});
    
    const issues = await queryAll(db, 'SELECT id, issue_key, title, status, story_points FROM issues WHERE fix_version_id = ?', [version.id]);
    const done = issues.filter(i => i.status === 'done');
    const totalPoints = issues.reduce((s, i) => s + (i.story_points || 0), 0);
    const donePoints = done.reduce((s, i) => s + (i.story_points || 0), 0);
    
    res.json({
      version: {id: version.id, name: version.name},
      issues: issues.map(i => ({id: i.id, issue_key: i.issue_key, title: i.title, status: i.status, points: i.story_points || 0})),
      done_count: done.length,
      total_count: issues.length,
      done_points: donePoints,
      total_points: totalPoints
    });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 3: Run test to verify it passes**

Run `npm test -- backend/tests/backend/reports-versions.test.js` and confirm rollup values.

- [ ] **Step 4: Commit backend**

```bash
git add backend/routes/reports.js backend/tests/backend/reports-versions.test.js
git commit -m "feat: add Version Report endpoint"
```

---

## Task 5: Version Report Frontend

**Files:**
- Modify: `frontend/src/screens/reports.tsx`

**Interfaces:**
- Consumes: `ChartCard`, `StackedBar`, `DataTable`, `api.reports.versions(projectId)`, `api.reports.versionReport(projectId, versionId)`, `STATUS_LABEL`
- Produces: No new exports. Renders `<ChartCard>` with version-picker dropdown, StackedBar (done vs remaining), and issues DataTable.

- [ ] **Step 1: Add version state and data fetching**

In `ReportsScreen`, add state:
```javascript
const [versions, setVersions] = useState<Array<{id, name}> | null>(null);
const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
const [versionReport, setVersionReport] = useState<VersionReportResponse | null>(null);
```

In `load()`, after epics, fetch versions and first version's report:
```javascript
const versionsList = await api.get(`/projects/${currentProjectId}/versions`);
setVersions(versionsList);
if (versionsList.length > 0) {
  const firstReport = await api.get(`/projects/${currentProjectId}/reports/versions/${versionsList[0].id}`);
  setVersionReport(firstReport);
  setSelectedVersionId(versionsList[0].id);
}
```

- [ ] **Step 2: Add version picker and reload handler**

Similar to epic picker, create dropdown and `handleVersionChange` function that refetches on selection change.

- [ ] **Step 3: Render Version Report ChartCard**

In the reports grid, add:
```jsx
{versionReport && (
  <ChartCard
    title="Version Report"
    description={selectedVersionId ? `${versionReport.version.name}` : 'Select a version'}
    children={
      <div className="space-y-4">
        <select value={selectedVersionId || ''} onChange={(e) => handleVersionChange(e.target.value)}>
          <option value="">Select version...</option>
          {versions?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <StackedBar
          data={[
            {label: 'Done', value: versionReport.done_points},
            {label: 'Remaining', value: versionReport.total_points - versionReport.done_points}
          ]}
        />
        <div className="text-sm text-muted-foreground">
          {versionReport.done_count} of {versionReport.total_count} issues • {versionReport.done_points} of {versionReport.total_points} points
        </div>
      </div>
    }
    table={
      versionReport.issues?.length ? (
        <DataTable
          caption="Version issues"
          columns={['Key', 'Title', 'Status', 'Points']}
          rows={versionReport.issues.map(i => [i.issue_key, i.title, STATUS_LABEL[i.status], i.points])}
        />
      ) : undefined
    }
  />
)}
```

- [ ] **Step 4: Commit frontend**

```bash
git add frontend/src/screens/reports.tsx
git commit -m "feat: add Version Report UI with StackedBar chart"
```

---

## Task 6: Control Chart Backend

**Files:**
- Modify: `backend/routes/reports.js` (add endpoint)
- Create: `backend/tests/backend/reports-control-chart.test.js`

**Interfaces:**
- Consumes: `queryAll`, `queryOne`, `requireAuth`, `serverError`, `projectStatuses`, `hoursBetween`, `percentile`
- Produces: `GET /api/projects/:projectId/reports/control-chart` endpoint returning `{ issues: [{resolved_date, cycle_time_days, issue_key, title}], p50_cycle_days, p85_cycle_days }`

- [ ] **Step 1: Write failing test for control chart data**

Create `backend/tests/backend/reports-control-chart.test.js` with seed data: 10 done issues with resolved_date spread over a month and varying cycle times (5, 7, 10, 12, 15, 18, 20, 22, 25, 30 days). Test `GET /api/projects/:projectId/reports/control-chart` returns issues sorted by resolved_date descending with cycle times in days, p50 and p85 percentiles.

- [ ] **Step 2: Implement control chart endpoint**

In `backend/routes/reports.js`, reuse the cycle-time endpoint's logic to load done issues. Adapt it to return only resolved_date and cycle_time_days (converted from hours to days), and compute p50/p85 percentiles:
```javascript
router.get('/projects/:projectId/reports/control-chart', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const { issues, byIssue } = await loadFlowData(db, req.params.projectId);
    
    const rows = [];
    for (const issue of issues) {
      if (categoryOf(issue.status, statuses) !== 'done') continue;
      const trans = byIssue.get(issue.id) || [];
      const doneEntry = trans.find(t => categoryOf(t.new_value, statuses) === 'done');
      if (!doneEntry) continue;
      const progressEntry = trans.find(t => categoryOf(t.new_value, statuses) === 'in_progress');
      const cycleHours = progressEntry && hoursBetween(progressEntry.created_at, doneEntry.created_at) >= 0
        ? hoursBetween(progressEntry.created_at, doneEntry.created_at)
        : null;
      
      rows.push({
        id: issue.id,
        issue_key: issue.issue_key,
        title: issue.title,
        resolved_date: doneEntry.created_at.split('T')[0],
        cycle_time_days: cycleHours !== null ? Math.round(cycleHours / 24 * 10) / 10 : null
      });
    }
    
    const cycles = rows.map(r => r.cycle_time_days).filter(c => c !== null).sort((a, b) => a - b);
    res.json({
      issues: rows.filter(r => r.cycle_time_days !== null).sort((a, b) => b.resolved_date.localeCompare(a.resolved_date)),
      p50_cycle_days: percentile(cycles, 0.5),
      p85_cycle_days: percentile(cycles, 0.85)
    });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 3: Run test to verify it passes**

Run `npm test -- backend/tests/backend/reports-control-chart.test.js` and confirm percentiles are computed correctly.

- [ ] **Step 4: Commit backend**

```bash
git add backend/routes/reports.js backend/tests/backend/reports-control-chart.test.js
git commit -m "feat: add Control Chart endpoint"
```

---

## Task 7: Control Chart Frontend

**Files:**
- Modify: `frontend/src/screens/reports.tsx`

**Interfaces:**
- Consumes: `ChartCard`, `ScatterChart` (from Task 1), `Legend`, `api.reports.controlChart(projectId)`
- Produces: No new exports. Renders `<ChartCard>` with ScatterChart showing cycle time trend + p50/p85 reference lines.

- [ ] **Step 1: Add control chart state and data fetching**

In `ReportsScreen`, add state:
```javascript
const [controlChart, setControlChart] = useState<ControlChartResponse | null>(null);
```

In `load()` function, add to Promise.all:
```javascript
api.get(`/projects/${currentProjectId}/reports/control-chart`)
```

And set the state in the results.

- [ ] **Step 2: Render Control Chart ChartCard**

In the reports grid, add:
```jsx
{controlChart && (
  <ChartCard
    title="Control Chart"
    description="Cycle time trend (last 50 resolved issues)"
    children={
      <div className="space-y-4">
        <Legend items={[
          {label: `P50: ${controlChart.p50_cycle_days?.toFixed(1)}d`, color: seriesColor(1)},
          {label: `P85: ${controlChart.p85_cycle_days?.toFixed(1)}d`, color: seriesColor(2)}
        ]} />
        <ScatterChart
          data={controlChart.issues.map(i => ({
            x: i.resolved_date,
            y: i.cycle_time_days || 0,
            label: i.issue_key
          }))}
          p50={controlChart.p50_cycle_days}
          p85={controlChart.p85_cycle_days}
          xLabel="Resolved Date"
          yLabel="Cycle Time (days)"
        />
      </div>
    }
    table={
      <DataTable
        caption="Control chart data"
        columns={['Key', 'Resolved', 'Cycle Time']}
        rows={controlChart.issues.map(i => [i.issue_key, i.resolved_date, `${i.cycle_time_days?.toFixed(1)}d`])}
      />
    }
  />
)}
```

- [ ] **Step 3: Commit frontend**

```bash
git add frontend/src/screens/reports.tsx
git commit -m "feat: add Control Chart UI with cycle time trend scatter plot"
```

---

## Task 8: Average Age Report Backend

**Files:**
- Modify: `backend/routes/reports.js` (add endpoint)
- Create: `backend/tests/backend/reports-average-age.test.js`

**Interfaces:**
- Consumes: `queryAll`, `requireAuth`, `serverError`, `projectStatuses`, `categoryOf`
- Produces: `GET /api/projects/:projectId/reports/average-age` endpoint returning `{ by_status: [{status, age_days_avg, age_days_max, count}], oldest_issues: [{id, issue_key, title, status, created_at, age_days}] }`

- [ ] **Step 1: Write failing test for average age calculation**

Create `backend/tests/backend/reports-average-age.test.js` with seed open issues (not 'done') created at different dates (10 days ago, 20 days ago, 30 days ago, etc., in different statuses: todo, in_progress, blocked). Test `GET /api/projects/:projectId/reports/average-age` returns by_status array with avg and max age per status, and oldest_issues sorted by age descending.

- [ ] **Step 2: Implement average age endpoint**

In `backend/routes/reports.js`, add:
```javascript
router.get('/projects/:projectId/reports/average-age', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const statuses = await projectStatuses(db, req.params.projectId);
    const issues = await queryAll(db, 'SELECT * FROM issues WHERE project_id = ?', [req.params.projectId]);
    const now = new Date();
    
    // Filter to open (non-done) issues
    const open = issues.filter(i => categoryOf(i.status, statuses) !== 'done');
    
    // Calculate age for each issue
    const withAge = open.map(i => ({
      ...i,
      age_days: Math.floor((now - new Date(i.created_at)) / 864e5)
    }));
    
    // Group by status: avg and max age
    const byStatus = new Map();
    for (const issue of withAge) {
      if (!byStatus.has(issue.status)) {
        byStatus.set(issue.status, []);
      }
      byStatus.get(issue.status).push(issue.age_days);
    }
    
    const statusGroups = Array.from(byStatus.entries()).map(([status, ages]) => ({
      status,
      age_days_avg: Math.round(ages.reduce((s, a) => s + a, 0) / ages.length),
      age_days_max: Math.max(...ages),
      count: ages.length
    }));
    
    // Oldest issues (top 20)
    const oldest = withAge.sort((a, b) => b.age_days - a.age_days).slice(0, 20);
    
    res.json({
      by_status: statusGroups,
      oldest_issues: oldest.map(i => ({id: i.id, issue_key: i.issue_key, title: i.title, status: i.status, created_at: i.created_at, age_days: i.age_days}))
    });
  } catch (e) { serverError(res, e); }
});
```

- [ ] **Step 3: Run test to verify it passes**

Run `npm test -- backend/tests/backend/reports-average-age.test.js` and confirm age calculations and grouping.

- [ ] **Step 4: Commit backend**

```bash
git add backend/routes/reports.js backend/tests/backend/reports-average-age.test.js
git commit -m "feat: add Average Age report endpoint"
```

---

## Task 9: Average Age Report Frontend

**Files:**
- Modify: `frontend/src/screens/reports.tsx`

**Interfaces:**
- Consumes: `ChartCard`, `HBarChart`, `DataTable`, `api.reports.averageAge(projectId)`, `STATUS_LABEL`
- Produces: No new exports. Renders `<ChartCard>` with HBarChart (avg age per status) and oldest issues DataTable.

- [ ] **Step 1: Add average age state and data fetching**

In `ReportsScreen`, add state:
```javascript
const [averageAge, setAverageAge] = useState<AverageAgeResponse | null>(null);
```

In `load()` function, add to Promise.all and set state.

- [ ] **Step 2: Render Average Age ChartCard**

In the reports grid, add:
```jsx
{averageAge && (
  <ChartCard
    title="Average Age"
    description="Age of currently open issues by status"
    children={
      <HBarChart
        data={averageAge.by_status.map(s => ({
          label: STATUS_LABEL[s.status],
          value: s.age_days_avg
        }))}
        formatValue={(n) => `${n}d`}
      />
    }
    table={
      averageAge.oldest_issues?.length ? (
        <DataTable
          caption="Oldest open issues"
          columns={['Key', 'Title', 'Status', 'Age (days)']}
          rows={averageAge.oldest_issues.map(i => [i.issue_key, i.title, STATUS_LABEL[i.status], i.age_days])}
        />
      ) : undefined
    }
  />
)}
```

- [ ] **Step 3: Commit frontend**

```bash
git add frontend/src/screens/reports.tsx
git commit -m "feat: add Average Age report UI"
```

---

## Task 10: Created vs Resolved Report Frontend

**Files:**
- Modify: `frontend/src/screens/reports.tsx`

**Interfaces:**
- Consumes: `ChartCard`, `LineChart`, `Legend`, `seriesColor` (already in scope)
- Produces: No new exports. Renders `<ChartCard>` with two-series LineChart (created/day, resolved/day).

- [ ] **Step 1: Add created-vs-resolved state and data fetching**

In `ReportsScreen`, add state:
```javascript
const [createdVsResolved, setCreatedVsResolved] = useState<CreatedVsResolvedResponse | null>(null);
```

In `load()`, add to Promise.all:
```javascript
api.get(`/projects/${currentProjectId}/reports/created-vs-resolved`)
```

And set state. Note: the backend already exists; this is UI only.

- [ ] **Step 2: Render Created vs Resolved ChartCard**

In the reports grid, add:
```jsx
{createdVsResolved && (
  <ChartCard
    title="Created vs Resolved"
    description="Creation and resolution trend over time"
    children={
      <div className="space-y-4">
        <Legend items={[
          {label: 'Created', color: seriesColor(0)},
          {label: 'Resolved', color: seriesColor(1)}
        ]} />
        <LineChart
          data={[
            createdVsResolved.created.map(d => ({label: d.day, value: d.count})),
            createdVsResolved.resolved.map(d => ({label: d.day, value: d.count}))
          ]}
          series={[
            {label: 'Created', color: seriesColor(0)},
            {label: 'Resolved', color: seriesColor(1)}
          ]}
        />
      </div>
    }
  />
)}
```

- [ ] **Step 3: Commit frontend**

```bash
git add frontend/src/screens/reports.tsx
git commit -m "feat: add Created vs Resolved report UI"
```

---

## Task 11: Manual Verification & Testing

**Files:**
- No files created/modified; verification only

**Interfaces:**
- Consumes: Running app instance, browser devtools
- Produces: Confidence that all five reports render correctly in both light/dark themes, dropdowns work, charts display real data

- [ ] **Step 1: Start dev servers**

Run `npm run dev` in backend and frontend directories (or your project's dev command).

- [ ] **Step 2: Navigate to Reports screen**

Open the app, select a project with issues/sprints/versions, navigate to Reports.

- [ ] **Step 3: Verify each new report**

For each report (Created vs Resolved, Epic Burndown, Version Report, Control Chart, Average Age):
- Chart renders without errors
- Data is populated from real backend (check Network tab for successful requests)
- Dropdowns (Epic, Version) populate with options and selection reloads chart
- Toggle to "Data" view shows DataTable with correct columns
- Switch browser theme (light/dark) and confirm chart colors, text contrast are readable

- [ ] **Step 4: Spot-check calculations**

For one epic/version, manually verify:
- Rollup totals (done_count, total_count, done_points, total_points) match issue list
- Burndown line is monotonically non-increasing (remaining points never increase day-to-day)
- Control Chart p50/p85 lines fall within the range of plotted points

- [ ] **Step 5: Commit final verification log (optional)**

No code changes, but if useful, create a short note documenting test results:
```bash
git commit --allow-empty -m "docs: verify all 5 new reports render and calculate correctly in dev instance"
```

---

## Spec Coverage Check

✅ Created vs Resolved — Task 10 (UI only, backend exists)
✅ Epic Report — Tasks 2–3 (backend endpoint with burndown series, epic picker UI)
✅ Version Report — Tasks 4–5 (backend endpoint, version picker UI, StackedBar)
✅ Control Chart — Tasks 1, 6–7 (ScatterChart primitive, backend endpoint with p50/p85, frontend UI)
✅ Average Age — Tasks 8–9 (backend endpoint grouping by status, frontend HBarChart + oldest issues table)
✅ No cross-project reporting — all queries filter by `project_id`
✅ No custom date ranges — all use fixed windows (epoch to now, or sprint/epic start to now)
✅ No CSV export for new reports — confirmed in spec
✅ Backend tests follow existing patterns — all task tests import seed data and verify response shape
✅ Frontend manual verification — Task 11 covers theme rendering, data population, dropdown behavior

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-05-reports-enhancements.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
