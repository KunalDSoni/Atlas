import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, FileText, Plus, Star, Trash2, Newspaper } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { isAdmin } from '@/lib/domain';
import type { WikiPage, WikiSpace, WikiTemplate, WikiTreeNode } from '@/lib/types';
import { EmptyState, ErrorState, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { WikiTree } from '@/components/app/wiki-tree';
import { WikiBreadcrumb } from '@/components/app/wiki-doc';
import { timeAgo } from '@/lib/format';

const BLANK = '__blank__';

export function CreatePageDialog({
  open,
  onOpenChange,
  spaceId,
  parentId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  spaceId: string;
  parentId?: string | null;
  onCreated: (page: WikiPage) => void;
}) {
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState(BLANK);
  const [templates, setTemplates] = useState<WikiTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [asBlog, setAsBlog] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setTemplateId(BLANK);
    api.wiki.templates().then(setTemplates).catch(() => setTemplates([]));
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const tpl = templates.find((t) => t.id === templateId);
      const page = await api.wiki.createPage(spaceId, {
        title: title.trim(),
        body: tpl?.body ?? '',
        parent_id: asBlog ? null : (parentId ?? null),
        page_type: asBlog ? 'blog' : 'page',
      });
      toast.success('Page created');
      onOpenChange(false);
      onCreated(page);
    } catch (err) {
      toast.error('Could not create page', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create page</DialogTitle>
            <DialogDescription>Start from a blank page or a template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pg-title">Title</Label>
              <Input id="pg-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={asBlog}
                onChange={(e) => setAsBlog(e.target.checked)}
                className="size-4"
              />
              Publish as a blog post (kept out of the page tree)
            </label>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={BLANK}>Blank page</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.icon ? `${t.icon} ` : ''}{t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || !title.trim()}>Create page</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WikiSpaceScreen() {
  const { spaceId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [space, setSpace] = useState<WikiSpace | null>(null);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [tree, setTree] = useState<WikiTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState<'pages' | 'blog'>('pages');

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, p, t] = await Promise.all([
        api.wiki.space(spaceId),
        api.wiki.pages(spaceId),
        api.wiki.tree(spaceId).catch(() => []),
      ]);
      setSpace(s);
      setPages(p);
      setTree(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load space');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleStar() {
    if (!space) return;
    const previous = space.starred;
    setSpace({ ...space, starred: previous ? 0 : 1 });
    try {
      await api.wiki.star({ space_id: space.id });
    } catch (e) {
      setSpace({ ...space, starred: previous });
      toast.error('Could not update star', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeSpace() {
    if (!space) return;
    try {
      await api.wiki.deleteSpace(space.id);
      toast.success(`${space.name} deleted`);
      navigate('/wiki');
    } catch (e) {
      toast.error('Could not delete space', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) {
    return <RowsSkeleton count={8} />;
  }
  if (error || !space) {
    return <ErrorState message={error ?? 'Space not found'} onRetry={load} />;
  }

  const blogPosts = pages.filter((p) => p.page_type === 'blog');
  const docPages = pages.filter((p) => p.page_type !== 'blog');
  const shown = tab === 'blog' ? blogPosts : docPages;

  return (
    <div className="mx-auto max-w-6xl">
      <WikiBreadcrumb items={[{ label: 'Wiki', to: '/wiki' }, { label: space.name, icon: space.icon ?? undefined }]} />

      {/* Space hero */}
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-lg text-2xl"
          style={{ background: space.color ? `${space.color}1a` : 'var(--primary-muted)' }}
        >
          {space.icon || '📘'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold tracking-tight">{space.name}</h1>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{space.space_key}</span>
          </div>
          {space.description && <p className="mt-1 text-sm text-muted-foreground">{space.description}</p>}
          <p className="mt-1 text-xs text-faint">{space.page_count} page{space.page_count === 1 ? '' : 's'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="icon" onClick={toggleStar} aria-label={space.starred ? 'Unstar space' : 'Star space'}>
            <Star className={space.starred ? 'size-4 fill-warning text-warning' : 'size-4'} />
          </Button>
          {isAdmin(user?.role) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete space">
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {space.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the space and all {space.page_count} of its pages. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={removeSpace}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete space
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New page
          </Button>
        </div>
      </div>

      {pages.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No pages in this space"
          description="Create the first page to get started."
          action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New page</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-6">
              <p className="mb-2 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Page tree</p>
              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
                <WikiTree nodes={tree} />
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'pages' | 'blog')} className="mb-3">
              <TabsList>
                <TabsTrigger value="pages">Pages ({docPages.length})</TabsTrigger>
                <TabsTrigger value="blog">Blog ({blogPosts.length})</TabsTrigger>
              </TabsList>
            </Tabs>

            {shown.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                {tab === 'blog' ? 'No blog posts yet.' : 'No pages yet.'}
              </p>
            ) : (
              <Card className="overflow-hidden py-0">
                <ul className="divide-y divide-border-light">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/wiki/page/${p.id}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                      >
                        {p.page_type === 'blog'
                          ? <Newspaper className="size-4 shrink-0 text-primary" />
                          : <FileText className="size-4 shrink-0 text-faint" />}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                        {p.page_type !== 'blog' && (
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">v{p.version}</span>
                        )}
                        <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:block">
                          {timeAgo(p.page_type === 'blog' ? p.created_at : p.updated_at)}
                        </span>
                        <UserAvatar name={p.editor_name ?? p.author_name} color={p.author_color} className="size-6" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      <CreatePageDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        spaceId={spaceId}
        onCreated={(page) => navigate(`/wiki/page/${page.id}`)}
      />
    </div>
  );
}
