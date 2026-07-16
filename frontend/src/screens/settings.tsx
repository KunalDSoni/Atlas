import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTheme } from '@/context/theme-provider';
import { useSettings } from '@/hooks/use-settings';
import type { Settings } from '@/lib/types';
import { ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';

const NOTIFICATION_TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'email_notifications', label: 'Email notifications', hint: 'Receive updates by email.' },
  { key: 'notify_assigned', label: 'Assigned to me', hint: 'When an issue is assigned to you.' },
  { key: 'notify_mentions', label: 'Mentions', hint: 'When someone mentions you.' },
  { key: 'notify_comments', label: 'Comments', hint: 'New comments on issues you watch.' },
  { key: 'notify_status_changes', label: 'Status changes', hint: 'When an issue you watch changes status.' },
  { key: 'notify_sprint_updates', label: 'Sprint updates', hint: 'When a sprint starts or completes.' },
];

export default function SettingsScreen() {
  const { theme, setTheme } = useTheme();
  // Shared with the rest of the app, so these controls actually take effect.
  const { settings, loading, patch } = useSettings();
  const error = !loading && !settings ? 'Failed to load settings' : null;

  if (loading) {
    return (
      <>
        <PageHeader title="Settings" />
        <RowsSkeleton count={6} />
      </>
    );
  }
  if (error || !settings) {
    return (
      <>
        <PageHeader title="Settings" />
        <ErrorState message={error ?? 'Settings unavailable'} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" description="Preferences for your account." />

      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Appearance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Theme</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Saved to your account and applied wherever you sign in.</p>
              </div>
              <Select
                value={theme}
                onValueChange={(v) => {
                  setTheme(v as 'light' | 'dark' | 'system');
                  void patch({ theme: v });
                }}
              >
                <SelectTrigger className="w-36" aria-label="Theme"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="compact">Compact view</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Denser spacing in lists and boards.</p>
              </div>
              <Switch
                id="compact"
                checked={Boolean(settings.compact_view)}
                onCheckedChange={(v) => patch({ compact_view: v ? 1 : 0 })}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Items per page</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Rows shown in paginated lists.</p>
              </div>
              <Select
                value={String(settings.items_per_page)}
                onValueChange={(v) => patch({ items_per_page: Number(v) })}
              >
                <SelectTrigger className="w-24" aria-label="Items per page"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {NOTIFICATION_TOGGLES.map((t, i) => (
              <div key={t.key}>
                {i > 0 && <Separator className="mb-4" />}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor={String(t.key)}>{t.label}</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.hint}</p>
                  </div>
                  <Switch
                    id={String(t.key)}
                    checked={Boolean(settings[t.key])}
                    onCheckedChange={(v) => patch({ [t.key]: v ? 1 : 0 } as Partial<Settings>)}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
