import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { canCreateIssues, epicColor } from '@/lib/domain';
import type { EpicSummary } from '@/lib/types';
import {
  EmptyState, ErrorState, PageHeader, RowsSkeleton, StatusPill, UserAvatar,
} from '@/components/app/primitives';
import { IssueDetailSheet } from '@/components/app/issue-detail-sheet';
import { CreateIssueDialog } from '@/components/app/create-issue-dialog';
import { cn } from '@/lib/utils';

function EpicRow({ epic, onOpen }: { epic: EpicSummary; onOpen: () => void }) {
  const issuePct = epic.child_count === 0 ? 0 : Math.round((epic.done_count / epic.child_count) * 100);

  return (
    <button
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/60"
    >
      <span className={cn('size-3 shrink-0 rounded-sm', epicColor(epic.epic_color).swatch)} aria-hidden />
      <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{epic.issue_key}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{epic.title}</span>

      <span className="hidden w-44 shrink-0 items-center gap-2 sm:flex">
        <Progress value={issuePct} className="h-1.5" />
        <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
          {epic.done_count}/{epic.child_count}
        </span>
      </span>

      <span className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground md:block">
        {epic.done_points}/{epic.total_points} pts
      </span>

      <StatusPill status={epic.status} className="shrink-0" />
      {epic.assignee_name ? (
        <UserAvatar name={epic.assignee_name} color={epic.assignee_color} />
      ) : (
        <span className="size-6 shrink-0 rounded-full border border-dashed border-border" />
      )}
    </button>
  );
}

export default function EpicsScreen() {
  const { user } = useAuth();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [epics, setEpics] = useState<EpicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // ?issue=<id> deep-links an epic open (used by the command palette).
  useEffect(() => {
    const target = searchParams.get('issue');
    if (target) setOpenIssueId(target);
  }, [searchParams]);

  function closeIssue() {
    setOpenIssueId(null);
    if (searchParams.has('issue')) {
      searchParams.delete('issue');
      setSearchParams(searchParams, { replace: true });
    }
  }

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      setEpics(await api.epics.list(currentProjectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load epics');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Epics" />
        <RowsSkeleton />
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Epics" />
        <EmptyState icon={Zap} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Epics" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  const done = epics.filter((e) => e.status === 'done').length;

  return (
    <>
      <PageHeader
        title="Epics"
        description={`${epics.length} epic${epics.length === 1 ? '' : 's'} · ${done} done in ${currentProject?.name ?? 'this project'}`}
        actions={
          canCreateIssues(user?.role) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create epic
            </Button>
          )
        }
      />

      {epics.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No epics yet"
          description="Epics group related issues into larger bodies of work."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {epics.map((epic) => (
              <li key={epic.id}>
                <EpicRow epic={epic} onOpen={() => setOpenIssueId(epic.id)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <IssueDetailSheet
        issueId={openIssueId}
        onOpenChange={(o) => !o && closeIssue()}
        onChanged={load}
        onOpenIssue={setOpenIssueId}
      />
      <CreateIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={currentProjectId}
        sprints={[]}
        defaultType="epic"
        onCreated={load}
      />
    </>
  );
}
