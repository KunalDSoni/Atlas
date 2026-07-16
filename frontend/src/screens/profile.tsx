import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { ROLE_LABEL } from '@/lib/domain';
import type { ProfileResponse } from '@/lib/types';
import { ErrorState, PageHeader, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { formatDate } from '@/lib/format';

export default function ProfileScreen() {
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ name: '', phone: '', department: '', job_title: '', bio: '', timezone: '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.profile.get();
        setProfile(p);
        setForm({
          name: p.name ?? '',
          phone: p.phone ?? '',
          department: p.department ?? '',
          job_title: p.job_title ?? '',
          bio: p.bio ?? '',
          timezone: p.timezone ?? '',
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.profile.update(form);
      toast.success('Profile updated');
      await refresh();
    } catch (err) {
      toast.error('Could not save profile', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setChangingPw(true);
    try {
      await api.profile.changePassword(pw.current_password, pw.new_password);
      setPw({ current_password: '', new_password: '', confirm: '' });
      toast.success('Password changed', { description: 'Your other sessions have been signed out.' });
    } catch (err) {
      toast.error('Could not change password', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setChangingPw(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Profile" />
        <RowsSkeleton count={5} />
      </>
    );
  }
  if (error || !profile) {
    return (
      <>
        <PageHeader title="Profile" />
        <ErrorState message={error ?? 'Profile unavailable'} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Profile" description="Manage your personal details and password." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
            <UserAvatar name={profile.name} color={profile.avatar_color} className="size-16 text-lg" />
            <div>
              <p className="font-semibold">{profile.name}</p>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
              <p className="mt-1 inline-block rounded-sm bg-primary-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">
                {ROLE_LABEL[profile.role]}
              </p>
            </div>
            <dl className="mt-2 w-full space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Assigned</dt>
                <dd className="tabular-nums">{profile.stats.assigned}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Completed</dt>
                <dd className="tabular-nums">{profile.stats.completed}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Comments</dt>
                <dd className="tabular-nums">{profile.stats.comments}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Joined</dt>
                <dd>{formatDate(profile.created_at)}</dd>
              </div>
            </dl>
            {profile.projects.length > 0 && (
              <div className="w-full pt-2 text-left">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Projects
                </p>
                <ul className="space-y-1">
                  {profile.projects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-xs">
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 text-muted-foreground">{p.role_in_project}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Personal details</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveProfile} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="p-name">Name</Label>
                    <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="p-phone">Phone</Label>
                    <Input id="p-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="p-dept">Department</Label>
                    <Input id="p-dept" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="p-title">Job title</Label>
                    <Input id="p-title" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="p-tz">Timezone</Label>
                    <Input id="p-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="Asia/Dubai" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="p-bio">Bio</Label>
                    <Textarea id="p-bio" rows={3} className="resize-none" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Change password</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={changePassword} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="pw-cur">Current</Label>
                    <Input
                      id="pw-cur"
                      type="password"
                      autoComplete="current-password"
                      value={pw.current_password}
                      onChange={(e) => setPw({ ...pw, current_password: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pw-new">New</Label>
                    <Input
                      id="pw-new"
                      type="password"
                      autoComplete="new-password"
                      minLength={6}
                      value={pw.new_password}
                      onChange={(e) => setPw({ ...pw, new_password: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pw-confirm">Confirm</Label>
                    <Input
                      id="pw-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={pw.confirm}
                      onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Minimum 6 characters. Changing your password signs out your other sessions.
                </p>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline" disabled={changingPw}>
                    {changingPw && <Loader2 className="size-4 animate-spin" />}
                    Change password
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
