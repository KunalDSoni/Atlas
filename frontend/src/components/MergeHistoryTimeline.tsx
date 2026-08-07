import React, { useEffect, useState } from 'react';

interface MergeHistory {
  id: string;
  child_feature_id: string;
  merged_by_id: string;
  merged_at: string;
  child_request_count: number;
}

interface MergeHistoryTimelineProps {
  featureId: string;
  onUnmerge: (childFeatureId: string) => void;
}

export const MergeHistoryTimeline: React.FC<MergeHistoryTimelineProps> = ({ featureId, onUnmerge }) => {
  const [history, setHistory] = useState<MergeHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/product-features/${featureId}/merge-history`);
        const data = await res.json();
        setHistory(data.data || []);
      } catch (error) {
        console.error('Failed to fetch merge history:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [featureId]);

  if (loading) return <div className="text-gray-500">Loading history...</div>;
  if (history.length === 0) return <div className="text-gray-500">No merge history</div>;

  return (
    <div className="space-y-2">
      {history.map((entry) => {
        const mergedAt = new Date(entry.merged_at);
        const canUnmerge = Date.now() - mergedAt.getTime() < 24 * 60 * 60 * 1000;
        const daysAgo = Math.floor((Date.now() - mergedAt.getTime()) / (1000 * 60 * 60 * 24));
        const hoursAgo = Math.floor(((Date.now() - mergedAt.getTime()) % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        let timeLabel = '';
        if (daysAgo > 0) timeLabel = `${daysAgo}d ago`;
        else if (hoursAgo > 0) timeLabel = `${hoursAgo}h ago`;
        else timeLabel = 'just now';

        return (
          <div key={entry.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm text-gray-900">
                Merged <span className="font-medium">+{entry.child_request_count} request{entry.child_request_count !== 1 ? 's' : ''}</span>
              </div>
              <div className="text-xs text-gray-500">{timeLabel}</div>
            </div>
            {canUnmerge && (
              <button
                onClick={() => onUnmerge(entry.child_feature_id)}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                Undo
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
