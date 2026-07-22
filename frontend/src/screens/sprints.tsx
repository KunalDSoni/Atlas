import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarRange, Plus, Rocket, Trash2 } from 'lucide-react';
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
import type { Sprint, SprintStatus } from '@/lib/types';
import { CardsSkeleton, EmptyState, ErrorState, PageHeader } from '@/components/app/primitives';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

// Must match the sprints.status CHECK constraint in backend/database.js — an
// unlisted value is rejected by the DB, not silently stored.
const SPRINT_STATUSES: SprintStatus[] = ['planning', 'active', 'completed'];

function SprintCard({
  sprint,
  canManage,
  onChanged,
}: {
  sprint: Sprint;
  canManage: boolean;
  onChanged: () => void;
}) {
  const pct = sprint.issue_count ? Math.round((sprint.done_count / sprint.issue_count) * 100) : 0;

  async function setStatus(status: SprintStatus) {
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
          <CardTitle className="text-base">{sprint.name}</CardTitle>
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

        {canManage && (
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
                    <SprintCard key={s.id} sprint={s} canManage={canManage} onChanged={load} />
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
    </>
  );
}
