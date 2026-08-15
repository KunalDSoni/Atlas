/**
 * Start or pause the stopwatch from a board card.
 *
 * Until this, a timer could only be started from the issue detail rail, so
 * every session cost a navigation on the most repeated action in the feature —
 * and the card gave no sign which issue was being tracked.
 *
 * Reads the running timer from the same `atlas:timer-changed` event the header
 * chip uses, so a board full of cards makes no requests of its own: one fetch
 * in the chip, and every card learns from the event.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { TIMER_CHANGED_EVENT, emitTimerChanged } from './running-timer-chip';

export function CardTimerButton({ issueId, issueKey }: { issueId: string; issueKey: string }) {
  const [runningIssueId, setRunningIssueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const mine = await api.timers.mine();
      setRunningIssueId(mine ? mine.issue_id : null);
    } catch {
      // Leave the last known state. A card showing the wrong icon for a moment
      // is better than one that flickers on every failed poll.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(TIMER_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TIMER_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const running = runningIssueId === issueId;

  async function toggle(e: React.MouseEvent) {
    // The whole card is a button that opens the issue, and it is draggable.
    // Without both of these, starting a timer opens the issue underneath it.
    e.stopPropagation();
    e.preventDefault();

    setBusy(true);
    try {
      if (running) {
        await api.timers.pause(issueId);
      } else {
        await api.timers.start(issueId);
      }
      // Tells the header chip and every other card at once — including the card
      // whose timer this just displaced.
      emitTimerChanged('issue-detail', issueId);
      await refresh();
    } catch (err) {
      toast.error(running ? 'Could not pause timer' : 'Could not start timer', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void toggle(e)}
      onKeyDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      disabled={busy}
      aria-label={running ? `Pause timer on ${issueKey}` : `Start timer on ${issueKey}`}
      className={cn(
        'grid size-5 place-items-center rounded transition-colors',
        // A running timer is always visible; the idle control appears on hover
        // or keyboard focus, so a board of cards is not a wall of buttons.
        running
          ? 'text-primary'
          : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground',
        'disabled:opacity-40',
      )}
    >
      {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
    </button>
  );
}
