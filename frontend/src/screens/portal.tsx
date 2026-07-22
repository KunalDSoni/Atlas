import { useCallback, useEffect, useState } from 'react';
import { Bell, Lightbulb, MessagesSquare, Plus, ThumbsUp } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { PortalFeature, PortalStatus } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { PORTAL_STATUS_LABELS } from '@/lib/product';
import { useAuth } from '@/context/auth-provider';
import { cn } from '@/lib/utils';

const COLUMNS: { key: PortalStatus; accent: string; description: string }[] = [
  { key: 'under_consideration', accent: 'border-t-slate-400', description: 'Ideas we are learning about' },
  { key: 'planned', accent: 'border-t-blue-500', description: 'Committed and coming up' },
  { key: 'launched', accent: 'border-t-emerald-500', description: 'Available now' },
];

export default function PortalScreen() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [features, setFeatures] = useState<PortalFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idea, setIdea] = useState({ title: '', content: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeatures(await api.portal.features());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function requireIdentity(action: () => void) {
    if (user) action();
    else navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
  }

  async function vote(feature: PortalFeature) {
    if (!user) {
      requireIdentity(() => undefined);
      return;
    }
    setFeatures((current) => current.map((item) => item.id === feature.id
      ? { ...item, has_voted: !item.has_voted, vote_count: item.vote_count + (item.has_voted ? -1 : 1) }
      : item));
    try {
      const saved = await api.portal.vote(feature.id);
      setFeatures((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (e) {
      toast.error('Vote failed', { description: e instanceof Error ? e.message : undefined });
      void load();
    }
  }

  async function submitIdea() {
    if (!idea.title.trim()) return;
    setSubmitting(true);
    try {
      await api.portal.submitIdea({ title: idea.title.trim(), content: idea.content.trim() || undefined });
      setIdeaOpen(false);
      setIdea({ title: '', content: '' });
      toast.success('Thanks! Your idea was submitted.');
      navigate('/portal/mine');
    } catch (e) {
      toast.error('Submit failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return (<><PageHeader title="Ideas portal" description="See what we are considering, planning, and launching" /><RowsSkeleton /></>);
  if (error) return (<><PageHeader title="Ideas portal" /><ErrorState message={error} onRetry={() => void load()} /></>);

  return (
    <>
      <PageHeader
        title="Ideas portal"
        description="Explore the public roadmap, vote on what matters, and follow ideas for updates"
        actions={(
          <Button onClick={() => requireIdentity(() => setIdeaOpen(true))}>
            <Plus className="size-4" /> Submit an idea
          </Button>
        )}
      />

      {features.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Nothing public yet" description="Published ideas will show up here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((column) => {
            const items = features.filter((feature) => feature.portal_status === column.key);
            return (
              <section key={column.key} className={cn('rounded-xl border border-t-2 border-border bg-muted/20 p-3', column.accent)}>
                <div className="mb-3">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-semibold">{PORTAL_STATUS_LABELS[column.key]}</h2>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{column.description}</p>
                </div>
                <div className="space-y-2">
                  {items.map((feature) => (
                    <Card key={feature.id} className="gap-3 p-3 transition-shadow hover:shadow-sm">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          aria-label={`${feature.has_voted ? 'Remove vote from' : 'Vote for'} ${feature.name}`}
                          onClick={() => void vote(feature)}
                          className={cn(
                            'flex shrink-0 flex-col items-center rounded-md border px-2 py-1 text-xs transition',
                            feature.has_voted
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:border-primary/40',
                          )}
                        >
                          <ThumbsUp className="size-3.5" />
                          <span className="mt-0.5 font-semibold tabular-nums">{feature.vote_count}</span>
                        </button>
                        <Link to={`/portal/features/${feature.id}`} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <h3 className="text-sm font-medium leading-snug hover:text-primary">{feature.name}</h3>
                          {feature.description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{feature.description}</p>}
                        </Link>
                      </div>
                      <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                        <Bell className="size-3" /> {feature.follower_count} following
                      </div>
                    </Card>
                  ))}
                  {items.length === 0 && (
                    <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                      Nothing here yet
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={ideaOpen} onOpenChange={setIdeaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lightbulb className="size-4" /> Submit an idea</DialogTitle>
            <DialogDescription>We will show it under My ideas, so you can see when the product team reviews it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input aria-label="Idea title" placeholder="What would you like to see?" value={idea.title}
              onChange={(event) => setIdea({ ...idea, title: event.target.value })} />
            <Textarea aria-label="Idea details" placeholder="Tell us more (optional)" value={idea.content}
              onChange={(event) => setIdea({ ...idea, content: event.target.value })} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIdeaOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitIdea()} disabled={submitting || !idea.title.trim()}>
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
