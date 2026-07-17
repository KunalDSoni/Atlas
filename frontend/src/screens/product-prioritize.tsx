import { useCallback, useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import type { PbFeature } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { FeatureDetailSheet } from '@/components/app/feature-detail-sheet';
import { FEATURE_STATUS_CLASS, FEATURE_STATUS_LABELS, quadrant } from '@/lib/product';
import { cn } from '@/lib/utils';

// Quadrant tints keyed by the label quadrant() returns.
const QUAD_HINT: Record<string, string> = {
  'Quick wins': 'text-emerald-600',
  'Big bets': 'text-blue-500',
  'Fill-ins': 'text-slate-500',
  'Money pit': 'text-red-500',
};

export default function ProductPrioritizeScreen() {
  const [features, setFeatures] = useState<PbFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeatures(await api.product.features());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load features');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const scored = useMemo(() => features.filter((f) => f.value != null && f.effort != null), [features]);
  const riceRanked = useMemo(() => [...features].filter((f) => f.rice != null)
    .sort((a, b) => (b.rice ?? 0) - (a.rice ?? 0)), [features]);

  if (loading) return (<><PageHeader title="Prioritize" description="Value vs effort" /><RowsSkeleton /></>);
  if (error) return (<><PageHeader title="Prioritize" /><ErrorState message={error} onRetry={() => void load()} /></>);

  return (
    <>
      <PageHeader title="Prioritize" description="Value-vs-effort matrix and RICE ranking" />

      {features.length === 0 ? (
        <EmptyState icon={Target} title="Nothing to prioritize yet" description="Add value and effort to features to place them on the matrix." />
      ) : (
        <div className="space-y-6">
          {/* Value/effort matrix */}
          <Card className="p-4">
            <div className="relative mx-auto aspect-square w-full max-w-xl">
              {/* Quadrant backdrop */}
              <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 overflow-hidden rounded-lg border border-border text-xs font-medium">
                <div className="flex items-start justify-start bg-emerald-500/[0.06] p-2 text-emerald-600">Quick wins</div>
                <div className="flex items-start justify-end bg-blue-500/[0.06] p-2 text-blue-500">Big bets</div>
                <div className="flex items-end justify-start bg-slate-500/[0.06] p-2 text-slate-500">Fill-ins</div>
                <div className="flex items-end justify-end bg-red-500/[0.06] p-2 text-red-500">Money pit</div>
              </div>
              {/* Axis labels */}
              <span className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] uppercase tracking-wide text-muted-foreground">Value →</span>
              <span className="absolute bottom-[-18px] left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wide text-muted-foreground">Effort →</span>
              {/* Points: x = effort (1-10), y = value (1-10, inverted) */}
              {scored.map((f) => {
                const x = ((f.effort! - 1) / 9) * 100;
                const y = (1 - (f.value! - 1) / 9) * 100;
                return (
                  <button key={f.id} onClick={() => setDetailId(f.id)}
                    title={`${f.name} — value ${f.value}, effort ${f.effort}`}
                    className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow ring-2 ring-background transition hover:scale-110"
                    style={{ left: `${x}%`, top: `${y}%` }}>
                    {f.name.length > 14 ? `${f.name.slice(0, 13)}…` : f.name}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* RICE table */}
          <div>
            <h2 className="mb-2 text-sm font-semibold">RICE ranking</h2>
            {riceRanked.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add reach, impact, and confidence to features to compute RICE.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Feature</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Reach</TableHead>
                      <TableHead className="text-right">Impact</TableHead>
                      <TableHead className="text-right">Conf.</TableHead>
                      <TableHead className="text-right">Effort</TableHead>
                      <TableHead className="text-right">RICE</TableHead>
                      <TableHead className="text-right">Quadrant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {riceRanked.map((f, i) => (
                      <TableRow key={f.id} className="cursor-pointer" onClick={() => setDetailId(f.id)}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{f.name}</TableCell>
                        <TableCell><Badge className={cn('font-medium', FEATURE_STATUS_CLASS[f.status])}>{FEATURE_STATUS_LABELS[f.status]}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{f.reach ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.impact ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.confidence != null ? `${f.confidence}%` : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.effort ?? '—'}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{f.rice}</TableCell>
                        <TableCell className={cn('text-right text-xs font-medium', f.value != null && f.effort != null && QUAD_HINT[quadrant(f.value, f.effort)])}>
                          {f.value != null && f.effort != null ? quadrant(f.value, f.effort) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      <FeatureDetailSheet featureId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} onChange={() => void load()} />
    </>
  );
}
