import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bell, BellOff, ThumbsUp } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, RowsSkeleton } from '@/components/app/primitives';
import { useAuth } from '@/context/auth-provider';
import { api } from '@/lib/api';
import { PORTAL_STATUS_LABELS } from '@/lib/product';
import type { PortalFeature } from '@/lib/types';

export default function PortalFeatureScreen() {
  const { featureId = '' } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [feature, setFeature] = useState<PortalFeature | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeature(await api.portal.feature(featureId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this idea');
    } finally {
      setLoading(false);
    }
  }, [featureId]);

  useEffect(() => { void load(); }, [load]);

  function requireIdentity(): boolean {
    if (user) return true;
    navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
    return false;
  }

  async function vote() {
    if (!feature || !requireIdentity()) return;
    setSaving(true);
    try {
      setFeature(await api.portal.vote(feature.id));
    } catch (e) {
      toast.error('Vote failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function toggleFollow() {
    if (!feature || !requireIdentity()) return;
    setSaving(true);
    try {
      setFeature(feature.is_following
        ? await api.portal.unfollow(feature.id)
        : await api.portal.follow(feature.id));
      toast.success(feature.is_following ? 'Updates unfollowed' : 'You will be notified when this changes');
    } catch (e) {
      toast.error('Could not update your follow', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <RowsSkeleton />;
  if (error || !feature) return <ErrorState message={error || 'Feature not found'} onRetry={() => void load()} />;

  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/portal"><ArrowLeft className="size-4" /> Back to roadmap</Link>
      </Button>

      <Card className="gap-6 p-6 sm:p-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{PORTAL_STATUS_LABELS[feature.portal_status]}</Badge>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Bell className="size-3.5" /> {feature.follower_count} {feature.follower_count === 1 ? 'follower' : 'followers'}
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">{feature.name}</h1>
          <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-muted-foreground">
            {feature.description || 'No public description has been added yet.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-border pt-5">
          <Button variant={feature.has_voted ? 'default' : 'outline'} onClick={() => void vote()} disabled={saving}>
            <ThumbsUp className="size-4" />
            {feature.has_voted ? 'Voted' : 'Vote'} · {feature.vote_count}
          </Button>
          <Button variant={feature.is_following ? 'secondary' : 'outline'} onClick={() => void toggleFollow()} disabled={saving}>
            {feature.is_following ? <BellOff className="size-4" /> : <Bell className="size-4" />}
            {feature.is_following ? 'Following' : 'Follow updates'}
          </Button>
        </div>

        {!user && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            You can browse without an account. Sign in when you want to vote or follow updates.
          </p>
        )}
      </Card>
    </div>
  );
}
