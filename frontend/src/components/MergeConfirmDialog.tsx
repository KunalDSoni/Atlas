import React from 'react';
import { RequestCountBadge } from './RequestCountBadge';

interface MergeConfirmDialogProps {
  parentFeature: { id: string; name: string; request_count: number };
  childFeatures: { id: string; name: string; request_count: number }[];
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const MergeConfirmDialog: React.FC<MergeConfirmDialogProps> = ({
  parentFeature,
  childFeatures,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const [reason, setReason] = React.useState('');
  const totalRequests = parentFeature.request_count + childFeatures.reduce((sum, f) => sum + f.request_count, 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Confirm Merge</h2>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Keep this feature:</label>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="font-medium">{parentFeature.name}</div>
              <div className="text-sm text-gray-500"><RequestCountBadge count={parentFeature.request_count} /></div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Merge these features:</label>
            <div className="space-y-2">
              {childFeatures.map((feature) => (
                <div key={feature.id} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="font-medium">{feature.name}</div>
                  <div className="text-sm text-gray-500"><RequestCountBadge count={feature.request_count} merged /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-sm font-medium text-blue-900">
              Combined requests: <RequestCountBadge count={totalRequests} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              rows={3}
              placeholder="e.g., Duplicate request, Same feature requested differently"
            />
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Merging...' : 'Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  );
};
