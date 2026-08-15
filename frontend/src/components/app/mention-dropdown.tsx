// The @ picker's option list.
//
// Rendered in a portal with position: fixed. It has to escape its composer —
// dialogs and sheets clip overflow, and the previous absolutely-positioned
// version was trapped inside a wrapper div that also broke the composer's
// layout. Nothing is nested inside the field's own subtree.

import { createPortal } from 'react-dom';
import type { MentionCandidate } from '@/lib/types';

export interface MentionDropdownProps {
  open: boolean;
  id: string;
  items: MentionCandidate[];
  activeIndex: number;
  /** Viewport anchor: the caret position the list should sit under. */
  anchor: { left: number; top: number; lineHeight: number } | null;
  onPick: (user: MentionCandidate) => void;
  onHover: (index: number) => void;
}

const WIDTH = 288;
const MAX_HEIGHT = 240;

export function MentionDropdown({
  open, id, items, activeIndex, anchor, onPick, onHover,
}: MentionDropdownProps) {
  if (!open || !anchor || items.length === 0) return null;

  // Flip above the caret when there is not enough room below, and keep the
  // list on screen horizontally.
  const below = anchor.top + anchor.lineHeight;
  const flip = below + MAX_HEIGHT > window.innerHeight && anchor.top > MAX_HEIGHT;
  const top = flip ? Math.max(4, anchor.top - MAX_HEIGHT) : below + 4;
  const left = Math.min(Math.max(4, anchor.left), window.innerWidth - WIDTH - 4);

  return createPortal(
    <ul
      id={id}
      role="listbox"
      aria-label="Mention a person"
      className="fixed z-[1000] overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
      style={{ top, left, width: WIDTH, maxHeight: MAX_HEIGHT }}
    >
      {items.map((user, i) => (
        <li
          key={user.id}
          id={`${id}-opt-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          className={`cursor-pointer px-2.5 py-1.5 ${i === activeIndex ? 'bg-muted' : ''}`}
          // mousedown, not click: click fires after blur, by which point the
          // composer has lost focus and the caret position with it.
          onMouseDown={(e) => { e.preventDefault(); onPick(user); }}
          onMouseEnter={() => onHover(i)}
        >
          <div className="flex items-center gap-2">
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
              style={{ backgroundColor: user.avatar_color }}
              aria-hidden
            >
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm leading-tight">{user.name}</span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                {user.email}
              </span>
            </span>
          </div>
          {!user.is_member && (
            <p className="mt-0.5 pl-8 text-[11px] leading-tight text-amber-600 dark:text-amber-500">
              Not a member of this project — may not be able to open it
            </p>
          )}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
