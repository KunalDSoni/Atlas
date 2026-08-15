import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { seriesColor } from '@/components/app/charts';

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

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string; payload: ImpactData }>;
  label?: string;
}

/** Series colours come from the shared ramp so this chart matches every other one. */
const FORECAST_COLOR = seriesColor(0);
const ACTUAL_COLOR = seriesColor(1);
const VARIANCE_COLOR = seriesColor(2);

const SERIES = [
  { label: 'Forecast', color: FORECAST_COLOR },
  { label: 'Actual', color: ACTUAL_COLOR },
  { label: 'Variance % (absolute)', color: VARIANCE_COLOR },
];

const CustomTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
      <p className="text-sm font-semibold">{data.name}</p>
      {/* Values wear text tokens, never the series colour — see charts.tsx. */}
      <p className="text-xs text-muted-foreground">Forecast: {data.forecast}</p>
      <p className="text-xs text-muted-foreground">Actual: {data.actual}</p>
      <p className="text-xs text-muted-foreground">
        Variance: {data.variance === null ? 'N/A' : `${data.variance.toFixed(1)}%`}
      </p>
    </div>
  );
};

export const ImpactChart: React.FC<ImpactChartProps> = ({ data, title }) => {
  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No impact data available</div>;
  }

  // A bar cannot render a negative overshoot sensibly alongside the raw values,
  // so the bar carries magnitude and the tooltip keeps the sign.
  const chartData = data.map(item => ({
    ...item,
    varianceAbs: item.variance === null ? 0 : Math.abs(item.variance),
  }));

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={11}
            label={{ value: 'Value / Variance %', angle: -90, position: 'insideLeft', fill: 'var(--muted-foreground)' }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--muted)' }} />
          <Legend />
          <Bar dataKey="forecast" fill={FORECAST_COLOR} name="Forecast" />
          <Bar dataKey="actual" fill={ACTUAL_COLOR} name="Actual" />
          <Bar dataKey="varianceAbs" fill={VARIANCE_COLOR} name="Variance %" />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-4 flex flex-wrap gap-4 text-xs">
        {SERIES.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded" style={{ background: color }} />
            {label}
          </div>
        ))}
        <div className="text-muted-foreground">Signed variance is in the tooltip</div>
      </div>

      {/* Table view for screen readers, per the chart primitives' rules. */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr><th>Feature</th><th>Forecast</th><th>Actual</th><th>Variance</th></tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.name}>
              <td>{d.name}</td>
              <td>{d.forecast}</td>
              <td>{d.actual}</td>
              <td>{d.variance === null ? 'N/A' : `${d.variance.toFixed(1)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
