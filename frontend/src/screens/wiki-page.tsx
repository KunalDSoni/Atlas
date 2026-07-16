import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Clock, Eye, Heart, History, Loader2, Pencil, Plus, Send, Trash2, X,
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
import type { WikiComment, WikiPage, WikiTreeNode, WikiVersion } from '@/lib/types';
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

  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.wiki.page(pageId);
      setPage(p);
      setDraftTitle(p.title);
      setDraftBody(p.body);
      const [t, c] = await Promise.all([
        api.wiki.tree(p.space_id).catch(() => []),
        api.wiki.comments(p.id).catch(() => []),
      ]);
      setTree(t);
      setComments(c);
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

  async function addComment() {
    if (!page || !commentBody.trim()) return;
    setPosting(true);
    try {
      await api.wiki.addComment(page.id, commentBody.trim());
      setCommentBody('');
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

                <Button size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Edit
                </Button>
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
                <RichTextView html={page.body} />
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
          <div className="mb-4 flex gap-2">
            <Textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Add a comment…"
              rows={2}
              className="resize-none"
            />
            <Button size="icon" onClick={addComment} disabled={posting || !commentBody.trim()} aria-label="Post comment">
              {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
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
