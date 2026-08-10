import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RunningTimerChip, TIMER_CHANGED_EVENT } from './running-timer-chip';
import { api } from '@/lib/api';
import type { MyTimer } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  api: { timers: { mine: vi.fn(), pause: vi.fn() } },
}));

const running = (over: Partial<MyTimer> = {}): MyTimer => ({
  issue_id: 'i-1',
  issue_key: 'ATL-42',
  title: 'Fix the thing',
  started_at: '2026-08-10 09:00:00',
  elapsed_minutes: 72,
  runaway: false,
  ...over,
});

const mine = () => vi.mocked(api.timers.mine);
const pause = () => vi.mocked(api.timers.pause);

const draw = () => render(<MemoryRouter><RunningTimerChip /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  pause().mockResolvedValue({} as never);
});
afterEach(() => vi.useRealTimers());

describe('RunningTimerChip', () => {
  it('renders nothing when no timer is running', async () => {
    mine().mockResolvedValue(null);
    const { container } = draw();
    await waitFor(() => expect(mine()).toHaveBeenCalled());
    // The header must not hold space for a timer nobody is running.
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the issue key and elapsed time, linking to the issue', async () => {
    mine().mockResolvedValue(running());
    draw();

    const link = await screen.findByRole('link', { name: /ATL-42/i });
    expect(link).toHaveTextContent('ATL-42');
    expect(link).toHaveTextContent('1h 12m');
    // issueUrl derives the project from the key, so a timer in another project
    // still links correctly from wherever the user happens to be.
    expect(link).toHaveAttribute('href', '/atl/ATL-42');
  });

  it('offers no pause control in the normal state', async () => {
    // A global, always-present stop target is easy to hit by accident, and an
    // accidentally stopped timer is the very complaint this feature exists to
    // prevent.
    mine().mockResolvedValue(running());
    draw();

    await screen.findByRole('link', { name: /ATL-42/i });
    expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument();
  });

  it('escalates and reveals a pause control once the server flags a runaway', async () => {
    mine().mockResolvedValue(running({ elapsed_minutes: 843, runaway: true }));
    draw();

    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();
    // Announced once, not on every minute tick.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ATL-42/i })).toHaveTextContent('14h 3m');
  });

  it('pauses the running issue when the escalated control is used', async () => {
    const user = userEvent.setup();
    // Running until the pause lands, nothing after — the chip re-reads the
    // server rather than trusting its own optimistic clear, so the mock has to
    // model that the timer is genuinely gone.
    mine().mockResolvedValueOnce(running({ runaway: true })).mockResolvedValue(null);
    draw();

    await user.click(await screen.findByRole('button', { name: /pause/i }));

    expect(pause()).toHaveBeenCalledWith('i-1');
    await waitFor(() => expect(screen.queryByRole('link', { name: /ATL-42/i })).not.toBeInTheDocument());
  });

  it('keeps the last known timer when a poll fails', async () => {
    // Flickering the chip out on one bad response would read as the timer
    // stopping by itself — the exact failure this feature exists to remove.
    mine().mockResolvedValueOnce(running()).mockRejectedValue(new Error('offline'));
    draw();
    await screen.findByRole('link', { name: /ATL-42/i });

    window.dispatchEvent(new CustomEvent(TIMER_CHANGED_EVENT, { detail: { source: 'issue-detail' } }));

    await waitFor(() => expect(mine()).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('link', { name: /ATL-42/i })).toBeInTheDocument();
  });

  it('refetches immediately when a timer changes elsewhere in the app', async () => {
    mine().mockResolvedValueOnce(null).mockResolvedValue(running());
    draw();
    await waitFor(() => expect(mine()).toHaveBeenCalledTimes(1));

    // Starting a timer on an issue page must surface here at once, not up to a
    // poll interval later.
    window.dispatchEvent(new CustomEvent(TIMER_CHANGED_EVENT, { detail: { source: 'issue-detail' } }));

    expect(await screen.findByRole('link', { name: /ATL-42/i })).toBeInTheDocument();
  });
});
