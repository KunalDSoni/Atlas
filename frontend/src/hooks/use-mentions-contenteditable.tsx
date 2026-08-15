// The @ picker for the wiki's contentEditable body.
//
// A separate hook from useMentions because contentEditable shares almost
// nothing with a textarea: there is no `value`, no selectionStart, and the
// caret lives in a Selection over a text node rather than at an integer offset.
// What it does share is the trigger grammar and the dropdown, both imported
// rather than re-stated, so the two surfaces cannot disagree about what opens a
// mention.
//
// Insertion produces a `<span data-mention-id>` — the HTML form of the same
// reference the plain-text surfaces store as a token.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { findMentionQuery } from '@/lib/mentions';
import { MentionDropdown } from '@/components/app/mention-dropdown';
import type { MentionCandidate } from '@/lib/types';

const DEBOUNCE_MS = 150;

interface ActiveQuery {
  node: Text;
  /** Offset of the '@' within the text node. */
  start: number;
  /** Offset of the caret within the text node. */
  caret: number;
  query: string;
}

export function useContentEditableMentions({
  editorRef,
  onInserted,
}: {
  editorRef: React.RefObject<HTMLElement | null>;
  /** Fired after a mention is inserted, so the editor can persist its HTML. */
  onInserted: () => void;
}) {
  const listId = useId();
  const [items, setItems] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number; lineHeight: number } | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const activeQuery = useRef<ActiveQuery | null>(null);
  const dismissed = useRef(false);

  const close = useCallback(() => {
    activeQuery.current = null;
    setQuery(null);
    setItems([]);
    setAnchor(null);
    setActiveIndex(0);
  }, []);

  /** Read the caret out of the live Selection and see if it sits in a query. */
  const sync = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return close();

    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return close();
    if (!editorRef.current?.contains(node)) return close();

    const text = node.textContent || '';
    const caret = sel.anchorOffset;
    const found = findMentionQuery(text, caret);
    if (!found) { dismissed.current = false; return close(); }
    if (dismissed.current) return;

    activeQuery.current = { node: node as Text, start: found.start, caret, query: found.query };

    // Measure the span from '@' to the caret. A collapsed range can report an
    // empty rect, so when nothing is typed yet measure the '@' itself.
    const range = document.createRange();
    range.setStart(node, found.start);
    range.setEnd(node, Math.max(caret, found.start + 1));
    const rect = range.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.top, lineHeight: rect.height || 20 });
    setQuery(found.query);
  }, [close, editorRef]);

  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.mentions.search(query)
        .then((rows) => { if (!cancelled) { setItems(rows); setActiveIndex(0); } })
        .catch(() => { if (!cancelled) setItems([]); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const pick = useCallback((user: MentionCandidate) => {
    const active = activeQuery.current;
    if (!active) return;

    const range = document.createRange();
    range.setStart(active.node, active.start);
    range.setEnd(active.node, active.caret);
    range.deleteContents();

    const badge = document.createElement('span');
    badge.setAttribute('data-mention-id', user.id);
    badge.className = 'mention';
    badge.textContent = `@${user.name}`;
    range.insertNode(badge);

    // A non-breaking space keeps the caret outside the badge; a plain space at
    // the end of a block would collapse and let the next keystroke land inside
    // the mention.
    const spacer = document.createTextNode(' ');
    badge.after(spacer);

    const sel = window.getSelection();
    const after = document.createRange();
    after.setStartAfter(spacer);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);

    close();
    onInserted();
  }, [close, onInserted]);

  const open = query !== null && items.length > 0;

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
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
      case 'Escape':
        e.preventDefault();
        dismissed.current = true;
        close();
        break;
    }
  }, [open, items, activeIndex, pick, close]);

  return {
    /** Spread onto the contentEditable element, after its own handlers. */
    editorProps: { onKeyUp: sync, onMouseUp: sync, onKeyDown },
    close,
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
