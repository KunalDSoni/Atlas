import React from 'react';
import { DataTable, GroupedColumns } from '@/components/app/charts';

interface ImpactData {
  name: string;
  forecast: number;
  actual: number;
  /** Null when there is no forecast to compare against — distinct from 0%. */
  variance: number | null;
}

interface ImpactChartProps {
  data: ImpactData[];
  title: string;
}

const formatVariance = (v: number | null) => (v === null ? 'N/A' : `${v.toFixed(1)}%`);

/**
 * Forecast vs actual per feature.
 *
 * Drawn with the shared chart primitives rather than a charting library: this
 * was the only recharts caller in the app, and it cost 384 kB — larger than
 * every other lazy screen chunk combined — for one three-series column chart
 * the primitives already draw. They also carry the rules this chart was
 * breaking anyway: series colour by fixed identity, values in text ink rather
 * than the series colour, and a data table for screen readers.
 */
export const ImpactChart: React.FC<ImpactChartProps> = ({ data, title }) => {
  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No impact data available</div>;
  }

  // A column carries magnitude only, so an overshoot and a shortfall of the
  // same size draw alike. The sign stays on the hover label and in the table.
  const groups = data.map(d => ({
    label: d.name,
    values: [d.forecast, d.actual, d.variance === null ? 0 : Math.abs(d.variance)],
  }));

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 font-semibold">{title}</h3>

      <GroupedColumns
        groups={groups}
        series={['Forecast', 'Actual', 'Variance % (absolute)']}
      />

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground">Show data</summary>
        <div className="mt-2">
          <DataTable
            caption={title}
            columns={['Feature', 'Forecast', 'Actual', 'Variance']}
            rows={data.map(d => [d.name, d.forecast, d.actual, formatVariance(d.variance)])}
          />
        </div>
      </details>
    </div>
  );
};
