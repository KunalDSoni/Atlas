import { useCallback, useEffect, useState } from 'react';
import { Map as MapIcon, Vote } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import type { PbFeature, Timeframe } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { FeatureDetailSheet } from '@/components/app/feature-detail-sheet';
import { FEATURE_STATUS_CLASS, FEATURE_STATUS_LABELS } from '@/lib/product';
import { cn } from '@/lib/utils';

const COLUMNS: { key: Timeframe; label: string; hint: string; accent: string }[] = [
  { key: 'now', label: 'Now', hint: 'In flight this cycle', accent: 'border-t-emerald-500' },
  { key: 'next', label: 'Next', hint: 'Coming up', accent: 'border-t-blue-500' },
  { key: 'later', label: 'Later', hint: 'On the horizon', accent: 'border-t-slate-400' },
];

export default function ProductRoadmapScreen() {
  const [features, setFeatures] = useState<PbFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Timeframe | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeatures(await api.product.features());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roadmap');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function moveTo(timeframe: Timeframe) {
    if (!dragId) return;
    const f = features.find((x) => x.id === dragId);
    setDragId(null);
    setDragOver(null);
    if (!f || f.timeframe === timeframe) return;
    // optimistic
    setFeatures((prev) => prev.map((x) => (x.id === dragId ? { ...x, timeframe } : x)));
    try {
      await api.product.updateFeature(f.id, { timeframe });
    } catch (e) {
      toast.error('Move failed', { description: e instanceof Error ? e.message : undefined });
      void load();
    }
  }

  if (loading) return (<><PageHeader title="Product roadmap" description="Now · Next · Later" /><RowsSkeleton /></>);
  if (error) return (<><PageHeader title="Product roadmap" /><ErrorState message={error} onRetry={() => void load()} /></>);

  const scheduled = features.filter((f) => f.timeframe);

  return (
    <>
      <PageHeader title="Product roadmap" description="Drag features across Now · Next · Later" />

      {scheduled.length === 0 && features.length === 0 ? (
        <EmptyState icon={MapIcon} title="Nothing on the roadmap" description="Give features a timeframe to place them here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = features.filter((f) => f.timeframe === col.key);
            return (
              <div key={col.key}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
                onDragLeave={() => setDragOver((c) => (c === col.key ? null : c))}
                onDrop={() => void moveTo(col.key)}
                className={cn('rounded-lg border border-t-2 border-border bg-muted/20 p-3 transition', col.accent,
                  dragOver === col.key && 'ring-2 ring-primary/40')}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-semibold">{col.label}</h2>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">{col.hint}</p>
                <div className="space-y-2">
                  {items.map((f) => {
                    const pct = f.delivery_total > 0 ? Math.round((f.delivery_done / f.delivery_total) * 100) : 0;
                    return (
                      <div key={f.id} draggable
                        onDragStart={() => setDragId(f.id)}
                        onDragEnd={() => { setDragId(null); setDragOver(null); }}
                        onClick={() => setDetailId(f.id)}
                        className="cursor-pointer rounded-md border border-border bg-card p-3 shadow-sm transition hover:border-primary/40">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">{f.name}</p>
                          <Badge className={cn('shrink-0 font-medium', FEATURE_STATUS_CLASS[f.status])}>{FEATURE_STATUS_LABELS[f.status]}</Badge>
                        </div>
                        {f.release_name && <p className="mt-1 text-xs text-muted-foreground">{f.release_name}</p>}
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Vote className="size-3" /> {f.vote_count}</span>
                          <span>impact {f.user_impact}</span>
                          {f.delivery_total > 0 && (
                            <span className="ml-auto flex items-center gap-1">
                              <Progress value={pct} className="h-1 w-12" /> {f.delivery_done}/{f.delivery_total}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">Drop features here</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FeatureDetailSheet featureId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} onChange={() => void load()} />
    </>
  );
}
