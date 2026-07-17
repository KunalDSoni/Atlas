import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Clock, Download, Eye, Heart, History, Loader2, Lock, Pencil, Plus, Quote, Send, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { isAdmin } from '@/lib/domain';
import type { User, WikiComment, WikiPage, WikiRestriction, WikiTreeNode, WikiVersion } from '@/lib/types';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorState, LabelChip, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { RichTextEditor, RichTextView } from '@/components/app/rich-text';
import { WikiTree } from '@/components/app/wiki-tree';
import { CreatePageDialog } from './wiki-space';
import { timeAgo } from '@/lib/format';

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

  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.wiki.page(pageId);
      setPage(p);
      setDraftTitle(p.title);
      setDraftBody(p.body);
      const [t, c, w] = await Promise.all([
        api.wiki.tree(p.space_id).catch(() => []),
        api.wiki.comments(p.id).catch(() => []),
        api.wiki.watchState(p.id).catch(() => ({ count: 0, watching: false })),
      ]);
      setTree(t);
      setComments(c);
      setWatching(w.watching);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load page');
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    void load();
    setEditing(false);
  }, [load]);

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

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:block">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 w-full justify-start text-muted-foreground">
          <Link to={`/wiki/space/${page.space_id}`}>
            <ArrowLeft className="size-4" /> {page.space_name ?? 'Space'}
          </Link>
        </Button>
        <WikiTree nodes={tree} activeId={page.id} />
      </aside>

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="h-auto border-0 px-0 !text-2xl font-semibold shadow-none focus-visible:ring-0"
                aria-label="Page title"
              />
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <UserAvatar name={page.author_name} color={page.author_color} className="size-4" />
                {page.author_name}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" /> {timeAgo(page.updated_at)}
              </span>
              <span>v{page.version}</span>
              <span className="flex items-center gap-1">
                <Eye className="size-3" /> {page.view_count}
              </span>
            </p>
            {page.labels?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {page.labels.map((l) => (
                  <LabelChip key={l}>{l}</LabelChip>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
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
                <Button variant="ghost" size="sm" onClick={like} className="gap-1.5">
                  <Heart className="size-4" /> {page.like_count}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleWatch}
                  className="gap-1.5"
                  aria-pressed={watching}
                >
                  <Eye className="size-4" /> {watching ? 'Watching' : 'Watch'}
                </Button>
                {(page.author_id === user?.id || isAdmin(user?.role)) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={openRestrictions}
                    className={page.restricted ? 'gap-1.5 text-warning' : 'gap-1.5'}
                  >
                    <Lock className="size-4" /> {page.restricted ? 'Restricted' : 'Restrict'}
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Export page" title="Export page">
                      <Download className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void exportPage('markdown')}>
                      Export as Markdown
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportPage('html')}>
                      Export as HTML
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => window.print()}>
                      Print / PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Version history">
                      <History className="size-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-full sm:max-w-sm">
                    <SheetHeader>
                      <SheetTitle>Version history</SheetTitle>
                    </SheetHeader>
                    <div className="px-4 pb-4">
                      <VersionHistory pageId={page.id} />
                    </div>
                  </SheetContent>
                </Sheet>

                <Button variant="ghost" size="icon" onClick={() => setCreateChildOpen(true)} aria-label="Add child page">
                  <Plus className="size-4" />
                </Button>

                {isAdmin(user?.role) && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete page">
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
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
                )}

                {page.can_edit_page !== 0 && (
                  <Button size="sm" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {editing ? (
          <RichTextEditor value={draftBody} onChange={setDraftBody} />
        ) : (
          <Card>
            <CardContent className="px-6 py-5">
              {page.body ? (
                <RichTextView html={page.body} macros />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  This page is empty. Click Edit to add content.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Separator className="my-6" />

        <section>
          <h2 className="mb-3 text-sm font-semibold">Comments ({comments.length})</h2>
          {quote && (
            <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2">
              <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 text-sm italic text-muted-foreground">{quote}</p>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => setQuote('')} aria-label="Remove quote">
                <X className="size-3.5" />
              </Button>
            </div>
          )}
          <div className="mb-4 flex gap-2">
            <Textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder={quote ? 'Comment on the selected text…' : 'Add a comment…'}
              rows={2}
              className="resize-none"
            />
            <div className="flex flex-col gap-1">
              <Button size="icon" onClick={addComment} disabled={posting || !commentBody.trim()} aria-label="Post comment">
                {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={quoteSelection}
                aria-label="Comment on selected text"
                title="Comment on selected text"
              >
                <Quote className="size-4" />
              </Button>
            </div>
          </div>

          {comments.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No comments yet.</p>
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
