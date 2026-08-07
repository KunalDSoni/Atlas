import React, { useState } from 'react';
import { toast } from 'sonner';

interface MetricsInputProps {
  featureId: string;
  onMetricRecorded: () => void;
}

export const MetricsInput: React.FC<MetricsInputProps> = ({ featureId, onMetricRecorded }) => {
  const [metricType, setMetricType] = useState('adoption');
  const [actualValue, setActualValue] = useState('');
  const [measurementDate, setMeasurementDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const unitMap = {
    adoption: 'percentage',
    satisfaction: 'score',
    revenue: 'dollars',
    bug_rate: 'percentage',
    engagement: 'score',
  };

  const handleSubmit = async () => {
    if (!actualValue) {
      toast.error('Please enter an actual value');
      return;
    }

    const parsedValue = parseFloat(actualValue);
    if (parsedValue < 0) {
      toast.error('Value must be >= 0');
      return;
    }

    const selectedDate = new Date(measurementDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate > today) {
      toast.error('Measurement date cannot be in the future');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/product-features/${featureId}/impact-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metricType,
          actualValue: parsedValue,
          unit: unitMap[metricType as keyof typeof unitMap],
          measurementDate,
          notes,
        }),
      });

      if (res.ok) {
        setActualValue('');
        setNotes('');
        setMeasurementDate(new Date().toISOString().split('T')[0]);
        toast.success('Metric recorded successfully');
        onMetricRecorded();
      } else {
        const errorText = await res.text().catch(() => res.statusText);
        toast.error(`Failed to record metric: ${errorText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to record metric';
      toast.error(errorMessage);
      console.error('Error recording metric:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
      <h3 className="font-semibold">Record Post-Launch Metric</h3>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Metric Type
        </label>
        <select
          value={metricType}
          onChange={(e) => setMetricType(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="adoption">Adoption %</option>
          <option value="satisfaction">Satisfaction Score</option>
          <option value="revenue">Revenue Impact ($)</option>
          <option value="bug_rate">Bug Rate %</option>
          <option value="engagement">Engagement Score</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Actual Value
        </label>
        <input
          type="number"
          value={actualValue}
          onChange={(e) => setActualValue(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          placeholder="e.g., 35.5"
          step="0.1"
          min="0"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Measurement Date
        </label>
        <input
          type="date"
          value={measurementDate}
          onChange={(e) => setMeasurementDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          max={new Date().toISOString().split('T')[0]}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={2}
          placeholder="e.g., Based on analytics dashboard, measured after 2 weeks"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!actualValue || isLoading}
        className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {isLoading ? 'Recording...' : 'Record Metric'}
      </button>
    </div>
  );
};
