import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Link2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { useWorkflow } from '@/hooks/use-workflow';
import { statusTone } from '@/lib/domain';
import type { Issue, Version } from '@/lib/types';
import {
  EmptyState, ErrorState, PageHeader, PriorityIcon, RowsSkeleton, SprintBadge, StatusPill, TypeIcon, UserAvatar,
} from '@/components/app/primitives';
import { formatDate } from '@/lib/format';
import { absoluteUrl, issueUrl, projectUrl, releaseUrl } from '@/lib/urls';
import { cn } from '@/lib/utils';

function CopyReleaseLink({ projectKey, slug }: { projectKey: string; slug: string }) {
  async function copy() {
    const url = absoluteUrl(releaseUrl(projectKey, slug));
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

export default function ReleaseDetailScreen() {
  const { releaseSlug = '' } = useParams<{ releaseSlug: string }>();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [versions, setVersions] = useState<Version[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workflow = useWorkflow(currentProjectId);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [loadedVersions, loadedIssues] = await Promise.all([
        api.versions.list(currentProjectId),
        api.issues.list(currentProjectId),
      ]);
      setVersions(loadedVersions);
      const version = loadedVersions.find((v) => v.slug === releaseSlug);
      setIssues(version ? loadedIssues.filter((issue) => issue.fix_version_id === version.id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load release');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId, releaseSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const version = useMemo(() => versions.find((v) => v.slug === releaseSlug), [versions, releaseSlug]);
  const pct = version?.issue_count ? Math.round((version.done_count / version.issue_count) * 100) : 0;

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Release" />
        <RowsSkeleton />
      </>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!currentProject || !version) {
    return (
      <EmptyState
        icon={Package}
        title="Release not found"
        description="This release does not exist, or it has been deleted."
        action={(
          <Button asChild variant="outline">
            <Link to={projectUrl(currentProject?.key ?? '', 'releases')}>Back to releases</Link>
          </Button>
        )}
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1 px-2">
          <Link to={projectUrl(currentProject.key, 'releases')}>
            <ChevronLeft className="size-4" /> Releases
          </Link>
        </Button>
        <span className="flex-1" />
        <CopyReleaseLink projectKey={currentProject.key} slug={version.slug} />
      </div>

      <PageHeader
        title={version.name}
        description={version.description || `Release in ${currentProject.name}`}
        actions={(
          <span
            className={cn(
              'rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
              version.status === 'released' ? 'bg-success-muted text-success' : 'bg-muted text-muted-foreground',
            )}
          >
            {version.status}
          </span>
        )}
      />

      <Card className="mb-5 p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
              <span>Issues complete</span>
              <span className="tabular-nums">{version.done_count}/{version.issue_count} · {pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
          <div className="text-sm text-muted-foreground md:text-right">
            Release date: {formatDate(version.release_date)}
          </div>
        </div>
      </Card>

      {issues.length === 0 ? (
        <EmptyState icon={Package} title="No issues in this release" />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {issues.map((issue) => (
              <li key={issue.id}>
                <Link to={issueUrl(issue.issue_key)} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60">
                  <TypeIcon type={issue.type} />
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                  {issue.sprint_name && issue.type !== 'subtask' && issue.type !== 'epic' && (
                    <SprintBadge name={issue.sprint_name} className="hidden shrink-0 md:inline-block" />
                  )}
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
