// Rendering and editing user-authored wiki HTML.
//
// The server sanitises page bodies on write (backend/utils/sanitize.js). This sanitises
// again on render — defence in depth, and it also protects against rows written before
// that fix landed. Never render a wiki body with a bare dangerouslySetInnerHTML.

import { useEffect, useRef, useState } from 'react';
import DOMPurify, { type Config } from 'dompurify';
import { Bold, Code, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'div', 'span',
    'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
    'mark', 'small', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr',
    'th', 'td', 'caption', 'a', 'img', 'figure', 'figcaption',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class', 'colspan', 'rowspan'],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeHtml(html: string): string {
  return String(DOMPurify.sanitize(html ?? '', PURIFY_CONFIG));
}

/** Read-only wiki content. Typography is applied via the `wiki-prose` class. */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn('wiki-prose', className)}
      // Sanitised immediately above; the server also cleans on write.
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

interface ToolbarButton {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  run: () => void;
}

/**
 * Minimal rich-text editor over contentEditable, matching what the original wiki
 * offered (bold/italic/headings/lists/quote/code/link). Content is sanitised on the
 * way out; the server sanitises again on write.
 */
export function RichTextEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  // execCommand acts on the live selection, which is lost when focus moves to the
  // popover input — so stash the range and restore it before applying the link.
  const savedRange = useRef<Range | null>(null);

  // Seed the DOM once. Re-writing innerHTML on every keystroke would reset the caret.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = sanitizeHtml(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(command: string, arg?: string) {
    // execCommand is deprecated but remains the only broadly supported way to do this
    // without pulling in a full editor framework.
    document.execCommand(command, false, arg);
    ref.current?.focus();
    emit();
  }

  function emit() {
    if (ref.current) onChange(sanitizeHtml(ref.current.innerHTML));
  }

  function applyLink() {
    const url = linkUrl.trim();
    // The sanitiser would strip javascript: anyway; don't even put it in the document.
    if (!/^https?:\/\//i.test(url)) return;
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    exec('createLink', url);
    setLinkUrl('');
    setLinkOpen(false);
  }

  const groups: ToolbarButton[][] = [
    [
      { icon: Bold, label: 'Bold', run: () => exec('bold') },
      { icon: Italic, label: 'Italic', run: () => exec('italic') },
      { icon: Strikethrough, label: 'Strikethrough', run: () => exec('strikeThrough') },
    ],
    [
      { icon: Heading2, label: 'Heading 2', run: () => exec('formatBlock', '<h2>') },
      { icon: Heading3, label: 'Heading 3', run: () => exec('formatBlock', '<h3>') },
    ],
    [
      { icon: List, label: 'Bullet list', run: () => exec('insertUnorderedList') },
      { icon: ListOrdered, label: 'Numbered list', run: () => exec('insertOrderedList') },
      { icon: Quote, label: 'Quote', run: () => exec('formatBlock', '<blockquote>') },
      { icon: Code, label: 'Code block', run: () => exec('formatBlock', '<pre>') },
    ],
  ];

  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1.5">
        {groups.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <Separator orientation="vertical" className="mx-1 h-5" />}
            {group.map((b) => (
              <Button
                key={b.label}
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={b.label}
                title={b.label}
                onMouseDown={(e) => e.preventDefault()} // keep the selection
                onClick={b.run}
              >
                <b.icon className="size-4" />
              </Button>
            ))}
          </div>
        ))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Insert link"
              title="Insert link"
              onMouseDown={(e) => {
                e.preventDefault();
                const sel = window.getSelection();
                savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
              }}
            >
              <Link2 className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3">
            <form onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
              <Label htmlFor="link-url" className="text-xs">Link URL</Label>
              <Input
                id="link-url"
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                className="mt-1.5 h-8 text-sm"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">Only http(s) links are allowed.</p>
              <div className="mt-2 flex justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLinkOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="h-7 text-xs" disabled={!/^https?:\/\//i.test(linkUrl.trim())}>
                  Add link
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Page content"
        onInput={emit}
        onBlur={emit}
        className="wiki-prose min-h-80 px-4 py-3 focus:outline-none"
      />
    </div>
  );
}
