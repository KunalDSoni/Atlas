import { useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Add/remove issue labels. The API stores them as a JSON string in `labels` and
 * returns the decoded array as `labels_parsed`, so callers hand us the array and
 * get an array back — the encoding stays at the call site.
 */
export function LabelsEditor({
  labels,
  canEdit,
  onChange,
}: {
  labels: string[];
  canEdit: boolean;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (!value) return;
    // Case-insensitive de-dupe; labels are a set, not a list.
    if (labels.some((l) => l.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      setOpen(false);
      return;
    }
    onChange([...labels, value]);
    setDraft('');
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
    if (e.key === 'Escape') {
      setDraft('');
      setOpen(false);
    }
  }

  if (!canEdit && labels.length === 0) {
    return <p className="text-sm text-faint">No labels.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {labels.map((l) => (
        <Badge key={l} variant="secondary" className="gap-1 rounded-sm px-1.5 py-0 text-[11px] font-medium">
          {l}
          {canEdit && (
            <button
              type="button"
              onClick={() => onChange(labels.filter((x) => x !== l))}
              aria-label={`Remove label ${l}`}
              className="-mr-0.5 rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}

      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground">
              <Plus className="size-3" /> Label
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Label name"
              aria-label="New label"
              className="h-8 text-sm"
            />
            <div className="mt-2 flex justify-end gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={add} disabled={!draft.trim()}>
                Add
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
