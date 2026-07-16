import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileClock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { AuditLogPage } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { timeAgo } from '@/lib/format';

const CATEGORIES = ['auth', 'users', 'projects', 'sprints', 'issues', 'comments'];
const ALL = '__all__';

export default function AuditLogScreen() {
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search so typing doesn't hammer the endpoint.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.admin.auditLog({
          page,
          limit: 25,
          category: category === ALL ? undefined : category,
          q: debounced || undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [page, category, debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description={data ? `${data.total} recorded event${data.total === 1 ? '' : 's'}` : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            className="pl-8"
            aria-label="Search audit log"
          />
        </div>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter by category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <RowsSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data || data.entries.length === 0 ? (
        <EmptyState icon={FileClock} title="No events" description="Nothing matches these filters." />
      ) : (
        <>
          <Card className="overflow-hidden py-0">
            <ul className="divide-y divide-border-light">
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <UserAvatar name={e.user_name} color={e.user_color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium">{e.user_name ?? 'System'}</span>{' '}
                      <span className="text-muted-foreground">{e.action.toLowerCase()}</span>
                      {e.entity_name && <span className="text-foreground"> · {e.entity_name}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="capitalize">{e.category}</span> · {timeAgo(e.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {data.total_pages > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Page {data.page} of {data.total_pages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.total_pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
