import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CardTimerButton } from './card-timer-button';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { timers: { mine: vi.fn(), start: vi.fn(), pause: vi.fn() } },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const mine = () => vi.mocked(api.timers.mine);
const start = () => vi.mocked(api.timers.start);
const pause = () => vi.mocked(api.timers.pause);

const runningOn = (issue_id: string) => ({
  issue_id, issue_key: 'ATL-7', title: 't', started_at: '2026-08-15 09:00:00',
  elapsed_minutes: 5, runaway: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  start().mockResolvedValue({} as never);
  pause().mockResolvedValue({} as never);
});

describe('CardTimerButton', () => {
  test('offers to start when no timer is running', async () => {
    mine().mockResolvedValue(null);

    render(<CardTimerButton issueId="i1" issueKey="ATL-7" />);

    expect(await screen.findByRole('button', { name: 'Start timer on ATL-7' })).toBeInTheDocument();
  });

  test('offers to pause when this card is the one being tracked', async () => {
    mine().mockResolvedValue(runningOn('i1'));

    render(<CardTimerButton issueId="i1" issueKey="ATL-7" />);

    expect(await screen.findByRole('button', { name: 'Pause timer on ATL-7' })).toBeInTheDocument();
  });

  test('a timer running on another issue still shows start here', async () => {
    mine().mockResolvedValue(runningOn('someone-elses-issue'));

    render(<CardTimerButton issueId="i1" issueKey="ATL-7" />);

    expect(await screen.findByRole('button', { name: 'Start timer on ATL-7' })).toBeInTheDocument();
  });

  test('clicking start does not also open the issue', async () => {
    // The whole card is a button that opens the issue, so without
    // stopPropagation starting a timer navigates away from the board.
    mine().mockResolvedValue(null);
    const onCardClick = vi.fn();

    render(
      <div onClick={onCardClick}>
        <CardTimerButton issueId="i1" issueKey="ATL-7" />
      </div>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Start timer/ }));

    await waitFor(() => expect(start()).toHaveBeenCalledWith('i1'));
    expect(onCardClick).not.toHaveBeenCalled();
  });

  test('clicking pause stops the running timer', async () => {
    mine().mockResolvedValue(runningOn('i1'));

    render(<CardTimerButton issueId="i1" issueKey="ATL-7" />);
    await userEvent.click(await screen.findByRole('button', { name: /Pause timer/ }));

    await waitFor(() => expect(pause()).toHaveBeenCalledWith('i1'));
  });

  test('a failed lookup leaves the control usable rather than blank', async () => {
    mine().mockRejectedValue(new Error('offline'));

    render(<CardTimerButton issueId="i1" issueKey="ATL-7" />);

    expect(await screen.findByRole('button', { name: 'Start timer on ATL-7' })).toBeInTheDocument();
  });
});
