// Rendering and editing user-authored wiki HTML.
//
// The server sanitises page bodies on write (backend/utils/sanitize.js). This sanitises
// again on render — defence in depth, and it also protects against rows written before
// that fix landed. Never render a wiki body with a bare dangerouslySetInnerHTML.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify, { type Config } from 'dompurify';
import { toast } from 'sonner';
import { api } from '@/lib/api';
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

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;

/**
 * Wiki macros, applied AFTER sanitising (everything injected here is built from
 * textContent, never raw user HTML):
 * - `[toc]` on its own line becomes a table of contents from the page headings
 * - issue keys like ATLAS-12 become clickable chips
 */
function applyMacros(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;

  const headings = [...root.querySelectorAll('h1, h2, h3')];
  headings.forEach((h, i) => {
    h.id = `h-${i}-${(h.textContent || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  });

  root.querySelectorAll('p, div').forEach((el) => {
    if ((el.textContent || '').trim().toLowerCase() !== '[toc]') return;
    const nav = document.createElement('nav');
    nav.className = 'wiki-toc rounded-md border border-border bg-surface px-4 py-3';
    const title = document.createElement('p');
    title.className = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground';
    title.textContent = 'On this page';
    nav.appendChild(title);
    const ul = document.createElement('ul');
    headings.forEach((h) => {
      const li = document.createElement('li');
      if (h.tagName === 'H3') li.style.marginLeft = '1rem';
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.textContent = h.textContent || '';
      li.appendChild(a);
      ul.appendChild(li);
    });
    nav.appendChild(ul);
    el.replaceWith(nav);
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (text.parentElement?.closest('a, code, pre')) continue;
    if (ISSUE_KEY_RE.test(text.textContent || '')) targets.push(text);
  }
  targets.forEach((text) => {
    const frag = document.createDocumentFragment();
    (text.textContent || '').split(/(\b[A-Z][A-Z0-9]{1,9}-\d+\b)/g).forEach((part) => {
      if (/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(part)) {
        const chip = document.createElement('a');
        chip.href = '#';
        chip.setAttribute('data-issue-key', part);
        chip.className =
          'wiki-issue-chip inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 font-mono text-[11px] font-semibold text-primary no-underline hover:bg-primary/20';
        chip.textContent = part;
        frag.appendChild(chip);
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });
    text.replaceWith(frag);
  });

  const out = document.createElement('div');
  out.appendChild(root);
  return out.innerHTML;
}

/** Read-only wiki content. Typography is applied via the `wiki-prose` class. */
export function RichTextView({
  html,
  className,
  macros = false,
}: {
  html: string;
  className?: string;
  /** Enable [toc] + issue-key chips (wiki pages). */
  macros?: boolean;
}) {
  const navigate = useNavigate();
  const rendered = useMemo(() => {
    const clean = sanitizeHtml(html);
    return macros ? applyMacros(clean) : clean;
  }, [html, macros]);

  async function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const chip = (e.target as HTMLElement).closest?.('a[data-issue-key]');
    if (!chip) return;
    e.preventDefault();
    const key = chip.getAttribute('data-issue-key') ?? '';
    try {
      const results = await api.search.query(key);
      const hit = results.issues.find((i) => i.issue_key === key) ?? results.issues[0];
      if (hit) navigate(hit.type === 'epic' ? `/epics?issue=${hit.id}` : `/board?issue=${hit.id}`);
      else toast.info(`No issue found for ${key}`);
    } catch {
      toast.error(`Could not look up ${key}`);
    }
  }

  return (
    <div
      className={cn('wiki-prose', className)}
      onClick={onClick}
      // Sanitised inside `rendered`; the server also cleans on write.
      dangerouslySetInnerHTML={{ __html: rendered }}
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
