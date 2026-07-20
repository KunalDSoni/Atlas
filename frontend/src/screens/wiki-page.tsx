import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, BadgeCheck, Clock, Download, Eye, FileText, Heart, History, Loader2, Lock,
  MoreHorizontal, Paperclip, Pencil, Plus, Quote, Send, Sparkles, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { isAdmin } from '@/lib/domain';
import type { User, WikiAttachment, WikiComment, WikiPage, WikiRestriction, WikiTreeNode, WikiVersion } from '@/lib/types';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorState, LabelChip, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { RichTextEditor, RichTextView, extractHeadings } from '@/components/app/rich-text';
import { WikiTree } from '@/components/app/wiki-tree';
import { WikiBreadcrumb, OnThisPage, type Crumb } from '@/components/app/wiki-doc';
import { useAIEnabled } from '@/hooks/use-ai';
import { CreatePageDialog } from './wiki-space';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Rough reading time from the page body text. */
function readingTime(html: string): number {
  const words = html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function VersionHistory({ pageId }: { pageId: string }) {
  const [versions, setVersions] = useState<WikiVersion[] | null>(null);

  useEffect(() => {
    api.wiki.versions(pageId).then(setVersions).catch(() => setVersions([]));
  }, [pageId]);

  if (!versions) return <RowsSkeleton count={4} />;
  if (!versions.length) return <p className="text-sm text-muted-foreground">No history yet.</p>;

  return (
    <ul className="space-y-3">
      {versions.map((v) => (
        <li key={v.id} className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
            v{v.version}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{v.title}</p>
            <p className="text-xs text-muted-foreground">
              {v.editor_name ?? 'Unknown'} · {timeAgo(v.created_at)}
              {v.change_message ? ` · ${v.change_message}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function WikiPageScreen() {
  const { pageId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [page, setPage] = useState<WikiPage | null>(null);
  const [tree, setTree] = useState<WikiTreeNode[]>([]);
  const [comments, setComments] = useState<WikiComment[]>([]);
  const [attachments, setAttachments] = useState<WikiAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);

  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [createChildOpen, setCreateChildOpen] = useState(false);
  const [watching, setWatching] = useState(false);
  const [quote, setQuote] = useState('');
  const [restrictOpen, setRestrictOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [restrictions, setRestrictions] = useState<Map<string, boolean>>(new Map());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const aiEnabled = useAIEnabled();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.wiki.page(pageId);
      setPage(p);
      setDraftTitle(p.title);
      setDraftBody(p.body);
      const [t, c, w, a] = await Promise.all([
        api.wiki.tree(p.space_id).catch(() => []),
        api.wiki.comments(p.id).catch(() => []),
        api.wiki.watchState(p.id).catch(() => ({ count: 0, watching: false })),
        api.wiki.attachments(p.id).catch(() => []),
      ]);
      setTree(t);
      setComments(c);
      setWatching(w.watching);
      setAttachments(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load page');
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    void load();
    setEditing(false);
    setAiSummary(null);
  }, [load]);

  async function summarize() {
    if (!page) return;
    setSummarizing(true);
    try {
      const { summary } = await api.ai.summarize({ page_id: page.id });
      setAiSummary(summary);
    } catch (e) {
      toast.error('Could not summarize', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSummarizing(false);
    }
  }

  async function save() {
    if (!page) return;
    setSaving(true);
    try {
      await api.wiki.updatePage(page.id, {
        title: draftTitle.trim() || page.title,
        body: draftBody,
        change_message: 'Edited',
      });
      toast.success('Page saved');
      setEditing(false);
      await load();
    } catch (e) {
      toast.error('Could not save page', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function like() {
    if (!page) return;
    try {
      const r = await api.wiki.like(page.id);
      setPage({ ...page, like_count: r.like_count });
    } catch (e) {
      toast.error('Could not like page', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function exportPage(format: 'markdown' | 'html') {
    if (!page) return;
    try {
      const file = await api.wiki.exportPage(page.id, format);
      const blob = new Blob([file.content], { type: file.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Export failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  function quoteSelection() {
    const text = window.getSelection()?.toString().trim() ?? '';
    if (!text) {
      toast.info('Select some page text first, then click Quote.');
      return;
    }
    setQuote(text.slice(0, 300));
  }

  async function openRestrictions() {
    if (!page) return;
    try {
      const [u, r] = await Promise.all([api.users.list(), api.wiki.restrictions(page.id)]);
      setAllUsers(u.filter((x) => x.is_active));
      setRestrictions(new Map(r.map((row: WikiRestriction) => [row.user_id, Number(row.can_edit) === 1])));
      setRestrictOpen(true);
    } catch (e) {
      toast.error('Could not load restrictions', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function saveRestrictions() {
    if (!page) return;
    try {
      await api.wiki.setRestrictions(page.id, [...restrictions.entries()].map(([user_id, can_edit]) => ({ user_id, can_edit })));
      setRestrictOpen(false);
      toast.success(restrictions.size === 0 ? 'Page is open to everyone' : 'Restrictions saved');
      await load();
    } catch (e) {
      toast.error('Could not save restrictions', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function toggleApproval() {
    if (!page) return;
    // A stale approval re-approves rather than revokes: the menu offers
    // "Re-approve this version", so revoking there would contradict the label.
    const revoking = (page.approval?.approved ?? false) && !page.approval?.stale;
    try {
      if (revoking) await api.wiki.revokeApproval(page.id);
      else await api.wiki.approve(page.id);
      toast.success(revoking ? 'Approval revoked' : 'Page approved');
      await load();
    } catch (e) {
      toast.error('Could not change approval', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function toggleWatch() {
    if (!page) return;
    try {
      const r = watching ? await api.wiki.unwatch(page.id) : await api.wiki.watch(page.id);
      setWatching(r.watching);
      toast.success(r.watching ? 'Watching this page' : 'No longer watching');
    } catch (e) {
      toast.error('Could not update watching', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function addComment() {
    if (!page || !commentBody.trim()) return;
    setPosting(true);
    try {
      await api.wiki.addComment(page.id, commentBody.trim(), quote || undefined);
      setCommentBody('');
      setQuote('');
      setComments(await api.wiki.comments(page.id));
    } catch (e) {
      toast.error('Could not post comment', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setPosting(false);
    }
  }

  async function removePage() {
    if (!page) return;
    try {
      await api.wiki.deletePage(page.id);
      toast.success('Page deleted');
      navigate(`/wiki/space/${page.space_id}`);
    } catch (e) {
      toast.error('Could not delete page', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) return <RowsSkeleton count={8} />;
  if (error || !page) return <ErrorState message={error ?? 'Page not found'} onRetry={load} />;

  const canManage = page.author_id === user?.id || isAdmin(user?.role);
  const headings = editing ? [] : extractHeadings(page.body);
  const crumbs: Crumb[] = [
    { label: page.space_name ?? 'Space', to: `/wiki/space/${page.space_id}`, icon: page.space_icon },
    ...(page.breadcrumb ?? []).map((b) => ({ label: b.title, to: `/wiki/page/${b.id}` })),
    { label: page.title },
  ];

  return (
    <div className="mx-auto grid max-w-[1440px] gap-x-8 gap-y-6 lg:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[236px_minmax(0,1fr)_200px]">
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <Link
            to={`/wiki/space/${page.space_id}`}
            className="mb-3 flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded text-sm">{page.space_icon || '📘'}</span>
            <span className="truncate">{page.space_name ?? 'Space'}</span>
          </Link>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
            <WikiTree nodes={tree} activeId={page.id} />
          </div>
        </div>
      </aside>

      <article className="min-w-0">
        <div className="mx-auto max-w-3xl">
          <WikiBreadcrumb items={crumbs} />

          <header className="mb-5">
            <div className="flex items-start justify-between gap-4">
              {editing ? (
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="h-auto border-0 px-0 !text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0"
                  placeholder="Page title"
                  aria-label="Page title"
                />
              ) : (
                <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
              )}

              <div className="flex shrink-0 items-center gap-1.5 pt-1">
                {editing ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraftTitle(page.title); setDraftBody(page.body); }}>
                      <X className="size-4" /> Cancel
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving}>
                      {saving && <Loader2 className="size-4 animate-spin" />} Save
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={like} className="gap-1.5 text-muted-foreground" aria-label="Like page">
                      <Heart className="size-4" /> {page.like_count}
                    </Button>
                    {page.can_edit_page !== 0 && (
                      <Button size="sm" onClick={() => setEditing(true)}>
                        <Pencil className="size-4" /> Edit
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="More actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => void toggleWatch()}>
                          <Eye className="size-4" /> {watching ? 'Stop watching' : 'Watch page'}
                        </DropdownMenuItem>
                        {page.can_edit_page !== 0 && (
                          <DropdownMenuItem onSelect={() => void toggleApproval()}>
                            <BadgeCheck className="size-4" />
                            {page.approval?.approved
                              ? (page.approval.stale ? 'Re-approve this version' : 'Revoke approval')
                              : 'Approve page'}
                          </DropdownMenuItem>
                        )}
                        {aiEnabled && (
                          <DropdownMenuItem onSelect={() => void summarize()} disabled={summarizing}>
                            <Sparkles className="size-4" /> Summarize with AI
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setCreateChildOpen(true)}>
                          <Plus className="size-4" /> Add child page
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                          <History className="size-4" /> Version history
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs text-muted-foreground">Export</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => void exportPage('markdown')}>
                          <Download className="size-4" /> Markdown
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void exportPage('html')}>
                          <Download className="size-4" /> HTML
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => window.print()}>
                          <Download className="size-4" /> Print / PDF
                        </DropdownMenuItem>
                        {canManage && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => void openRestrictions()}>
                              <Lock className="size-4" /> {page.restricted ? 'Edit restrictions' : 'Restrict page'}
                            </DropdownMenuItem>
                          </>
                        )}
                        {isAdmin(user?.role) && (
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
                            <Trash2 className="size-4" /> Delete page
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <UserAvatar name={page.author_name} color={page.author_color} className="size-5" />
                <span className="font-medium text-foreground">{page.author_name}</span>
              </span>
              <span className="text-faint">·</span>
              <span className="flex items-center gap-1"><Clock className="size-3.5" /> Updated {timeAgo(page.updated_at)}</span>
              <span className="text-faint">·</span>
              <span>{readingTime(page.body)} min read</span>
              <span className="text-faint">·</span>
              <span className="flex items-center gap-1"><Eye className="size-3.5" /> {page.view_count}</span>
              <span className="text-faint">·</span>
              <span>v{page.version}</span>
              {page.restricted ? (
                <>
                  <span className="text-faint">·</span>
                  <span className="flex items-center gap-1 text-warning"><Lock className="size-3.5" /> Restricted</span>
                </>
              ) : null}
            </div>

            {page.approval?.approved && (
              // Stale is deliberately not "unapproved": the sign-off happened and
              // is worth showing, it just no longer covers the current version.
              <div
                className={cn(
                  'mt-2.5 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm',
                  page.approval.stale
                    ? 'border-warning/40 bg-warning/5 text-warning'
                    : 'border-success/40 bg-success/5 text-success',
                )}
              >
                {page.approval.stale
                  ? <AlertTriangle className="size-4 shrink-0" />
                  : <BadgeCheck className="size-4 shrink-0" />}
                <span className="font-medium">
                  {page.approval.stale
                    ? `Approved at v${page.approval.version} — edited since`
                    : `Approved by ${page.approval.approved_by_name ?? 'someone'}`}
                </span>
                {page.approval.approved_at && (
                  <span className="text-xs opacity-80">{timeAgo(page.approval.approved_at)}</span>
                )}
                {page.approval.note && (
                  <span className="text-xs opacity-80">· {page.approval.note}</span>
                )}
              </div>
            )}

            {page.labels?.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {page.labels.map((l) => (
                  <LabelChip key={l}>{l}</LabelChip>
                ))}
              </div>
            )}
          </header>

          {(summarizing || aiSummary) && !editing && (
            <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <Sparkles className="size-4" /> AI summary
                </span>
                {aiSummary && (
                  <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" onClick={() => setAiSummary(null)} aria-label="Dismiss summary">
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
              {summarizing ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Summarizing…</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {aiSummary!.split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).map((line, i) => (
                    <li key={i} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" /><span>{line}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {editing ? (
            <RichTextEditor value={draftBody} onChange={setDraftBody} pageId={page.id} />
          ) : page.body ? (
            <RichTextView html={page.body} macros issues={page.linked_issues} />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <FileText className="mx-auto mb-2 size-7 text-faint" />
              <p className="text-sm font-medium">This page is empty</p>
              {page.can_edit_page !== 0 && (
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Start writing
                </Button>
              )}
            </div>
          )}

          {!editing && attachments.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Paperclip className="size-4" /> Attachments ({attachments.length})</h2>
              <ul className="divide-y divide-border-light rounded-lg border border-border">
                {attachments.map((a) => (
                  <li key={a.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                    {a.is_image
                      ? <img src={a.raw_url} alt="" className="size-9 shrink-0 rounded object-cover" />
                      : <FileText className="size-5 shrink-0 text-faint" />}
                    <a href={a.raw_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{a.original_name}</a>
                    <span className="shrink-0 text-xs text-muted-foreground">{a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB` : ''}</span>
                    <button
                      className="shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100"
                      aria-label="Delete attachment"
                      onClick={async () => {
                        try { await api.wiki.removeAttachment(a.id); setAttachments((prev) => prev.filter((x) => x.id !== a.id)); }
                        catch (e) { toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined }); }
                      }}
                    ><Trash2 className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Separator className="my-8" />

          <section>
          <h2 className="mb-3 text-sm font-semibold">Comments ({comments.length})</h2>

          <div className="mb-6 rounded-lg border border-border bg-card p-3">
            {quote && (
              <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2">
                <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <p className="min-w-0 flex-1 text-sm italic text-muted-foreground">{quote}</p>
                <Button variant="ghost" size="icon" className="size-6" onClick={() => setQuote('')} aria-label="Remove quote">
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
            <div className="flex gap-2.5">
              <UserAvatar name={user?.name ?? null} color={user?.avatar_color} className="mt-0.5 shrink-0" />
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={quote ? 'Comment on the selected text…' : 'Add a comment…'}
                rows={2}
                className="min-h-9 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-border-light pt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={quoteSelection}
                className="text-muted-foreground"
                title="Select page text, then click to quote it"
              >
                <Quote className="size-3.5" /> Quote selection
              </Button>
              <Button size="sm" onClick={addComment} disabled={posting || !commentBody.trim()}>
                {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Comment
              </Button>
            </div>
          </div>

          {comments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No comments yet. Start the discussion.
            </p>
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <UserAvatar name={c.author_name} color={c.author_color} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <span className="font-semibold">{c.author_name}</span>{' '}
                      <span className="text-muted-foreground">{timeAgo(c.created_at)}</span>
                    </p>
                    {c.quote && (
                      <blockquote className="mt-1 border-l-2 border-primary/50 pl-2 text-sm italic text-muted-foreground">
                        {c.quote}
                      </blockquote>
                    )}
                    {/* Comment bodies are user HTML too — same sanitising path. */}
                    <RichTextView html={c.body} className="mt-0.5 text-sm" />
                  </div>
                  {(c.author_id === user?.id || isAdmin(user?.role)) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground"
                      aria-label="Delete comment"
                      onClick={async () => {
                        try {
                          await api.wiki.deleteComment(c.id);
                          setComments((prev) => prev.filter((x) => x.id !== c.id));
                        } catch (e) {
                          toast.error('Could not delete comment', {
                            description: e instanceof Error ? e.message : undefined,
                          });
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          </section>
        </div>
      </article>

      <div className="hidden xl:block">
        <OnThisPage headings={headings} />
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Version history</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <VersionHistory pageId={page.id} />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{page.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the page and its comments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={removePage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={restrictOpen} onOpenChange={setRestrictOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restrict “{page.title}”</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            With no one selected, everyone can view and edit. Selecting people limits viewing to
            them (plus you and admins); the Edit switch controls who may change the page.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {allUsers.map((u) => {
              const included = restrictions.has(u.id);
              const canEditPage = restrictions.get(u.id) ?? false;
              return (
                <li key={u.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={(e) => {
                      setRestrictions((prev) => {
                        const next = new Map(prev);
                        if (e.target.checked) next.set(u.id, false);
                        else next.delete(u.id);
                        return next;
                      });
                    }}
                    aria-label={`Allow ${u.name} to view`}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <UserAvatar name={u.name} color={u.avatar_color} className="size-6" />
                  <span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
                  {included && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Edit
                      <Switch
                        checked={canEditPage}
                        onCheckedChange={(v) => {
                          setRestrictions((prev) => new Map(prev).set(u.id, v));
                        }}
                        aria-label={`Allow ${u.name} to edit`}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestrictOpen(false)}>Cancel</Button>
            <Button onClick={saveRestrictions}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreatePageDialog
        open={createChildOpen}
        onOpenChange={setCreateChildOpen}
        spaceId={page.space_id}
        parentId={page.id}
        onCreated={(p) => navigate(`/wiki/page/${p.id}`)}
      />
    </div>
  );
}
