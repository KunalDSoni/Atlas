import { useCallback, useEffect, useState } from 'react';
import { Plus, Target, Trash2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMentions } from '@/hooks/use-mentions';
import { MentionText } from '@/components/app/mention-text';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { PbFeature, PbObjective } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, CardsSkeleton } from '@/components/app/primitives';
import {
  OBJECTIVE_STATUS_CLASS, OBJECTIVE_STATUS_LABELS, OBJECTIVE_STATUS_OPTIONS,
} from '@/lib/product';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function ProductObjectivesScreen() {
  const [objectives, setObjectives] = useState<PbObjective[]>([]);
  const [features, setFeatures] = useState<PbFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', status: 'on_track', target_date: '' });
  // The product board is not project-scoped, so everyone is searchable and
  // flagged as a non-member.
  const descMentions = useMentions({
    value: form.description,
    onChange: (next) => setForm((f) => ({ ...f, description: next })),
  });

  const [linkOpen, setLinkOpen] = useState<PbObjective | null>(null);
  const [linkFeatureId, setLinkFeatureId] = useState('');
  const [detail, setDetail] = useState<PbObjective | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [objs, feats] = await Promise.all([api.product.objectives(), api.product.features()]);
      setObjectives(objs);
      setFeatures(feats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load objectives');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!form.name.trim()) return;
    try {
      await api.product.createObjective({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        status: form.status,
        target_date: form.target_date || undefined,
      });
      setCreateOpen(false);
      setForm({ name: '', description: '', status: 'on_track', target_date: '' });
      toast.success('Objective created');
      void load();
    } catch (e) {
      toast.error('Create failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function openDetail(o: PbObjective) {
    try { setDetail(await api.product.objective(o.id)); }
    catch { setDetail(o); }
  }

  async function linkFeature() {
    if (!linkOpen || !linkFeatureId) return;
    try {
      await api.product.linkObjectiveFeature(linkOpen.id, linkFeatureId);
      setLinkOpen(null);
      setLinkFeatureId('');
      toast.success('Feature linked');
      void load();
      if (detail?.id === linkOpen.id) await openDetail(linkOpen);
    } catch (e) {
      toast.error('Link failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function remove(id: string) {
    try { await api.product.removeObjective(id); toast.success('Objective deleted'); if (detail?.id === id) setDetail(null); void load(); }
    catch (e) { toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined }); }
  }

  async function unlinkFeature(linkId: string, objective: PbObjective) {
    try { await api.product.unlinkObjectiveFeature(linkId); void load(); await openDetail(objective); }
    catch (e) { toast.error('Unlink failed', { description: e instanceof Error ? e.message : undefined }); }
  }

  if (loading) return (<><PageHeader title="Objectives" description="OKRs" /><CardsSkeleton /></>);
  if (error) return (<><PageHeader title="Objectives" /><ErrorState message={error} onRetry={() => void load()} /></>);

  return (
    <>
      <PageHeader
        title="Objectives"
        description="Tie features to the outcomes they move"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New objective</Button>}
      />

      {objectives.length === 0 ? (
        <EmptyState icon={Target} title="No objectives yet" description="Create an objective and link features to it."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New objective</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {objectives.map((o) => {
            const pct = o.feature_count > 0 ? Math.round((o.launched_count / o.feature_count) * 100) : 0;
            return (
              <Card key={o.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => void openDetail(o)}>
                    <p className="truncate font-semibold hover:underline">{o.name}</p>
                  </button>
                  <Badge className={cn('font-medium', OBJECTIVE_STATUS_CLASS[o.status])}>{OBJECTIVE_STATUS_LABELS[o.status]}</Badge>
                </div>
                {o.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground"><MentionText text={o.description} /></p>}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{o.launched_count}/{o.feature_count} features launched</span>
                    <span>{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
                  <span>{o.target_date ? `Due ${formatDate(o.target_date)}` : 'No target date'}</span>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => setLinkOpen(o)}><Link2 className="size-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => void remove(o.id)}><Trash2 className="size-3.5" /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          {detail && (
            <>
              <DialogHeader><DialogTitle>{detail.name}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Select value={detail.status} onValueChange={async (v) => { await api.product.updateObjective(detail.id, { status: v as PbObjective['status'] }); await openDetail(detail); void load(); }}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{OBJECTIVE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{OBJECTIVE_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                  </Select>
                  {detail.target_date && <span className="text-xs text-muted-foreground">Due {formatDate(detail.target_date)}</span>}
                </div>
                {detail.description && <p className="text-sm text-muted-foreground"><MentionText text={detail.description} /></p>}
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked features</p>
                  <div className="space-y-1.5">
                    {detail.features?.length ? detail.features.map((f) => {
                      const dpct = f.delivery_total > 0 ? Math.round((f.delivery_done / f.delivery_total) * 100) : 0;
                      return (
                        <div key={f.link_id} className="rounded-md border border-border bg-muted/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm">{f.name}</span>
                            <button className="text-muted-foreground" onClick={() => void unlinkFeature(f.link_id, detail)}><Trash2 className="size-3.5" /></button>
                          </div>
                          {f.delivery_total > 0 && (
                            <div className="mt-1 flex items-center gap-2">
                              <Progress value={dpct} className="h-1" />
                              <span className="text-xs text-muted-foreground">{f.delivery_done}/{f.delivery_total}</span>
                            </div>
                          )}
                        </div>
                      );
                    }) : <p className="text-xs text-muted-foreground">No features linked.</p>}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setDetail(null); setLinkOpen(detail); }}><Link2 className="size-3.5" /> Link feature</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New objective</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Objective name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Textarea
              ref={descMentions.ref}
              placeholder="Description"
              value={form.description}
              {...descMentions.inputProps}
              rows={3}
            />
            {descMentions.dropdown}
            <div className="grid grid-cols-2 gap-3">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OBJECTIVE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{OBJECTIVE_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void create()} disabled={!form.name.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link feature dialog */}
      <Dialog open={!!linkOpen} onOpenChange={(o) => !o && setLinkOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link a feature to {linkOpen?.name}</DialogTitle></DialogHeader>
          <Select value={linkFeatureId} onValueChange={setLinkFeatureId}>
            <SelectTrigger><SelectValue placeholder="Choose a feature" /></SelectTrigger>
            <SelectContent>{features.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkOpen(null)}>Cancel</Button>
            <Button onClick={() => void linkFeature()} disabled={!linkFeatureId}>Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
