import { useCallback, useEffect, useState } from 'react';
import { useProjects } from '@/hooks/use-projects';
import { Inbox, Plus, Link2, Trash2, CheckCircle2, MessageSquareQuote, XCircle, Layers, Sparkles, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMentions } from '@/hooks/use-mentions';
import { MentionText } from '@/components/app/mention-text';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { PbCustomer, PbFeature, PbInsight, PbTheme, PbThemeSuggestion } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { INSIGHT_ORIGIN_LABELS, INSIGHT_SOURCE_LABELS, INSIGHT_SOURCE_OPTIONS, TIER_CLASS } from '@/lib/product';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function ProductInsightsScreen() {
  const { projects } = useProjects();
  const [insights, setInsights] = useState<PbInsight[]>([]);
  const [customers, setCustomers] = useState<PbCustomer[]>([]);
  const [features, setFeatures] = useState<PbFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'inbox' | 'processed' | 'dismissed' | 'themes'>('inbox');
  const [themes, setThemes] = useState<PbTheme[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<PbTheme | null>(null);
  // Multi-select drives manual grouping — the path that works with no API key.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: '', summary: '' });
  const [suggestions, setSuggestions] = useState<PbThemeSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [selected, setSelected] = useState<PbInsight | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', source: 'other', customer_id: '' });
  // The product board is not project-scoped, so everyone is searchable and
  // flagged as a non-member.
  const contentMentions = useMentions({
    value: form.content,
    onChange: (next) => setForm((f) => ({ ...f, content: next })),
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ feature_id: '', importance: '1', quote: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ins, cus, feats, ths, ai] = await Promise.all([
        api.product.insights(),
        api.product.customers(),
        api.product.features(),
        api.product.themes(),
        api.ai.status().catch(() => ({ enabled: false })),
      ]);
      setInsights(ins);
      setCustomers(cus);
      setFeatures(feats);
      setThemes(ths);
      setAiOn(Boolean(ai.enabled));
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

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function groupIntoTheme() {
    if (!groupForm.name.trim() || picked.size === 0) return;
    try {
      await api.product.createTheme({
        name: groupForm.name.trim(),
        summary: groupForm.summary.trim() || undefined,
        insight_ids: [...picked],
      });
      setGroupOpen(false);
      setGroupForm({ name: '', summary: '' });
      setPicked(new Set());
      toast.success('Theme created');
      void load();
    } catch (e) {
      toast.error('Could not create theme', { description: e instanceof Error ? e.message : undefined });
    }
  }

  // Proposals only. Nothing is stored until confirmSuggestion() calls the same
  // create-theme endpoint a hand-made theme uses.
  async function runSuggest() {
    setSuggesting(true);
    try {
      const res = await api.product.suggestThemes();
      if (!res.enabled) {
        toast.message('AI is not configured', { description: 'Group insights by hand instead.' });
        setSuggestions([]);
      } else if (res.suggestions.length === 0) {
        toast.message('No groupings found', { description: res.error || 'Not enough untriaged feedback yet.' });
        setSuggestions([]);
      } else {
        setSuggestions(res.suggestions);
        setTab('themes');
      }
    } catch (e) {
      toast.error('Suggestion failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSuggesting(false);
    }
  }

  async function confirmSuggestion(sug: PbThemeSuggestion) {
    try {
      await api.product.createTheme({ name: sug.name, summary: sug.summary, insight_ids: sug.insight_ids });
      setSuggestions((prev) => (prev || []).filter((s) => s !== sug));
      toast.success('Theme created');
      void load();
    } catch (e) {
      toast.error('Could not create theme', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function openTheme(theme: PbTheme) {
    try {
      setSelectedTheme(await api.product.theme(theme.id));
      setSelected(null);
    } catch {
      setSelectedTheme(theme);
    }
  }

  async function promote(theme: PbTheme) {
    const projectId = projects[0]?.id;
    if (!projectId) {
      toast.error('No project to promote into');
      return;
    }
    try {
      const out = await api.product.promoteTheme(theme.id, projectId);
      toast.success(`Created feature “${out.name}”`, { description: `${out.insight_count} insights carried across.` });
      void load();
    } catch (e) {
      toast.error('Promotion failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeTheme(theme: PbTheme) {
    try {
      await api.product.removeTheme(theme.id);
      if (selectedTheme?.id === theme.id) setSelectedTheme(null);
      toast.success('Theme removed', { description: 'The insights are untouched.' });
      void load();
    } catch (e) {
      toast.error('Could not remove theme', { description: e instanceof Error ? e.message : undefined });
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
        actions={
          <div className="flex items-center gap-2">
            {aiOn && (
              <Button variant="outline" onClick={() => void runSuggest()} disabled={suggesting}>
                <Sparkles className="size-4" /> {suggesting ? 'Thinking…' : 'Suggest themes'}
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Add feedback</Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'inbox' | 'processed' | 'dismissed' | 'themes')} className="mb-4">
        <TabsList>
          <TabsTrigger value="inbox">Inbox ({active.filter((i) => !i.processed).length})</TabsTrigger>
          <TabsTrigger value="processed">Processed ({active.filter((i) => i.processed).length})</TabsTrigger>
          <TabsTrigger value="dismissed">Dismissed ({insights.filter((i) => i.dismissed_at).length})</TabsTrigger>
          <TabsTrigger value="themes">Themes ({themes.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'inbox' && picked.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
          <span className="text-sm">{picked.size} selected</span>
          <Button size="sm" onClick={() => setGroupOpen(true)}><Layers className="size-3.5" /> Group into theme</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <div className="space-y-2">
          {tab === 'themes' ? (
            <>
              {suggestions && suggestions.length > 0 && (
                <div className="mb-3 space-y-2 rounded-lg border border-dashed border-primary/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Proposed groupings — nothing is saved until you accept
                  </p>
                  {suggestions.map((sug, idx) => (
                    <div key={idx} className="rounded-md border border-border bg-card p-2">
                      <p className="text-sm font-medium">{sug.name}</p>
                      {sug.summary && <p className="text-xs text-muted-foreground">{sug.summary}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{sug.insight_ids.length} insights</span>
                        <Button size="sm" className="ml-auto" onClick={() => void confirmSuggestion(sug)}>Accept</Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setSuggestions((prev) => (prev || []).filter((s) => s !== sug))}>
                          Discard
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {themes.length === 0 ? (
                <EmptyState icon={Layers} title="No themes yet"
                  description="Select several insights in the Inbox and group them, or let AI propose groupings." />
              ) : (
                themes.map((t) => (
                  <button key={t.id} onClick={() => void openTheme(t)}
                    className={cn('block w-full rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary/40',
                      selectedTheme?.id === t.id && 'border-primary/60 ring-1 ring-primary/30')}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</p>
                      <Badge variant="secondary">{t.insight_count} insights</Badge>
                    </div>
                    {t.summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.summary}</p>}
                  </button>
                ))
              )}
            </>
          ) : shown.length === 0 ? (
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
                  {tab === 'inbox' && (
                    <input
                      type="checkbox"
                      className="mt-1 size-3.5 shrink-0 accent-primary"
                      checked={picked.has(i.id)}
                      onClick={(e) => { e.stopPropagation(); togglePick(i.id); }}
                      onChange={() => undefined}
                      aria-label={`Select ${i.title}`}
                    />
                  )}
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
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground"><MentionText text={i.origin_excerpt || i.content} /></p>
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
          {selectedTheme && tab === 'themes' ? (
            <Card className="sticky top-4 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold leading-snug">{selectedTheme.name}</h2>
                <Badge variant="secondary">{selectedTheme.insight_count}</Badge>
              </div>
              {selectedTheme.summary && (
                <p className="mt-2 text-sm text-muted-foreground">{selectedTheme.summary}</p>
              )}

              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Insights in this theme
                </p>
                <div className="space-y-1.5">
                  {selectedTheme.insights?.map((i) => (
                    <div key={i.id} className="rounded-md border border-border bg-muted/30 p-2">
                      <p className="truncate text-sm">{i.title}</p>
                      {i.origin_excerpt && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.origin_excerpt}</p>
                      )}
                    </div>
                  )) ?? null}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                <Button size="sm" onClick={() => void promote(selectedTheme)}>
                  <Rocket className="size-3.5" /> Promote to feature
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto text-destructive"
                  onClick={() => void removeTheme(selectedTheme)}>
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              </div>
              {/* Promotion keeps the theme: it records how the feature was
                  arrived at, which is worth more than the tidiness of removing it. */}
              <p className="mt-2 text-xs text-muted-foreground">
                Promoting creates a feature and carries every insight across. The theme stays.
              </p>
            </Card>
          ) : selected ? (
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
              {selected.content && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground"><MentionText text={selected.content} /></p>}
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

      {/* Group into theme */}
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Group {picked.size} insights into a theme</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Theme name" value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
            <Textarea placeholder="What do these have in common?" rows={3} value={groupForm.summary}
              onChange={(e) => setGroupForm({ ...groupForm, summary: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGroupOpen(false)}>Cancel</Button>
            <Button onClick={() => void groupIntoTheme()} disabled={!groupForm.name.trim()}>Create theme</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Capture dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Capture feedback</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Summary" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea
              ref={contentMentions.ref}
              placeholder="What did the customer say?"
              value={form.content}
              {...contentMentions.inputProps}
              rows={4}
            />
            {contentMentions.dropdown}
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
