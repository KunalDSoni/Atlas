import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useMentions } from '@/hooks/use-mentions';
import { api } from '@/lib/api';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, TYPE_LABEL } from '@/lib/domain';
import type { IssueStatus, IssueType, Priority, Sprint, User } from '@/lib/types';
import { PriorityIcon, TypeIcon } from './primitives';

const UNASSIGNED = '__unassigned__';
const NO_SPRINT = '__backlog__';
const TYPES: IssueType[] = ['story', 'task', 'bug', 'epic'];

export function CreateIssueDialog({
  open,
  onOpenChange,
  projectId,
  sprints,
  defaultSprintId,
  defaultType = 'task',
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  sprints: Sprint[];
  defaultSprintId?: string | null;
  defaultType?: IssueType;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const mentions = useMentions({ projectId: projectId ?? undefined, value: description, onChange: setDescription });
  const [type, setType] = useState<IssueType>('task');
  const [status, setStatus] = useState<IssueStatus>('todo');
  const [priority, setPriority] = useState<Priority>('medium');
  const [assigneeId, setAssigneeId] = useState(UNASSIGNED);
  const [sprintId, setSprintId] = useState(NO_SPRINT);
  const [points, setPoints] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Reset to a clean form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setType(defaultType);
    setStatus('todo');
    setPriority('medium');
    setAssigneeId(UNASSIGNED);
    setSprintId(defaultSprintId ?? NO_SPRINT);
    setPoints('');
    api.users.list().then((u) => setUsers(u.filter((x) => x.is_active))).catch(() => setUsers([]));
  }, [open, defaultSprintId, defaultType]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !title.trim()) return;
    setSubmitting(true);
    try {
      await api.issues.create(projectId, {
        title: title.trim(),
        description: description.trim() || null,
        type,
        status,
        priority,
        assignee_id: assigneeId === UNASSIGNED ? null : assigneeId,
        sprint_id: type === 'epic' || sprintId === NO_SPRINT ? null : sprintId,
        story_points: points ? Number(points) : null,
      });
      toast.success('Issue created');
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast.error('Could not create issue', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create issue</DialogTitle>
            <DialogDescription>Add a new issue to this project.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="issue-title">Title</Label>
              <Input
                id="issue-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary of the work"
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="issue-desc">Description</Label>
              <Textarea
                ref={mentions.ref}
                id="issue-desc"
                value={description}
                {...mentions.inputProps}
                placeholder="Add more detail…"
                rows={3}
                className="resize-none"
              />
              {mentions.dropdown}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as IssueType)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        <span className="flex items-center gap-2"><TypeIcon type={t} />{TYPE_LABEL[t]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        <span className="flex items-center gap-2"><PriorityIcon priority={p} />{PRIORITY_LABEL[p]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="issue-points">Story points</Label>
                <Input
                  id="issue-points"
                  type="number"
                  min={0}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  placeholder="—"
                />
              </div>

              <div className="space-y-2">
                <Label>Assignee</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {type !== 'epic' && (
                <div className="space-y-2">
                  <Label>Sprint</Label>
                  <Select value={sprintId} onValueChange={setSprintId}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SPRINT}>Backlog</SelectItem>
                      {sprints.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Create issue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
