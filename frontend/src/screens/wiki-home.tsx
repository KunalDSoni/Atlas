import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, Plus, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import type { WikiPage, WikiSpace } from '@/lib/types';
import { CardsSkeleton, EmptyState, ErrorState, PageHeader, UserAvatar } from '@/components/app/primitives';
import { timeAgo } from '@/lib/format';

function CreateSpaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setKey('');
    setDescription('');
    setKeyEdited(false);
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.wiki.createSpace({
        name: name.trim(),
        space_key: key.trim().toUpperCase(),
        description: description.trim() || undefined,
      });
      toast.success('Space created');
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error('Could not create space', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create space</DialogTitle>
            <DialogDescription>Spaces group related pages, like a team or product area.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="sp-name">Name</Label>
              <Input
                id="sp-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyEdited) setKey(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase());
                }}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sp-key">Key</Label>
              <Input
                id="sp-key"
                value={key}
                onChange={(e) => {
                  setKeyEdited(true);
                  setKey(e.target.value.toUpperCase());
                }}
                maxLength={6}
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sp-desc">Description</Label>
              <Textarea
                id="sp-desc"
                rows={2}
                className="resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || !name.trim() || !key.trim()}>Create space</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PageRow({ page }: { page: WikiPage }) {
  return (
    <li>
      <Link
        to={`/wiki/page/${page.id}`}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
      >
        <BookOpen className="size-4 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-sm">{page.title}</span>
        {page.space_name && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{page.space_name}</span>
        )}
        <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground md:block">
          {timeAgo(page.updated_at)}
        </span>
        <UserAvatar name={page.editor_name ?? page.author_name} color={page.author_color} className="size-5" />
      </Link>
    </li>
  );
}

export default function WikiHomeScreen() {
  const [spaces, setSpaces] = useState<WikiSpace[]>([]);
  const [recent, setRecent] = useState<WikiPage[]>([]);
  const [starred, setStarred] = useState<WikiPage[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WikiPage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r, st] = await Promise.all([
        api.wiki.spaces(),
        api.wiki.recent().catch(() => []),
        api.wiki.starred().catch(() => []),
      ]);
      setSpaces(s);
      setRecent(r);
      setStarred(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wiki');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced search across all spaces.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setResults(await api.wiki.search(q));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  if (loading) {
    return (
      <>
        <PageHeader title="Wiki" />
        <CardsSkeleton count={3} />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Wiki" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Wiki"
        description="Spaces, pages, and documentation."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New space
          </Button>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all pages…"
          className="pl-8"
          aria-label="Search wiki"
        />
      </div>

      {results !== null ? (
        <Card className="overflow-hidden py-0">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No pages match “{query}”.
            </p>
          ) : (
            <ul className="divide-y divide-border-light">
              {results.map((p) => (
                <PageRow key={p.id} page={p} />
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <>
          {spaces.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No spaces yet"
              description="Create a space to start documenting."
              action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New space</Button>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {spaces.map((s) => (
                <Link key={s.id} to={`/wiki/space/${s.id}`} className="group">
                  <Card className="h-full overflow-hidden pt-0 transition-all hover:border-primary/40 hover:shadow-raised">
                    <span className="block h-1.5" style={{ background: s.color || 'var(--primary)' }} />
                    <CardContent className="flex items-start gap-3 px-4 pb-4 pt-3.5">
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-lg text-lg"
                        style={{ background: s.color ? `${s.color}1a` : 'var(--primary-muted)' }}
                      >
                        {s.icon || '📘'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{s.name}</span>
                          {s.starred ? <Star className="size-3.5 shrink-0 fill-warning text-warning" /> : null}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                          {s.space_key}
                        </span>
                        {s.description && (
                          <span className="mt-1.5 line-clamp-2 block text-xs text-muted-foreground">{s.description}</span>
                        )}
                        <span className="mt-2 block text-[11px] text-faint">
                          {s.page_count} page{s.page_count === 1 ? '' : 's'}
                        </span>
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Clock className="size-4 text-muted-foreground" /> Recently updated
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {recent.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">No pages yet.</p>
                ) : (
                  <ul className="divide-y divide-border-light border-t border-border-light">
                    {recent.slice(0, 8).map((p) => (
                      <PageRow key={p.id} page={p} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Star className="size-4 text-muted-foreground" /> Starred
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {starred.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">
                    Star a page to find it quickly here.
                  </p>
                ) : (
                  <ul className="divide-y divide-border-light border-t border-border-light">
                    {starred.slice(0, 8).map((p) => (
                      <PageRow key={p.id} page={p} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <CreateSpaceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </>
  );
}
