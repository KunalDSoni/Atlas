import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ImpactChart } from '@/components/ImpactChart';
import { api } from '@/lib/api';
import type { PbImpactDashboard } from '@/lib/types';

/** Renders a variance that may legitimately be 0 — `0%` is a result, not "no data". */
function formatVariance(v: number | null | undefined): string {
  return v === null || v === undefined ? 'N/A' : `${v.toFixed(1)}%`;
}

export const ImpactDashboard: React.FC = () => {
  const [summary, setSummary] = useState<PbImpactDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadDashboard = async () => {
      try {
        const data = await api.product.impactDashboard();
        if (cancelled) return;
        setSummary(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch impact dashboard';
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadDashboard();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="p-6">Loading...</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!summary) return <div className="p-6">No data</div>;

  const chartData = summary.features.map((f) => {
    const forecast = f.forecast_adoption ?? 0;
    const actual = f.actual_adoption ?? 0;
    return {
      name: f.name.substring(0, 20),
      forecast,
      actual,
      variance: forecast === 0 ? null : ((actual - forecast) / forecast) * 100,
    };
  });

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Features Analyzed</div>
          <div className="text-3xl font-bold">{summary.total_features_analyzed}</div>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Avg Adoption Variance</div>
          <div className="text-3xl font-bold">{formatVariance(summary.avg_adoption_variance)}</div>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Avg Revenue Variance</div>
          <div className="text-3xl font-bold">{formatVariance(summary.avg_revenue_variance)}</div>
        </div>
      </div>

      <ImpactChart data={chartData} title="Adoption: Forecast vs Actual" />
    </div>
  );
};

// Default export to match the lazy-loaded screen convention in App.tsx.
export default ImpactDashboard;
