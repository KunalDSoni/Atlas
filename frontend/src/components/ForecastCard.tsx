import React, { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

interface ForecastCardProps {
  featureId: string;
  forecastAdoption?: number | null;
  forecastRevenue?: number | null;
  onSave: () => void;
}

export const ForecastCard: React.FC<ForecastCardProps> = ({
  featureId,
  forecastAdoption,
  forecastRevenue,
  onSave,
}) => {
  const [adoption, setAdoption] = useState(forecastAdoption ?? 0);
  const [revenue, setRevenue] = useState(forecastRevenue ?? 0);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fieldId = useId();
  const adoptionFieldId = `${fieldId}-adoption`;
  const revenueFieldId = `${fieldId}-revenue`;

  // onSave() refetches the feature upstream, so the props change under us.
  // Without this the card keeps showing the pre-save values until remount —
  // and worse, a later edit would submit stale numbers. Skip while editing so
  // a background refresh cannot yank the field out from under the typist.
  useEffect(() => {
    if (isEditing) return;
    setAdoption(forecastAdoption ?? 0);
    setRevenue(forecastRevenue ?? 0);
  }, [forecastAdoption, forecastRevenue, isEditing]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await api.product.saveForecast(featureId, {
        forecastAdoption: adoption,
        forecastRevenue: revenue,
      });
      setIsEditing(false);
      onSave();
      toast.success('Forecast saved');
    } catch (error) {
      toast.error('Failed to save forecast', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-lg border bg-primary-muted p-4">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="font-semibold text-accent-foreground">Pre-launch forecast</h4>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={adoptionFieldId}>Expected adoption %</Label>
            <Input
              id={adoptionFieldId}
              type="number"
              value={adoption}
              onChange={e => setAdoption(parseFloat(e.target.value) || 0)}
              min="0"
              max="100"
              step="0.1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={revenueFieldId}>Expected revenue ($)</Label>
            <Input
              id={revenueFieldId}
              type="number"
              value={revenue}
              onChange={e => setRevenue(parseFloat(e.target.value) || 0)}
              min="0"
              step="100"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isLoading} className="flex-1">
              {isLoading ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outline" onClick={() => setIsEditing(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Adoption</span>
            <span className="font-medium">{adoption}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Revenue</span>
            <span className="font-medium">${revenue.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};
