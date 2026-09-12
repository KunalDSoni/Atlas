/**
 * Presentation for the server's completion guard: a parent issue rejected
 * because its children are still open.
 *
 * The server answers those with 409 `{ error, summary, blockers }`. `error` is
 * a complete one-line sentence for anywhere that can only show a string; the
 * pieces below use `summary` plus the structured `blockers` so each open child
 * gets its own line with the state it is actually in — which is the whole
 * point: "three subtasks are open" is useless without saying which three.
 */
import { toast } from 'sonner';
import { ApiError, type CompletionBlocker } from './api';

/** How many blockers a toast lists before it summarizes the remainder. */
const VISIBLE_LIMIT = 6;

/** The guard's blockers, or [] for any other failure. */
export function blockersOf(error: unknown): CompletionBlocker[] {
  return error instanceof ApiError ? error.blockers : [];
}

export function isCompletionBlocked(error: unknown): boolean {
  return blockersOf(error).length > 0;
}

/** Falls back to the error's own message when the server sent no summary. */
export function blockerTitle(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Update failed';
  return error.summary || error.message;
}

export function BlockerList({ blockers }: { blockers: CompletionBlocker[] }) {
  const shown = blockers.slice(0, VISIBLE_LIMIT);
  const hidden = blockers.length - shown.length;
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((blocker) => (
        <li key={blocker.id} className="flex items-baseline gap-1.5">
          <span className="shrink-0 font-medium">{blocker.issue_key}</span>
          <span className="min-w-0 flex-1 truncate">{blocker.title}</span>
          <span className="shrink-0 opacity-80">— {blocker.status_label}</span>
        </li>
      ))}
      {hidden > 0 && <li className="opacity-80">and {hidden} more</li>}
    </ul>
  );
}

/**
 * Shows the guard's rejection as a toast and reports whether it handled the
 * error. Callers fall through to their own generic toast when it returns false.
 */
export function notifyCompletionBlocked(error: unknown): boolean {
  const blockers = blockersOf(error);
  if (blockers.length === 0) return false;
  toast.error(blockerTitle(error), { description: <BlockerList blockers={blockers} /> });
  return true;
}

/** One issue that a bulk update could not move, and why. */
export interface BulkFailure {
  issueKey: string;
  error: unknown;
}

/**
 * Reports the outcome of a partial bulk update: what moved, and a line per
 * issue that did not. Blocked issues are named with their open-child count so
 * the user can see the shape of the problem without opening each one.
 */
export function notifyBulkOutcome(
  updated: number,
  failures: BulkFailure[],
  noun: string,
): void {
  const label = (count: number) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  if (failures.length === 0) {
    toast.success(`Updated ${label(updated)}`);
    return;
  }

  const lines = failures.slice(0, VISIBLE_LIMIT).map(({ issueKey, error }) => {
    const blockers = blockersOf(error);
    const reason = blockers.length > 0
      ? `${blockers.length} open ${blockers.every((b) => b.type === 'subtask') ? 'subtask' : 'child issue'}${blockers.length === 1 ? '' : 's'}`
      : (error instanceof Error ? error.message : 'could not be updated');
    return { issueKey, reason };
  });
  const hidden = failures.length - lines.length;

  const description = (
    <ul className="mt-1 space-y-0.5">
      {lines.map(({ issueKey, reason }) => (
        <li key={issueKey} className="flex items-baseline gap-1.5">
          <span className="shrink-0 font-medium">{issueKey}</span>
          <span className="min-w-0 flex-1 truncate">— {reason}</span>
        </li>
      ))}
      {hidden > 0 && <li className="opacity-80">and {hidden} more</li>}
    </ul>
  );

  // Nothing moved at all reads as a plain failure; a partial run is a warning
  // so the count that did succeed is not mistaken for a total failure.
  const headline = updated === 0
    ? `Could not update ${label(failures.length)}`
    : `Updated ${label(updated)}, ${failures.length} blocked`;

  if (updated === 0) toast.error(headline, { description });
  else toast.warning(headline, { description });
}
