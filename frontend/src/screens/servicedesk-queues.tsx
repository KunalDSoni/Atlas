import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Headphones, Inbox, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { notifyBulkOutcome, type BulkFailure } from '@/lib/completion-blockers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { useAuth } from '@/context/auth-provider';
import type { ProjectMember, Queue, QueueColumn, QueueIssue, WorkflowStatus } from '@/lib/types';
import {
  EmptyState, ErrorState, PageHeader, PriorityIcon, RowsSkeleton, UserAvatar,
} from '@/components/app/primitives';
import { SlaBadges } from '@/components/app/sla-badge';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const ALL_COLUMNS: { key: QueueColumn; label: string }[] = [
  { key: 'key', label: 'Key' },
  { key: 'summary', label: 'Summary' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'reporter', label: 'Reporter' },
  { key: 'request_type', label: 'Request type' },
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Updated' },
  { key: 'sla', label: 'SLA' },
];

const ORDER_OPTIONS = [
  { value: 'created_at', label: 'Newest first' },
  { value: 'created_at_asc', label: 'Oldest first' },
  { value: 'updated_at', label: 'Recently updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'key', label: 'Key' },
  { value: 'summary', label: 'Summary' },
  { value: 'status', label: 'Status' },
];

const DEFAULT_COLUMNS: QueueColumn[] = ['key', 'summary', 'status', 'assignee', 'sla'];

function isBoardAdmin(role?: string) {
  return role === 'admin' || role === 'board_admin';
}

// ===== The queue editor =====

interface QueueDraft {
  id?: string;
  name: string;
  jql: string;
  order_by: string;
  columns: QueueColumn[];
}

const EMPTY_DRAFT: QueueDraft = {
  name: '', jql: 'type = request AND status != done', order_by: 'created_at', columns: DEFAULT_COLUMNS,
};

function QueueDialog({ open, draft, onOpenChange, onSaved, projectId }: {
  open: boolean;
  draft: QueueDraft;
  projectId: string;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<QueueDraft>(draft);
  const [saving, setSaving] = useState(false);
  const [jqlError, setJqlError] = useState<string | null>(null);

  useEffect(() => {
    setForm(draft);
    setJqlError(null);
  }, [draft, open]);

  function toggleColumn(key: QueueColumn) {
    setForm((f) => ({
      ...f,
      columns: f.columns.includes(key) ? f.columns.filter((c) => c !== key) : [...f.columns, key],
    }));
  }

  async function save() {
    setSaving(true);
    setJqlError(null);
    try {
      const body = { name: form.name, jql: form.jql, order_by: form.order_by, columns: form.columns };
      if (form.id) await api.queues.update(form.id, body);
      else await api.queues.create(projectId, body);
      toast.success(form.id ? 'Queue updated' : 'Queue created');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      // Keep the server as the parser authority, but put its offset-aware error
      // beside the query that needs fixing instead of hiding it in a toast.
      setJqlError(e instanceof Error ? e.message : 'Could not validate this query');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Edit queue' : 'New queue'}</DialogTitle>
          <DialogDescription>
            A queue is a saved query. Ordering is a separate setting because the query language has no ORDER BY.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="queue-name">Name</Label>
            <Input
              id="queue-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Unassigned requests"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="queue-jql">Query</Label>
            <Textarea
              id="queue-jql"
              value={form.jql}
              onChange={(e) => {
                setForm((f) => ({ ...f, jql: e.target.value }));
                setJqlError(null);
              }}
              rows={3}
              aria-invalid={!!jqlError}
              aria-describedby={jqlError ? 'queue-jql-error queue-jql-help' : 'queue-jql-help'}
              className="min-h-20 resize-y font-mono text-xs"
              placeholder="type = request AND assignee = unassigned"
            />
            {jqlError && (
              <p id="queue-jql-error" role="alert" className="text-xs text-destructive">
                {jqlError}
              </p>
            )}
            <p id="queue-jql-help" className="text-xs leading-relaxed text-muted-foreground">
              Fields: project, status, type, priority, assignee, reporter, label, sla,
              first_response, resolution, request_type, category, waiting_for_customer.
              Operators: =, !=, IN, NOT IN, IS EMPTY, AND, OR, NOT, and parentheses.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="queue-order">Sort by</Label>
            <Select value={form.order_by} onValueChange={(v) => setForm((f) => ({ ...f, order_by: v }))}>
              <SelectTrigger id="queue-order"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Columns</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ALL_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.columns.includes(c.key)}
                    onCheckedChange={() => toggleColumn(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name.trim() || !form.jql.trim()}>
            {form.id ? 'Save' : 'Create queue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== The table =====

function Cell({ column, issue }: { column: QueueColumn; issue: QueueIssue }) {
  switch (column) {
    case 'key':
      return <span className="font-mono text-xs text-muted-foreground">{issue.issue_key}</span>;
    case 'summary':
      return <span className="font-medium">{issue.title}</span>;
    case 'type':
      return <span className="capitalize text-muted-foreground">{issue.type}</span>;
    case 'status':
      return <span className="capitalize text-muted-foreground">{issue.status.replace(/_/g, ' ')}</span>;
    case 'priority':
      return (
        <span className="inline-flex items-center gap-1.5 capitalize text-muted-foreground">
          <PriorityIcon priority={issue.priority as never} className="size-3.5" />
          {issue.priority}
        </span>
      );
    case 'assignee':
      return issue.assignee_name ? (
        <span className="inline-flex items-center gap-1.5">
          <UserAvatar name={issue.assignee_name} color={issue.assignee_color} className="size-5 text-[10px]" />
          <span className="truncate">{issue.assignee_name}</span>
        </span>
      ) : <span className="text-muted-foreground">Unassigned</span>;
    case 'reporter':
      return <span className="truncate text-muted-foreground">{issue.reporter_name ?? '—'}</span>;
    case 'request_type':
      return <span className="text-muted-foreground">{issue.request_type_name ?? '—'}</span>;
    case 'created':
      return <span className="whitespace-nowrap text-muted-foreground">{timeAgo(issue.created_at)}</span>;
    case 'updated':
      return <span className="whitespace-nowrap text-muted-foreground">{timeAgo(issue.updated_at)}</span>;
    case 'sla':
      return <SlaBadges sla={issue.sla} />;
    default:
      return null;
  }
}

// ===== Screen =====

export default function ServiceDeskQueues() {
  const { currentProject } = useProjects();
  const { user } = useAuth();
  const projectId = currentProject?.id ?? null;

  const [queues, setQueues] = useState<Queue[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [issues, setIssues] = useState<QueueIssue[]>([]);
  const [loadingQueues, setLoadingQueues] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<QueueDraft>(EMPTY_DRAFT);

  const active = useMemo(() => queues.find((q) => q.id === activeId) ?? null, [queues, activeId]);

  const loadQueues = useCallback(async () => {
    if (!projectId) return;
    setLoadingQueues(true);
    setError(null);
    try {
      const list = await api.queues.list(projectId);
      setQueues(list);
      // Keep the open queue selected across a reload; otherwise open the first.
      setActiveId((prev) => (prev && list.some((q) => q.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queues');
    } finally {
      setLoadingQueues(false);
    }
  }, [projectId]);

  const loadIssues = useCallback(async () => {
    if (!activeId) { setIssues([]); return; }
    setLoadingIssues(true);
    try {
      setIssues(await api.queues.issues(activeId));
    } catch (e) {
      toast.error('Could not load this queue', { description: e instanceof Error ? e.message : undefined });
      setIssues([]);
    } finally {
      setLoadingIssues(false);
    }
  }, [activeId]);

  useEffect(() => { void loadQueues(); }, [loadQueues]);
  useEffect(() => { void loadIssues(); setSelected(new Set()); }, [loadIssues]);

  // Only needed for the bulk bar, so fetched once alongside the queues.
  useEffect(() => {
    if (!projectId) return;
    void api.projects.members(projectId).then(setMembers).catch(() => setMembers([]));
    void api.workflow.list(projectId).then(setStatuses).catch(() => setStatuses([]));
  }, [projectId]);

  const columns = active?.columns?.length ? active.columns : DEFAULT_COLUMNS;

  async function bulkUpdate(body: Record<string, unknown>) {
    const ids = [...selected];
    // Partial apply: a request blocked by its open subtasks must not stop the
    // rest of the selection from moving. See the board's bulkUpdate.
    const results = await Promise.allSettled(ids.map((id) => api.issues.update(id, body)));

    const failures: BulkFailure[] = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const id = ids[index];
        failures.push({
          issueKey: issues.find((i) => i.id === id)?.issue_key ?? id,
          error: result.reason,
        });
      }
    });

    notifyBulkOutcome(results.length - failures.length, failures, 'request');
    setSelected(new Set());
    await Promise.all([loadIssues(), loadQueues()]);
  }

  async function removeQueue(queue: Queue) {
    try {
      await api.queues.remove(queue.id);
      toast.success(`Deleted "${queue.name}"`);
      setActiveId(null);
      await loadQueues();
    } catch (e) {
      toast.error('Could not delete the queue', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (!currentProject) return <EmptyState icon={Headphones} title="No project selected" />;
  if (loadingQueues) return <RowsSkeleton />;
  if (error) return <ErrorState message={error} onRetry={loadQueues} />;

  const canManage = isBoardAdmin(user?.role);

  return (
    <>
      <PageHeader
        title="Queues"
        description={`Saved views over ${currentProject.name}`}
        actions={canManage ? (
          <Button onClick={() => { setDraft(EMPTY_DRAFT); setDialogOpen(true); }}>
            <Plus className="size-4" /> New queue
          </Button>
        ) : undefined}
      />

      {queues.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No queues yet"
          description={
            currentProject.is_service_desk
              ? 'A queue is a saved query — "unassigned", "breaching today", "waiting on us".'
              : 'Queues work on any project, but they earn their keep on a service desk.'
          }
          action={canManage ? (
            <Button onClick={() => { setDraft(EMPTY_DRAFT); setDialogOpen(true); }}>
              <Plus className="size-4" /> New queue
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Sidebar — counts come from the listing call, not one request per queue. */}
          <nav className="w-full shrink-0 lg:w-56" aria-label="Queues">
            <ul className="space-y-0.5">
              {queues.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(q.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                      q.id === activeId
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span className="truncate">{q.name}</span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {q.invalid ? <AlertTriangle className="size-3.5 text-amber-500" /> : q.count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1">
            {active?.invalid && (
              <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                This queue's query no longer works: {active.invalid}
              </div>
            )}

            <div className="mb-2 flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {loadingIssues ? 'Loading…' : `${issues.length} request${issues.length === 1 ? '' : 's'}`}
              </p>
              <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {active?.jql}
              </code>
              <div className="flex-1" />
              {canManage && active && (
                <>
                  <Button
                    variant="ghost" size="icon" aria-label="Edit queue"
                    onClick={() => {
                      setDraft({
                        id: active.id, name: active.name, jql: active.jql,
                        order_by: active.order_by, columns: active.columns,
                      });
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" aria-label="Delete queue"
                    className="text-destructive"
                    onClick={() => void removeQueue(active)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>

            {loadingIssues ? <RowsSkeleton count={5} /> : issues.length === 0 ? (
              <EmptyState icon={Inbox} title="Nothing in this queue" description="Which is usually good news." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="w-10 px-3 py-2">
                        <Checkbox
                          aria-label="Select all"
                          checked={selected.size > 0 && selected.size === issues.length}
                          onCheckedChange={(v) =>
                            setSelected(v ? new Set(issues.map((i) => i.id)) : new Set())}
                        />
                      </th>
                      {columns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">
                          {ALL_COLUMNS.find((a) => a.key === c)?.label ?? c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((issue) => (
                      <tr key={issue.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <Checkbox
                            aria-label={`Select ${issue.issue_key}`}
                            checked={selected.has(issue.id)}
                            onCheckedChange={() => setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(issue.id)) next.delete(issue.id); else next.add(issue.id);
                              return next;
                            })}
                          />
                        </td>
                        {columns.map((c) => (
                          <td key={c} className="max-w-xs truncate px-3 py-2">
                            <Cell column={c} issue={issue} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk bar — the same two actions the board offers, on the same shortcut. */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-raised">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select value="" onValueChange={(v) => void bulkUpdate({ status: v })}>
            <SelectTrigger className="w-36" aria-label="Set status">
              <SelectValue placeholder="Set status…" />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value=""
            onValueChange={(v) => void bulkUpdate({ assignee_id: v === '__unassigned__' ? null : v })}
          >
            <SelectTrigger className="w-36" aria-label="Set assignee">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__">Unassigned</SelectItem>
              {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <X className="size-4" />
          </Button>
        </div>
      )}

      {projectId && (
        <QueueDialog
          open={dialogOpen}
          draft={draft}
          projectId={projectId}
          onOpenChange={setDialogOpen}
          onSaved={loadQueues}
        />
      )}
    </>
  );
}
