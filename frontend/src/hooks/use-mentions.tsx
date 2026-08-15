// The @ picker, as a hook over a controlled textarea or input.
//
// This replaces a wrapper component that cloned a ref and handlers onto a child
// it did not own. That approach failed twice over: the ref never attached to
// the non-forwardRef Textarea, so insertion was dead, and the wrapper <div>
// collapsed inside flex parents, visibly breaking the comment composer. A hook
// owns no DOM, so neither failure is possible.
//
// Usage:
//   const m = useMentions({ projectId, value, onChange: setValue });
//   <Textarea value={value} {...m.inputProps} ref={m.ref} />
//   {m.dropdown}

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { findMentionQuery, insertMention } from '@/lib/mentions';
import { getCaretCoordinates, type CaretPoint } from '@/lib/caret-coordinates';
import { MentionDropdown } from '@/components/app/mention-dropdown';
import type { MentionCandidate } from '@/lib/types';

type Field = HTMLTextAreaElement | HTMLInputElement;

const DEBOUNCE_MS = 150;

export interface UseMentionsOptions {
  /** Scopes the lookup so project members rank first. Optional — without it
   *  everyone is searchable and flagged as a non-member. */
  projectId?: string;
  value: string;
  onChange: (next: string) => void;
}

export function useMentions({ projectId, value, onChange }: UseMentionsOptions) {
  const listId = useId();
  const fieldRef = useRef<Field | null>(null);
  const [items, setItems] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<CaretPoint | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  // Set when the user presses Escape, cleared once they leave this query.
  // Without it the very next keystroke reopens the list they just dismissed.
  const dismissedAt = useRef<number | null>(null);
  // Caret to restore after a state-driven re-render, since assigning `value`
  // moves it to the end of the field.
  const pendingCaret = useRef<number | null>(null);

  const close = useCallback(() => {
    setQuery(null);
    setItems([]);
    setAnchor(null);
    setActiveIndex(0);
  }, []);

  /** Recompute the active query from wherever the caret now is. */
  const sync = useCallback((field: Field) => {
    const caret = field.selectionStart ?? 0;
    const found = findMentionQuery(field.value, caret);

    if (!found) {
      dismissedAt.current = null;
      close();
      return;
    }
    if (dismissedAt.current === found.start) return; // dismissed, still here
    dismissedAt.current = null;

    setQuery(found.query);
    setAnchor(getCaretCoordinates(field, found.start));
  }, [close]);

  // Fetch candidates for the active query. A failed lookup simply yields no
  // dropdown — typing must never be interrupted by a network problem.
  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.mentions.search(query, projectId)
        .then((rows) => { if (!cancelled) { setItems(rows); setActiveIndex(0); } })
        .catch(() => { if (!cancelled) setItems([]); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, projectId]);

  // Restore the caret after React re-renders the field with the new value.
  useEffect(() => {
    if (pendingCaret.current === null || !fieldRef.current) return;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    fieldRef.current.setSelectionRange(caret, caret);
  }, [value]);

  const pick = useCallback((user: MentionCandidate) => {
    const field = fieldRef.current;
    if (!field) return;
    const result = insertMention(field.value, field.selectionStart ?? 0, user);
    pendingCaret.current = result.caret;
    onChange(result.text);
    close();
  }, [onChange, close]);

  const open = query !== null && items.length > 0;

  const onKeyDown = useCallback((e: React.KeyboardEvent<Field>) => {
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(items.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        pick(items[activeIndex]);
        break;
      case 'Escape': {
        e.preventDefault();
        const field = e.currentTarget;
        const found = findMentionQuery(field.value, field.selectionStart ?? 0);
        dismissedAt.current = found ? found.start : null;
        close();
        break;
      }
    }
  }, [open, items, activeIndex, pick, close]);

  return {
    ref: (el: Field | null) => { fieldRef.current = el; },

    inputProps: {
      onChange: (e: React.ChangeEvent<Field>) => {
        onChange(e.currentTarget.value);
        sync(e.currentTarget);
      },
      onKeyDown,
      // Moving the caret with the mouse or arrows can land inside or outside a
      // mention; either way the list must agree with where the caret now is.
      onSelect: (e: React.SyntheticEvent<Field>) => sync(e.currentTarget),
      onBlur: close,
      role: 'combobox' as const,
      'aria-expanded': open,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? `${listId}-opt-${activeIndex}` : undefined,
      'aria-autocomplete': 'list' as const,
    },

    dropdown: (
      <MentionDropdown
        open={open}
        id={listId}
        items={items}
        activeIndex={activeIndex}
        anchor={anchor}
        onPick={pick}
        onHover={setActiveIndex}
      />
    ),
  };
}
