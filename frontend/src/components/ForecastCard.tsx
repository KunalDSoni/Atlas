import React, { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
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
      toast.success('Forecast saved successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save forecast';
      toast.error(`Failed to save forecast: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-blue-900">Pre-Launch Forecast</h3>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor={adoptionFieldId} className="block text-sm font-medium text-gray-700 mb-1">
              Expected Adoption %
            </label>
            <input
              id={adoptionFieldId}
              type="number"
              value={adoption}
              onChange={(e) => setAdoption(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              min="0"
              max="100"
              step="0.1"
            />
          </div>
          <div>
            <label htmlFor={revenueFieldId} className="block text-sm font-medium text-gray-700 mb-1">
              Expected Revenue ($)
            </label>
            <input
              id={revenueFieldId}
              type="number"
              value={revenue}
              onChange={(e) => setRevenue(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              min="0"
              step="100"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-700">Adoption:</span>
            <span className="font-medium">{adoption}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">Revenue:</span>
            <span className="font-medium">${revenue.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};
