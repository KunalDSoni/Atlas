import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ImpactMetricType } from '@/lib/types';

interface MetricsInputProps {
  featureId: string;
  onMetricRecorded: () => void;
}

export const MetricsInput: React.FC<MetricsInputProps> = ({ featureId, onMetricRecorded }) => {
  const [metricType, setMetricType] = useState<ImpactMetricType>('adoption');
  const [actualValue, setActualValue] = useState('');
  const [measurementDate, setMeasurementDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [acknowledgeReadOnly, setAcknowledgeReadOnly] = useState(false);
  const fieldId = useId();
  const ids = {
    type: `${fieldId}-type`,
    value: `${fieldId}-value`,
    date: `${fieldId}-date`,
    notes: `${fieldId}-notes`,
  };

  const unitMap: Record<ImpactMetricType, string> = {
    adoption: 'percentage',
    satisfaction: 'score',
    revenue: 'dollars',
    bug_rate: 'percentage',
    engagement: 'score',
  };

  // Calendar dates are compared as ISO strings, never as Date objects: the
  // field holds a YYYY-MM-DD string, and `new Date('YYYY-MM-DD')` parses it as
  // UTC midnight. Comparing that against a local-midnight Date made every date
  // read one day off for timezones ahead of UTC. The API decides both of these
  // rules the same way (feature-impact-metrics.js anchors to UTC midnight), so
  // matching it here keeps the client's warning and its guard honest.
  const todayIso = () => new Date().toISOString().slice(0, 10);

  // Past the window the measurement is still accepted — it just lands frozen,
  // as audit trail. The checkbox below makes that consequence explicit rather
  // than letting someone discover it when they try to correct a typo.
  const isReadOnly = (() => {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    return measurementDate < cutoff.toISOString().slice(0, 10);
  })();

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

    if (measurementDate > todayIso()) {
      toast.error('Measurement date cannot be in the future');
      return;
    }

    setIsLoading(true);
    try {
      const metric = await api.product.recordImpactMetric(featureId, {
        metricType,
        actualValue: parsedValue,
        unit: unitMap[metricType],
        measurementDate,
        notes: notes || undefined,
      });

      setActualValue('');
      setNotes('');
      setMeasurementDate(new Date().toISOString().split('T')[0]);
      setAcknowledgeReadOnly(false);
      toast.success(metric.editable
        ? 'Metric recorded successfully'
        : 'Metric recorded as read-only audit trail');
      onMetricRecorded();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record metric';
      toast.error(`Failed to record metric: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
      <h3 className="font-semibold">Record Post-Launch Metric</h3>

      <div>
        <label htmlFor={ids.type} className="block text-sm font-medium text-gray-700 mb-1">
          Metric Type
        </label>
        <select
          id={ids.type}
          value={metricType}
          onChange={(e) => setMetricType(e.target.value as ImpactMetricType)}
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
        <label htmlFor={ids.value} className="block text-sm font-medium text-gray-700 mb-1">
          Actual Value
        </label>
        <input
          id={ids.value}
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
        <label htmlFor={ids.date} className="block text-sm font-medium text-gray-700 mb-1">
          Measurement Date
        </label>
        <input
          id={ids.date}
          type="date"
          value={measurementDate}
          onChange={(e) => {
            setMeasurementDate(e.target.value);
            setAcknowledgeReadOnly(false);
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          max={new Date().toISOString().split('T')[0]}
        />
        {isReadOnly && (
          <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded">
            <p className="text-xs text-amber-700 mb-2">
              Warning: This measurement date is {'>30'} days in the past. It will be marked as read-only for audit trail purposes and cannot be edited after recording.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledgeReadOnly}
                onChange={(e) => setAcknowledgeReadOnly(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-xs text-amber-700">I acknowledge this metric will be read-only</span>
            </label>
          </div>
        )}
      </div>

      <div>
        <label htmlFor={ids.notes} className="block text-sm font-medium text-gray-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          id={ids.notes}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={2}
          placeholder="e.g., Based on analytics dashboard, measured after 2 weeks"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!actualValue || isLoading || (isReadOnly && !acknowledgeReadOnly)}
        className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        title={isReadOnly && !acknowledgeReadOnly ? 'Please acknowledge the read-only status' : ''}
      >
        {isLoading ? 'Recording...' : 'Record Metric'}
      </button>
    </div>
  );
};
