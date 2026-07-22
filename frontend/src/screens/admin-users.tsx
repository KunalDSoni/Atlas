import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Pencil, Plus, Search, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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


/**
 * Everything about a user an admin may change.
 *
 * Split from the row's role dropdown deliberately: role is the one field
 * changed often enough to want inline, while name, email and the profile
 * fields are an occasional, deliberate edit that deserves a review step.
 */
function EditUserDialog({ user, onOpenChange, onSaved }: {
  user: User | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '', email: '', role: 'user' as Role,
    department: '', job_title: '', phone: '', timezone: '', bio: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name ?? '',
      email: user.email ?? '',
      role: user.role,
      department: user.department ?? '',
      job_title: user.job_title ?? '',
      phone: user.phone ?? '',
      timezone: user.timezone ?? '',
      bio: user.bio ?? '',
    });
  }, [user]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      await api.users.update(user.id, form);
      toast.success(`${form.name} updated`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      // The server owns the rules an admin can trip here — duplicate email,
      // last-admin demotion — so its message is the useful one.
      toast.error('Could not save', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {user?.name}</DialogTitle>
          <DialogDescription>Changes apply immediately across the app.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={form.name} onChange={set('name')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" type="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-role">Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}>
              <SelectTrigger id="edit-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-dept">Department</Label>
            <Input id="edit-dept" value={form.department} onChange={set('department')} placeholder="Engineering" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Job title</Label>
            <Input id="edit-title" value={form.job_title} onChange={set('job_title')} placeholder="Senior Engineer" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input id="edit-phone" value={form.phone} onChange={set('phone')} placeholder="+1-555-0100" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="edit-tz">Timezone</Label>
            <Input id="edit-tz" value={form.timezone} onChange={set('timezone')} placeholder="Europe/London" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="edit-bio">Bio</Label>
            <Textarea id="edit-bio" rows={3} value={form.bio} onChange={set('bio')} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Shows a one-time password exactly once.
 *
 * Same treatment as account creation, because it is the same fact: the server
 * stores only a hash, so this is the only moment the value is readable. If the
 * admin closes without copying it, the only way forward is another reset.
 */
function OneTimePasswordDialog({ result, onOpenChange }: {
  result: { email: string; password: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={!!result} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Password reset</DialogTitle>
          <DialogDescription>
            Copy this now — it is stored hashed and cannot be shown again. Any sessions
            they had open have been signed out.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-3">
          <p className="text-sm">
            <span className="text-muted-foreground">Email:</span>{' '}
            <span className="font-mono">{result?.email}</span>
          </p>
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-sm">{result?.password}</code>
            <Button
              size="icon" variant="ghost" className="size-7" aria-label="Copy password"
              onClick={() => {
                if (result) void navigator.clipboard.writeText(result.password);
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
  const [editing, setEditing] = useState<User | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null);

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

  async function resetPassword(u: User) {
    try {
      const res = await api.users.resetPassword(u.id);
      setResetResult({ email: res.email, password: res.password });
    } catch (e) {
      toast.error('Could not reset the password', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function reactivate(u: User) {
    try {
      await api.users.update(u.id, { is_active: 1 });
      toast.success(`${u.name} reactivated`);
      void load();
    } catch (e) {
      toast.error('Could not reactivate user', { description: e instanceof Error ? e.message : undefined });
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
                <TableCell className="whitespace-nowrap">
                  <Button
                    variant="ghost" size="icon" className="size-8"
                    aria-label={`Edit ${u.name}`}
                    onClick={() => setEditing(u)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Reset password for ${u.name}`}>
                        <KeyRound className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Reset {u.name}'s password?</AlertDialogTitle>
                        <AlertDialogDescription>
                          A new one-time password is generated and shown once. Their current
                          password stops working and any open sessions are signed out.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void resetPassword(u)}>Reset password</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {!u.is_active && (
                    <Button
                      variant="ghost" size="icon" className="size-8"
                      aria-label={`Reactivate ${u.name}`}
                      onClick={() => void reactivate(u)}
                    >
                      <UserCheck className="size-4" />
                    </Button>
                  )}
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
      <EditUserDialog user={editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={load} />
      <OneTimePasswordDialog result={resetResult} onOpenChange={(o) => !o && setResetResult(null)} />
    </>
  );
}
