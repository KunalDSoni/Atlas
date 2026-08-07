import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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

const CustomTooltip: React.FC<TooltipProps> = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg">
        <p className="font-semibold text-sm">{data.name}</p>
        <p className="text-xs text-blue-600">Forecast: {data.forecast}</p>
        <p className="text-xs text-green-600">Actual: {data.actual}</p>
        <p className="text-xs text-purple-600">
          Variance: {data.variance === null ? 'N/A' : `${data.variance.toFixed(1)}%`}
        </p>
      </div>
    );
  }
  return null;
};

export const ImpactChart: React.FC<ImpactChartProps> = ({ data, title }) => {
  if (data.length === 0) {
    return <div className="text-gray-500 text-center py-8">No impact data available</div>;
  }

  // Transform data to add visible variance for the chart
  // Use absolute value of variance to display as a bar
  const chartData = data.map((item) => ({
    ...item,
    varianceAbs: item.variance === null ? 0 : Math.abs(item.variance),
  }));

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200">
      <h3 className="font-semibold mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis label={{ value: 'Value / Variance %', angle: -90, position: 'insideLeft' }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar dataKey="forecast" fill="#3b82f6" name="Forecast" />
          <Bar dataKey="actual" fill="#10b981" name="Actual" />
          <Bar dataKey="varianceAbs" fill="#f59e0b" name="Variance %" />
        </BarChart>
      </ResponsiveContainer>
      {/* Legend explanation */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs">
        <div>
          <span className="inline-block w-3 h-3 bg-blue-500 rounded mr-1.5"></span>
          Forecast
        </div>
        <div>
          <span className="inline-block w-3 h-3 bg-green-500 rounded mr-1.5"></span>
          Actual
        </div>
        <div>
          <span className="inline-block w-3 h-3 bg-amber-500 rounded mr-1.5"></span>
          Variance % (absolute)
        </div>
        <div className="text-gray-600 ml-2">Detailed variance shown in tooltip</div>
      </div>
    </div>
  );
};
