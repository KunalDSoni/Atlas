import { useCallback, useEffect, useMemo, useState } from 'react';
import { Columns3, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { STATUS_LABEL, STATUSES, canCreateIssues, canDragIssues } from '@/lib/domain';
import type { Issue, IssueStatus, Sprint } from '@/lib/types';
import { EmptyState, ErrorState, LabelChip, PageHeader, PriorityIcon, TypeIcon, UserAvatar } from '@/components/app/primitives';
import { cn } from '@/lib/utils';
import { IssueDetailSheet } from '@/components/app/issue-detail-sheet';
import { CreateIssueDialog } from '@/components/app/create-issue-dialog';

function IssueCard({
  issue,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  issue: Issue;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', issue.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${issue.issue_key}: ${issue.title}`}
      className={cn(
        'group cursor-pointer rounded-md border border-border bg-card p-2.5 shadow-card transition-all',
        'hover:border-primary/40 hover:shadow-raised focus-visible:outline-2 focus-visible:outline-ring',
        draggable && 'active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <p className="mb-2 line-clamp-3 text-sm leading-snug">{issue.title}</p>

      {issue.labels_parsed?.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {issue.labels_parsed.slice(0, 3).map((l) => (
            <LabelChip key={l}>{l}</LabelChip>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <TypeIcon type={issue.type} />
        <PriorityIcon priority={issue.priority} />
        <span className="font-mono text-[11px] text-muted-foreground">{issue.issue_key}</span>
        {issue.story_points != null && (
          <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
            {issue.story_points}
          </span>
        )}
        <span className="flex-1" />
        {issue.assignee_name ? (
          <UserAvatar name={issue.assignee_name} color={issue.assignee_color} className="size-5" />
        ) : (
          <span className="size-5 rounded-full border border-dashed border-border" />
        )}
      </div>
    </article>
  );
}

export default function BoardScreen() {
  const { user } = useAuth();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintFilter, setSprintFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<IssueStatus | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const canDrag = canDragIssues(user?.role);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [i, sp] = await Promise.all([api.issues.list(currentProjectId), api.sprints.list(currentProjectId)]);
      setIssues(i);
      setSprints(sp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues.filter((i) => {
      if (sprintFilter === 'backlog' && i.sprint_id) return false;
      if (sprintFilter !== 'all' && sprintFilter !== 'backlog' && i.sprint_id !== sprintFilter) return false;
      if (!q) return true;
      return i.title.toLowerCase().includes(q) || i.issue_key.toLowerCase().includes(q);
    });
  }, [issues, sprintFilter, query]);

  const columns = useMemo(() => {
    const map = {} as Record<IssueStatus, Issue[]>;
    STATUSES.forEach((s) => (map[s] = []));
    visible.forEach((i) => map[i.status]?.push(i));
    STATUSES.forEach((s) => map[s].sort((a, b) => (a.board_order ?? 0) - (b.board_order ?? 0)));
    return map;
  }, [visible]);

  async function handleDrop(status: IssueStatus) {
    setDragOver(null);
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;

    const issue = issues.find((i) => i.id === id);
    if (!issue || issue.status === status) return;

    const previous = issues;
    // Optimistic: move the card immediately, roll back if the server disagrees.
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      await api.issues.move(id, { status, board_order: columns[status].length });
    } catch (e) {
      setIssues(previous);
      toast.error('Could not move issue', {
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    }
  }

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Board" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((s) => (
            <Skeleton key={s} className="h-72 rounded-lg" />
          ))}
        </div>
      </>
    );
  }

  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Board" />
        <EmptyState icon={Columns3} title="No project selected" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Board" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Board"
        description={currentProject?.name}
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
            placeholder="Search issues…"
            className="pl-8"
            aria-label="Search issues"
          />
        </div>
        <Select value={sprintFilter} onValueChange={setSprintFilter}>
          <SelectTrigger className="w-44" aria-label="Filter by sprint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All issues</SelectItem>
            <SelectItem value="backlog">Backlog only</SelectItem>
            {sprints.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STATUSES.map((status) => (
          <section
            key={status}
            onDragOver={(e) => {
              if (!canDrag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOver(status);
            }}
            onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              void handleDrop(status);
            }}
            aria-label={STATUS_LABEL[status]}
            className={cn(
              'flex min-h-72 flex-col rounded-lg border border-transparent bg-surface p-2 transition-colors',
              dragOver === status && 'border-primary/50 bg-primary-muted/60',
            )}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {STATUS_LABEL[status]}
              </h2>
              <span className="rounded bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {columns[status].length}
              </span>
            </header>

            <div className="flex flex-1 flex-col gap-2">
              {columns[status].map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  draggable={canDrag}
                  dragging={draggingId === issue.id}
                  onOpen={() => setOpenIssueId(issue.id)}
                  onDragStart={() => setDraggingId(issue.id)}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
              {columns[status].length === 0 && (
                <p className="grid flex-1 place-items-center rounded-md border border-dashed border-border text-xs text-faint">
                  {dragOver === status ? 'Drop here' : 'No issues'}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      <IssueDetailSheet
        issueId={openIssueId}
        onOpenChange={(open) => !open && setOpenIssueId(null)}
        onChanged={load}
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
