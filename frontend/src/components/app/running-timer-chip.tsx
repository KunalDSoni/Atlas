/**
 * The running timer, wherever you are.
 *
 * The stopwatch used to have no presence outside the issue it was started on:
 * start one, navigate away, and nothing indicated it was still going. People
 * did not forget timers because the timer misbehaved — they forgot because it
 * was invisible, and the automatic stop that followed read as a malfunction.
 *
 * Renders nothing when no timer is running, so the header holds no space
 * speculatively. See docs/superpowers/specs/2026-08-10-running-timer-indicator-design.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { issueUrl } from '@/lib/urls';
import { cn } from '@/lib/utils';
import type { MyTimer } from '@/lib/types';

/**
 * Dispatched on `window` whenever a timer starts or stops anywhere in the app.
 * Polling alone would leave the chip up to a minute stale after the user's own
 * click, which reads as the UI being broken. A DOM event rather than a store or
 * context: the shell already dispatches one for the ⌘K palette, and one chip
 * should not require global state plumbing.
 *
 * `detail.issueId` names the issue whose timer changed, so a listener showing
 * that issue can reload the totals a pause has just rewritten.
 *
 * `detail.source` names who dispatched it, and exists to stop a listener acting
 * on its own event. The issue detail view both emits (so the chip updates) and
 * listens (so the chip's own pause refreshes it) — without this it would answer
 * its own start/pause by refetching the entire issue, fourteen requests deep,
 * every time someone clicks the stopwatch.
 */
export const TIMER_CHANGED_EVENT = 'atlas:timer-changed';

export type TimerChangeSource = 'chip' | 'issue-detail';

export interface TimerChangedDetail {
  issueId?: string;
  source: TimerChangeSource;
}

export function emitTimerChanged(source: TimerChangeSource, issueId?: string) {
  window.dispatchEvent(
    new CustomEvent<TimerChangedDetail>(TIMER_CHANGED_EVENT, { detail: { issueId, source } })
  );
}

const POLL_MS = 60_000;

export function RunningTimerChip() {
  const [timer, setTimer] = useState<MyTimer | null>(null);
  const [pausing, setPausing] = useState(false);
  // Advances the readout between polls so the minutes move without a request
  // each time. Reset whenever a fetch lands, since that value is authoritative.
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setTimer(await api.timers.mine());
      setTick(0);
    } catch {
      // Keep the last known state. Flickering the chip out on one failed poll
      // would look exactly like the timer stopping by itself.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onChanged = () => void refresh();
    window.addEventListener(TIMER_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TIMER_CHANGED_EVENT, onChanged);
  }, [refresh]);

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, [timer]);

  if (!timer) return null;

  const elapsed = timer.elapsed_minutes + tick;

  async function pauseRunning() {
    if (!timer) return;
    setPausing(true);
    try {
      await api.timers.pause(timer.issue_id);
      setTimer(null);
      // Pausing writes a work log, so an open issue page's logged total and
      // worklog list are stale the moment this returns.
      emitTimerChanged('chip', timer.issue_id);
    } catch (e) {
      // Never show a stopped timer that is still running on the server.
      toast.error('Could not pause timer', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setPausing(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        to={issueUrl(timer.issue_key)}
        aria-label={`Timer running on ${timer.issue_key}, ${formatDuration(elapsed)}`}
        title={timer.title}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
          timer.runaway
            ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
            : 'border-border bg-surface text-muted-foreground hover:border-primary/40 hover:text-foreground'
        )}
      >
        <Timer className={cn('size-3.5', !timer.runaway && 'animate-pulse')} />
        <span>{timer.issue_key}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{elapsed > 0 ? formatDuration(elapsed) : '0m'}</span>
      </Link>

      {timer.runaway && (
        <>
          {/* Announced once, on escalation. The elapsed figure above is
              deliberately not in a live region — it changes every minute, and
              announcing that on a loop is hostile. */}
          <span role="status" className="sr-only">
            Timer on {timer.issue_key} has been running over 12 hours.
          </span>
          <button
            type="button"
            onClick={() => void pauseRunning()}
            disabled={pausing}
            aria-label={`Pause timer on ${timer.issue_key}`}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-destructive underline underline-offset-2 hover:bg-destructive/10 disabled:opacity-60"
          >
            <Pause className="size-3" /> Pause it
          </button>
        </>
      )}
    </div>
  );
}
