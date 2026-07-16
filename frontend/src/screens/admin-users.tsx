import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Copy, Plus, Search, UserX } from 'lucide-react';
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { ROLE_LABEL } from '@/lib/domain';
import type { Role, User } from '@/lib/types';
import { ErrorState, PageHeader, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { formatDate, timeAgo } from '@/lib/format';

const ROLES: Role[] = ['admin', 'board_admin', 'user', 'client'];

function CreateUserDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setRole('user');
      setCreated(null);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const u = await api.users.create({ name: name.trim(), email: email.trim(), role });
      // The generated password is shown once — it is only ever stored hashed.
      setCreated({ email: u.email, password: u.initial_password });
      onCreated();
    } catch (err) {
      toast.error('Could not create user', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                Copy this password now — it is stored hashed and cannot be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Email:</span> <span className="font-mono">{created.email}</span>
              </p>
              <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-sm">{created.password}</code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Copy password"
                  onClick={() => {
                    void navigator.clipboard.writeText(created.password);
                    toast.success('Password copied');
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
              <DialogDescription>A one-time password is generated for the new account.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="u-name">Name</Label>
                <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-email">Email</Label>
                <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting || !name.trim() || !email.trim()}>Create user</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminUsersScreen() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.users.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, query]);

  async function changeRole(u: User, role: Role) {
    const previous = users;
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)));
    try {
      await api.users.update(u.id, { role });
      toast.success(`${u.name} is now ${ROLE_LABEL[role]}`);
    } catch (e) {
      setUsers(previous);
      toast.error('Could not change role', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function deactivate(u: User) {
    try {
      await api.users.deactivate(u.id);
      toast.success(`${u.name} deactivated`);
      void load();
    } catch (e) {
      toast.error('Could not deactivate user', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Users" />
        <RowsSkeleton />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Users" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Users"
        description={`${users.length} account${users.length === 1 ? '' : 's'}`}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Create user
          </Button>
        }
      />

      <div className="relative mb-4 max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users…"
          className="pl-8"
          aria-label="Search users"
        />
      </div>

      <Card className="overflow-x-auto py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead className="w-40">Role</TableHead>
              <TableHead className="hidden lg:table-cell">Last login</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((u) => (
              <TableRow key={u.id} className={u.is_active ? undefined : 'opacity-50'}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={u.name} color={u.avatar_color} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {u.name}
                        {u.id === me?.id && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                        {!u.is_active && <span className="ml-1.5 text-xs text-destructive">inactive</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <p className="text-sm">{u.department || '—'}</p>
                  <p className="text-xs text-muted-foreground">{u.job_title || ''}</p>
                </TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    onValueChange={(v) => changeRole(u, v as Role)}
                    disabled={u.id === me?.id}
                  >
                    <SelectTrigger className="h-8 w-full text-xs" aria-label={`Role for ${u.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">{ROLE_LABEL[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  {u.last_login ? timeAgo(u.last_login) : 'Never'}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                  {formatDate(u.created_at)}
                </TableCell>
                <TableCell>
                  {u.id !== me?.id && Boolean(u.is_active) && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Deactivate ${u.name}`}>
                          <UserX className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Deactivate {u.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They will not be able to sign in. Their issues and comments are kept.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deactivate(u)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Deactivate
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </>
  );
}
