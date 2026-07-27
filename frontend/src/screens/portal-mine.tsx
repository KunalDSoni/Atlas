import { useCallback, useEffect, useState } from 'react';
import { Bell, Lightbulb, MessageSquareText } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { useAuth } from '@/context/auth-provider';
import { formatDate } from '@/lib/format';
import { api } from '@/lib/api';
import { PORTAL_STATUS_LABELS } from '@/lib/product';
import type { PortalMe, PortalSubmissionStatus } from '@/lib/types';

const SUBMISSION_LABELS: Record<PortalSubmissionStatus, string> = {
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  closed: 'Closed',
};

const SUBMISSION_CLASSES: Record<PortalSubmissionStatus, string> = {
  submitted: 'bg-slate-500/15 text-slate-600',
  reviewed: 'bg-blue-500/15 text-blue-600',
  closed: 'bg-emerald-500/15 text-emerald-600',
};

export default function PortalMineScreen() {
  const { user, loading: authLoading } = useAuth();
  const [mine, setMine] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      setMine(await api.portal.mine());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your ideas');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  if (authLoading) return <RowsSkeleton />;
  if (!user) return <Navigate to="/login?next=%2Fportal%2Fmine" replace />;
  if (loading) return (<><PageHeader title="My ideas" /><RowsSkeleton /></>);
  if (error || !mine) return <ErrorState message={error || 'Could not load your ideas'} onRetry={() => void load()} />;

  async function unfollow(featureId: string) {
    try {
      await api.portal.unfollow(featureId);
      setMine((current) => current ? {
        ...current,
        follows: current.follows.filter((feature) => feature.id !== featureId),
      } : current);
      toast.success('Updates unfollowed');
    } catch (e) {
      toast.error('Could not unfollow', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <>
      <PageHeader
        title="My ideas"
        description="Ideas you submitted and public roadmap items you follow"
        actions={<Button asChild><Link to="/portal"><Lightbulb className="size-4" /> Browse roadmap</Link></Button>}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <MessageSquareText className="size-4 text-muted-foreground" />
            <h2 className="font-semibold">My submissions</h2>
            <span className="text-xs text-muted-foreground">{mine.submissions.length}</span>
          </div>
          {mine.submissions.length ? (
            <div className="space-y-3">
              {mine.submissions.map((submission) => (
                <Card key={submission.id} className="gap-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-medium">{submission.title}</h3>
                    <Badge className={SUBMISSION_CLASSES[submission.status]}>{SUBMISSION_LABELS[submission.status]}</Badge>
                  </div>
                  {submission.content && <p className="text-sm leading-6 text-muted-foreground">{submission.content}</p>}
                  <p className="text-xs text-muted-foreground">Submitted {formatDate(submission.submitted_at)}</p>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon={MessageSquareText} title="No submissions yet" description="Submit an idea from the public roadmap and it will stay visible here." />
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <h2 className="font-semibold">Following</h2>
            <span className="text-xs text-muted-foreground">{mine.follows.length}</span>
          </div>
          {mine.follows.length ? (
            <div className="space-y-3">
              {mine.follows.map((feature) => (
                <Card key={feature.id} className="gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Badge variant="secondary">{PORTAL_STATUS_LABELS[feature.portal_status]}</Badge>
                      <Link to={`/portal/features/${feature.id}`} className="mt-2 block font-medium hover:text-primary">
                        {feature.name}
                      </Link>
                      {feature.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{feature.description}</p>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void unfollow(feature.id)}>Unfollow</Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon={Bell} title="Not following anything" description="Follow a roadmap item to hear when its public status changes." />
          )}
        </section>
      </div>
    </>
  );
}
