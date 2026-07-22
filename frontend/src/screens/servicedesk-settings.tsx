import { useCallback, useEffect, useState } from 'react';
import { Clock, Headphones, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import type {
  RequestField, RequestFieldType, RequestType, SlaGoal, SlaMetric, WorkflowStatus,
} from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { formatDuration } from '@/lib/format';

const FIELD_TYPES: RequestFieldType[] = ['text', 'textarea', 'select', 'date'];
const METRICS: { value: SlaMetric; label: string }[] = [
  { value: 'first_response', label: 'First response' },
  { value: 'resolution', label: 'Resolution' },
];
const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'];
const ANY_PRIORITY = '__any__';

// ===== Request type form editor =====

function FieldRow({ field, onChange, onRemove }: {
  field: RequestField;
  onChange: (f: RequestField) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
      <div className="min-w-32 flex-1 space-y-1">
        <Label className="text-xs">Label</Label>
        <Input
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          placeholder="Device model"
        />
      </div>
      <div className="w-28 space-y-1">
        <Label className="text-xs">Key</Label>
        <Input
          value={field.key}
          onChange={(e) => onChange({ ...field, key: e.target.value })}
          className="font-mono text-xs"
        />
      </div>
      <div className="w-32 space-y-1">
        <Label className="text-xs">Type</Label>
        <Select
          value={field.type}
          onValueChange={(v) => onChange({ ...field, type: v as RequestFieldType })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {field.type === 'select' && (
        <div className="min-w-40 flex-1 space-y-1">
          <Label className="text-xs">Options (comma separated)</Label>
          <Input
            value={(field.options ?? []).join(', ')}
            onChange={(e) => onChange({
              ...field,
              options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
            })}
          />
        </div>
      )}
      <label className="flex items-center gap-1.5 pb-2 text-xs">
        <Switch checked={field.required} onCheckedChange={(v) => onChange({ ...field, required: v })} />
        Required
      </label>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove field">
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </div>
  );
}

function RequestTypeDialog({ open, projectId, editing, onOpenChange, onSaved }: {
  open: boolean;
  projectId: string;
  editing: RequestType | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<RequestField[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setFields(editing?.fields ?? []);
  }, [editing, open]);

  async function save() {
    setSaving(true);
    try {
      const body = { name, description, fields };
      if (editing) await api.requestTypes.update(editing.id, body);
      else await api.requestTypes.create(projectId, body);
      toast.success(editing ? 'Request type updated' : 'Request type created');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error('Could not save', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit request type' : 'New request type'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rt-name">Name</Label>
            <Input id="rt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hardware problem" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-desc">Description</Label>
            <Textarea
              id="rt-desc" rows={2} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the customer sees under the name in the help center"
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Form fields</Label>
                <p className="text-xs text-muted-foreground">
                  Customers fill these in. Answers are validated server-side against this list.
                </p>
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => setFields((f) => [...f, {
                  key: `field_${f.length + 1}`, label: '', type: 'text', required: false,
                }])}
              >
                <Plus className="size-4" /> Add field
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                No extra fields — the customer just writes a summary.
              </p>
            ) : fields.map((f, i) => (
              <FieldRow
                key={i}
                field={f}
                onChange={(next) => setFields((all) => all.map((x, xi) => (xi === i ? next : x)))}
                onRemove={() => setFields((all) => all.filter((_, xi) => xi !== i))}
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== SLA goals for one request type =====

function GoalEditor({ type }: { type: RequestType }) {
  const [goals, setGoals] = useState<SlaGoal[]>([]);
  const [metric, setMetric] = useState<SlaMetric>('first_response');
  const [priority, setPriority] = useState(ANY_PRIORITY);
  const [minutes, setMinutes] = useState('60');

  const load = useCallback(async () => {
    try { setGoals(await api.sla.goals(type.id)); } catch { setGoals([]); }
  }, [type.id]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    try {
      await api.sla.createGoal(type.id, {
        metric,
        priority: priority === ANY_PRIORITY ? null : priority,
        target_minutes: Number(minutes),
      });
      toast.success('Goal added');
      await load();
    } catch (e) {
      toast.error('Could not add the goal', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function remove(goal: SlaGoal) {
    try {
      await api.sla.removeGoal(goal.id);
      // Clocks already running keep their own target, so this only changes what
      // future requests promise.
      toast.success('Goal removed — requests already open keep their target');
      await load();
    } catch (e) {
      toast.error('Could not remove the goal', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <div className="space-y-2">
      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SLA goals — requests of this type are not timed.</p>
      ) : (
        <ul className="space-y-1">
          {goals.map((g) => (
            <li key={g.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm">
              <Clock className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{METRICS.find((m) => m.value === g.metric)?.label ?? g.metric}</span>
              <span className="text-muted-foreground">
                within {formatDuration(g.target_minutes)}
                {g.priority ? ` · ${g.priority} priority` : ' · any priority'}
              </span>
              <div className="flex-1" />
              <Button variant="ghost" size="icon" onClick={() => void remove(g)} aria-label="Remove goal">
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40 space-y-1">
          <Label className="text-xs">Metric</Label>
          <Select value={metric} onValueChange={(v) => setMetric(v as SlaMetric)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {METRICS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36 space-y-1">
          <Label className="text-xs">Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_PRIORITY}>Any</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-28 space-y-1">
          <Label className="text-xs" htmlFor={`mins-${type.id}`}>Minutes</Label>
          <Input
            id={`mins-${type.id}`} type="number" min={1} value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={add}><Plus className="size-4" /> Add goal</Button>
      </div>
    </div>
  );
}

// ===== Screen =====

export default function ServiceDeskSettings() {
  const { currentProject, reload: reloadProjects } = useProjects();
  const projectId = currentProject?.id ?? null;

  const [types, setTypes] = useState<RequestType[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RequestType | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [t, s] = await Promise.all([
        api.requestTypes.list(projectId),
        api.workflow.list(projectId),
      ]);
      setTypes(t);
      setStatuses(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load service desk settings');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleServiceDesk(on: boolean) {
    if (!projectId) return;
    try {
      await api.projects.update(projectId, { is_service_desk: on } as never);
      toast.success(on ? 'Service desk enabled' : 'Service desk disabled');
      await reloadProjects();
    } catch (e) {
      toast.error('Could not update the project', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function toggleWaiting(status: WorkflowStatus, on: boolean) {
    try {
      await api.workflow.update(status.id, { waiting_for_customer: on });
      await load();
    } catch (e) {
      toast.error('Could not update the status', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeType(type: RequestType) {
    try {
      await api.requestTypes.remove(type.id);
      toast.success('Request type deleted');
      await load();
    } catch (e) {
      // The server refuses to orphan requests that use the type; say so plainly.
      toast.error('Could not delete', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (!currentProject) return <EmptyState icon={Headphones} title="No project selected" />;
  if (loading) return <RowsSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="Service desk"
        description={`Request forms, SLAs and workflow for ${currentProject.name}`}
      />

      <Card className="mb-6 flex items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium">Service desk project</p>
          <p className="text-sm text-muted-foreground">
            Publishes this project's request types in the help center, where customers raise requests.
          </p>
        </div>
        <Switch
          checked={!!currentProject.is_service_desk}
          onCheckedChange={(v) => void toggleServiceDesk(v)}
          aria-label="Service desk project"
        />
      </Card>

      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">Request types</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
        </TabsList>

        <TabsContent value="types" className="space-y-3 pt-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="size-4" /> New request type
            </Button>
          </div>

          {types.length === 0 ? (
            <EmptyState
              icon={Headphones}
              title="No request types"
              description="A request type is the form a customer fills in. Start with one broad type and split it later."
            />
          ) : types.map((t) => (
            <Card key={t.id} className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.description || 'No description'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.fields.length === 0 ? 'No extra fields' :
                      `${t.fields.length} field${t.fields.length === 1 ? '' : 's'}: ${t.fields.map((f) => f.label).join(', ')}`}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setEditing(t); setDialogOpen(true); }}>
                  Edit
                </Button>
                <Button variant="ghost" size="icon" onClick={() => void removeType(t)} aria-label="Delete request type">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              <Separator />
              <GoalEditor type={t} />
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="workflow" className="pt-4">
          <Card className="divide-y divide-border">
            <div className="p-4">
              <p className="text-sm font-medium">Waiting for customer</p>
              <p className="text-sm text-muted-foreground">
                While a request sits in one of these statuses its SLA clocks pause. They resume when
                the customer replies, or when an agent moves it on.
              </p>
            </div>
            {statuses.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs capitalize text-muted-foreground">{s.category.replace(/_/g, ' ')}</p>
                </div>
                {s.builtin ? (
                  // Built-in statuses are not rows yet, so there is nothing to flag.
                  // Adding any status in the workflow editor materializes them.
                  <span className="text-xs text-muted-foreground">Add a custom status to use this</span>
                ) : (
                  <Switch
                    checked={!!s.waiting_for_customer}
                    onCheckedChange={(v) => void toggleWaiting(s, v)}
                    aria-label={`${s.label} waits for the customer`}
                  />
                )}
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>

      {projectId && (
        <RequestTypeDialog
          open={dialogOpen}
          projectId={projectId}
          editing={editing}
          onOpenChange={setDialogOpen}
          onSaved={load}
        />
      )}
    </>
  );
}
