import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ImpactChart } from '../components/ImpactChart';

interface FeatureImpact {
  id: string;
  name: string;
  forecast_adoption?: number;
  actual_adoption?: number;
  forecast_revenue?: number;
  actual_revenue?: number;
}

interface ImpactSummary {
  total_features_analyzed: number;
  avg_adoption_variance?: number;
  avg_revenue_variance?: number;
  features: FeatureImpact[];
}

export const ImpactDashboard: React.FC = () => {
  const [summary, setSummary] = useState<ImpactSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const res = await fetch('/api/product-features/impact-dashboard');
        if (!res.ok) {
          throw new Error(`Failed to fetch impact dashboard: ${res.statusText}`);
        }
        const data = await res.json();
        setSummary(data.data);
        setError(null);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch impact dashboard';
        setError(errorMessage);
        toast.error(errorMessage);
        console.error('Failed to fetch impact dashboard:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  if (loading) return <div className="p-6">Loading...</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!summary) return <div className="p-6">No data</div>;

  const chartData = summary.features.map((f: any) => {
    const forecast = f.forecast_adoption || 0;
    const actual = f.actual_adoption || 0;
    const variance = forecast && forecast !== 0
      ? ((actual - forecast) / forecast * 100)
      : 0;

    return {
      name: f.name.substring(0, 20),
      forecast,
      actual,
      variance,
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
          <div className="text-3xl font-bold">
            {summary.avg_adoption_variance ? `${summary.avg_adoption_variance.toFixed(1)}%` : 'N/A'}
          </div>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Avg Revenue Variance</div>
          <div className="text-3xl font-bold">
            {summary.avg_revenue_variance ? `${summary.avg_revenue_variance.toFixed(1)}%` : 'N/A'}
          </div>
        </div>
      </div>

      <ImpactChart data={chartData} title="Adoption: Forecast vs Actual" />
    </div>
  );
};
