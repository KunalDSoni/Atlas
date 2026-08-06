import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { TYPE_LABEL } from '@/lib/domain';
import type { Issue, IssueType } from '@/lib/types';
import { TypeIcon } from './primitives';
import { useAuth } from '@/hooks/use-auth';
import { useProjects } from '@/hooks/use-projects';
import { MentionAutocomplete } from './mention-autocomplete';

const TYPES: IssueType[] = ['story', 'task', 'bug', 'epic', 'subtask'];

/** `2026-07-22 09:47:02` and ISO timestamps both render as `2026-07-22`. */
function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/**
 * Edits the fields nothing else in the UI can reach: title, description, type,
 * story points and the two dates. Status, assignee, priority, sprint, epic,
 * version, component and epic colour stay in the detail sheet's sidebar — one
 * control per field, not two.
 */
export function EditIssueDialog({
  issue,
  open,
  onOpenChange,
  onSaved,
}: {
  issue: Issue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IssueType>('task');
  const [points, setPoints] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const { currentProject } = useProjects();
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Seed the form from the issue each time the dialog opens, so reopening
  // after a cancelled edit shows what is actually stored.
  useEffect(() => {
    if (!open) return;
    setTitle(issue.title);
    setDescription(issue.description ?? '');
    setType(issue.type);
    setPoints(issue.story_points != null ? String(issue.story_points) : '');
    setStartDate(toDateInput(issue.start_date));
    setDueDate(toDateInput(issue.due_date));
    setError(null);
  }, [open, issue]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.issues.update(issue.id, {
        title: title.trim(),
        description: description.trim() || null,
        type,
        story_points: points ? Number(points) : null,
        start_date: startDate || null,
        due_date: dueDate || null,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      // The server rejects type changes that would orphan children
      // (validateHierarchy in backend/routes/issues.js). Keep the dialog open
      // and show why, rather than dropping the edit into a toast.
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit {issue.issue_key}</DialogTitle>
            <DialogDescription>Change what this issue says.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-issue-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as IssueType)}>
                <SelectTrigger id="edit-issue-type" aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      <span className="flex items-center gap-2">
                        <TypeIcon type={t} />
                        {TYPE_LABEL[t]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-issue-title">Title</Label>
              <Input
                id="edit-issue-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-issue-desc">Description</Label>
              {user && currentProject && (
                <MentionAutocomplete
                  projectId={currentProject.id}
                  authorId={user.id}
                  onMentionInsert={(mentionText) => {
                    if (descriptionRef.current) {
                      const start = descriptionRef.current.selectionStart || 0;
                      const end = descriptionRef.current.selectionEnd || 0;
                      const text = descriptionRef.current.value;
                      let atIndex = start - 1;
                      while (atIndex >= 0 && /[a-zA-Z0-9\s]/.test(text[atIndex])) {
                        atIndex--;
                      }
                      const beforeMention = text.substring(0, atIndex + 1);
                      const afterMention = text.substring(end);
                      setDescription(beforeMention + mentionText + afterMention);
                    }
                  }}
                >
                  <Textarea
                    ref={descriptionRef}
                    id="edit-issue-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What needs to happen?"
                    rows={5}
                  />
                </MentionAutocomplete>
              )}
              {(!user || !currentProject) && (
                <Textarea
                  ref={descriptionRef}
                  id="edit-issue-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What needs to happen?"
                  rows={5}
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-issue-points">Points</Label>
                <Input
                  id="edit-issue-points"
                  type="number"
                  min="0"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-issue-start">Start</Label>
                <Input
                  id="edit-issue-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-issue-due">Due</Label>
                <Input
                  id="edit-issue-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
