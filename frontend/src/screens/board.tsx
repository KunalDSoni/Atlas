import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { issueUrl } from '@/lib/urls';
import { useLiveEvents } from '@/hooks/use-live-events';
import { ArrowDown, ArrowUp, Check, Columns3, Plus, Rows3, Search, SlidersHorizontal, Trash2, Workflow, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { useSettings } from '@/hooks/use-settings';
import { useWorkflow } from '@/hooks/use-workflow';
import { STATUSES, canCreateIssues, canDragIssues, canManageSprints, statusTone } from '@/lib/domain';
import type { Issue, IssueStatus, Sprint, StatusCategory } from '@/lib/types';
import { EmptyState, EpicBadge, ErrorState, LabelChip, PageHeader, PriorityIcon, SubtaskProgress, TypeIcon, UserAvatar } from '@/components/app/primitives';
import { cn } from '@/lib/utils';
import { CreateIssueDialog } from '@/components/app/create-issue-dialog';

const NO_SWIMLANE = 'none';

function IssueCard({
  issue,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
  compact,
  selectMode,
  selected,
}: {
  issue: Issue;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging: boolean;
  compact: boolean;
  selectMode: boolean;
  selected: boolean;
}) {
  return (
    <article
      draggable={draggable && !selectMode}
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
      data-issue-key={issue.issue_key}
      data-issue-id={issue.id}
      aria-label={`${issue.issue_key}: ${issue.title}`}
      className={cn(
        'group relative cursor-pointer rounded-md border border-border bg-card shadow-card transition-all',
        compact ? 'p-1.5' : 'p-2.5',
        'hover:border-primary/40 hover:shadow-raised focus-visible:outline-2 focus-visible:outline-ring',
        draggable && !selectMode && 'active:cursor-grabbing',
        dragging && 'opacity-40',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      {selectMode && (
        <span
          className={cn(
            'absolute right-2 top-2 grid size-4 place-items-center rounded border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
          )}
          aria-hidden
        >
          {selected && <Check className="size-3" />}
        </span>
      )}
      <p className={cn('line-clamp-3 text-sm leading-snug', compact ? 'mb-1.5' : 'mb-2', selectMode && 'pr-5')}>{issue.title}</p>

      {!compact && issue.labels_parsed?.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {issue.labels_parsed.slice(0, 3).map((l) => (
            <LabelChip key={l}>{l}</LabelChip>
          ))}
        </div>
      )}

      {issue.epic_key && (
        <div className={compact ? 'mb-1' : 'mb-1.5'}>
          <EpicBadge name={issue.epic_title ?? issue.epic_key} color={issue.epic_badge_color} />
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
        <SubtaskProgress done={issue.subtask_done_count} total={issue.subtask_count} />
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
  const { compact } = useSettings();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintFilter, setSprintFilter] = useState<string>('all');
  const [swimlane, setSwimlane] = useState<string>(NO_SWIMLANE);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<IssueStatus | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wipOpen, setWipOpen] = useState(false);
  const [wipDraft, setWipDraft] = useState<Record<string, string>>({});
  const [wipOverride, setWipOverride] = useState<Record<string, number> | null>(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [newStatusCategory, setNewStatusCategory] = useState<StatusCategory>('in_progress');
  const location = useLocation();
  const navigate = useNavigate();
  const workflow = useWorkflow(currentProjectId);

  const canDrag = canDragIssues(user?.role);
  const canAdmin = canManageSprints(user?.role);

  // Opening an issue is a navigation now. `background` is what tells
  // ProjectScope there is a board underneath to layer the drawer over; a
  // pasted link has no such state and renders the full page instead.
  const openIssue = (issue: Issue) =>
    navigate(issueUrl(issue.issue_key), { state: { background: location } });

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

  // Live updates: when anyone changes an issue in this project, refresh the board
  // in the background (no spinner) so teammates see each other's moves.
  useLiveEvents((e) => {
    if (e.type === 'issue' && e.projectId === currentProjectId) {
      api.issues.list(currentProjectId).then(setIssues).catch(() => undefined);
    }
  });

  // Per-status WIP limits from the project record (admin-editable), 0/absent = no limit.
  const wipLimits = useMemo<Record<string, number>>(() => {
    if (wipOverride) return wipOverride;
    try {
      return JSON.parse(currentProject?.wip_limits || '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }, [currentProject, wipOverride]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues.filter((i) => {
      if (i.type === 'epic' || i.type === 'subtask') return false;
      if (sprintFilter === 'backlog' && i.sprint_id) return false;
      if (sprintFilter !== 'all' && sprintFilter !== 'backlog' && i.sprint_id !== sprintFilter) return false;
      if (!q) return true;
      return i.title.toLowerCase().includes(q) || i.issue_key.toLowerCase().includes(q);
    });
  }, [issues, sprintFilter, query]);

  // Swimlanes: group the visible issues; each lane renders its own 4 columns.
  const lanes = useMemo(() => {
    if (swimlane === NO_SWIMLANE) return [{ key: '__all__', label: null as string | null, issues: visible }];
    const groups = new Map<string, { label: string; issues: Issue[] }>();
    for (const i of visible) {
      const key =
        swimlane === 'assignee'
          ? (i.assignee_id ?? '__unassigned__')
          : (i.parent_id && i.epic_title ? i.parent_id : '__no_epic__');
      const label =
        swimlane === 'assignee'
          ? (i.assignee_name ?? 'Unassigned')
          : (i.epic_title ?? 'No epic');
      if (!groups.has(key)) groups.set(key, { label, issues: [] });
      groups.get(key)!.issues.push(i);
    }
    return [...groups.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([key, g]) => ({ key, label: g.label as string | null, issues: g.issues }));
  }, [visible, swimlane]);

  const columnsFor = useCallback((laneIssues: Issue[]) => {
    const map = {} as Record<IssueStatus, Issue[]>;
    workflow.keys.forEach((s) => (map[s] = []));
    laneIssues.forEach((i) => map[i.status]?.push(i));
    workflow.keys.forEach((s) => map[s].sort((a, b) => (a.board_order ?? 0) - (b.board_order ?? 0)));
    return map;
  }, [workflow.keys]);

  // Column totals across all lanes (WIP limits are per status, not per lane).
  const statusTotals = useMemo(() => {
    const totals = {} as Record<IssueStatus, number>;
    workflow.keys.forEach((s) => (totals[s] = 0));
    visible.forEach((i) => { totals[i.status] = (totals[i.status] ?? 0) + 1; });
    return totals;
  }, [visible, workflow.keys]);

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
      await api.issues.move(id, { status, board_order: statusTotals[status] });
    } catch (e) {
      setIssues(previous);
      toast.error('Could not move issue', {
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function bulkUpdate(body: Partial<Issue>) {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => api.issues.update(id, body)));
      toast.success(`Updated ${ids.length} issue${ids.length === 1 ? '' : 's'}`);
      exitSelectMode();
      void load();
    } catch (e) {
      toast.error('Bulk update failed', { description: e instanceof Error ? e.message : undefined });
      void load();
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => api.issues.remove(id)));
      toast.success(`Deleted ${ids.length} issue${ids.length === 1 ? '' : 's'}`);
      exitSelectMode();
      void load();
    } catch (e) {
      toast.error('Bulk delete failed', { description: e instanceof Error ? e.message : undefined });
      void load();
    }
  }

  function openWipDialog() {
    const draft: Record<string, string> = {};
    workflow.keys.forEach((s) => { draft[s] = wipLimits[s] ? String(wipLimits[s]) : ''; });
    setWipDraft(draft);
    setWipOpen(true);
  }

  async function saveWipLimits() {
    if (!currentProjectId) return;
    const limits: Record<string, number> = {};
    workflow.keys.forEach((s) => {
      const n = parseInt(wipDraft[s] ?? '', 10);
      if (Number.isFinite(n) && n > 0) limits[s] = n;
    });
    try {
      await api.projects.update(currentProjectId, { wip_limits: JSON.stringify(limits) });
      setWipOverride(limits);
      setWipOpen(false);
      toast.success('WIP limits saved');
    } catch (e) {
      toast.error('Could not save WIP limits', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function addStatus() {
    if (!currentProjectId || !newStatusLabel.trim()) return;
    try {
      await api.workflow.create(currentProjectId, { label: newStatusLabel.trim(), category: newStatusCategory });
      setNewStatusLabel('');
      await workflow.reload();
      toast.success('Status added');
    } catch (e) {
      toast.error('Could not add status', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function moveStatus(id: string, dir: -1 | 1) {
    const list = workflow.statuses;
    const idx = list.findIndex((s) => s.id === id);
    const other = list[idx + dir];
    if (idx < 0 || !other) return;
    try {
      await Promise.all([
        api.workflow.update(list[idx].id, { position: other.position }),
        api.workflow.update(other.id, { position: list[idx].position }),
      ]);
      await workflow.reload();
    } catch (e) {
      toast.error('Could not reorder', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function deleteStatus(id: string) {
    try {
      await api.workflow.remove(id);
      await workflow.reload();
      void load();
      toast.success('Status removed — its issues moved to the first remaining column');
    } catch (e) {
      toast.error('Could not delete status', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function setStatusCategory(id: string, category: StatusCategory) {
    try {
      await api.workflow.update(id, { category });
      await workflow.reload();
    } catch (e) {
      toast.error('Could not update category', { description: e instanceof Error ? e.message : undefined });
    }
  }

  const members = useMemo(() => {
    const seen = new Map<string, { name: string }>();
    issues.forEach((i) => {
      if (i.assignee_id && i.assignee_name) seen.set(i.assignee_id, { name: i.assignee_name });
    });
    return [...seen.entries()].map(([id, m]) => ({ id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

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
          <SelectTrigger className="w-40" aria-label="Filter by sprint">
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
        <Select value={swimlane} onValueChange={setSwimlane}>
          <SelectTrigger className="w-40" aria-label="Swimlanes">
            <Rows3 className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SWIMLANE}>No swimlanes</SelectItem>
            <SelectItem value="assignee">By assignee</SelectItem>
            <SelectItem value="epic">By epic</SelectItem>
          </SelectContent>
        </Select>
        {canDrag && (
          <Button
            variant={selectMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          >
            <Check className="size-4" /> {selectMode ? 'Done' : 'Select'}
          </Button>
        )}
        {canAdmin && (
          <Button variant="outline" size="icon" onClick={openWipDialog} aria-label="WIP limits" title="WIP limits">
            <SlidersHorizontal className="size-4" />
          </Button>
        )}
        {canAdmin && (
          <Button variant="outline" size="icon" onClick={() => setWorkflowOpen(true)} aria-label="Edit workflow" title="Edit workflow">
            <Workflow className="size-4" />
          </Button>
        )}
      </div>

      <div className="space-y-6">
        {lanes.map((lane) => {
          const columns = columnsFor(lane.issues);
          return (
            <div key={lane.key}>
              {lane.label && (
                <h3 className="mb-2 text-sm font-semibold">
                  {lane.label}{' '}
                  <span className="text-xs font-normal text-muted-foreground">({lane.issues.length})</span>
                </h3>
              )}
              <div className={cn('grid gap-3 md:grid-cols-2', `board-columns-${workflow.keys.length}`)}>
                <style>{`@media (min-width: 1280px) { .board-columns-${workflow.keys.length} { grid-template-columns: repeat(${workflow.keys.length}, minmax(0, 1fr)); } }`}</style>
                {workflow.statuses.map((ws) => {
                  const status = ws.key;
                  const limit = wipLimits[status];
                  const over = limit ? statusTotals[status] > limit : false;
                  return (
                    <section
                      key={status}
                      onDragOver={(e) => {
                        if (!canDrag || selectMode) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOver(status);
                      }}
                      onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
                      onDrop={(e) => {
                        e.preventDefault();
                        void handleDrop(status);
                      }}
                      aria-label={ws.label}
                      className={cn(
                        'flex min-h-40 flex-col rounded-lg border border-transparent bg-surface p-2 transition-colors',
                        swimlane === NO_SWIMLANE && 'min-h-72',
                        dragOver === status && 'border-primary/50 bg-primary-muted/60',
                        over && 'border-destructive/40',
                      )}
                    >
                      <header className="mb-2 flex items-center justify-between px-1">
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {ws.label}
                        </h2>
                        <span
                          className={cn(
                            'rounded bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground',
                            over && 'bg-destructive-muted text-destructive',
                          )}
                          title={limit ? `WIP limit ${limit}` : undefined}
                        >
                          {swimlane === NO_SWIMLANE ? statusTotals[status] : columns[status].length}
                          {limit ? `/${limit}` : ''}
                        </span>
                      </header>

                      <div className="flex flex-1 flex-col gap-2">
                        {columns[status].map((issue) => (
                          <IssueCard
                            key={issue.id}
                            issue={issue}
                            draggable={canDrag}
                            dragging={draggingId === issue.id}
                            onOpen={() => (selectMode ? toggleSelected(issue.id) : openIssue(issue))}
                            onDragStart={() => setDraggingId(issue.id)}
                            onDragEnd={() => setDraggingId(null)}
                            compact={compact}
                            selectMode={selectMode}
                            selected={selected.has(issue.id)}
                          />
                        ))}
                        {columns[status].length === 0 && (
                          <p className="grid flex-1 place-items-center rounded-md border border-dashed border-border text-xs text-faint">
                            {dragOver === status ? 'Drop here' : 'No issues'}
                          </p>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bulk edit action bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-raised">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select value="" onValueChange={(v) => void bulkUpdate({ status: v as IssueStatus })}>
            <SelectTrigger className="w-36" aria-label="Set status">
              <SelectValue placeholder="Set status…" />
            </SelectTrigger>
            <SelectContent>
              {workflow.statuses.map((s) => (
                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value="" onValueChange={(v) => void bulkUpdate({ assignee_id: v === '__unassigned__' ? null : v })}>
            <SelectTrigger className="w-36" aria-label="Set assignee">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdminRole(user?.role) && (
            <Button variant="outline" size="sm" className="text-destructive" onClick={bulkDelete}>
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={exitSelectMode} aria-label="Clear selection">
            <X className="size-4" />
          </Button>
        </div>
      )}

      <Dialog open={workflowOpen} onOpenChange={setWorkflowOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Workflow · {currentProject?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Columns on this project's board. Adding a status converts the project to a custom
            workflow; deleting one moves its issues to the first remaining column.
          </p>
          <ul className="space-y-2">
            {workflow.statuses.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className={cn('inline-flex min-w-0 flex-1 items-center rounded-sm px-2 py-1 text-xs font-semibold uppercase tracking-wide', statusTone(s.key, workflow.statuses))}>
                  <span className="truncate">{s.label}</span>
                </span>
                <Select
                  value={s.category}
                  onValueChange={(v) => void setStatusCategory(s.id, v as StatusCategory)}
                  disabled={s.builtin}
                >
                  <SelectTrigger className="w-32" aria-label={`Category for ${s.label}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To do</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="size-7" disabled={s.builtin || i === 0} onClick={() => void moveStatus(s.id, -1)} aria-label={`Move ${s.label} up`}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" disabled={s.builtin || i === workflow.statuses.length - 1} onClick={() => void moveStatus(s.id, 1)} aria-label={`Move ${s.label} down`}>
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" disabled={s.builtin || workflow.statuses.length <= 1} onClick={() => void deleteStatus(s.id)} aria-label={`Delete ${s.label}`}>
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={newStatusLabel}
              onChange={(e) => setNewStatusLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addStatus();
                }
              }}
              placeholder="New status name…"
              aria-label="New status name"
            />
            <Select value={newStatusCategory} onValueChange={(v) => setNewStatusCategory(v as StatusCategory)}>
              <SelectTrigger className="w-32" aria-label="New status category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">To do</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={addStatus} disabled={!newStatusLabel.trim()}>Add</Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkflowOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wipOpen} onOpenChange={setWipOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>WIP limits</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Column counts turn red when a limit is exceeded. Leave blank for no limit.
          </p>
          <div className="space-y-3">
            {workflow.statuses.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <Label className="text-sm">{s.label}</Label>
                <Input
                  type="number"
                  min="0"
                  value={wipDraft[s.key] ?? ''}
                  onChange={(e) => setWipDraft((prev) => ({ ...prev, [s.key]: e.target.value }))}
                  className="w-24"
                  aria-label={`WIP limit for ${s.label}`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWipOpen(false)}>Cancel</Button>
            <Button onClick={saveWipLimits}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function isAdminRole(role?: string) {
  return role === 'admin' || role === 'board_admin';
}
