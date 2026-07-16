import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CircleDot, Columns3, ListTodo } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { STATUS_LABEL, STATUSES, TYPE_LABEL } from '@/lib/domain';
import type { Issue, ProjectStats, Sprint } from '@/lib/types';
import {
  CardsSkeleton, EmptyState, ErrorState, PageHeader, PriorityIcon, StatusPill, TypeIcon, UserAvatar,
} from '@/components/app/primitives';
import { timeAgo } from '@/lib/format';

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-4 py-3.5">
        <span className={`grid size-9 shrink-0 place-items-center rounded-md ${tone}`}>
          <Icon className="size-4.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-2xl font-semibold leading-none tabular-nums">{value}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
        </span>
      </CardContent>
    </Card>
  );
}

export default function DashboardScreen() {
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProjectId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, i, sp] = await Promise.all([
          api.projects.stats(currentProjectId),
          api.issues.list(currentProjectId),
          api.sprints.list(currentProjectId),
        ]);
        if (cancelled) return;
        setStats(s);
        setIssues(i);
        setSprints(sp);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <CardsSkeleton count={4} />
      </>
    );
  }

  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState icon={Columns3} title="No project selected" description="Create a project to get started." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState message={error} />
      </>
    );
  }

  const count = (status: string) => stats?.byStatus.find((s) => s.status === status)?.count ?? 0;
  const total = stats?.total ?? 0;
  const done = count('done');
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const activeSprint = sprints.find((s) => s.status === 'active');
  const recent = [...issues]
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={currentProject ? `${currentProject.name} · ${currentProject.key}` : undefined}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/board">Open board</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total issues" value={total} icon={ListTodo} tone="bg-primary-muted text-accent-foreground" />
        <StatTile label="In progress" value={count('in_progress')} icon={CircleDot} tone="bg-info-muted text-info" />
        <StatTile label="In review" value={count('in_review')} icon={AlertCircle} tone="bg-warning-muted text-warning" />
        <StatTile label="Done" value={done} icon={CheckCircle2} tone="bg-success-muted text-success" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Progress by status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="font-medium">Overall completion</span>
                <span className="tabular-nums text-muted-foreground">
                  {done}/{total} · {donePct}%
                </span>
              </div>
              <Progress value={donePct} className="h-2" />
            </div>

            <div className="space-y-2.5 pt-1">
              {STATUSES.map((s) => {
                const c = count(s);
                const pct = total ? Math.round((c / total) * 100) : 0;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <StatusPill status={s} className="w-24 justify-center" />
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{c}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Active sprint</CardTitle>
          </CardHeader>
          <CardContent>
            {activeSprint ? (
              <div className="space-y-3">
                <div>
                  <p className="font-medium">{activeSprint.name}</p>
                  {activeSprint.goal && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{activeSprint.goal}</p>
                  )}
                </div>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
                    <span>Issues completed</span>
                    <span className="tabular-nums">
                      {activeSprint.done_count}/{activeSprint.issue_count}
                    </span>
                  </div>
                  <Progress
                    value={activeSprint.issue_count ? (activeSprint.done_count / activeSprint.issue_count) * 100 : 0}
                    className="h-2"
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Story points</span>
                  <span className="tabular-nums">
                    {activeSprint.done_points}/{activeSprint.total_points}
                  </span>
                </div>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/sprints">View sprints</Link>
                </Button>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">No active sprint.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Recently updated</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {recent.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">No issues yet.</p>
          ) : (
            <ul className="divide-y divide-border-light">
              {recent.map((issue) => (
                <li key={issue.id} className="flex items-center gap-3 px-6 py-2.5 hover:bg-muted/50">
                  <TypeIcon type={issue.type} />
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                  <span className="hidden shrink-0 sm:block">
                    <PriorityIcon priority={issue.priority} />
                  </span>
                  <span className="hidden w-24 shrink-0 text-xs text-muted-foreground sm:block">
                    {TYPE_LABEL[issue.type]}
                  </span>
                  <StatusPill status={issue.status} className="hidden shrink-0 md:inline-flex" />
                  <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground lg:block">
                    {timeAgo(issue.updated_at)}
                  </span>
                  {issue.assignee_name ? (
                    <UserAvatar name={issue.assignee_name} color={issue.assignee_color} />
                  ) : (
                    <span className="size-6 shrink-0 rounded-full border border-dashed border-border" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="sr-only">
        {STATUSES.map((s) => `${STATUS_LABEL[s]}: ${count(s)}`).join(', ')}
      </p>
    </>
  );
}
