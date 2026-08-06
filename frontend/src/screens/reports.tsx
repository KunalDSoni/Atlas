import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, Gauge, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getToken } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, STATUSES, TYPE_LABEL } from '@/lib/domain';
import type { ControlChartResponse, CumulativeFlowResponse, CycleTimeResponse, IssueStatus, IssueType, Priority, TimeInStatusResponse, VersionReportResponse } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, UserAvatar } from '@/components/app/primitives';
import { DataTable, GroupedColumns, HBarChart, Legend, LineChart, ScatterChart, StackedBar, seriesColor } from '@/components/app/charts';
import { toast } from 'sonner';

/** Story → Task → Bug reads as a workflow; alphabetical does not. */
const TYPE_ORDER = ['story', 'task', 'bug'] as const;

/** Hours render as days past 48h; null (no data) renders as an em dash. */
function fmtHours(h: number | null): string {
  if (h === null) return '—';
  return h >= 48 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(1)}h`;
}

interface VelocityResponse {
  sprints: {
    sprint: string;
    committed_points: number;
    completed_points: number;
    committed_issues: number;
    completed_issues: number;
  }[];
  average_velocity: number;
}

interface WorkloadResponse {
  members: {
    id: string;
    name: string;
    avatar_color: string;
    total_issues: number;
    todo: number;
    in_progress: number;
    in_review: number;
    done: number;
    total_points: number;
  }[];
}

type DistRow<K extends string> = Record<K, string> & { status: IssueStatus; count: number; points: number };

interface SprintReportRow {
  id: string;
  name: string;
  status: string;
  total_issues: number;
  completed_issues: number;
  incomplete_issues: number;
  total_points: number;
  completed_points: number;
  completion_rate: number;
}

interface BurndownResponse {
  sprint: { id: string; name: string; start_date: string; end_date: string; total_points: number } | null;
  data: { date: string; ideal: number; actual: number }[];
}

interface ResolutionResponse {
  total_resolved: number;
  avg_resolution_days: number;
  by_priority: { priority: string; total: number; resolved: number; avg_days: number | null }[];
}

interface CreatedVsResolvedResponse {
  created: { day: string; count: number }[];
  resolved: { day: string; count: number }[];
}

/**
 * Collapse a status-split distribution into totals per key, in a caller-supplied
 * domain order. The API returns rows grouped by status, so insertion order is
 * meaningless — priority in particular must read highest→low, not alphabetically.
 */
function totalsByKey<K extends string>(rows: DistRow<K>[] | null, key: K, order: readonly string[]) {
  const map = new Map<string, number>();
  (rows ?? []).forEach((r) => {
    const k = r[key] as unknown as string;
    map.set(k, (map.get(k) ?? 0) + r.count);
  });
  const known = order.filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const);
  const extra = [...map].filter(([k]) => !order.includes(k));
  return [...known, ...extra];
}

function ChartCard({
  title,
  description,
  children,
  table,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  table?: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {table && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
            >
              <Table2 className="size-3.5" />
              {showTable ? 'Chart' : 'Data'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">{showTable && table ? table : children}</CardContent>
    </Card>
  );
}

export default function ReportsScreen() {
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [velocity, setVelocity] = useState<VelocityResponse | null>(null);
  const [workload, setWorkload] = useState<WorkloadResponse | null>(null);
  const [types, setTypes] = useState<DistRow<'type'>[] | null>(null);
  const [priorities, setPriorities] = useState<DistRow<'priority'>[] | null>(null);
  const [sprintReport, setSprintReport] = useState<SprintReportRow[] | null>(null);
  const [burndown, setBurndown] = useState<BurndownResponse | null>(null);
  const [resolution, setResolution] = useState<ResolutionResponse | null>(null);
  const [cycle, setCycle] = useState<CycleTimeResponse | null>(null);
  const [tis, setTis] = useState<TimeInStatusResponse | null>(null);
  const [cfd, setCfd] = useState<CumulativeFlowResponse | null>(null);
  const [controlChart, setControlChart] = useState<ControlChartResponse | null>(null);
  const [createdVsResolved, setCreatedVsResolved] = useState<CreatedVsResolvedResponse | null>(null);
  const [epics, setEpics] = useState<Array<{ id: string; title: string }> | null>(null);
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const [epicReport, setEpicReport] = useState<any | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; name: string }> | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versionReport, setVersionReport] = useState<VersionReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [v, w, t, p, sr, bd, rs, ct, ts, cf, cc, cvr, epicsList, versionsList] = await Promise.all([
        api.reports.velocity(currentProjectId),
        api.reports.workload(currentProjectId),
        api.reports.typeDistribution(currentProjectId),
        api.reports.priorityDistribution(currentProjectId),
        api.reports.sprint(currentProjectId).catch(() => null),
        api.reports.burndown(currentProjectId).catch(() => null),
        api.reports.resolution(currentProjectId).catch(() => null),
        api.reports.cycleTime(currentProjectId).catch(() => null),
        api.reports.timeInStatus(currentProjectId).catch(() => null),
        api.reports.cumulativeFlow(currentProjectId).catch(() => null),
        api.reports.controlChart(currentProjectId).catch(() => null),
        api.reports.createdVsResolved(currentProjectId).catch(() => null),
        api.epics.list(currentProjectId).catch(() => []),
        api.reports.versions(currentProjectId).catch(() => []),
      ]);
      setVelocity(v as VelocityResponse);
      setWorkload(w as WorkloadResponse);
      setTypes(t as DistRow<'type'>[]);
      setPriorities(p as DistRow<'priority'>[]);
      setSprintReport(sr as SprintReportRow[] | null);
      setBurndown(bd as BurndownResponse | null);
      setResolution(rs as ResolutionResponse | null);
      setCycle(ct);
      setTis(ts);
      setCfd(cf);
      setControlChart(cc);
      setCreatedVsResolved(cvr as CreatedVsResolvedResponse | null);

      const epicSummaries = (epicsList as any[]).map((e) => ({ id: e.id, title: e.title }));
      setEpics(epicSummaries);
      if (epicSummaries.length > 0) {
        const firstBurndown = await api.reports.epicBurndown(currentProjectId, epicSummaries[0].id);
        setEpicReport(firstBurndown);
        setSelectedEpicId(epicSummaries[0].id);
      }

      const versionSummaries = (versionsList as any[]).map((v) => ({ id: v.id, name: v.name }));
      setVersions(versionSummaries);
      if (versionSummaries.length > 0) {
        const firstReport = await api.reports.versionReport(currentProjectId, versionSummaries[0].id);
        setVersionReport(firstReport as VersionReportResponse);
        setSelectedVersionId(versionSummaries[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** CSV lives behind auth, so fetch it with the token and save the blob. */
  async function downloadCsv() {
    if (!currentProjectId) return;
    try {
      const res = await fetch(api.reports.csvUrl(currentProjectId), {
        headers: { 'x-auth-token': getToken() ?? '' },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject?.key ?? 'atlas'}-issues.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Could not export CSV', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function handleEpicChange(epicId: string) {
    if (!currentProjectId) return;
    setSelectedEpicId(epicId);
    try {
      const burndown = await api.reports.epicBurndown(currentProjectId, epicId);
      setEpicReport(burndown);
    } catch (e) {
      toast.error('Could not load epic report', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function handleVersionChange(versionId: string) {
    if (!currentProjectId) return;
    setSelectedVersionId(versionId);
    try {
      const report = await api.reports.versionReport(currentProjectId, versionId);
      setVersionReport(report);
    } catch (e) {
      toast.error('Could not load version report', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Reports" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState icon={Gauge} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Reports" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  const typeTotals = totalsByKey(types, 'type', TYPE_ORDER);
  const priorityTotals = totalsByKey(priorities, 'priority', PRIORITIES);
  const members = workload?.members ?? [];
  const sprints = velocity?.sprints ?? [];

  return (
    <>
      <PageHeader
        title="Reports"
        description={currentProject?.name}
        actions={
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />

      {/* Resolution headline — a hero number reads better than a chart for one value. */}
      {resolution && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-success-muted text-success">
                <CheckCircle2 className="size-4.5" />
              </span>
              <span>
                <span className="block text-2xl font-semibold leading-none tabular-nums">
                  {resolution.total_resolved}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">Issues resolved</span>
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-muted text-accent-foreground">
                <Clock className="size-4.5" />
              </span>
              <span>
                <span className="block text-2xl font-semibold leading-none tabular-nums">
                  {resolution.avg_resolution_days ?? 0}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">days</span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">Average resolution time</span>
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {burndown?.sprint && burndown.data.length > 1 && (
          <ChartCard
            title="Sprint burndown"
            description={`${burndown.sprint.name} · ${burndown.sprint.total_points} points committed`}
            table={
              <DataTable
                caption="Ideal versus actual remaining points per day"
                columns={['Date', 'Ideal', 'Actual']}
                rows={burndown.data.map((d) => [d.date, d.ideal, d.actual])}
              />
            }
          >
            <LineChart
              series={['Ideal', 'Actual']}
              points={burndown.data.map((d) => ({ label: d.date.slice(5), values: [d.ideal, d.actual] }))}
              formatValue={(n) => `${n} pts`}
            />
          </ChartCard>
        )}

        <ChartCard
          title="Sprint velocity"
          description={`Average ${velocity?.average_velocity ?? 0} points completed per sprint`}
          table={
            <DataTable
              caption="Committed versus completed points per sprint"
              columns={['Sprint', 'Committed', 'Completed']}
              rows={sprints.map((s) => [s.sprint, s.committed_points, s.completed_points])}
            />
          }
        >
          <GroupedColumns
            series={['Committed', 'Completed']}
            groups={sprints.map((s) => ({ label: s.sprint, values: [s.committed_points, s.completed_points] }))}
            formatValue={(n) => `${n} pts`}
          />
        </ChartCard>

        {epicReport && (
          <ChartCard
            title="Epic Burndown"
            description={selectedEpicId ? `${(epicReport as any).epic?.name || 'Epic'}` : 'Select an epic'}
            table={
              (epicReport as any).children?.length ? (
                <DataTable
                  caption="Epic children"
                  columns={['Key', 'Title', 'Status', 'Points']}
                  rows={(epicReport as any).children.map((c: any) => [c.issue_key, c.title, STATUS_LABEL[c.status] || c.status, c.points])}
                />
              ) : undefined
            }
          >
            <div className="space-y-4">
              <select
                value={selectedEpicId || ''}
                onChange={(e) => handleEpicChange(e.target.value)}
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select epic...</option>
                {epics?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
              {(epicReport as any).burndown && (epicReport as any).burndown.length > 0 ? (
                <LineChart
                  series={['Remaining']}
                  points={(epicReport as any).burndown.map((d: any) => ({
                    label: d.date.slice(5),
                    values: [d.remaining_points],
                  }))}
                  formatValue={(n) => `${n} pts`}
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No burndown data available.</p>
              )}
            </div>
          </ChartCard>
        )}

        {versionReport && (
          <ChartCard
            title="Version Report"
            description={selectedVersionId ? `${versionReport.version?.name || 'Version'}` : 'Select a version'}
            table={
              versionReport.issues?.length ? (
                <DataTable
                  caption="Version issues"
                  columns={['Key', 'Title', 'Status', 'Points']}
                  rows={versionReport.issues.map((i) => [i.issue_key, i.title, STATUS_LABEL[i.status as IssueStatus] || i.status, i.points])}
                />
              ) : undefined
            }
          >
            <div className="space-y-4">
              <select
                value={selectedVersionId || ''}
                onChange={(e) => handleVersionChange(e.target.value)}
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select version...</option>
                {versions?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium">Completion</span>
                  <span className="tabular-nums text-muted-foreground">
                    {versionReport.done_count}/{versionReport.total_count} issues · {versionReport.done_points}/{versionReport.total_points} points
                  </span>
                </div>
                <StackedBar
                  total={versionReport.total_points}
                  segments={[
                    {
                      label: 'Done',
                      value: versionReport.done_points,
                      color: seriesColor(4), // Using the done status color
                    },
                    {
                      label: 'Remaining',
                      value: versionReport.total_points - versionReport.done_points,
                      color: seriesColor(0), // Using a neutral color for remaining
                    },
                  ]}
                />
              </div>
            </div>
          </ChartCard>
        )}

        <ChartCard
          title="Workload by assignee"
          description="Open and completed issues per person"
          table={
            <DataTable
              caption="Issue counts per assignee"
              columns={['Assignee', 'To Do', 'In Progress', 'In Review', 'Done', 'Total']}
              rows={members.map((m) => [m.name, m.todo, m.in_progress, m.in_review, m.done, m.total_issues])}
            />
          }
        >
          {members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No assignees yet.</p>
          ) : (
            <>
              <Legend items={STATUSES.map((s, i) => ({ label: STATUS_LABEL[s], color: seriesColor(i) }))} />
              <ul className="space-y-3">
                {members.map((m) => (
                  <li key={m.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <UserAvatar name={m.name} color={m.avatar_color} className="size-5" />
                      <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {m.total_issues} · {m.total_points} pts
                      </span>
                    </div>
                    <StackedBar
                      total={m.total_issues}
                      segments={STATUSES.map((s, i) => ({
                        label: STATUS_LABEL[s],
                        value: m[s as keyof typeof m] as number,
                        color: seriesColor(i),
                      }))}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Issues by type"
          table={
            <DataTable
              caption="Issue count by type"
              columns={['Type', 'Issues']}
              rows={typeTotals.map(([k, v]) => [TYPE_LABEL[k as IssueType] ?? k, v])}
            />
          }
        >
          <HBarChart
            colorIndex={0}
            data={typeTotals.map(([k, v]) => ({ label: TYPE_LABEL[k as IssueType] ?? k, value: v }))}
          />
        </ChartCard>

        {sprintReport && sprintReport.length > 0 && (
          <ChartCard
            title="Sprint report"
            description="Completion rate per sprint"
            table={
              <DataTable
                caption="Sprint completion"
                columns={['Sprint', 'Done', 'Total', 'Rate']}
                rows={sprintReport.map((r) => [r.name, r.completed_issues, r.total_issues, `${r.completion_rate}%`])}
              />
            }
          >
            <ul className="space-y-3">
              {sprintReport.map((r) => (
                <li key={r.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-medium">{r.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {r.completed_issues}/{r.total_issues} · {r.completion_rate}%
                    </span>
                  </div>
                  <Progress value={r.completion_rate} className="h-2" />
                  <p className="text-[11px] text-muted-foreground">
                    {r.completed_points}/{r.total_points} points · {r.status}
                  </p>
                </li>
              ))}
            </ul>
          </ChartCard>
        )}

        {resolution && resolution.by_priority.length > 0 && (
          <ChartCard
            title="Resolution time by priority"
            description="Average days from created to done"
            table={
              <DataTable
                caption="Resolution time by priority"
                columns={['Priority', 'Resolved', 'Total', 'Avg days']}
                rows={resolution.by_priority.map((r) => [
                  PRIORITY_LABEL[r.priority as Priority] ?? r.priority,
                  r.resolved,
                  r.total,
                  r.avg_days ?? '—',
                ])}
              />
            }
          >
            <HBarChart
              colorIndex={1}
              formatValue={(n) => `${n}d`}
              data={PRIORITIES.filter((p) => resolution.by_priority.some((r) => r.priority === p)).map((p) => ({
                label: PRIORITY_LABEL[p],
                value: resolution.by_priority.find((r) => r.priority === p)?.avg_days ?? 0,
              }))}
            />
          </ChartCard>
        )}

        <ChartCard
          title="Issues by priority"
          table={
            <DataTable
              caption="Issue count by priority"
              columns={['Priority', 'Issues']}
              rows={priorityTotals.map(([k, v]) => [PRIORITY_LABEL[k as Priority] ?? k, v])}
            />
          }
        >
          <HBarChart
            colorIndex={3}
            data={priorityTotals.map(([k, v]) => ({ label: PRIORITY_LABEL[k as Priority] ?? k, value: v }))}
          />
        </ChartCard>

        {/* ===== Flow metrics (since tracking began) ===== */}
        {cycle && cycle.count > 0 && (
          <ChartCard
            title="Cycle time"
            description="Completed issues, since tracking began"
            table={
              <DataTable
                caption="Recently completed issues with cycle and lead times"
                columns={['Key', 'Title', 'Cycle', 'Lead']}
                rows={cycle.issues.slice(0, 10).map((i) => [
                  i.issue_key, i.title, fmtHours(i.cycle_time_h), fmtHours(i.lead_time_h),
                ])}
              />
            }
          >
            <div className="grid grid-cols-4 gap-3 text-center">
              {([
                ['Avg cycle', cycle.avg_cycle_h], ['P50', cycle.p50_cycle_h],
                ['P85', cycle.p85_cycle_h], ['Avg lead', cycle.avg_lead_h],
              ] as const).map(([label, val]) => (
                <div key={label} className="rounded-md border border-border p-2.5">
                  <p className="text-lg font-semibold tabular-nums">{fmtHours(val)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </ChartCard>
        )}

        {tis && tis.statuses.length > 0 && (
          <ChartCard
            title="Time in status"
            description="Average hours per status, since tracking began"
            table={
              <DataTable
                caption="Average and total hours spent per status"
                columns={['Status', 'Avg', 'Total', 'Issues']}
                rows={tis.statuses.map((s) => [
                  STATUS_LABEL[s.status as IssueStatus] ?? s.status, fmtHours(s.avg_h), fmtHours(s.total_h), s.issues,
                ])}
              />
            }
          >
            <HBarChart
              colorIndex={1}
              data={tis.statuses.map((s) => ({
                label: STATUS_LABEL[s.status as IssueStatus] ?? s.status,
                value: s.avg_h,
              }))}
              formatValue={(n) => fmtHours(n)}
            />
          </ChartCard>
        )}

        {cfd && cfd.days.length > 1 && (
          <ChartCard
            title="Cumulative flow"
            description="Issues per category per day, last 30 days"
            table={
              <DataTable
                caption="Daily issue counts per workflow category"
                columns={['Date', 'To Do', 'In Progress', 'Done']}
                rows={cfd.days.slice(-10).map((d) => [d.date, d.todo, d.in_progress, d.done])}
              />
            }
          >
            <LineChart
              series={['To Do', 'In Progress', 'Done']}
              points={cfd.days.map((d) => ({
                label: d.date.slice(5),
                values: [d.todo, d.in_progress, d.done],
              }))}
            />
            <div className="mt-2">
              <Legend items={['To Do', 'In Progress', 'Done'].map((label, i) => ({ label, color: seriesColor(i) }))} />
            </div>
          </ChartCard>
        )}

        {controlChart && controlChart.issues.length > 0 && (
          <ChartCard
            title="Control Chart"
            description="Cycle time trend with p50/p85 reference lines"
            table={
              <DataTable
                caption="Resolved issues with cycle time"
                columns={['Key', 'Title', 'Resolved', 'Cycle (days)']}
                rows={controlChart.issues.map((i) => [i.issue_key, i.title, i.resolved_date.slice(0, 10), i.cycle_time_days])}
              />
            }
          >
            <div className="space-y-4">
              <Legend
                items={[
                  { label: `p50: ${controlChart.p50_cycle_days}d`, color: seriesColor(0) },
                  { label: `p85: ${controlChart.p85_cycle_days}d`, color: seriesColor(1) },
                ]}
              />
              <ScatterChart
                data={controlChart.issues.map((i) => ({
                  x: i.resolved_date.slice(5),
                  y: i.cycle_time_days,
                  label: `${i.issue_key}: ${i.title}`,
                }))}
                p50={controlChart.p50_cycle_days}
                p85={controlChart.p85_cycle_days}
                xLabel="Date"
                yLabel="Cycle time (days)"
                formatValue={(n) => `${n}d`}
              />
            </div>
          </ChartCard>
        )}

        {createdVsResolved && (createdVsResolved.created.length > 1 || createdVsResolved.resolved.length > 1) && (
          <ChartCard
            title="Created vs Resolved"
            description="Issues created and resolved per day"
            table={
              <DataTable
                caption="Daily counts of created and resolved issues"
                columns={['Date', 'Created', 'Resolved']}
                rows={createdVsResolved.created.map((c, i) => {
                  const resolved = createdVsResolved.resolved[i];
                  return [c.day, c.count, resolved?.count ?? 0];
                })}
              />
            }
          >
            <LineChart
              series={['Created', 'Resolved']}
              points={createdVsResolved.created.map((c, i) => {
                const resolved = createdVsResolved.resolved[i];
                return {
                  label: c.day.slice(5),
                  values: [c.count, resolved?.count ?? 0],
                };
              })}
            />
            <div className="mt-2">
              <Legend items={['Created', 'Resolved'].map((label, i) => ({ label, color: seriesColor(i) }))} />
            </div>
          </ChartCard>
        )}
      </div>
    </>
  );
}
