import { useEffect, useState } from 'react';
import { FolderKanban, ListTodo, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/domain';
import type { AdminStats, Role } from '@/lib/types';
import { CardsSkeleton, ErrorState, PageHeader } from '@/components/app/primitives';
import { DataTable, HBarChart } from '@/components/app/charts';

export default function AdminOverviewScreen() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setStats(await api.admin.stats());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load admin stats');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <>
        <PageHeader title="Administration" />
        <CardsSkeleton count={3} />
      </>
    );
  }
  if (error || !stats) {
    return (
      <>
        <PageHeader title="Administration" />
        <ErrorState message={error ?? 'Stats unavailable'} />
      </>
    );
  }

  const tiles = [
    { label: 'Users', value: stats.users, icon: Users, tone: 'bg-primary-muted text-accent-foreground' },
    { label: 'Projects', value: stats.projects, icon: FolderKanban, tone: 'bg-info-muted text-info' },
    { label: 'Issues', value: stats.issues, icon: ListTodo, tone: 'bg-success-muted text-success' },
  ];

  const roleData = stats.byRole.map((r) => ({ label: ROLE_LABEL[r.role as Role] ?? r.role, value: r.count }));

  return (
    <>
      <PageHeader title="Administration" description="Workspace-wide overview." />

      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="flex items-center gap-3 px-4 py-3.5">
              <span className={`grid size-9 shrink-0 place-items-center rounded-md ${t.tone}`}>
                <t.icon className="size-4.5" />
              </span>
              <span>
                <span className="block text-2xl font-semibold leading-none tabular-nums">{t.value}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t.label}</span>
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4 max-w-2xl">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Users by role</CardTitle>
        </CardHeader>
        <CardContent>
          <HBarChart data={roleData} colorIndex={0} />
          <div className="sr-only">
            <DataTable
              caption="User count by role"
              columns={['Role', 'Users']}
              rows={roleData.map((r) => [r.label, r.value])}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
