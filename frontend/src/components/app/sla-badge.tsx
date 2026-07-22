import { PauseCircle } from 'lucide-react';
import type { SlaState } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The one way an SLA is rendered.
 *
 * The server derives state (utils/sla.js) and this renders it — neither side
 * recomputes the other's job, so a queue badge, a request detail and the report
 * cannot disagree about whether something is breached.
 */

const STATUS_STYLES: Record<SlaState['status'], string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  at_risk: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  breached: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

const METRIC_LABELS: Record<string, string> = {
  first_response: 'First response',
  resolution: 'Resolution',
};

/**
 * Time remaining, or time over. Deliberately coarse: an SLA read to the minute
 * invites treating a derived-on-read number as a live countdown, which it is
 * not — nothing re-renders it until the page reloads.
 */
function remainingLabel(sla: SlaState): string {
  const mins = Math.abs(sla.remaining_minutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const size = h >= 24 ? `${Math.floor(h / 24)}d` : h > 0 ? `${h}h` : `${m}m`;
  if (sla.stopped) return sla.status === 'breached' ? `${size} over` : 'Met';
  return sla.remaining_minutes < 0 ? `${size} over` : `${size} left`;
}

export function SlaBadge({ sla, showMetric = false, className }: {
  sla: SlaState;
  showMetric?: boolean;
  className?: string;
}) {
  const label = remainingLabel(sla);
  const metric = METRIC_LABELS[sla.metric] ?? sla.metric;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[sla.status],
        // A paused clock is not making progress toward anything; dimming it
        // stops a green "4h left" reading as reassurance while we wait.
        sla.paused && 'opacity-60',
        className,
      )}
      title={`${metric}: ${sla.elapsed_minutes}m of ${sla.target_minutes}m used${sla.paused ? ' (paused)' : ''}`}
    >
      {sla.paused && <PauseCircle className="size-3" aria-hidden />}
      {showMetric && <span className="font-normal opacity-80">{metric}</span>}
      {label}
    </span>
  );
}

/** Every clock on a request, in a stable order. Renders nothing when there are none. */
export function SlaBadges({ sla, showMetric = false }: {
  sla: Partial<Record<string, SlaState>>;
  showMetric?: boolean;
}) {
  const order = ['first_response', 'resolution'];
  const states = order.map((m) => sla[m]).filter((s): s is SlaState => !!s);
  if (states.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {states.map((s) => <SlaBadge key={s.metric} sla={s} showMetric={showMetric} />)}
    </span>
  );
}
