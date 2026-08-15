import { apiFetch } from './client';

export type TimerUserTotal = { user_id: string; name: string; minutes: number };

/** Why the server closed a segment the user never paused. Mirrors the web type. */
export type TimerStopReason = 'workday_end' | 'abandoned' | 'issue_done' | 'switched_issue';

export type TimerAutoStop = { reason: TimerStopReason; stopped_at: string };

export type TimerState = {
  running: boolean;
  started_at: string | null;
  elapsed_minutes: number;
  /** Open for more than 12h — a warning only, never auto-corrected. */
  runaway: boolean;
  /**
   * Set when the SERVER stopped the timer rather than the user. The field has
   * been on the wire since migration 030; mobile could not see it, so a timer
   * the server stopped simply vanished with no explanation — which is the
   * original "it stopped by itself" report.
   */
  auto_stopped: TimerAutoStop | null;
  by_user: TimerUserTotal[];
  paused_issue?: { id: string; issue_key: string } | null;
};

/** An abandoned timer this user has not yet accounted for. */
export type UnresolvedTimer = {
  id: string;
  issue_id: string;
  issue_key: string;
  title: string;
  started_at: string;
  ended_at: string;
};

export function fetchTimer(issueId: string): Promise<TimerState> {
  return apiFetch<TimerState>(`/issues/${issueId}/timer`);
}

export function startTimer(issueId: string): Promise<TimerState> {
  return apiFetch<TimerState>(`/issues/${issueId}/timer/start`, { method: 'POST', body: {} });
}

export function pauseTimer(issueId: string): Promise<TimerState> {
  return apiFetch<TimerState>(`/issues/${issueId}/timer/pause`, { method: 'POST', body: {} });
}

/**
 * Log work by hand. An abandoned timer credits nothing, so this is the only way
 * its time is ever recorded. Posting also settles that user's abandoned
 * segments on the issue, so the prompt clears itself.
 */
export function logWork(issueId: string, minutes: number): Promise<unknown> {
  return apiFetch(`/issues/${issueId}/worklogs`, { method: 'POST', body: { minutes } });
}

export function fetchUnresolvedTimers(): Promise<UnresolvedTimer[]> {
  return apiFetch<UnresolvedTimer[]>('/me/timer/unresolved');
}

export function resolveTimerSegment(segmentId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/timer-segments/${segmentId}/resolve`, { method: 'POST', body: {} });
}
