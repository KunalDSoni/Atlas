import React, { useEffect, useState } from 'react';
import { RequestCountBadge } from './RequestCountBadge';

interface MergeSuggestion {
  feature: { id: string; name: string; request_count: number };
  similarity: number;
}

interface MergeSuggestionsProps {
  featureId: string;
  onSelectForMerge: (childIds: string[]) => void;
  isLoading?: boolean;
}

export const MergeSuggestions: React.FC<MergeSuggestionsProps> = ({
  featureId,
  onSelectForMerge,
  isLoading = false,
}) => {
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`/api/product-features/${featureId}/merge-candidates`);
        const data = await res.json();
        setSuggestions(data.data || []);
      } catch (error) {
        console.error('Failed to fetch merge candidates:', error);
      }
    };

    fetchSuggestions();
  }, [featureId]);

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const handleMerge = () => {
    if (selected.size > 0) {
      onSelectForMerge(Array.from(selected));
      setSelected(new Set());
    }
  };

  if (isLoading) {
    return <div className="text-gray-500">Loading suggestions...</div>;
  }

  if (suggestions.length === 0) {
    return <div className="text-gray-500">No duplicate features found</div>;
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-lg divide-y">
        {suggestions.map((suggestion) => (
          <div key={suggestion.feature.id} className="p-3 flex items-center gap-3">
            <input
              type="checkbox"
              checked={selected.has(suggestion.feature.id)}
              onChange={() => toggleSelection(suggestion.feature.id)}
              className="rounded border-gray-300"
            />
            <div className="flex-1">
              <div className="font-medium">{suggestion.feature.name}</div>
              <div className="text-sm text-gray-500">
                {Math.round(suggestion.similarity * 100)}% match • <RequestCountBadge count={suggestion.feature.request_count} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {selected.size > 0 && (
        <button
          onClick={handleMerge}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Merge {selected.size} Feature{selected.size !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
};
