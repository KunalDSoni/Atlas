import { useCallback, useEffect, useState } from 'react';
import { Inbox, Plus, Link2, Trash2, CheckCircle2, MessageSquareQuote, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { PbCustomer, PbFeature, PbInsight } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { INSIGHT_ORIGIN_LABELS, INSIGHT_SOURCE_LABELS, INSIGHT_SOURCE_OPTIONS, TIER_CLASS } from '@/lib/product';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function ProductInsightsScreen() {
  const [insights, setInsights] = useState<PbInsight[]>([]);
  const [customers, setCustomers] = useState<PbCustomer[]>([]);
  const [features, setFeatures] = useState<PbFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'inbox' | 'processed' | 'dismissed'>('inbox');
  const [selected, setSelected] = useState<PbInsight | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', source: 'other', customer_id: '' });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ feature_id: '', importance: '1', quote: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ins, cus, feats] = await Promise.all([
        api.product.insights(),
        api.product.customers(),
        api.product.features(),
      ]);
      setInsights(ins);
      setCustomers(cus);
      setFeatures(feats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load insights');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Dismissed is its own bucket rather than a flavour of processed: a dismissed
  // insight was judged not actionable, which is a different fact from having
  // been triaged into a feature. It stays visible so the judgement can be undone.
  const active = insights.filter((i) => !i.dismissed_at);
  const shown = tab === 'dismissed'
    ? insights.filter((i) => i.dismissed_at)
    : active.filter((i) => (tab === 'inbox' ? !i.processed : i.processed));

  async function create() {
    if (!form.title.trim()) return;
    try {
      await api.product.createInsight({
        title: form.title.trim(),
        content: form.content.trim() || undefined,
        source: form.source,
        customer_id: form.customer_id || undefined,
      });
      setCreateOpen(false);
      setForm({ title: '', content: '', source: 'other', customer_id: '' });
      toast.success('Feedback captured');
      void load();
    } catch (e) {
      toast.error('Failed to capture', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function openDetail(insight: PbInsight) {
    try {
      setSelected(await api.product.insight(insight.id));
    } catch {
      setSelected(insight);
    }
  }

  async function toggleProcessed(insight: PbInsight) {
    try {
      await api.product.updateInsight(insight.id, { processed: insight.processed ? 0 : 1 });
      toast.success(insight.processed ? 'Moved back to inbox' : 'Marked processed');
      void load();
      if (selected?.id === insight.id) setSelected(null);
    } catch (e) {
      toast.error('Update failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function dismiss(insight: PbInsight) {
    try {
      await api.product.dismissInsight(insight.id);
      toast.success('Dismissed', { description: 'Kept as evidence — find it under Dismissed.' });
      if (selected?.id === insight.id) setSelected(null);
      void load();
    } catch (e) {
      toast.error('Dismiss failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function remove(insight: PbInsight) {
    try {
      await api.product.removeInsight(insight.id);
      toast.success('Deleted');
      if (selected?.id === insight.id) setSelected(null);
      void load();
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function linkToFeature() {
    if (!selected || !linkForm.feature_id) return;
    try {
      await api.product.linkInsight(selected.id, {
        feature_id: linkForm.feature_id,
        importance: Number(linkForm.importance),
        quote: linkForm.quote.trim() || undefined,
      });
      setLinkOpen(false);
      setLinkForm({ feature_id: '', importance: '1', quote: '' });
      toast.success('Linked to feature');
      await openDetail(selected);
      void load();
    } catch (e) {
      toast.error('Link failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) {
    return (<><PageHeader title="Insights" description="Customer feedback inbox" /><RowsSkeleton /></>);
  }
  if (error) {
    return (<><PageHeader title="Insights" /><ErrorState message={error} onRetry={() => void load()} /></>);
  }

  return (
    <>
      <PageHeader
        title="Insights"
        description="Capture and triage customer feedback, then link it to features"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Add feedback</Button>}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'inbox' | 'processed' | 'dismissed')} className="mb-4">
        <TabsList>
          <TabsTrigger value="inbox">Inbox ({active.filter((i) => !i.processed).length})</TabsTrigger>
          <TabsTrigger value="processed">Processed ({active.filter((i) => i.processed).length})</TabsTrigger>
          <TabsTrigger value="dismissed">Dismissed ({insights.filter((i) => i.dismissed_at).length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <div className="space-y-2">
          {shown.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={tab === 'inbox' ? 'Inbox zero' : tab === 'processed' ? 'Nothing processed yet' : 'Nothing dismissed'}
              description={
                tab === 'inbox'
                  ? 'New feedback appears here — captured from a request, a comment, the portal, or added by hand.'
                  : tab === 'processed'
                    ? 'Triaged feedback shows up here.'
                    : 'Feedback you judge not actionable is kept here rather than deleted.'
              }
            />
          ) : (
            shown.map((i) => (
              <button key={i.id} onClick={() => void openDetail(i)}
                className={cn('block w-full rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary/40',
                  selected?.id === i.id && 'border-primary/60 ring-1 ring-primary/30')}>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {i.origin_kind && i.origin_kind !== 'manual' && (
                      <Badge variant="secondary">{INSIGHT_ORIGIN_LABELS[i.origin_kind]}</Badge>
                    )}
                    <Badge variant="outline">{INSIGHT_SOURCE_LABELS[i.source]}</Badge>
                  </div>
                </div>
                {/* The captured excerpt is what a customer actually said, so it
                    outranks the hand-written content field when both exist. */}
                {(i.origin_excerpt || i.content) && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.origin_excerpt || i.content}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {i.customer_name && <span>{i.customer_name}</span>}
                  {i.company_name && (
                    <Badge className={cn('font-medium', i.company_tier && TIER_CLASS[i.company_tier])}>{i.company_name}</Badge>
                  )}
                  {(i.feature_count ?? 0) > 0 && <span className="inline-flex items-center gap-1"><Link2 className="size-3" /> {i.feature_count}</span>}
                  <span className="ml-auto">{formatDate(i.created_at)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div>
          {selected ? (
            <Card className="sticky top-4 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold leading-snug">{selected.title}</h2>
                <Badge variant="outline">{INSIGHT_SOURCE_LABELS[selected.source]}</Badge>
              </div>
              {selected.origin_excerpt && (
                <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
                  “{selected.origin_excerpt}”
                  <span className="mt-1 block not-italic text-xs">
                    Captured from {selected.origin_kind ? INSIGHT_ORIGIN_LABELS[selected.origin_kind].toLowerCase() : 'a source'}
                    {' — snapshotted, so it survives the original being edited or deleted.'}
                  </span>
                </blockquote>
              )}
              {selected.content && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selected.content}</p>}
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {selected.customer_name && <p>Customer: <span className="text-foreground">{selected.customer_name}</span></p>}
                {selected.company_name && <p>Company: <span className="text-foreground">{selected.company_name}</span></p>}
                <p>Captured {formatDate(selected.created_at)}{selected.created_by_name ? ` by ${selected.created_by_name}` : ''}</p>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked features</p>
                  <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}><Link2 className="size-3.5" /> Link</Button>
                </div>
                {selected.features && selected.features.length > 0 ? (
                  <div className="space-y-1.5">
                    {selected.features.map((f) => (
                      <div key={f.link_id} className="rounded-md border border-border bg-muted/30 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm">{f.name}</span>
                          <Badge variant="secondary">impact {f.importance}</Badge>
                        </div>
                        {f.quote && (
                          <p className="mt-1 flex gap-1 text-xs italic text-muted-foreground">
                            <MessageSquareQuote className="mt-0.5 size-3 shrink-0" /> “{f.quote}”
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not linked to any feature yet.</p>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                <Button size="sm" variant="outline" onClick={() => void toggleProcessed(selected)}>
                  <CheckCircle2 className="size-3.5" /> {selected.processed ? 'Reopen' : 'Mark processed'}
                </Button>
                {!selected.dismissed_at && (
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(selected)}>
                    <XCircle className="size-3.5" /> Dismiss
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => void remove(selected)}>
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="grid place-items-center p-10 text-center text-sm text-muted-foreground">
              Select a piece of feedback to see details and link it to a feature.
            </Card>
          )}
        </div>
      </div>

      {/* Capture dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Capture feedback</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Summary" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea placeholder="What did the customer say?" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} />
            <div className="grid grid-cols-2 gap-3">
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  {INSIGHT_SOURCE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{INSIGHT_SOURCE_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.customer_id || 'none'} onValueChange={(v) => setForm({ ...form, customer_id: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No customer</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.company_name ? ` · ${c.company_name}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void create()} disabled={!form.title.trim()}>Capture</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link-to-feature dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link to a feature</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={linkForm.feature_id} onValueChange={(v) => setLinkForm({ ...linkForm, feature_id: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a feature" /></SelectTrigger>
              <SelectContent>
                {features.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Importance to this customer</p>
              <Select value={linkForm.importance} onValueChange={(v) => setLinkForm({ ...linkForm, importance: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 · Nice to have</SelectItem>
                  <SelectItem value="2">2 · Important</SelectItem>
                  <SelectItem value="3">3 · Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea placeholder="Optional quote to attach" value={linkForm.quote} onChange={(e) => setLinkForm({ ...linkForm, quote: e.target.value })} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button onClick={() => void linkToFeature()} disabled={!linkForm.feature_id}>Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
