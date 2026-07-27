import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarRange, ChevronLeft, Link2, ListTodo } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { useWorkflow } from '@/hooks/use-workflow';
import { SPRINT_TONE, statusTone } from '@/lib/domain';
import type { Issue, Sprint } from '@/lib/types';
import {
  EmptyState, ErrorState, PageHeader, PriorityIcon, RowsSkeleton, StatusPill, TypeIcon, UserAvatar,
} from '@/components/app/primitives';
import { formatDate } from '@/lib/format';
import { absoluteUrl, issueUrl, projectUrl, sprintUrl } from '@/lib/urls';
import { cn } from '@/lib/utils';

function CopySprintLink({ projectKey, slug }: { projectKey: string; slug: string }) {
  async function copy() {
    const url = absoluteUrl(sprintUrl(projectKey, slug));
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', { description: url });
    } catch {
      toast.error('Could not copy', { description: url });
    }
  }

  return (
    <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={copy} aria-label="Copy link">
      <Link2 className="size-3.5" /> Copy link
    </Button>
  );
}

export default function SprintDetailScreen() {
  const { sprintSlug = '' } = useParams<{ sprintSlug: string }>();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workflow = useWorkflow(currentProjectId);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const loadedSprints = await api.sprints.list(currentProjectId);
      setSprints(loadedSprints);
      const sprint = loadedSprints.find((s) => s.slug === sprintSlug);
      setIssues(sprint ? await api.issues.list(currentProjectId, sprint.id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sprint');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId, sprintSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const sprint = useMemo(() => sprints.find((s) => s.slug === sprintSlug), [sprints, sprintSlug]);
  const pct = sprint?.issue_count ? Math.round((sprint.done_count / sprint.issue_count) * 100) : 0;

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Sprint" />
        <RowsSkeleton />
      </>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!currentProject || !sprint) {
    return (
      <EmptyState
        icon={ListTodo}
        title="Sprint not found"
        description="This sprint does not exist, or it has been deleted."
        action={(
          <Button asChild variant="outline">
            <Link to={projectUrl(currentProject?.key ?? '', 'sprints')}>Back to sprints</Link>
          </Button>
        )}
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1 px-2">
          <Link to={projectUrl(currentProject.key, 'sprints')}>
            <ChevronLeft className="size-4" /> Sprints
          </Link>
        </Button>
        <span className="flex-1" />
        <CopySprintLink projectKey={currentProject.key} slug={sprint.slug} />
      </div>

      <PageHeader
        title={sprint.name}
        description={sprint.goal || `Sprint in ${currentProject.name}`}
        actions={(
          <span className={cn('rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', SPRINT_TONE[sprint.status])}>
            {sprint.status}
          </span>
        )}
      />

      <Card className="mb-5 p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
              <span>Issues complete</span>
              <span className="tabular-nums">{sprint.done_count}/{sprint.issue_count} · {pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground md:justify-end">
            <CalendarRange className="size-4" />
            {formatDate(sprint.start_date)} → {formatDate(sprint.end_date)}
          </div>
        </div>
      </Card>

      {issues.length === 0 ? (
        <EmptyState icon={ListTodo} title="No issues in this sprint" />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {issues.map((issue) => (
              <li key={issue.id}>
                <Link to={issueUrl(issue.issue_key)} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60">
                  <TypeIcon type={issue.type} />
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                  <PriorityIcon priority={issue.priority} />
                  <StatusPill status={issue.status} label={workflow.label(issue.status)} tone={statusTone(issue.status, workflow.statuses)} className="hidden md:inline-flex" />
                  {issue.assignee_name ? <UserAvatar name={issue.assignee_name} color={issue.assignee_color} /> : <span className="size-6 shrink-0 rounded-full border border-dashed border-border" />}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
