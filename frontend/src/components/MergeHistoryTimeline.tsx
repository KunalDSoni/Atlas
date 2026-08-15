import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { PbMergeHistoryEntry } from '@/lib/types';

/** The server refuses an undo past this age, so the button matches that rule. */
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

interface MergeHistoryTimelineProps {
  featureId: string;
  onUnmerge: (childFeatureId: string) => void;
  /** Bumped by the parent after a merge or undo so the list refetches. */
  refreshKey?: number;
}

function timeAgo(from: Date): string {
  const elapsed = Date.now() - from.getTime();
  const days = Math.floor(elapsed / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(elapsed / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h ago`;
  return 'just now';
}

export const MergeHistoryTimeline: React.FC<MergeHistoryTimelineProps> = ({
  featureId,
  onUnmerge,
  refreshKey = 0,
}) => {
  const [history, setHistory] = useState<PbMergeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHistory(await api.product.mergeHistory(featureId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load merge history');
    } finally {
      setLoading(false);
    }
  }, [featureId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading history...</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (history.length === 0) return <div className="text-sm text-muted-foreground">No merge history</div>;

  return (
    <div className="space-y-2">
      {history.map(entry => {
        const mergedAt = new Date(entry.merged_at);
        const canUnmerge = Date.now() - mergedAt.getTime() < UNDO_WINDOW_MS;

        return (
          <div key={entry.id} className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                Merged{' '}
                <span className="font-medium">
                  +{entry.child_request_count} request{entry.child_request_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{timeAgo(mergedAt)}</div>
            </div>
            {canUnmerge && (
              <Button variant="ghost" size="sm" onClick={() => onUnmerge(entry.child_feature_id)}>
                Undo
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
};
