// Rendering and editing user-authored wiki HTML.
//
// The server sanitises page bodies on write (backend/utils/sanitize.js). This sanitises
// again on render — defence in depth, and it also protects against rows written before
// that fix landed. Never render a wiki body with a bare dangerouslySetInnerHTML.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify, { type Config } from 'dompurify';
import type { JqlSearchIssue, LinkedIssueSummary, PageTask } from '@/lib/types';
import { StatusPill } from './primitives';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Bold, Code, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListOrdered, Loader2, Quote, Sparkles, Strikethrough } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAIEnabled } from '@/hooks/use-ai';
import { cn } from '@/lib/utils';
import { issueUrl } from '@/lib/urls';

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

/** Stable heading id, shared by applyMacros and the right-rail TOC so anchors match. */
function headingId(text: string, index: number): string {
  return `h-${index}-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
}

export interface HeadingEntry {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

/** Extract h1–h3 from a page body for the "On this page" outline. Uses the same
 *  id scheme applyMacros stamps onto the rendered headings. */
export function extractHeadings(html: string): HeadingEntry[] {
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitizeHtml(html);
  return [...tpl.content.querySelectorAll('h1, h2, h3')].map((h, i) => ({
    id: headingId(h.textContent || '', i),
    text: (h.textContent || '').trim(),
    level: Number(h.tagName[1]) as 1 | 2 | 3,
  })).filter((h) => h.text.length > 0);
}

/**
 * Wiki macros, applied AFTER sanitising (everything injected here is built from
 * textContent, never raw user HTML):
 * - `[toc]` on its own line becomes a table of contents from the page headings
 * - issue keys like ATLAS-12 become clickable chips — but only when the key
 *   resolves to a real issue in `issues`. That check is what keeps prose like
 *   COVID-19, ISO-8601 and SEV-1 from rendering as links.
 */
function applyMacros(html: string, issues: Map<string, LinkedIssueSummary>, tasks: PageTask[] = []): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;

  const headings = [...root.querySelectorAll('h1, h2, h3')];
  headings.forEach((h, i) => {
    h.id = headingId(h.textContent || '', i);
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

  // [jql: query] paragraphs become live-table placeholders; RichTextView
  // fetches results after render. Built from textContent, so nothing the
  // author wrote is ever injected as HTML.
  root.querySelectorAll('p, div').forEach((el) => {
    const m = (el.textContent || '').trim().match(/^\[jql:\s*([^\]]+)\]$/i);
    if (!m) return;
    const holder = document.createElement('div');
    holder.setAttribute('data-jql', m[1].trim());
    holder.className = 'wiki-jql-block rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground';
    holder.textContent = `Loading issues for “${m[1].trim()}”…`;
    el.replaceWith(holder);
  });

  // Task-list items: `[ ] text` / `[x] text` become real checkboxes. The server
  // parses the same body and returns tasks in document order, so the Nth task
  // item here is tasks[n] — no need to recompute the server's hash in-browser.
  let taskIndex = 0;
  root.querySelectorAll('li').forEach((li) => {
    const raw = (li.textContent || '').trim();
    const m = raw.match(/^\[( |x|X)\]\s*(.+)$/);
    if (!m) return;
    const task = tasks[taskIndex];
    taskIndex += 1;
    const text = m[2].trim();

    li.classList.add('wiki-task-item');
    li.textContent = '';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'wiki-task-box mr-2 align-middle accent-primary';
    box.checked = task ? task.checked : m[1].toLowerCase() === 'x';
    // No stored task means the page data is stale relative to the body; render
    // it read-only rather than letting a click write against a guessed key.
    if (task) box.setAttribute('data-task-key', task.key);
    else box.disabled = true;
    li.appendChild(box);

    const label = document.createElement('span');
    label.textContent = text;
    if (box.checked) label.className = 'text-muted-foreground line-through';
    li.appendChild(label);

    // A converted task shows its issue, so the page reflects real progress
    // rather than a checkbox someone forgot to tick.
    if (task?.issue_key) {
      const chip = document.createElement('a');
      chip.href = '#';
      chip.setAttribute('data-issue-id', task.issue_id || '');
      chip.setAttribute('data-issue-key', task.issue_key);
      chip.setAttribute('data-issue-type', 'task');
      chip.className = 'wiki-issue-chip ml-2 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 font-mono text-[11px] font-semibold text-primary no-underline hover:bg-primary/20';
      chip.textContent = task.issue_status ? `${task.issue_key} · ${task.issue_status}` : task.issue_key;
      li.appendChild(chip);
    }
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
      const issue = /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(part) ? issues.get(part) : undefined;
      // Only a key that resolves to a real issue becomes a chip. Everything
      // else stays prose, so a chip existing is proof the issue exists.
      if (issue) {
        const chip = document.createElement('a');
        chip.href = '#';
        chip.setAttribute('data-issue-id', issue.id);
        chip.setAttribute('data-issue-key', issue.issue_key);
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
  issues,
  tasks,
  onToggleTask,
}: {
  html: string;
  className?: string;
  /** Enable [toc] + issue-key chips (wiki pages). */
  macros?: boolean;
  /** Issues mentioned by this content. A key only becomes a chip if it appears here. */
  issues?: LinkedIssueSummary[];
  /** Task-list state, in document order. Enables interactive checkboxes. */
  tasks?: PageTask[];
  /** Called when a checkbox is toggled; the parent persists and reloads. */
  onToggleTask?: (taskKey: string, checked: boolean) => void;
}) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ issue: LinkedIssueSummary; x: number; y: number } | null>(null);
  // Results per [jql:] query string; an { error } value marks a failed query.
  const [jqlResults, setJqlResults] = useState<Map<string, JqlSearchIssue[] | { error: string }>>(new Map());

  const issueMap = useMemo(
    () => new Map((issues ?? []).map((i) => [i.issue_key, i])),
    [issues],
  );
  const rendered = useMemo(() => {
    const clean = sanitizeHtml(html);
    return macros ? applyMacros(clean, issueMap, tasks ?? []) : clean;
  }, [html, macros, issueMap, tasks]);

  // Fetch results for every [jql:] block once per query string.
  useEffect(() => {
    if (!macros) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = rendered;
    const queries = [...new Set(
      [...tpl.content.querySelectorAll('div[data-jql]')].map((el) => el.getAttribute('data-jql') || ''),
    )].filter((q) => q && !jqlResults.has(q));
    if (queries.length === 0) return;
    let cancelled = false;
    void Promise.all(queries.map(async (q) => {
      try {
        const { issues: rows } = await api.search.jql(q);
        return [q, rows] as const;
      } catch (e) {
        return [q, { error: e instanceof Error ? e.message : 'Query failed' }] as const;
      }
    })).then((pairs) => {
      if (cancelled) return;
      setJqlResults((prev) => new Map([...prev, ...pairs]));
    });
    return () => { cancelled = true; };
  }, [rendered, macros, jqlResults]);

  // Swap each placeholder for its table (or error box) as results arrive.
  // DOM-built like the rest of the macro pipeline: every node is created via
  // createElement/textContent, so query results are never injected as HTML.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll('div[data-jql]').forEach((el) => {
      const q = el.getAttribute('data-jql') || '';
      const result = jqlResults.get(q);
      if (!result) return; // still loading
      if (!Array.isArray(result)) {
        el.className = 'wiki-jql-block rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm';
        el.textContent = `JQL error: ${result.error}`;
        return;
      }
      if (result.length === 0) {
        el.className = 'wiki-jql-block rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground';
        el.textContent = 'No issues match this query.';
        return;
      }
      el.className = 'wiki-jql-block overflow-x-auto';
      el.textContent = '';
      const table = document.createElement('table');
      table.className = 'w-full text-sm';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const h of ['Key', 'Title', 'Status', 'Assignee']) {
        const th = document.createElement('th');
        th.className = 'border-b border-border px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground';
        th.textContent = h;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const issue of result) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-border/50';
        const key = document.createElement('td');
        key.className = 'px-2 py-1.5';
        const chip = document.createElement('a');
        chip.href = '#';
        chip.setAttribute('data-issue-id', issue.id);
        chip.setAttribute('data-issue-key', issue.issue_key);
        chip.setAttribute('data-issue-type', issue.type);
        chip.className = 'wiki-issue-chip inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 font-mono text-[11px] font-semibold text-primary no-underline hover:bg-primary/20';
        chip.textContent = issue.issue_key;
        key.appendChild(chip);
        const title = document.createElement('td');
        title.className = 'px-2 py-1.5';
        title.textContent = issue.title;
        const status = document.createElement('td');
        status.className = 'px-2 py-1.5 text-xs text-muted-foreground';
        status.textContent = issue.status;
        const assignee = document.createElement('td');
        assignee.className = 'px-2 py-1.5 text-xs text-muted-foreground';
        assignee.textContent = issue.assignee_name ?? '—';
        tr.append(key, title, status, assignee);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      el.appendChild(table);
      if (result.length === 50) {
        const note = document.createElement('p');
        note.className = 'mt-1.5 text-xs text-muted-foreground';
        note.textContent = 'Showing 50 — refine your query.';
        el.appendChild(note);
      }
    });
  }, [jqlResults, rendered]);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const box = (e.target as HTMLElement).closest?.('input[data-task-key]') as HTMLInputElement | null;
    if (box) {
      const key = box.getAttribute('data-task-key') ?? '';
      // The DOM checkbox already flipped; report the state it moved to. The
      // parent reloads the page, which re-renders from server truth.
      onToggleTask?.(key, box.checked);
      return;
    }
    const chip = (e.target as HTMLElement).closest?.('a[data-issue-id]');
    if (!chip) return;
    e.preventDefault();
    // The key is the address. Type no longer selects a screen — one route
    // serves epics, stories, tasks and bugs alike — and the project comes from
    // the key's prefix, so a chip pointing into another project just works.
    const key = chip.getAttribute('data-issue-key') ?? '';
    navigate(issueUrl(key));
  }

  function onPointerOver(e: React.PointerEvent<HTMLDivElement>) {
    const chip = (e.target as HTMLElement).closest?.('a[data-issue-key]');
    if (!chip) { setHovered(null); return; }
    const issue = issueMap.get(chip.getAttribute('data-issue-key') ?? '');
    if (!issue) { setHovered(null); return; }
    const r = (chip as HTMLElement).getBoundingClientRect();
    setHovered({ issue, x: r.left, y: r.bottom + 6 });
  }

  return (
    <>
      <div
        ref={containerRef}
        className={cn('wiki-prose', className)}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerLeave={() => setHovered(null)}
        // Sanitised inside `rendered`; the server also cleans on write.
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
      {hovered && (
        <div
          role="tooltip"
          className="fixed z-50 w-72 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
          style={{ left: hovered.x, top: hovered.y }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-semibold text-primary">{hovered.issue.issue_key}</span>
            <StatusPill status={hovered.issue.status} />
          </div>
          <p className="mt-1 text-sm font-medium leading-snug">{hovered.issue.title}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {hovered.issue.assignee_name ?? 'Unassigned'} · {hovered.issue.priority}
          </p>
        </div>
      )}
    </>
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
  pageId,
}: {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  /** When set, enables image upload — files attach to this wiki page. */
  pageId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const aiEnabled = useAIEnabled();
  const [aiBusy, setAiBusy] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
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

  async function uploadImage(file: File) {
    if (!pageId || !ref.current) return;
    setUploading(true);
    try {
      const [att] = await api.wiki.uploadAttachments(pageId, [file]);
      ref.current.focus();
      const img = att.is_image
        ? `<img src="${att.raw_url}" alt="${att.original_name.replace(/"/g, '')}" />`
        : `<a href="${att.raw_url}">${att.original_name}</a>`;
      document.execCommand('insertHTML', false, `${img}<p></p>`);
      emit();
    } catch (e) {
      toast.error('Upload failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setUploading(false);
    }
  }

  // Whether the current selection sits inside the editor and isn't collapsed.
  function editorSelectionText(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
    if (!ref.current?.contains(sel.anchorNode)) return '';
    return sel.toString().trim();
  }

  // Transform the selection (if any) or the whole document via the AI writer.
  async function runWrite(action: 'improve' | 'shorten' | 'expand' | 'fix') {
    if (!ref.current) return;
    const selText = editorSelectionText();
    const target = selText || ref.current.innerText;
    if (!target.trim()) { toast.info('Write something first, then use AI.'); return; }
    setAiBusy(true);
    try {
      const { html } = await api.ai.write({ action, text: selText || ref.current.innerHTML });
      const clean = sanitizeHtml(html);
      if (selText) {
        ref.current.focus();
        document.execCommand('insertHTML', false, clean);
      } else {
        ref.current.innerHTML = clean;
      }
      emit();
      toast.success('Updated with AI');
    } catch (e) {
      toast.error('AI request failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setAiBusy(false);
    }
  }

  async function runDraft() {
    if (!ref.current || !draftPrompt.trim()) return;
    setAiBusy(true);
    try {
      const { html } = await api.ai.write({ action: 'draft', prompt: draftPrompt.trim() });
      const clean = sanitizeHtml(html);
      ref.current.focus();
      // Insert at the caret; fall back to appending if there's no editor selection.
      if (editorSelectionText() || window.getSelection()?.anchorNode && ref.current.contains(window.getSelection()!.anchorNode)) {
        document.execCommand('insertHTML', false, clean);
      } else {
        ref.current.innerHTML = ref.current.innerHTML + clean;
      }
      emit();
      setDraftOpen(false);
      setDraftPrompt('');
      toast.success('Draft inserted');
    } catch (e) {
      toast.error('AI request failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setAiBusy(false);
    }
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
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-0.5 border-b border-border bg-card/95 p-1.5 backdrop-blur">
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

        {pageId && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.csv,.txt,.docx,.xlsx,.pptx,.zip"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ''; }}
            />
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Insert image or file"
              title="Insert image or file" disabled={uploading}
              onMouseDown={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
            </Button>
          </>
        )}

        {aiEnabled && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-primary" disabled={aiBusy}
                  onMouseDown={(e) => e.preventDefault()} aria-label="AI writing assistant">
                  {aiBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  <span className="text-xs font-medium">AI</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem onSelect={() => setDraftOpen(true)}>
                  <Sparkles className="size-4" /> Draft from a prompt…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void runWrite('improve')}>Improve writing</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runWrite('fix')}>Fix spelling & grammar</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runWrite('shorten')}>Make shorter</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runWrite('expand')}>Make longer</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Draft with AI</DialogTitle></DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            placeholder="What should this section cover? e.g. 'onboarding steps for a new engineer'"
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraftOpen(false)}>Cancel</Button>
            <Button onClick={() => void runDraft()} disabled={aiBusy || !draftPrompt.trim()}>
              {aiBusy && <Loader2 className="size-4 animate-spin" />} Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Page content"
        onInput={emit}
        onBlur={emit}
        className="wiki-prose min-h-[60vh] px-5 py-4 focus:outline-none"
      />
    </div>
  );
}
