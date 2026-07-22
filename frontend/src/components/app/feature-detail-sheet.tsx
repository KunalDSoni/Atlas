import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, FileText, MessageSquareQuote, Rocket, Target, Trash2, TrendingUp, Users2, Vote } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import type { PbFeature, WikiSpace } from '@/lib/types';
import {
  FEATURE_STATUS_CLASS, FEATURE_STATUS_LABELS, FEATURE_STATUS_OPTIONS,
  TIMEFRAME_LABELS, TIMEFRAME_OPTIONS, TIER_CLASS, TIER_LABELS, computeRice,
} from '@/lib/product';
import { formatArr } from '@/lib/format';
import { cn } from '@/lib/utils';

const NONE = '__none__';

function ScoreTile({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" /> {label}</div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function FeatureDetailSheet({
  featureId, open, onOpenChange, onChange,
}: {
  featureId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChange?: () => void;
}) {
  const { projects } = useProjects();
  const [feature, setFeature] = useState<PbFeature | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushType, setPushType] = useState('epic');
  const [spaces, setSpaces] = useState<WikiSpace[]>([]);
  const [specSpace, setSpecSpace] = useState('');
  const [drafting, setDrafting] = useState(false);
  const navigate = useNavigate();
  const [pushProject, setPushProject] = useState('');

  const load = useCallback(async () => {
    if (!featureId) return;
    setLoading(true);
    try {
      const f = await api.product.feature(featureId);
      setFeature(f);
      setPushProject(f.project_id || projects[0]?.id || '');
      // Spaces populate the spec picker. A failure here must not break the
      // sheet — the rest of the feature is still readable without it.
      setSpaces(await api.wiki.spaces().catch(() => []));
    } catch (e) {
      toast.error('Failed to load feature', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [featureId, projects]);

  useEffect(() => { if (open && featureId) void load(); }, [open, featureId, load]);

  async function draftSpec() {
    if (!feature || !specSpace) return;
    setDrafting(true);
    try {
      const out = await api.product.draftSpec(feature.id, specSpace);
      toast.success(out.created ? 'Spec drafted' : 'Spec already exists', {
        description: 'Opened as an ordinary wiki page — edit it there.',
      });
      setFeature(await api.product.feature(feature.id));
    } catch (e) {
      toast.error('Could not draft the spec', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setDrafting(false);
    }
  }

  async function patch(body: Partial<PbFeature>) {
    if (!feature) return;
    try {
      const updated = await api.product.updateFeature(feature.id, body);
      setFeature({ ...feature, ...updated });
      onChange?.();
    } catch (e) {
      toast.error('Update failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function vote() {
    if (!feature) return;
    try {
      const r = await api.product.voteFeature(feature.id);
      setFeature({ ...feature, vote_count: r.vote_count });
      onChange?.();
    } catch (e) {
      toast.error('Vote failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function push() {
    if (!feature) return;
    try {
      await api.product.pushToDelivery(feature.id, { project_id: pushProject || undefined, type: pushType });
      toast.success('Pushed to delivery');
      await load();
      onChange?.();
    } catch (e) {
      toast.error('Push failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function unlinkIssue(linkId: string) {
    try {
      await api.product.unlinkIssue(linkId);
      await load();
      onChange?.();
    } catch (e) {
      toast.error('Unlink failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  const rice = feature ? computeRice(feature) : null;
  const deliveryPct = feature && feature.delivery_total > 0
    ? Math.round((feature.delivery_done / feature.delivery_total) * 100) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {loading && !feature ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : feature ? (
          <>
            <SheetHeader className="gap-2 border-b border-border px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn('font-medium', FEATURE_STATUS_CLASS[feature.status])}>{FEATURE_STATUS_LABELS[feature.status]}</Badge>
                {feature.timeframe && <Badge variant="outline">{TIMEFRAME_LABELS[feature.timeframe]}</Badge>}
                {feature.project_key && <Badge variant="secondary">{feature.project_key}</Badge>}
              </div>
              <SheetTitle className="text-left text-lg leading-snug">{feature.name}</SheetTitle>
            </SheetHeader>

            <div className="space-y-6 px-6 py-5">
              {/* Scores */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ScoreTile icon={Users2} label="User impact" value={feature.user_impact} />
                <ScoreTile icon={DollarSign} label="Demand" value={feature.demand > 0 ? formatArr(feature.demand) : '—'} />
                <ScoreTile icon={TrendingUp} label="RICE" value={rice ?? '—'} />
                <ScoreTile icon={Vote} label="Votes" value={feature.vote_count} />
              </div>

              {/* Spec — the wiki is the editor, so this is a link, not an
                  embedded document. Drafting is idempotent: once a page exists
                  the button becomes a chip through to it. */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Spec</p>
                {feature.spec_page_id ? (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/wiki/pages/${feature.spec_page_id}`)}>
                    <FileText className="size-3.5" /> Open spec page
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select value={specSpace} onValueChange={setSpecSpace}>
                      <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Choose a space" /></SelectTrigger>
                      <SelectContent>
                        {spaces.map((sp) => <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" disabled={!specSpace || drafting}
                      onClick={() => void draftSpec()}>
                      <FileText className="size-3.5" /> {drafting ? 'Drafting…' : 'Draft spec'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Who asked for this — the evidence behind the demand number, so
                  the score can be argued with rather than just trusted. */}
              {(feature.demand_breakdown?.length || feature.demand_unattributed) ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Who asked for this
                  </p>
                  <div className="space-y-1.5">
                    {feature.demand_breakdown?.map((row) => (
                      <div key={row.company_id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                        <span className="truncate text-sm">{row.company_name ?? 'Unknown company'}</span>
                        {row.tier && <Badge className={cn('font-medium', TIER_CLASS[row.tier])}>{TIER_LABELS[row.tier]}</Badge>}
                        <span className="text-xs text-muted-foreground">
                          {row.insight_count} {row.insight_count === 1 ? 'insight' : 'insights'}
                        </span>
                        <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
                          {formatArr(row.contribution)}
                          {/* An estimated row used the tier median because the
                              company has no ARR recorded — never presented as
                              measured revenue. */}
                          {row.estimated && <span className="ml-1 text-xs font-normal text-muted-foreground">est.</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  {(feature.demand_unattributed ?? 0) > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {feature.demand_unattributed} insight{feature.demand_unattributed === 1 ? '' : 's'} with no company attached — not counted.
                    </p>
                  )}
                </div>
              ) : null}

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-muted-foreground">Status
                  <Select value={feature.status} onValueChange={(v) => void patch({ status: v as PbFeature['status'] })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{FEATURE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{FEATURE_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">Timeframe
                  <Select value={feature.timeframe ?? NONE} onValueChange={(v) => void patch({ timeframe: v === NONE ? null : v as PbFeature['timeframe'] })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unscheduled</SelectItem>
                      {TIMEFRAME_OPTIONS.map((t) => <SelectItem key={t} value={t}>{TIMEFRAME_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(['reach', 'impact', 'confidence', 'effort', 'value'] as const).map((fld) => (
                  <label key={fld} className="text-xs font-medium capitalize text-muted-foreground">{fld}
                    <Input type="number" className="mt-1" defaultValue={feature[fld] ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== feature[fld]) void patch({ [fld]: v } as Partial<PbFeature>);
                      }} />
                  </label>
                ))}
              </div>

              {feature.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{feature.description}</p>}

              <Button size="sm" variant="outline" onClick={() => void vote()}><Vote className="size-3.5" /> Vote ({feature.vote_count})</Button>

              {/* Delivery */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Delivery</h3>
                  <span className="text-xs text-muted-foreground">{feature.delivery_done}/{feature.delivery_total} done</span>
                </div>
                {feature.delivery_total > 0 && <Progress value={deliveryPct} className="mb-2 h-1.5" />}
                <div className="space-y-1.5">
                  {feature.issues?.map((iss) => (
                    <div key={iss.link_id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-sm">
                      <Badge variant="secondary" className="shrink-0">{iss.issue_key}</Badge>
                      <span className={cn('truncate', iss.is_done && 'text-muted-foreground line-through')}>{iss.title}</span>
                      <Button size="icon" variant="ghost" className="ml-auto size-6" onClick={() => void unlinkIssue(iss.link_id)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select value={pushType} onValueChange={setPushType}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="epic">Epic</SelectItem>
                      <SelectItem value="story">Story</SelectItem>
                      <SelectItem value="task">Task</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={pushProject} onValueChange={setPushProject}>
                    <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Project" /></SelectTrigger>
                    <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" onClick={() => void push()} disabled={!pushProject}><Rocket className="size-3.5" /> Push to delivery</Button>
                </div>
              </section>

              {/* Insights */}
              <section>
                <h3 className="mb-2 text-sm font-semibold">Evidence ({feature.insights?.length ?? 0})</h3>
                <div className="space-y-1.5">
                  {feature.insights?.length ? feature.insights.map((ins) => (
                    <div key={ins.link_id} className="rounded-md border border-border bg-muted/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">{ins.title}</span>
                        <Badge variant="secondary" className="shrink-0">impact {ins.importance}</Badge>
                      </div>
                      {ins.company_name && <p className="mt-0.5 text-xs text-muted-foreground">{ins.company_name}{ins.customer_name ? ` · ${ins.customer_name}` : ''}</p>}
                      {ins.quote && <p className="mt-1 flex gap-1 text-xs italic text-muted-foreground"><MessageSquareQuote className="mt-0.5 size-3 shrink-0" /> “{ins.quote}”</p>}
                    </div>
                  )) : <p className="text-xs text-muted-foreground">No linked feedback yet.</p>}
                </div>
              </section>

              {/* Objectives */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Target className="size-4" /> Objectives</h3>
                <div className="flex flex-wrap gap-1.5">
                  {feature.objectives?.length ? feature.objectives.map((o) => (
                    <Badge key={o.link_id} variant="outline">{o.name}</Badge>
                  )) : <p className="text-xs text-muted-foreground">Not tied to an objective.</p>}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
