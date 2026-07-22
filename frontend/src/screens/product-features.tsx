import { useCallback, useEffect, useMemo, useState } from 'react';
import { DollarSign, Lightbulb, Plus, Users2, Vote, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import type { PbFeature } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { FeatureDetailSheet } from '@/components/app/feature-detail-sheet';
import {
  FEATURE_STATUS_CLASS, FEATURE_STATUS_LABELS, FEATURE_STATUS_OPTIONS,
  TIMEFRAME_LABELS, TIMEFRAME_OPTIONS,
} from '@/lib/product';
import { formatArr } from '@/lib/format';
import { cn } from '@/lib/utils';

type SortKey = 'user_impact' | 'demand' | 'rice' | 'vote_count';

export default function ProductFeaturesScreen() {
  const { projects } = useProjects();
  const [features, setFeatures] = useState<PbFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [timeframeFilter, setTimeframeFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('user_impact');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', project_id: '', status: 'idea', timeframe: '' });

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

  const shown = useMemo(() => {
    let list = features;
    if (statusFilter !== 'all') list = list.filter((f) => f.status === statusFilter);
    if (timeframeFilter !== 'all') list = list.filter((f) => f.timeframe === timeframeFilter);
    return [...list].sort((a, b) => (Number(b[sort] ?? 0) - Number(a[sort] ?? 0)));
  }, [features, statusFilter, timeframeFilter, sort]);

  async function create() {
    if (!form.name.trim()) return;
    try {
      const f = await api.product.createFeature({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        project_id: form.project_id || undefined,
        status: form.status as PbFeature['status'],
        timeframe: (form.timeframe || undefined) as PbFeature['timeframe'],
      });
      setCreateOpen(false);
      setForm({ name: '', description: '', project_id: '', status: 'idea', timeframe: '' });
      toast.success('Feature created');
      void load();
      setDetailId(f.id);
    } catch (e) {
      toast.error('Create failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) return (<><PageHeader title="Features" description="Prioritized product backlog" /><RowsSkeleton /></>);
  if (error) return (<><PageHeader title="Features" /><ErrorState message={error} onRetry={() => void load()} /></>);

  return (
    <>
      <PageHeader
        title="Features"
        description="Everything you might build, ranked by evidence"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New feature</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {FEATURE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{FEATURE_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={timeframeFilter} onValueChange={setTimeframeFilter}>
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All timeframes</SelectItem>
            {TIMEFRAME_OPTIONS.map((t) => <SelectItem key={t} value={t}>{TIMEFRAME_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user_impact">Sort: User impact</SelectItem>
            <SelectItem value="demand">Sort: Demand (ARR)</SelectItem>
            <SelectItem value="rice">Sort: RICE</SelectItem>
            <SelectItem value="vote_count">Sort: Votes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Lightbulb} title="No features yet" description="Create a feature to start prioritizing."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New feature</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Timeframe</TableHead>
                <TableHead className="text-right"><span className="inline-flex items-center gap-1"><Users2 className="size-3.5" /> Impact</span></TableHead>
                <TableHead className="text-right"><span className="inline-flex items-center gap-1"><DollarSign className="size-3.5" /> Demand</span></TableHead>
                <TableHead className="text-right"><span className="inline-flex items-center gap-1"><TrendingUp className="size-3.5" /> RICE</span></TableHead>
                <TableHead className="text-right"><span className="inline-flex items-center gap-1"><Vote className="size-3.5" /> Votes</span></TableHead>
                <TableHead className="text-right">Delivery</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((f) => (
                <TableRow key={f.id} className="cursor-pointer" onClick={() => setDetailId(f.id)}>
                  <TableCell className="max-w-xs">
                    <p className="truncate font-medium">{f.name}</p>
                    {f.project_key && <span className="text-xs text-muted-foreground">{f.project_key}</span>}
                  </TableCell>
                  <TableCell><Badge className={cn('font-medium', FEATURE_STATUS_CLASS[f.status])}>{FEATURE_STATUS_LABELS[f.status]}</Badge></TableCell>
                  <TableCell>{f.timeframe ? <Badge variant="outline">{TIMEFRAME_LABELS[f.timeframe]}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{f.user_impact}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.demand > 0 ? formatArr(f.demand) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.rice ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.vote_count}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{f.delivery_total > 0 ? `${f.delivery_done}/${f.delivery_total}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FeatureDetailSheet featureId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} onChange={() => void load()} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New feature</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Feature name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            <div className="grid grid-cols-2 gap-3">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FEATURE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{FEATURE_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={form.timeframe || 'none'} onValueChange={(v) => setForm({ ...form, timeframe: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Timeframe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unscheduled</SelectItem>
                  {TIMEFRAME_OPTIONS.map((t) => <SelectItem key={t} value={t}>{TIMEFRAME_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Select value={form.project_id || 'none'} onValueChange={(v) => setForm({ ...form, project_id: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Delivery project (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void create()} disabled={!form.name.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
