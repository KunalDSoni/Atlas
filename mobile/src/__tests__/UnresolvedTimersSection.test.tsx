import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UnresolvedTimersSection } from '../components/UnresolvedTimersSection';
import * as timersApi from '../api/timers';

jest.mock('../api/timers');

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const timer = {
  id: 'seg-1',
  issue_id: 'i1',
  issue_key: 'ATL-42',
  title: 'Fix the login redirect',
  started_at: '2026-08-13 09:00:00',
  ended_at: '2026-08-13 12:00:00',
};

beforeEach(() => jest.clearAllMocks());

test('renders nothing when there is nothing to resolve', async () => {
  (timersApi.fetchUnresolvedTimers as jest.Mock).mockResolvedValue([]);

  const { toJSON } = await renderWithClient(<UnresolvedTimersSection />);

  await waitFor(() => expect(timersApi.fetchUnresolvedTimers).toHaveBeenCalled());
  expect(toJSON()).toBeNull();
});

test('lists an unresolved timer with how long it ran', async () => {
  (timersApi.fetchUnresolvedTimers as jest.Mock).mockResolvedValue([timer]);

  const { findByText } = await renderWithClient(<UnresolvedTimersSection />);

  await findByText('ATL-42');
  // 09:00 to 12:00 — the span the server refused to credit.
  await findByText(/Ran 3h 0m before it was stopped/);
});

test('dismissing settles it and refetches', async () => {
  (timersApi.fetchUnresolvedTimers as jest.Mock)
    .mockResolvedValueOnce([timer])
    .mockResolvedValue([]);
  (timersApi.resolveTimerSegment as jest.Mock).mockResolvedValue({ ok: true });

  const { findByText, queryByText } = await renderWithClient(<UnresolvedTimersSection />);
  fireEvent.press(await findByText('Dismiss'));

  await waitFor(() => expect(timersApi.resolveTimerSegment).toHaveBeenCalledWith('seg-1'));
  await waitFor(() => expect(queryByText('ATL-42')).toBeNull());
});

test('tapping the issue hands its id back to the caller to navigate', async () => {
  (timersApi.fetchUnresolvedTimers as jest.Mock).mockResolvedValue([timer]);
  const onOpenIssue = jest.fn();

  const { findByText } = await renderWithClient(<UnresolvedTimersSection onOpenIssue={onOpenIssue} />);
  fireEvent.press(await findByText('ATL-42'));

  expect(onOpenIssue).toHaveBeenCalledWith('i1');
});
