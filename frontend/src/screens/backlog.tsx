import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveEvents } from '@/hooks/use-live-events';
import { useLocation, useNavigate } from 'react-router-dom';
import { issueUrl } from '@/lib/urls';
import { BookmarkPlus, ListTodo, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { useSettings } from '@/hooks/use-settings';
import { useWorkflow } from '@/hooks/use-workflow';
import { TYPE_LABEL, canCreateIssues, statusTone } from '@/lib/domain';
import type { Issue, IssueType, SavedFilter, Sprint } from '@/lib/types';
import {
  EmptyState, EpicBadge, ErrorState, LabelChip, PageHeader, PriorityIcon, RowsSkeleton, StatusPill, SubtaskProgress, TypeIcon, UserAvatar,
} from '@/components/app/primitives';
import { CreateIssueDialog } from '@/components/app/create-issue-dialog';
import { cn } from '@/lib/utils';

export default function BacklogScreen() {
  const { user } = useAuth();
  const { compact } = useSettings();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();

  // Opening an issue is a navigation now — see ProjectScope for how the
  // `background` location decides drawer versus full page.
  const location = useLocation();
  const navigate = useNavigate();
  const openIssue = (issueKey: string) =>
    navigate(issueUrl(issueKey), { state: { background: location } });

  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [labelFilter, setLabelFilter] = useState('all');
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [selectedFilterId, setSelectedFilterId] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const workflow = useWorkflow(currentProjectId);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [i, sp, sf] = await Promise.all([
        api.issues.list(currentProjectId),
        api.sprints.list(currentProjectId),
        api.filters.list(currentProjectId).catch(() => []),
      ]);
      setIssues(i);
      setSprints(sp);
      // JQL filters have their own screen; this picker remains the compact
      // backlog-control preset it was before Epic 55.
      setSavedFilters(sf.filter((filter) => filter.params_parsed.kind === 'backlog'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backlog');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  // The drawer no longer belongs to this screen, so it can no longer hand back
  // an onChanged. Live events cover the same ground and also pick up a
  // teammate's edits, which onChanged never did.
  useLiveEvents((e) => {
    if (e.type === 'issue' && e.projectId === currentProjectId) void load();
  });

  useEffect(() => {
    void load();
  }, [load]);

  // The backlog is everything not committed to a sprint.
  const backlog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues
      .filter((i) => i.type !== 'epic' && i.type !== 'subtask')
      .filter((i) => !i.sprint_id)
      .filter((i) => (statusFilter === 'all' ? true : i.status === statusFilter))
      .filter((i) => (typeFilter === 'all' ? true : i.type === typeFilter))
      .filter((i) =>
        assigneeFilter === 'all'
          ? true
          : assigneeFilter === 'unassigned'
            ? !i.assignee_id
            : i.assignee_id === assigneeFilter)
      .filter((i) => (labelFilter === 'all' ? true : (i.labels_parsed ?? []).includes(labelFilter)))
      .filter((i) => !q || i.title.toLowerCase().includes(q) || i.issue_key.toLowerCase().includes(q));
  }, [issues, query, statusFilter, typeFilter, assigneeFilter, labelFilter]);

  // Filter options derived from the loaded issues themselves.
  const assignees = useMemo(() => {
    const seen = new Map<string, string>();
    issues.forEach((i) => {
      if (i.assignee_id && i.assignee_name) seen.set(i.assignee_id, i.assignee_name);
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

  const labels = useMemo(
    () => [...new Set(issues.flatMap((i) => i.labels_parsed ?? []))].sort(),
    [issues],
  );

  function applySavedFilter(f: SavedFilter) {
    const p = f.params_parsed;
    if (p.kind !== 'backlog') return;
    setQuery(p.query);
    setStatusFilter(p.status);
    setTypeFilter(p.type);
    setAssigneeFilter(p.assignee);
    setLabelFilter(p.label);
    setSelectedFilterId(f.id);
  }

  async function saveCurrentFilter() {
    if (!currentProjectId || !saveName.trim()) return;
    try {
      const created = await api.filters.create(currentProjectId, saveName.trim(), {
        kind: 'backlog',
        query, status: statusFilter, type: typeFilter, assignee: assigneeFilter, label: labelFilter,
      });
      setSavedFilters((prev) => [...prev, created]);
      setSelectedFilterId(created.id);
      setSaveOpen(false);
      setSaveName('');
      toast.success('Filter saved');
    } catch (e) {
      toast.error('Could not save filter', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function deleteSelectedFilter() {
    const f = savedFilters.find((x) => x.id === selectedFilterId);
    if (!f) return;
    try {
      await api.filters.remove(f.id);
      setSavedFilters((prev) => prev.filter((x) => x.id !== f.id));
      setSelectedFilterId('');
      toast.success('Filter deleted');
    } catch (e) {
      toast.error('Could not delete filter', { description: e instanceof Error ? e.message : undefined });
    }
  }

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
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {workflow.statuses.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(['story', 'task', 'bug'] as IssueType[]).map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-36" aria-label="Filter by assignee">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {assignees.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {labels.length > 0 && (
          <Select value={labelFilter} onValueChange={setLabelFilter}>
            <SelectTrigger className="w-32" aria-label="Filter by label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All labels</SelectItem>
              {labels.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {savedFilters.length > 0 && (
          <Select
            value={selectedFilterId}
            onValueChange={(id) => {
              const f = savedFilters.find((x) => x.id === id);
              if (f) applySavedFilter(f);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Saved filters">
              <SelectValue placeholder="Saved filters…" />
            </SelectTrigger>
            <SelectContent>
              {savedFilters.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="icon" aria-label="Save current filter" onClick={() => setSaveOpen(true)}>
          <BookmarkPlus className="size-4" />
        </Button>
        {selectedFilterId && (
          <Button variant="outline" size="icon" aria-label="Delete saved filter" onClick={deleteSelectedFilter}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        )}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save filter</DialogTitle>
          </DialogHeader>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveCurrentFilter();
              }
            }}
            placeholder="Filter name…"
            aria-label="Filter name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={saveCurrentFilter} disabled={!saveName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  onClick={() => openIssue(issue.issue_key)}
                  data-issue-key={issue.issue_key}
                  data-issue-id={issue.id}
                  className={cn('flex w-full items-center gap-3 px-4 text-left transition-colors hover:bg-muted/60', compact ? 'py-1.5' : 'py-2.5')}
                >
                  <TypeIcon type={issue.type} />
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                  {issue.epic_key && (
                    <span className="hidden md:block">
                      <EpicBadge name={issue.epic_title ?? issue.epic_key} color={issue.epic_badge_color} />
                    </span>
                  )}
                  {issue.labels_parsed?.slice(0, 2).map((l) => (
                    <span key={l} className="hidden lg:block">
                      <LabelChip>{l}</LabelChip>
                    </span>
                  ))}
                  <PriorityIcon priority={issue.priority} />
                  <SubtaskProgress done={issue.subtask_done_count} total={issue.subtask_count} className="hidden sm:inline-flex" />
                  {issue.story_points != null && (
                    <span className="hidden size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground sm:grid">
                      {issue.story_points}
                    </span>
                  )}
                  <StatusPill status={issue.status} label={workflow.label(issue.status)} tone={statusTone(issue.status, workflow.statuses)} className="hidden shrink-0 md:inline-flex" />
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
