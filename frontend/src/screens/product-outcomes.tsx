import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, MessageSquareQuote, Pencil, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { OutcomeDialog } from '@/components/app/outcome-dialog';
import { api } from '@/lib/api';
import type { PbFeatureOutcome, PbOutcomeFeature } from '@/lib/types';
import { OUTCOME_VERDICT_CLASS, OUTCOME_VERDICT_LABELS } from '@/lib/product';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const REVIEW_WINDOWS = [14, 30, 60, 90];

export default function ProductOutcomesScreen() {
  const [features, setFeatures] = useState<PbOutcomeFeature[]>([]);
  const [reviewDays, setReviewDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PbOutcomeFeature | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.product.outcomes(reviewDays);
      setFeatures(response.features);
      setReviewDays(response.review_after_days);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load outcomes');
    } finally {
      setLoading(false);
    }
  }, [reviewDays]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => ({
    due: features.filter((feature) => feature.review_due).length,
    reviewed: features.filter((feature) => feature.outcome?.reviewed_at).length,
    signals: features.reduce((sum, feature) => sum + feature.post_launch_insight_count, 0),
  }), [features]);

  function saved(outcome: PbFeatureOutcome) {
    setFeatures((current) => current.map((feature) => feature.id === outcome.feature_id ? {
      ...feature,
      outcome,
      needs_outcome_metric: !outcome.metric,
      review_due: !outcome.reviewed_at && feature.days_since_launch >= reviewDays,
    } : feature));
    setEditing(null);
  }

  if (loading) return (<><PageHeader title="Outcomes" description="Review what launched—not just what shipped" /><RowsSkeleton /></>);
  if (error) return (<><PageHeader title="Outcomes" /><ErrorState message={error} onRetry={() => void load()} /></>);

  return (
    <>
      <PageHeader
        title="Outcomes"
        description="Success measures, post-launch feedback, and launch reviews"
        actions={(
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Review after
            <Select value={String(reviewDays)} onValueChange={(value) => setReviewDays(Number(value))}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{REVIEW_WINDOWS.map((days) => <SelectItem key={days} value={String(days)}>{days} days</SelectItem>)}</SelectContent>
            </Select>
          </label>
        )}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="gap-1 p-4"><span className="text-xs text-muted-foreground">Launched</span><strong className="text-2xl tabular-nums">{features.length}</strong></Card>
        <Card className="gap-1 p-4"><span className="text-xs text-muted-foreground">Reviews due</span><strong className="text-2xl tabular-nums">{summary.due}</strong></Card>
        <Card className="gap-1 p-4"><span className="text-xs text-muted-foreground">Post-launch signals</span><strong className="text-2xl tabular-nums">{summary.signals}</strong></Card>
      </div>

      {features.length === 0 ? (
        <EmptyState icon={Activity} title="Nothing has launched yet" description="Launched features will appear here for outcome review." />
      ) : (
        <div className="space-y-3">
          {features.map((feature) => {
            const showAll = expanded.has(feature.id);
            const signals = showAll ? feature.post_launch_insights : feature.post_launch_insights.slice(0, 2);
            return (
              <Card key={feature.id} className={cn('gap-4 p-5', feature.review_due && 'border-amber-500/50')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{feature.name}</h2>
                      {feature.project_key && <Badge variant="secondary">{feature.project_key}</Badge>}
                      {feature.review_due && <Badge className="bg-amber-500/15 text-amber-700"><AlertTriangle className="size-3" /> Review due</Badge>}
                      {feature.outcome?.verdict && (
                        <Badge className={cn('font-medium', OUTCOME_VERDICT_CLASS[feature.outcome.verdict])}>
                          {OUTCOME_VERDICT_LABELS[feature.outcome.verdict]}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Launched {formatDate(feature.launched_at)} · {feature.days_since_launch} days ago
                      {feature.outcome?.reviewed_at ? ` · reviewed ${formatDate(feature.outcome.reviewed_at)}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant={feature.review_due ? 'default' : 'outline'} onClick={() => setEditing(feature)}>
                    <Pencil className="size-3.5" /> {feature.outcome?.reviewed_at ? 'Edit review' : feature.outcome?.metric ? 'Review launch' : 'Set measure'}
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md bg-muted/40 p-3 md:col-span-1">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Target className="size-3.5" /> Success metric</p>
                    <p className="mt-1.5 text-sm font-medium">{feature.outcome?.metric || 'Not declared'}</p>
                    {(feature.outcome?.baseline || feature.outcome?.target) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {feature.outcome.baseline || 'No baseline'} → {feature.outcome.target || 'No target'}
                      </p>
                    )}
                    {feature.outcome?.measured && <p className="mt-2 text-xs"><span className="text-muted-foreground">Measured:</span> {feature.outcome.measured}</p>}
                  </div>

                  <div className="rounded-md border border-border p-3 md:col-span-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <MessageSquareQuote className="size-3.5" /> Post-launch feedback ({feature.post_launch_insight_count})
                    </p>
                    {signals.length ? (
                      <div className="mt-2 space-y-2">
                        {signals.map((signal) => (
                          <div key={signal.id} className="flex items-start gap-2 text-sm">
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="font-medium">{signal.title}</p>
                              <p className="line-clamp-2 text-xs text-muted-foreground">
                                {signal.company_name ? `${signal.company_name} · ` : ''}{signal.quote || signal.origin_excerpt || signal.content || 'No excerpt'}
                              </p>
                            </div>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDate(signal.created_at)}</span>
                          </div>
                        ))}
                        {feature.post_launch_insight_count > 2 && (
                          <button className="text-xs font-medium text-primary hover:underline"
                            onClick={() => setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(feature.id)) next.delete(feature.id); else next.add(feature.id);
                              return next;
                            })}>
                            {showAll ? 'Show less' : `Show ${feature.post_launch_insight_count - 2} more`}
                          </button>
                        )}
                      </div>
                    ) : <p className="mt-2 text-sm text-muted-foreground">No linked feedback has arrived since launch.</p>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <OutcomeDialog
          featureId={editing.id}
          featureName={editing.name}
          outcome={editing.outcome}
          open
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          onSaved={saved}
        />
      )}
    </>
  );
}
