import { useCallback, useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { ImpactChart } from '@/components/ImpactChart';
import { api } from '@/lib/api';
import type { PbImpactDashboard } from '@/lib/types';

/** Renders a variance that may legitimately be 0 — `0%` is a result, not "no data". */
function formatVariance(v: number | null | undefined): string {
  return v === null || v === undefined ? 'N/A' : `${v.toFixed(1)}%`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

export default function ProductImpactScreen() {
  const [summary, setSummary] = useState<PbImpactDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.product.impactDashboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the impact dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const header = (
    <PageHeader
      title="Impact"
      description="What launched features actually did, against what we forecast"
    />
  );

  if (loading) return (<>{header}<RowsSkeleton /></>);
  if (error) return (<>{header}<ErrorState message={error} onRetry={() => void load()} /></>);

  // The server only returns features carrying a recorded actual, so an empty
  // list means nothing has been measured yet — not that nothing has launched.
  if (!summary || summary.features.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Gauge}
          title="No measurements yet"
          description="Record a post-launch metric on a launched feature and it will show up here against its forecast."
        />
      </>
    );
  }

  const chartData = summary.features.map(f => {
    const forecast = f.forecast_adoption ?? 0;
    const actual = f.actual_adoption ?? 0;
    return {
      name: f.name,
      forecast,
      actual,
      variance: forecast === 0 ? null : ((actual - forecast) / forecast) * 100,
    };
  });

  return (
    <>
      {header}
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Features analyzed" value={summary.total_features_analyzed} />
          <StatCard label="Avg adoption variance" value={formatVariance(summary.avg_adoption_variance)} />
          <StatCard label="Avg revenue variance" value={formatVariance(summary.avg_revenue_variance)} />
        </div>

        <ImpactChart data={chartData} title="Adoption: forecast vs actual" />
      </div>
    </>
  );
}
