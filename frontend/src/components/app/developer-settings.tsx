import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import type { ApiToken, Webhook } from '@/lib/types';
import { timeAgo } from '@/lib/format';

const WEBHOOK_EVENTS = ['issue.created', 'issue.updated', 'issue.deleted'];

function ApiTokens() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = useCallback(() => { api.tokens.list().then(setTokens).catch(() => setTokens([])); }, []);
  useEffect(() => load(), [load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const t = await api.tokens.create(name.trim());
      setNewToken(t.token ?? null);
      setName('');
      load();
    } catch (e) {
      toast.error('Could not create token', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-end gap-2">
        <div className="flex-1">
          <p className="mb-1 text-xs text-muted-foreground">Create a token to use the Atlas API as yourself (send it as <code>Authorization: Bearer …</code>).</p>
          <Input placeholder="Token name, e.g. CI pipeline" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button onClick={() => void create()} disabled={creating || !name.trim()}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create
        </Button>
      </div>

      {tokens.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">No API tokens yet.</p>
      ) : (
        <ul className="divide-y divide-border-light rounded-lg border border-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <KeyRound className="size-4 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{t.prefix}…· {t.last_used_at ? `used ${timeAgo(t.last_used_at)}` : 'never used'}</p>
              </div>
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"
                onClick={async () => { await api.tokens.remove(t.id); load(); }} aria-label="Revoke token">
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new token</DialogTitle>
            <DialogDescription>This is the only time it's shown. Store it somewhere safe.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">{newToken}</code>
            <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(newToken ?? ''); toast.success('Copied'); }} aria-label="Copy">
              <Copy className="size-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewToken(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Webhooks() {
  const { currentProjectId, currentProject } = useProjects();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['issue.created', 'issue.updated', 'issue.deleted']);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!currentProjectId) return;
    api.webhooks.list(currentProjectId).then(setHooks).catch(() => setHooks([]));
  }, [currentProjectId]);
  useEffect(() => load(), [load]);

  async function create() {
    if (!currentProjectId || !/^https?:\/\//i.test(url)) return;
    try {
      const h = await api.webhooks.create(currentProjectId, { url: url.trim(), events });
      setNewSecret(h.secret ?? null);
      setUrl('');
      load();
    } catch (e) {
      toast.error('Could not create webhook', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (!currentProjectId) return <p className="text-xs text-muted-foreground">Select a project to manage webhooks.</p>;

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">Fire signed HTTP POSTs to your endpoint on issue events in <strong>{currentProject?.name}</strong>. Verify deliveries with the <code>x-atlas-signature</code> header.</p>
      <div className="mb-3 flex items-end gap-2">
        <Input placeholder="https://your-server.com/atlas-hook" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button onClick={() => void create()} disabled={!/^https?:\/\//i.test(url)}><Plus className="size-4" /> Add</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {WEBHOOK_EVENTS.map((ev) => (
          <button key={ev} type="button"
            onClick={() => setEvents((prev) => prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev])}
            className={`rounded-full border px-2 py-0.5 text-xs ${events.includes(ev) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
            {ev}
          </button>
        ))}
      </div>

      {hooks.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">No webhooks for this project.</p>
      ) : (
        <ul className="divide-y divide-border-light rounded-lg border border-border">
          {hooks.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <WebhookIcon className="size-4 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{h.url}</p>
                <p className="text-xs text-muted-foreground">
                  {(h.events.length ? h.events : ['all events']).join(', ')}
                  {h.last_status != null && <> · last {h.last_status === 0 ? 'failed' : h.last_status}</>}
                </p>
              </div>
              <Badge variant={h.enabled ? 'secondary' : 'outline'}>{h.enabled ? 'on' : 'off'}</Badge>
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"
                onClick={async () => { await api.webhooks.remove(h.id); load(); }} aria-label="Delete webhook">
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!newSecret} onOpenChange={(o) => !o && setNewSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your signing secret</DialogTitle>
            <DialogDescription>Use it to verify the <code>x-atlas-signature</code> HMAC on deliveries. Shown once.</DialogDescription>
          </DialogHeader>
          <code className="block truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">{newSecret}</code>
          <DialogFooter>
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(newSecret ?? ''); toast.success('Copied'); }}>Copy</Button>
            <Button onClick={() => setNewSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DeveloperSettings() {
  const { user } = useAuth();
  const canManageWebhooks = user?.role === 'admin' || user?.role === 'board_admin';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Developer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">API tokens</p>
          <ApiTokens />
        </div>
        {canManageWebhooks && (
          <div className="border-t border-border pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Webhooks</p>
            <Webhooks />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
