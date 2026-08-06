import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { SPRINT_TONE, canManageSprints } from '@/lib/domain';
import type { Issue, Sprint, SprintStatus } from '@/lib/types';
import { CardsSkeleton, EmptyState, ErrorState, PageHeader } from '@/components/app/primitives';
import { formatDate } from '@/lib/format';
import { sprintUrl } from '@/lib/urls';
import { cn } from '@/lib/utils';

// Must match the sprints.status CHECK constraint in backend/database.js — an
// unlisted value is rejected by the DB, not silently stored.
const SPRINT_STATUSES: SprintStatus[] = ['planning', 'active', 'completed'];

function SprintCard({
  sprint,
  projectKey,
  canManage,
  onEdit,
  onComplete,
  onChanged,
}: {
  sprint: Sprint;
  projectKey: string;
  canManage: boolean;
  onEdit: (sprint: Sprint) => void;
  onComplete: (sprint: Sprint) => void;
  onChanged: () => void;
}) {
  const pct = sprint.issue_count ? Math.round((sprint.done_count / sprint.issue_count) * 100) : 0;

  async function setStatus(status: SprintStatus) {
    if (status === 'completed' && sprint.status !== 'completed') {
      onComplete(sprint);
      return;
    }
    try {
      await api.sprints.update(sprint.id, { status });
      onChanged();
    } catch (e) {
      toast.error('Could not update sprint', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function remove() {
    try {
      await api.sprints.remove(sprint.id);
      toast.success('Sprint deleted', { description: 'Its issues moved back to the backlog.' });
      onChanged();
    } catch (e) {
      toast.error('Could not delete sprint', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="min-w-0 text-base">
            <Link
              to={sprintUrl(projectKey, sprint.slug)}
              data-sprint-slug={sprint.slug}
              className="block truncate transition-colors hover:text-primary"
            >
              {sprint.name}
            </Link>
          </CardTitle>
          <span
            className={cn(
              'shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
              SPRINT_TONE[sprint.status],
            )}
          >
            {sprint.status}
          </span>
        </div>
        {sprint.goal && <p className="line-clamp-2 text-sm text-muted-foreground">{sprint.goal}</p>}
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Issues</span>
            <span className="tabular-nums">
              {sprint.done_count}/{sprint.issue_count} · {pct}%
            </span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Story points</span>
          <span className="tabular-nums">
            {sprint.done_points}/{sprint.total_points}
          </span>
        </div>

        {(sprint.start_date || sprint.end_date) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" />
            {formatDate(sprint.start_date)} → {formatDate(sprint.end_date)}
          </p>
        )}

        {canManage && sprint.status !== 'completed' && (
          <div className="flex items-center gap-2 pt-1">
            <Select value={sprint.status} onValueChange={(v) => setStatus(v as SprintStatus)}>
              <SelectTrigger className="h-8 flex-1 text-xs" aria-label={`Status for ${sprint.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPRINT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onEdit(sprint)}
              aria-label={`Edit ${sprint.name}`}
              title="Edit sprint"
            >
              <Pencil className="size-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Delete ${sprint.name}`}>
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {sprint.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Issues in this sprint move back to the backlog. They are not deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={remove}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete sprint
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {canManage && sprint.status === 'completed' && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onEdit(sprint)}
              aria-label={`Edit ${sprint.name}`}
              title="Edit sprint"
            >
              <Pencil className="size-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Delete ${sprint.name}`}>
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {sprint.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Issues in this sprint move back to the backlog. They are not deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={remove}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete sprint
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditSprintDialog({
  sprint,
  onOpenChange,
  onSaved,
  onComplete,
}: {
  sprint: Sprint | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onComplete: (sprint: Sprint, updates: Partial<Sprint>) => void;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState<SprintStatus>('planning');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (sprint) {
      setName(sprint.name);
      setGoal(sprint.goal ?? '');
      setStart(sprint.start_date?.slice(0, 10) ?? '');
      setEnd(sprint.end_date?.slice(0, 10) ?? '');
      setStatus(sprint.status);
    }
  }, [sprint]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sprint || !name.trim()) return;
    const updates = {
      name: name.trim(),
      goal: goal.trim() || null,
      start_date: start || null,
      end_date: end || null,
      status,
    };
    if (status === 'completed' && sprint.status !== 'completed') {
      onComplete(sprint, updates);
      return;
    }
    setSubmitting(true);
    try {
      await api.sprints.update(sprint.id, updates);
      toast.success('Sprint updated');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error('Could not update sprint', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!sprint} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit sprint</DialogTitle>
            <DialogDescription>Update sprint details and status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-sprint-name">Name</Label>
              <Input
                id="edit-sprint-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-sprint-goal">Goal</Label>
              <Textarea
                id="edit-sprint-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-sprint-start">Start</Label>
                <Input id="edit-sprint-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-sprint-end">End</Label>
                <Input id="edit-sprint-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as SprintStatus)}>
                <SelectTrigger aria-label="Sprint status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPRINT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              Save sprint
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function unfinishedSummary(issues: Pick<Issue, 'type'>[]) {
  const counts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.type] = (acc[issue.type] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${count} ${count === 1 ? type : pluralIssueType(type)}`)
    .join(', ');
}

function pluralIssueType(type: string) {
  if (type === 'story') return 'stories';
  return `${type}s`;
}

function CompleteSprintDialog({
  pending,
  sprints,
  onCancel,
  onCompleted,
}: {
  pending: {
    sprint: Sprint;
    unfinished: Issue[];
    updates?: Partial<Sprint>;
  } | null;
  sprints: Sprint[];
  onCancel: () => void;
  onCompleted: () => void;
}) {
  const [destination, setDestination] = useState('backlog');
  const [submitting, setSubmitting] = useState(false);
  const destinationSprints = sprints.filter((s) => s.id !== pending?.sprint.id && s.status !== 'completed');

  useEffect(() => {
    if (pending) setDestination(destinationSprints[0]?.id ?? 'backlog');
    // Recompute only when a new completion flow opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.sprint.id]);

  async function complete() {
    if (!pending) return;
    setSubmitting(true);
    try {
      const sprintUpdates = pending.updates ?? { status: 'completed' as SprintStatus };
      const sprintPayload = { ...sprintUpdates, status: 'completed' as SprintStatus };
      await api.sprints.update(pending.sprint.id, sprintPayload);
      const sprint_id = destination === 'backlog' ? null : destination;
      await Promise.all(pending.unfinished.map((issue) => api.issues.update(issue.id, { sprint_id })));
      toast.success('Sprint completed', {
        description: destination === 'backlog' ? 'Unfinished work moved to backlog.' : 'Unfinished work moved to the selected sprint.',
      });
      onCompleted();
    } catch (err) {
      toast.error('Could not complete sprint', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !submitting) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete {pending?.sprint.name}?</DialogTitle>
          <DialogDescription>
            {pending?.unfinished.length
              ? `There are still ${pending.unfinished.length} unfinished issue${pending.unfinished.length === 1 ? '' : 's'} (${unfinishedSummary(pending.unfinished)}). Move them before closing the sprint.`
              : 'This sprint has no unfinished work.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Move unfinished work to</Label>
          <Select value={destination} onValueChange={setDestination}>
            <SelectTrigger aria-label="Move unfinished work to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {destinationSprints.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
              <SelectItem value="backlog">Backlog</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={complete} disabled={submitting}>
            Complete sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateSprintDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setGoal('');
      setStart('');
      setEnd('');
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await api.sprints.create(projectId, {
        name: name.trim(),
        goal: goal.trim() || null,
        start_date: start || null,
        end_date: end || null,
        status: 'planning',
      });
      toast.success('Sprint created');
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error('Could not create sprint', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create sprint</DialogTitle>
            <DialogDescription>Plan a new block of work.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="sprint-name">Name</Label>
              <Input
                id="sprint-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sprint 5"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sprint-goal">Goal</Label>
              <Textarea
                id="sprint-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What should this sprint achieve?"
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sprint-start">Start</Label>
                <Input id="sprint-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sprint-end">End</Label>
                <Input id="sprint-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              Create sprint
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SprintsScreen() {
  const { user } = useAuth();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
  const [completePending, setCompletePending] = useState<{
    sprint: Sprint;
    unfinished: Issue[];
    updates?: Partial<Sprint>;
  } | null>(null);

  const canManage = canManageSprints(user?.role);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      setSprints(await api.sprints.list(currentProjectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sprints');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestComplete = useCallback(async (sprint: Sprint, updates?: Partial<Sprint>) => {
    try {
      const issues = await api.issues.list(sprint.project_id, sprint.id);
      const unfinished = issues.filter((issue) => issue.status !== 'done');
      if (unfinished.length === 0) {
        await api.sprints.update(sprint.id, { ...(updates ?? {}), status: 'completed' });
        toast.success('Sprint completed');
        setEditingSprint(null);
        void load();
        return;
      }
      setCompletePending({ sprint, unfinished, updates });
    } catch (err) {
      toast.error('Could not inspect sprint work', { description: err instanceof Error ? err.message : undefined });
    }
  }, [load]);

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Sprints" />
        <CardsSkeleton count={3} />
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Sprints" />
        <EmptyState icon={Rocket} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Sprints" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  const active = sprints.filter((s) => s.status === 'active');
  const planned = sprints.filter((s) => s.status === 'planning');
  const completed = sprints.filter((s) => s.status === 'completed');

  return (
    <>
      <PageHeader
        title="Sprints"
        description={currentProject?.name}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New sprint
            </Button>
          )
        }
      />

      {sprints.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No sprints yet"
          description={canManage ? 'Create a sprint to start planning work.' : 'No sprints have been created.'}
          action={canManage && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New sprint</Button>}
        />
      ) : (
        <div className="space-y-6">
          {[
            { title: 'Active', items: active },
            { title: 'Planned', items: planned },
            { title: 'Completed', items: completed },
          ]
            .filter((g) => g.items.length > 0)
            .map((group) => (
              <section key={group.title}>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title} ({group.items.length})
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((s) => (
                    <SprintCard
                      key={s.id}
                      sprint={s}
                      projectKey={currentProject?.key ?? ''}
                      canManage={canManage}
                      onEdit={setEditingSprint}
                      onComplete={requestComplete}
                      onChanged={load}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}

      <CreateSprintDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={currentProjectId}
        onCreated={load}
      />
      <EditSprintDialog
        sprint={editingSprint}
        onOpenChange={(open) => { if (!open) setEditingSprint(null); }}
        onSaved={load}
        onComplete={requestComplete}
      />
      <CompleteSprintDialog
        pending={completePending}
        sprints={sprints}
        onCancel={() => setCompletePending(null)}
        onCompleted={() => {
          setCompletePending(null);
          setEditingSprint(null);
          void load();
        }}
      />
    </>
  );
}
