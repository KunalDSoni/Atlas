import { useCallback, useEffect, useState } from 'react';
import { Lightbulb, MessagesSquare, Plus, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { PortalFeature, PortalStatus } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { PORTAL_STATUS_LABELS } from '@/lib/product';
import { cn } from '@/lib/utils';

const COLUMNS: { key: PortalStatus; accent: string }[] = [
  { key: 'under_consideration', accent: 'border-t-slate-400' },
  { key: 'planned', accent: 'border-t-blue-500' },
  { key: 'launched', accent: 'border-t-emerald-500' },
];

export default function PortalScreen() {
  const [features, setFeatures] = useState<PortalFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ideaOpen, setIdeaOpen] = useState(false);
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

  async function vote(f: PortalFeature) {
    // optimistic toggle
    setFeatures((prev) => prev.map((x) => x.id === f.id
      ? { ...x, has_voted: !x.has_voted, vote_count: x.vote_count + (x.has_voted ? -1 : 1) } : x));
    try {
      await api.portal.vote(f.id);
    } catch (e) {
      toast.error('Vote failed', { description: e instanceof Error ? e.message : undefined });
      void load();
    }
  }

  async function submitIdea() {
    if (!idea.title.trim()) return;
    try {
      await api.portal.submitIdea({ title: idea.title.trim(), content: idea.content.trim() || undefined });
      setIdeaOpen(false);
      setIdea({ title: '', content: '' });
      toast.success('Thanks! Your idea was submitted.');
    } catch (e) {
      toast.error('Submit failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) return (<><PageHeader title="Ideas portal" description="What we're considering" /><RowsSkeleton /></>);
  if (error) return (<><PageHeader title="Ideas portal" /><ErrorState message={error} onRetry={() => void load()} /></>);

  return (
    <>
      <PageHeader
        title="Ideas portal"
        description="Vote on what matters to you, or suggest something new"
        actions={<Button onClick={() => setIdeaOpen(true)}><Plus className="size-4" /> Submit an idea</Button>}
      />

      {features.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Nothing public yet" description="Published features will show up here for customers to vote on." />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = features.filter((f) => f.portal_status === col.key);
            return (
              <div key={col.key} className={cn('rounded-lg border border-t-2 border-border bg-muted/20 p-3', col.accent)}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-semibold">{PORTAL_STATUS_LABELS[col.key]}</h2>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((f) => (
                    <Card key={f.id} className="p-3">
                      <div className="flex items-start gap-3">
                        <button onClick={() => void vote(f)}
                          className={cn('flex shrink-0 flex-col items-center rounded-md border px-2 py-1 text-xs transition',
                            f.has_voted ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                          <ThumbsUp className="size-3.5" />
                          <span className="mt-0.5 font-semibold tabular-nums">{f.vote_count}</span>
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug">{f.name}</p>
                          {f.description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{f.description}</p>}
                        </div>
                      </div>
                    </Card>
                  ))}
                  {items.length === 0 && <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">Nothing here yet</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={ideaOpen} onOpenChange={setIdeaOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Lightbulb className="size-4" /> Submit an idea</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="What would you like to see?" value={idea.title} onChange={(e) => setIdea({ ...idea, title: e.target.value })} />
            <Textarea placeholder="Tell us more (optional)" value={idea.content} onChange={(e) => setIdea({ ...idea, content: e.target.value })} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIdeaOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitIdea()} disabled={!idea.title.trim()}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
