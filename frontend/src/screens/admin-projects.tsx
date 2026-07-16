import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FolderKanban, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import type { Project, User } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { formatDate } from '@/lib/format';

const NO_LEAD = '__none__';

function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
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
      await api.projects.create({
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim() || undefined,
        lead_id: leadId === NO_LEAD ? undefined : leadId,
      });
      toast.success('Project created');
      onOpenChange(false);
      onCreated();
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

export default function AdminProjectsScreen() {
  const { reload: reloadProjectsContext } = useProjects();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.projects.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function afterChange() {
    await load();
    await reloadProjectsContext();
  }

  async function remove(p: Project) {
    try {
      await api.projects.remove(p.id);
      toast.success(`${p.name} deleted`);
      await afterChange();
    } catch (e) {
      toast.error('Could not delete project', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Projects" />
        <RowsSkeleton count={4} />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Projects" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${projects.length} project${projects.length === 1 ? '' : 's'}`}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Create project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Create project</Button>}
        />
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="hidden md:table-cell">Lead</TableHead>
                <TableHead className="text-right">Issues</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Members</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
                        {p.key.slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{p.key}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {p.lead_name ? (
                      <div className="flex items-center gap-2">
                        <UserAvatar name={p.lead_name} color={p.lead_color} className="size-5" />
                        <span className="truncate text-sm">{p.lead_name}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{p.issue_count}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums sm:table-cell">{p.member_count}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {formatDate(p.created_at)}
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Delete ${p.name}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes the project and all {p.issue_count} of its issues, sprints, and
                            comments. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => remove(p)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete project
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={afterChange} />
    </>
  );
}
