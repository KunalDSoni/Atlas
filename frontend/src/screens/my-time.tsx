/**
 * What did I work on this week — across every project.
 *
 * Every other time report in Atlas is scoped to a single project, so answering
 * this meant opening each one in turn and adding up the rows carrying your
 * name. See docs/superpowers/specs/2026-08-15-my-time-design.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { issueUrl } from '@/lib/urls';
import type { MyTimeResponse } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';

const DAY_MS = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Monday of the week containing `d`, as a UTC date. */
function weekStart(d: Date): Date {
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // getUTCDay is 0 for Sunday; shift so Monday is the first column.
  const offset = (utc.getUTCDay() + 6) % 7;
  return new Date(utc.getTime() - offset * DAY_MS);
}

const dayName = (date: string) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const dayNumber = (date: string) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export default function MyTimeScreen() {
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<MyTimeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const from = isoDate(start);
  const to = isoDate(new Date(start.getTime() + 7 * DAY_MS));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.myTime(from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your time');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const thisWeek = isoDate(weekStart(new Date()));
  const today = isoDate(new Date());

  const header = (
    <PageHeader
      title="My time"
      description={data ? `${formatDuration(data.total_minutes)} logged · times shown in ${data.timezone}` : undefined}
      actions={
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous week"
            onClick={() => setStart(new Date(start.getTime() - 7 * DAY_MS))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={from === thisWeek}
            onClick={() => setStart(weekStart(new Date()))}>
            This week
          </Button>
          <Button variant="outline" size="icon" aria-label="Next week"
            onClick={() => setStart(new Date(start.getTime() + 7 * DAY_MS))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      }
    />
  );

  if (loading) return <>{header}<RowsSkeleton count={5} /></>;
  if (error) return <>{header}<ErrorState message={error} onRetry={load} /></>;
  if (!data) return <>{header}<ErrorState message="No data" onRetry={load} /></>;

  if (data.total_minutes === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Clock}
          title="Nothing logged this week"
          description="Time you log on an issue — by hand or with the stopwatch — shows up here."
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-3 lg:grid-cols-7">
        {data.by_day.map((day) => {
          const entries = data.entries.filter((e) => e.date === day.date);
          return (
            <Card key={day.date} className={`p-3 ${day.date === today ? 'border-primary/50' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{dayName(day.date)}</p>
                  <p className="text-lg font-semibold tabular-nums">{dayNumber(day.date)}</p>
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {day.minutes > 0 ? formatDuration(day.minutes) : '—'}
                </p>
              </div>

              <ul className="mt-2 space-y-2">
                {entries.map((entry) => (
                  <li key={entry.id} className="rounded-md border p-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link to={issueUrl(entry.issue_key)} className="text-xs font-medium hover:underline">
                        {entry.issue_key}
                      </Link>
                      <span className="text-xs tabular-nums">{formatDuration(entry.minutes)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground" title={entry.title}>{entry.title}</p>
                    {/* Measured time is worth distinguishing from inferred time —
                        the point of the abandoned-timer and business-hours work. */}
                    {entry.source !== 'manual' && (
                      <Badge variant="secondary" className="mt-1 text-[10px]">{entry.source}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
