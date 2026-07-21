import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import type { Project, User } from '@/lib/types';

const NO_LEAD = '__none__';

/**
 * Shared by the admin projects screen and by the zero-project states, which are
 * the only way into the app on a fresh deployment — see `ProjectSwitcher`.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [leadId, setLeadId] = useState(NO_LEAD);
  const [users, setUsers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [keyEdited, setKeyEdited] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setKey('');
    setDescription('');
    setLeadId(NO_LEAD);
    setKeyEdited(false);
    // Listing users is admin-only; a board admin creating a project just gets
    // an empty lead picker rather than a broken dialog.
    api.users.list().then((u) => setUsers(u.filter((x) => x.is_active))).catch(() => setUsers([]));
  }, [open]);

  // Suggest a key from the name until the user takes over.
  function onNameChange(v: string) {
    setName(v);
    if (!keyEdited) {
      setKey(v.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase());
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const project = await api.projects.create({
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim() || undefined,
        lead_id: leadId === NO_LEAD ? undefined : leadId,
      });
      toast.success('Project created');
      onOpenChange(false);
      onCreated(project);
    } catch (err) {
      toast.error('Could not create project', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>The key prefixes every issue, e.g. ATL-1.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pr-name">Name</Label>
              <Input id="pr-name" value={name} onChange={(e) => onNameChange(e.target.value)} autoFocus required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-key">Key</Label>
              <Input
                id="pr-key"
                value={key}
                onChange={(e) => {
                  setKeyEdited(true);
                  setKey(e.target.value.toUpperCase());
                }}
                maxLength={6}
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-desc">Description</Label>
              <Textarea
                id="pr-desc"
                rows={2}
                className="resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Project lead</Label>
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LEAD}>No lead</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || !name.trim() || !key.trim()}>Create project</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
