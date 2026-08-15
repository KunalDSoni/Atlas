import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import type { PbMergeCandidate } from '@/lib/types';
import { RequestCountBadge } from './RequestCountBadge';

interface MergeSuggestionsProps {
  featureId: string;
  onSelectForMerge: (childIds: string[]) => void;
  isLoading?: boolean;
  /** Bumped by the parent after a merge or undo so the list refetches. */
  refreshKey?: number;
}

export const MergeSuggestions: React.FC<MergeSuggestionsProps> = ({
  featureId,
  onSelectForMerge,
  isLoading = false,
  refreshKey = 0,
}) => {
  const [suggestions, setSuggestions] = useState<PbMergeCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.product.mergeCandidates(featureId)
      .then(candidates => {
        if (cancelled) return;
        setSuggestions(candidates);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Surfaced rather than swallowed to the console: a failure here used to
        // be indistinguishable from "no duplicates found", which is the answer
        // a broken request is most likely to be mistaken for.
        setError(e instanceof Error ? e.message : 'Failed to load merge candidates');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [featureId, refreshKey]);

  const toggleSelection = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMerge = () => {
    if (selected.size === 0) return;
    onSelectForMerge(Array.from(selected));
    setSelected(new Set());
  };

  if (isLoading || loading) {
    return <div className="text-sm text-muted-foreground">Loading suggestions...</div>;
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  if (suggestions.length === 0) {
    return <div className="text-sm text-muted-foreground">No duplicate features found</div>;
  }

  return (
    <div className="space-y-3">
      <div className="divide-y rounded-lg border bg-card">
        {suggestions.map(({ feature, similarity }) => (
          <label
            key={feature.id}
            className="flex cursor-pointer items-center gap-3 p-3 first:rounded-t-lg last:rounded-b-lg hover:bg-muted/50"
          >
            <Checkbox
              checked={selected.has(feature.id)}
              onCheckedChange={() => toggleSelection(feature.id)}
              aria-label={`Select ${feature.name} to merge`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{feature.name}</div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {Math.round(similarity * 100)}% match
                <span aria-hidden>•</span>
                <RequestCountBadge count={feature.request_count} />
              </div>
            </div>
          </label>
        ))}
      </div>
      {selected.size > 0 && (
        <Button onClick={handleMerge} size="sm">
          Merge {selected.size} feature{selected.size !== 1 ? 's' : ''}
        </Button>
      )}
    </div>
  );
};
