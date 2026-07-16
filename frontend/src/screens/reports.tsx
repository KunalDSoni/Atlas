import { useCallback, useEffect, useState } from 'react';
import { Download, Gauge, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getToken } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, STATUSES, TYPE_LABEL } from '@/lib/domain';
import type { IssueStatus, IssueType, Priority } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, UserAvatar } from '@/components/app/primitives';
import { DataTable, GroupedColumns, HBarChart, Legend, StackedBar, seriesColor } from '@/components/app/charts';
import { toast } from 'sonner';

/** Story → Task → Bug reads as a workflow; alphabetical does not. */
const TYPE_ORDER = ['story', 'task', 'bug'] as const;

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [v, w, t, p] = await Promise.all([
        api.reports.velocity(currentProjectId),
        api.reports.workload(currentProjectId),
        api.reports.typeDistribution(currentProjectId),
        api.reports.priorityDistribution(currentProjectId),
      ]);
      setVelocity(v as VelocityResponse);
      setWorkload(w as WorkloadResponse);
      setTypes(t as DistRow<'type'>[]);
      setPriorities(p as DistRow<'priority'>[]);
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

      <div className="grid gap-4 lg:grid-cols-2">
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
      </div>
    </>
  );
}
