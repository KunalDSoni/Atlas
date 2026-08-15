import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import type { ImpactMetricType } from '@/lib/types';

interface MetricsInputProps {
  featureId: string;
  onMetricRecorded: () => void;
}

const METRIC_LABELS: Record<ImpactMetricType, string> = {
  adoption: 'Adoption %',
  satisfaction: 'Satisfaction score',
  revenue: 'Revenue impact ($)',
  bug_rate: 'Bug rate %',
  engagement: 'Engagement score',
};

const UNITS: Record<ImpactMetricType, string> = {
  adoption: 'percentage',
  satisfaction: 'score',
  revenue: 'dollars',
  bug_rate: 'percentage',
  engagement: 'score',
};

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
        unit: UNITS[metricType],
        measurementDate,
        notes: notes || undefined,
      });

      setActualValue('');
      setNotes('');
      setMeasurementDate(new Date().toISOString().split('T')[0]);
      setAcknowledgeReadOnly(false);
      toast.success(metric.editable
        ? 'Metric recorded'
        : 'Metric recorded as read-only audit trail');
      onMetricRecorded();
    } catch (error) {
      toast.error('Failed to record metric', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <h4 className="font-semibold">Record post-launch metric</h4>

      <div className="space-y-1.5">
        <Label htmlFor={ids.type}>Metric type</Label>
        <Select value={metricType} onValueChange={v => setMetricType(v as ImpactMetricType)}>
          <SelectTrigger id={ids.type}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(METRIC_LABELS) as ImpactMetricType[]).map(type => (
              <SelectItem key={type} value={type}>{METRIC_LABELS[type]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.value}>Actual value</Label>
        <Input
          id={ids.value}
          type="number"
          value={actualValue}
          onChange={e => setActualValue(e.target.value)}
          placeholder="e.g. 35.5"
          step="0.1"
          min="0"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.date}>Measurement date</Label>
        <Input
          id={ids.date}
          type="date"
          value={measurementDate}
          onChange={e => {
            setMeasurementDate(e.target.value);
            setAcknowledgeReadOnly(false);
          }}
          max={todayIso()}
        />
        {isReadOnly && (
          <div className="mt-2 space-y-2 rounded border bg-warning-muted p-2 text-warning-foreground">
            <p className="text-xs">
              This measurement date is more than 30 days in the past. It will be recorded
              read-only as audit trail and cannot be edited afterwards.
            </p>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={acknowledgeReadOnly}
                onCheckedChange={checked => setAcknowledgeReadOnly(checked === true)}
                // Explicit: Radix renders a button, not an input, so the
                // wrapping <label> alone does not name it for assistive tech.
                aria-label="I acknowledge this metric will be read-only"
              />
              <span className="text-xs">I acknowledge this metric will be read-only</span>
            </label>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.notes}>Notes (optional)</Label>
        <Textarea
          id={ids.notes}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. from the analytics dashboard, measured after 2 weeks"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!actualValue || isLoading || (isReadOnly && !acknowledgeReadOnly)}
        className="w-full"
        title={isReadOnly && !acknowledgeReadOnly ? 'Please acknowledge the read-only status' : undefined}
      >
        {isLoading ? 'Recording…' : 'Record metric'}
      </Button>
    </div>
  );
};
