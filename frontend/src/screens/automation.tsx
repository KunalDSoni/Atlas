import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { useWorkflow } from '@/hooks/use-workflow';
import { PRIORITIES, PRIORITY_LABEL, TYPE_LABEL, canManageSprints } from '@/lib/domain';
import type {
  AutomationAction, AutomationRule, AutomationTrigger, IssueType, User,
} from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  issue_created: 'When an issue is created',
  status_changed: 'When an issue status changes',
  all_subtasks_done: 'When all subtasks are done',
};

const ACTION_LABEL: Record<AutomationAction['type'], string> = {
  set_status: 'Set status to',
  set_assignee: 'Assign to',
  add_label: 'Add label',
  notify_user: 'Notify',
};

const NO_CONDITION = '__none__';

export default function AutomationScreen() {
  const { user } = useAuth();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const workflow = useWorkflow(currentProjectId);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<AutomationTrigger>('issue_created');
  const [conditionField, setConditionField] = useState<string>(NO_CONDITION);
  const [conditionValue, setConditionValue] = useState('');
  const [actionType, setActionType] = useState<AutomationAction['type']>('set_status');
  const [actionValue, setActionValue] = useState('');

  const canManage = canManageSprints(user?.role);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [r, u] = await Promise.all([
        api.automations.list(currentProjectId),
        api.users.list().catch(() => []),
      ]);
      setRules(r);
      setUsers(u.filter((x) => x.is_active));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load automation rules');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function describe(rule: AutomationRule) {
    const conds = rule.conditions_parsed
      .map((c) => `${c.field} is ${c.value}`)
      .join(' and ');
    const acts = rule.actions_parsed
      .map((a) => {
        const label = ACTION_LABEL[a.type] ?? a.type;
        if (a.type === 'set_status') return `${label} ${workflow.label(a.value)}`;
        if (a.type === 'set_assignee' || a.type === 'notify_user') {
          return `${label} ${users.find((u) => u.id === a.value)?.name ?? 'someone'}`;
        }
        return `${label} "${a.value}"`;
      })
      .join(', ');
    return `${TRIGGER_LABEL[rule.trigger_type]}${conds ? `, if ${conds}` : ''} → ${acts}`;
  }

  async function createRule() {
    if (!currentProjectId || !name.trim() || !actionValue) return;
    try {
      await api.automations.create(currentProjectId, {
        name: name.trim(),
        trigger_type: trigger,
        conditions:
          conditionField !== NO_CONDITION && conditionValue
            ? [{ field: conditionField as 'type' | 'priority', value: conditionValue }]
            : [],
        actions: [{ type: actionType, value: actionValue }],
      });
      setCreateOpen(false);
      setName('');
      setConditionField(NO_CONDITION);
      setConditionValue('');
      setActionValue('');
      toast.success('Rule created');
      void load();
    } catch (e) {
      toast.error('Could not create rule', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function toggleRule(rule: AutomationRule) {
    try {
      await api.automations.update(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled ? 0 : 1 } : r)));
    } catch (e) {
      toast.error('Could not update rule', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeRule(id: string) {
    try {
      await api.automations.remove(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success('Rule deleted');
    } catch (e) {
      toast.error('Could not delete rule', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Automation" />
        <RowsSkeleton />
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Automation" />
        <EmptyState icon={Zap} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Automation" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Automation"
        description={`Trigger → condition → action rules for ${currentProject?.name ?? 'this project'}`}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New rule
            </Button>
          )
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No automation rules"
          description='Try: when all subtasks are done, set the parent status to Done.'
          action={
            canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> New rule
              </Button>
            )
          }
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                <Zap className="size-4 shrink-0 text-warning" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{rule.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{describe(rule)}</span>
                </span>
                {canManage && (
                  <>
                    <Switch
                      checked={Boolean(rule.enabled)}
                      onCheckedChange={() => void toggleRule(rule)}
                      aria-label={`Enable ${rule.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void removeRule(rule.id)}
                      aria-label={`Delete ${rule.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New automation rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auto-done parents" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">When</Label>
              <Select value={trigger} onValueChange={(v) => setTrigger(v as AutomationTrigger)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_LABEL) as AutomationTrigger[]).map((t) => (
                    <SelectItem key={t} value={t}>{TRIGGER_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">If (optional)</Label>
              <div className="flex gap-2">
                <Select value={conditionField} onValueChange={(v) => { setConditionField(v); setConditionValue(''); }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CONDITION}>No condition</SelectItem>
                    <SelectItem value="type">Type is</SelectItem>
                    <SelectItem value="priority">Priority is</SelectItem>
                  </SelectContent>
                </Select>
                {conditionField === 'type' && (
                  <Select value={conditionValue} onValueChange={setConditionValue}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a type…" /></SelectTrigger>
                    <SelectContent>
                      {(['story', 'task', 'bug', 'subtask'] as IssueType[]).map((t) => (
                        <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {conditionField === 'priority' && (
                  <Select value={conditionValue} onValueChange={setConditionValue}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a priority…" /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Then</Label>
              <div className="flex gap-2">
                <Select value={actionType} onValueChange={(v) => { setActionType(v as AutomationAction['type']); setActionValue(''); }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTION_LABEL) as AutomationAction['type'][]).map((a) => (
                      <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {actionType === 'set_status' && (
                  <Select value={actionValue} onValueChange={setActionValue}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a status…" /></SelectTrigger>
                    <SelectContent>
                      {workflow.statuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(actionType === 'set_assignee' || actionType === 'notify_user') && (
                  <Select value={actionValue} onValueChange={setActionValue}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a person…" /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {actionType === 'add_label' && (
                  <Input
                    value={actionValue}
                    onChange={(e) => setActionValue(e.target.value)}
                    placeholder="Label…"
                    className="flex-1"
                    aria-label="Label to add"
                  />
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createRule} disabled={!name.trim() || !actionValue}>Create rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
