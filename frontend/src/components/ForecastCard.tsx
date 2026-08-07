import React, { useState } from 'react';
import { toast } from 'sonner';

interface ForecastCardProps {
  featureId: string;
  forecastAdoption?: number;
  forecastRevenue?: number;
  onSave: () => void;
}

export const ForecastCard: React.FC<ForecastCardProps> = ({
  featureId,
  forecastAdoption = 0,
  forecastRevenue = 0,
  onSave,
}) => {
  const [adoption, setAdoption] = useState(forecastAdoption);
  const [revenue, setRevenue] = useState(forecastRevenue);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/product-features/${featureId}/forecast-metrics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forecastAdoption: adoption || null,
          forecastRevenue: revenue || null,
        }),
      });

      if (res.ok) {
        setIsEditing(false);
        onSave();
        toast.success('Forecast saved successfully');
      } else {
        const errorText = await res.text().catch(() => res.statusText);
        toast.error(`Failed to save forecast: ${errorText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save forecast';
      toast.error(errorMessage);
      console.error('Error saving forecast:', error);
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected Adoption %
            </label>
            <input
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected Revenue ($)
            </label>
            <input
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
