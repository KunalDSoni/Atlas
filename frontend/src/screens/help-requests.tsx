import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { stripMentionSyntax } from '@/lib/mentions';
import { api } from '@/lib/api';
import type { PublicRequest } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { cn } from '@/lib/utils';

/** One rating per request, editable while it stays resolved. */
function SatisfactionCard({ requestKey, existing, onRated }: {
  requestKey: string;
  existing: { rating: number; comment: string } | null;
  onRated: (s: { rating: number; comment: string }) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function rate(rating: number) {
    setSaving(true);
    try {
      await api.help.rate(requestKey, rating);
      onRated({ rating, comment: existing?.comment ?? '' });
      toast.success('Thanks for the feedback');
    } catch (e) {
      toast.error('Could not save your rating', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <p className="text-sm font-medium">
        {existing ? 'You rated this request' : 'How did we do?'}
      </p>
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={saving}
            aria-label={`${star} star${star === 1 ? '' : 's'}`}
            onClick={() => void rate(star)}
            className={cn(
              'text-2xl leading-none transition-colors',
              existing && star <= existing.rating ? 'text-amber-500' : 'text-muted-foreground/40 hover:text-amber-400',
            )}
          >
            ★
          </button>
        ))}
      </div>
      {existing && <p className="mt-1 text-xs text-muted-foreground">You can change this while the request stays resolved.</p>}
    </Card>
  );
}

const STATUS_STYLES: Record<string, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

function StatusChip({ request }: { request: PublicRequest }) {
  return (
    <span className={cn(
      'rounded-full px-2 py-0.5 text-xs font-medium',
      STATUS_STYLES[request.status_category ?? 'todo'] ?? STATUS_STYLES.todo,
    )}>
      {request.status}
    </span>
  );
}

function RequestList() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<PublicRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequests(await api.help.myRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <RowsSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="My requests"
        description="Everything you have raised, newest first"
        actions={<Button onClick={() => navigate('/help')}>Raise a request</Button>}
      />
      {requests.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No requests yet"
          description="When you raise a request it will appear here."
          action={<Button onClick={() => navigate('/help')}>Raise a request</Button>}
        />
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Card
              key={r.key}
              className="cursor-pointer p-4 transition hover:border-primary"
              onClick={() => navigate(`/help/requests/${r.key}`)}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.key}
                    {r.request_type ? ` · ${r.request_type.name}` : ''}
                  </p>
                </div>
                <StatusChip request={r} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function RequestDetail({ requestKey }: { requestKey: string }) {
  const navigate = useNavigate();
  const [request, setRequest] = useState<PublicRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequest(await api.help.getRequest(requestKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load this request');
    } finally {
      setLoading(false);
    }
  }, [requestKey]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.help.reply(requestKey, reply.trim());
      setReply('');
      await load();
    } catch (e) {
      toast.error('Could not send your reply', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    setBusy(true);
    try {
      setRequest(await api.help.resolve(requestKey));
      toast.success('Request marked as resolved');
    } catch (e) {
      toast.error('Could not resolve the request', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <RowsSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!request) return null;

  const fieldEntries = Object.entries(request.fields);

  return (
    <>
      <PageHeader
        title={request.summary}
        description={`${request.key}${request.request_type ? ` · ${request.request_type.name}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusChip request={request} />
            <Button variant="ghost" onClick={() => navigate('/help/requests')}>Back</Button>
            {request.status_category !== 'done' && (
              <Button variant="outline" disabled={busy} onClick={() => void resolve()}>
                Mark as resolved
              </Button>
            )}
          </div>
        }
      />

      {/* Rating only makes sense once the job is done, and stays editable for
          as long as it stays done — the server enforces both. */}
      {request.status_category === 'done' && (
        <SatisfactionCard
          requestKey={request.key}
          existing={request.satisfaction}
          onRated={(s) => setRequest((r) => (r ? { ...r, satisfaction: s } : r))}
        />
      )}

      {fieldEntries.length > 0 && (
        <Card className="mb-4 p-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            {fieldEntries.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <div className="space-y-3">
        {request.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No replies yet.</p>
        ) : (
          request.comments.map((c) => (
            <Card key={c.id} className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{c.author_name}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{stripMentionSyntax(c.body)}</p>
            </Card>
          ))
        )}
      </div>

      <div className="mt-4 space-y-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Add a reply…"
          rows={3}
        />
        <div className="flex justify-end">
          <Button disabled={!reply.trim() || busy} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      </div>
    </>
  );
}

export default function HelpRequestsScreen() {
  const { key } = useParams<{ key: string }>();
  return (
    <div className="mx-auto max-w-3xl p-6">
      {key ? <RequestDetail requestKey={key} /> : <RequestList />}
    </div>
  );
}
