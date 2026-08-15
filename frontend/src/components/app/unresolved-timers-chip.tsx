/**
 * Timers the server stopped without crediting any time.
 *
 * An abandoned timer credits nothing — the server will not invent a duration —
 * so unless the person says how long they worked, the time is never recorded.
 * The issue rail asks that question, but only on the issue it happened on, and
 * forgetting the timer and forgetting the issue are the same act of attention.
 * This is the same question asked somewhere they will actually pass.
 *
 * Separate from RunningTimerChip on purpose: a running timer and an unresolved
 * one are different states with different urgency, and one component switching
 * between them would be harder to read than two that each render or return null.
 *
 * See docs/superpowers/specs/2026-08-15-recovering-unresolved-time-design.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TimerOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { formatDuration, timeAgo } from '@/lib/format';
import { issueUrl } from '@/lib/urls';
import type { UnresolvedTimer } from '@/lib/types';
import { TIMER_CHANGED_EVENT } from './running-timer-chip';

const POLL_MS = 60_000;

/** Wall-clock length of the session the server could not measure. */
function ranFor(t: UnresolvedTimer): number {
  const start = new Date(`${t.started_at.replace(' ', 'T')}Z`).getTime();
  const end = new Date(`${t.ended_at.replace(' ', 'T')}Z`).getTime();
  return Math.max(0, Math.round((end - start) / 60_000));
}

export function UnresolvedTimersChip() {
  const [timers, setTimers] = useState<UnresolvedTimer[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTimers(await api.timers.unresolved());
    } catch {
      // Keep the last known list. Dropping the count on one failed poll would
      // claim work was resolved when it was not.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // A timer that stops — including one the server auto-stops — can create an
  // entry here, so react to the same signal the running chip uses.
  useEffect(() => {
    const onChanged = () => void refresh();
    window.addEventListener(TIMER_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TIMER_CHANGED_EVENT, onChanged);
  }, [refresh]);

  async function dismiss(t: UnresolvedTimer) {
    setBusy(t.id);
    try {
      await api.timers.resolve(t.id);
      setTimers((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error('Could not dismiss', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  if (timers.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${timers.length} timer${timers.length === 1 ? '' : 's'} stopped without logging time`}
          className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/15"
        >
          <TimerOff className="size-3.5" />
          <span className="tabular-nums">{timers.length}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-semibold">Timers with no time logged</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            These were stopped automatically, so nothing was recorded. Log what you
            actually worked, or dismiss them.
          </p>
        </div>

        <ul className="max-h-80 overflow-y-auto">
          {timers.map((t) => (
            <li key={t.id} className="border-b px-3 py-2 last:border-b-0">
              <Link
                to={issueUrl(t.issue_key)}
                onClick={() => setOpen(false)}
                className="text-sm font-medium hover:underline"
              >
                {t.issue_key}
              </Link>
              <p className="truncate text-xs text-muted-foreground" title={t.title}>{t.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ran {formatDuration(ranFor(t))} before it was stopped {timeAgo(t.ended_at)}
              </p>
              <div className="mt-1.5 flex gap-2">
                <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                  <Link to={issueUrl(t.issue_key)} onClick={() => setOpen(false)}>Log time</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={busy === t.id}
                  onClick={() => void dismiss(t)}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
