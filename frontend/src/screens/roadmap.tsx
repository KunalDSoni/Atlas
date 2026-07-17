import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { epicColor } from '@/lib/domain';
import type { EpicSummary, Sprint } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { IssueDetailSheet } from '@/components/app/issue-detail-sheet';
import { cn } from '@/lib/utils';

const DAY = 86_400_000;

function parseDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso.includes('T') ? iso : `${iso.slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Month boundaries covering [min, max]. */
function monthsBetween(min: number, max: number) {
  const months: { start: number; label: string }[] = [];
  const d = new Date(min);
  let cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  while (cur <= max) {
    const cd = new Date(cur);
    months.push({
      start: cur,
      label: cd.toLocaleDateString(undefined, { month: 'short', year: months.length === 0 || cd.getUTCMonth() === 0 ? 'numeric' : undefined, timeZone: 'UTC' }),
    });
    cur = Date.UTC(cd.getUTCFullYear(), cd.getUTCMonth() + 1, 1);
  }
  return months;
}

export default function RoadmapScreen() {
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [epics, setEpics] = useState<EpicSummary[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [e, sp] = await Promise.all([
        api.epics.list(currentProjectId),
        api.sprints.list(currentProjectId),
      ]);
      setEpics(e);
      setSprints(sp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roadmap');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every epic gets a window: explicit dates, or created_at + 30 days as fallback.
  const rows = useMemo(
    () =>
      epics.map((e) => {
        const start = parseDate(e.start_date) ?? parseDate(e.created_at) ?? Date.now();
        const end = Math.max(parseDate(e.due_date) ?? start + 30 * DAY, start + DAY);
        return { epic: e, start, end };
      }),
    [epics],
  );

  const sprintRows = useMemo(
    () =>
      sprints
        .map((s) => {
          const start = parseDate(s.start_date);
          const end = parseDate(s.end_date);
          return start && end && end > start ? { sprint: s, start, end } : null;
        })
        .filter((x): x is { sprint: Sprint; start: number; end: number } => x !== null),
    [sprints],
  );

  const range = useMemo(() => {
    const all = [...rows.flatMap((r) => [r.start, r.end]), ...sprintRows.flatMap((r) => [r.start, r.end])];
    if (all.length === 0) return null;
    const min = Math.min(...all);
    const max = Math.max(...all);
    const dMin = new Date(min);
    const dMax = new Date(max);
    const lo = Date.UTC(dMin.getUTCFullYear(), dMin.getUTCMonth(), 1);
    const hi = Date.UTC(dMax.getUTCFullYear(), dMax.getUTCMonth() + 1, 1);
    return { lo, hi, months: monthsBetween(lo, hi - 1) };
  }, [rows, sprintRows]);

  const pct = (t: number) => (range ? ((t - range.lo) / (range.hi - range.lo)) * 100 : 0);
  const now = Date.now();

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Roadmap" />
        <RowsSkeleton />
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Roadmap" />
        <EmptyState icon={CalendarRange} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Roadmap" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }
  if (!range || rows.length === 0) {
    return (
      <>
        <PageHeader title="Roadmap" />
        <EmptyState
          icon={CalendarRange}
          title="Nothing to plot yet"
          description={`Create epics in ${currentProject?.name ?? 'this project'} to see them on the timeline.`}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Roadmap"
        description="Epics and sprints across time — click a bar to open it"
      />

      <Card className="overflow-x-auto py-0">
        <div className="min-w-[640px] p-4">
          {/* Month header */}
          <div className="relative mb-2 ml-48 h-6 border-b border-border">
            {range.months.map((m) => (
              <span
                key={m.start}
                className="absolute top-0 border-l border-border-light pl-1.5 text-[11px] font-medium text-muted-foreground"
                style={{ left: `${pct(m.start)}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          {/* Epic rows */}
          <div className="space-y-1">
            {rows.map(({ epic, start, end }) => (
              <div key={epic.id} className="flex items-center gap-0">
                <button
                  onClick={() => setOpenIssueId(epic.id)}
                  className="flex w-48 shrink-0 items-center gap-2 truncate pr-3 text-left text-sm hover:text-primary"
                  title={epic.title}
                >
                  <span className={cn('size-2.5 shrink-0 rounded-sm', epicColor(epic.epic_color).swatch)} />
                  <span className="truncate">{epic.title}</span>
                </button>
                <div className="relative h-7 flex-1">
                  {now >= range.lo && now <= range.hi && (
                    <span
                      className="absolute inset-y-0 w-px bg-destructive/60"
                      style={{ left: `${pct(now)}%` }}
                      aria-hidden
                    />
                  )}
                  <button
                    onClick={() => setOpenIssueId(epic.id)}
                    className={cn(
                      'absolute inset-y-1 rounded-md transition-opacity hover:opacity-80',
                      epicColor(epic.epic_color).swatch,
                      epic.status === 'done' && 'opacity-50',
                    )}
                    style={{ left: `${pct(start)}%`, width: `${Math.max(pct(end) - pct(start), 1.5)}%` }}
                    aria-label={`${epic.issue_key} ${epic.title}`}
                    title={`${epic.issue_key} · ${epic.done_count}/${epic.child_count} done`}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Sprint rows */}
          {sprintRows.length > 0 && (
            <>
              <p className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-faint">Sprints</p>
              <div className="space-y-1">
                {sprintRows.map(({ sprint, start, end }) => (
                  <div key={sprint.id} className="flex items-center">
                    <span className="w-48 shrink-0 truncate pr-3 text-sm text-muted-foreground" title={sprint.name}>
                      {sprint.name}
                    </span>
                    <div className="relative h-6 flex-1">
                      <span
                        className={cn(
                          'absolute inset-y-1 rounded-md border',
                          sprint.status === 'active'
                            ? 'border-success bg-success-muted'
                            : 'border-border bg-muted',
                        )}
                        style={{ left: `${pct(start)}%`, width: `${Math.max(pct(end) - pct(start), 1.5)}%` }}
                        title={sprint.name}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>

      <IssueDetailSheet
        issueId={openIssueId}
        onOpenChange={(o) => !o && setOpenIssueId(null)}
        onChanged={load}
        onOpenIssue={setOpenIssueId}
      />
    </>
  );
}
