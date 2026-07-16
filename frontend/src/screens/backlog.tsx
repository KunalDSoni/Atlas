import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListTodo, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { useSettings } from '@/hooks/use-settings';
import { STATUSES, STATUS_LABEL, canCreateIssues } from '@/lib/domain';
import type { Issue, Sprint } from '@/lib/types';
import {
  EmptyState, ErrorState, LabelChip, PageHeader, PriorityIcon, RowsSkeleton, StatusPill, TypeIcon, UserAvatar,
} from '@/components/app/primitives';
import { IssueDetailSheet } from '@/components/app/issue-detail-sheet';
import { CreateIssueDialog } from '@/components/app/create-issue-dialog';
import { cn } from '@/lib/utils';

export default function BacklogScreen() {
  const { user } = useAuth();
  const { compact } = useSettings();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [i, sp] = await Promise.all([api.issues.list(currentProjectId), api.sprints.list(currentProjectId)]);
      setIssues(i);
      setSprints(sp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backlog');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The backlog is everything not committed to a sprint.
  const backlog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues
      .filter((i) => !i.sprint_id)
      .filter((i) => (statusFilter === 'all' ? true : i.status === statusFilter))
      .filter((i) => !q || i.title.toLowerCase().includes(q) || i.issue_key.toLowerCase().includes(q));
  }, [issues, query, statusFilter]);

  const points = backlog.reduce((sum, i) => sum + (i.story_points ?? 0), 0);

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Backlog" />
        <RowsSkeleton />
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Backlog" />
        <EmptyState icon={ListTodo} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Backlog" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Backlog"
        description={`${backlog.length} issue${backlog.length === 1 ? '' : 's'} · ${points} point${points === 1 ? '' : 's'} unplanned`}
        actions={
          canCreateIssues(user?.role) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search backlog…"
            className="pl-8"
            aria-label="Search backlog"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {backlog.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="Backlog is empty"
          description={
            query || statusFilter !== 'all'
              ? 'No issues match your filters.'
              : `Every issue in ${currentProject?.name ?? 'this project'} is assigned to a sprint.`
          }
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {backlog.map((issue) => (
              <li key={issue.id}>
                <button
                  onClick={() => setOpenIssueId(issue.id)}
                  className={cn('flex w-full items-center gap-3 px-4 text-left transition-colors hover:bg-muted/60', compact ? 'py-1.5' : 'py-2.5')}
                >
                  <TypeIcon type={issue.type} />
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                  {issue.labels_parsed?.slice(0, 2).map((l) => (
                    <span key={l} className="hidden lg:block">
                      <LabelChip>{l}</LabelChip>
                    </span>
                  ))}
                  <PriorityIcon priority={issue.priority} />
                  {issue.story_points != null && (
                    <span className="hidden size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground sm:grid">
                      {issue.story_points}
                    </span>
                  )}
                  <StatusPill status={issue.status} className="hidden shrink-0 md:inline-flex" />
                  {issue.assignee_name ? (
                    <UserAvatar name={issue.assignee_name} color={issue.assignee_color} />
                  ) : (
                    <span className="size-6 shrink-0 rounded-full border border-dashed border-border" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <IssueDetailSheet
        issueId={openIssueId}
        onOpenChange={(o) => !o && setOpenIssueId(null)}
        onChanged={load}
        onOpenIssue={setOpenIssueId}
      />
      <CreateIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={currentProjectId}
        sprints={sprints}
        onCreated={load}
      />
    </>
  );
}
