import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { UnresolvedTimersChip } from './unresolved-timers-chip';
import { api } from '@/lib/api';
import type { UnresolvedTimer } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  api: { timers: { unresolved: vi.fn(), resolve: vi.fn() } },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const unresolved = () => vi.mocked(api.timers.unresolved);
const resolve = () => vi.mocked(api.timers.resolve);

const timer: UnresolvedTimer = {
  id: 'seg-1',
  issue_id: 'issue-1',
  issue_key: 'ATL-42',
  title: 'Fix the login redirect',
  started_at: '2026-08-13 09:00:00',
  ended_at: '2026-08-13 12:00:00',
};

const renderChip = () =>
  render(<MemoryRouter><UnresolvedTimersChip /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  resolve().mockResolvedValue({ ok: true });
});

describe('UnresolvedTimersChip', () => {
  test('renders nothing when there is nothing to resolve', async () => {
    unresolved().mockResolvedValue([]);

    const { container } = renderChip();

    await waitFor(() => expect(unresolved()).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('shows how many timers logged no time', async () => {
    unresolved().mockResolvedValue([timer, { ...timer, id: 'seg-2', issue_key: 'ATL-43' }]);

    renderChip();

    expect(await screen.findByRole('button', { name: /2 timers stopped without logging time/i }))
      .toBeInTheDocument();
  });

  test('lists the issue and how long the timer ran', async () => {
    unresolved().mockResolvedValue([timer]);
    renderChip();

    await userEvent.click(await screen.findByRole('button', { name: /stopped without logging time/i }));

    expect(await screen.findByText('ATL-42')).toBeInTheDocument();
    // 09:00 to 12:00 — the span the server refused to credit.
    expect(screen.getByText(/Ran 3h/)).toBeInTheDocument();
  });

  test('dismissing removes it from the list', async () => {
    unresolved().mockResolvedValue([timer]);
    renderChip();
    await userEvent.click(await screen.findByRole('button', { name: /stopped without logging time/i }));

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(resolve()).toHaveBeenCalledWith('seg-1'));
    await waitFor(() => expect(screen.queryByText('ATL-42')).not.toBeInTheDocument());
  });

  test('a failed refresh keeps the existing list rather than claiming it is resolved', async () => {
    unresolved().mockResolvedValueOnce([timer]).mockRejectedValue(new Error('offline'));
    renderChip();
    await screen.findByRole('button', { name: /stopped without logging time/i });

    // Drive the component's own refresh, so the rejection is handled where it
    // would be in production rather than escaping into the test.
    window.dispatchEvent(new CustomEvent('atlas:timer-changed', { detail: { source: 'chip' } }));

    await waitFor(() => expect(unresolved()).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /stopped without logging time/i })).toBeInTheDocument();
  });
});
