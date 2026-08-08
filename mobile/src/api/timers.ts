import { apiFetch } from './client';

export type TimerUserTotal = { user_id: string; name: string; minutes: number };

export type TimerState = {
  running: boolean;
  started_at: string | null;
  elapsed_minutes: number;
  /** Open for more than 12h — a warning only, never auto-corrected. */
  runaway: boolean;
  by_user: TimerUserTotal[];
  paused_issue?: { id: string; issue_key: string } | null;
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
