import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import MyTimeScreen from './my-time';
import { api } from '@/lib/api';
import type { MyTimeResponse } from '@/lib/types';

vi.mock('@/lib/api', () => ({ api: { myTime: vi.fn() } }));

const myTime = () => vi.mocked(api.myTime);

function week(overrides: Partial<MyTimeResponse> = {}): MyTimeResponse {
  return {
    from: '2026-08-10',
    to: '2026-08-17',
    timezone: 'UTC',
    total_minutes: 0,
    by_day: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-08-${String(10 + i).padStart(2, '0')}`, minutes: 0,
    })),
    entries: [],
    ...overrides,
  };
}

const renderScreen = () => render(<MemoryRouter><MyTimeScreen /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe('MyTimeScreen', () => {
  test('says so plainly when nothing was logged', async () => {
    myTime().mockResolvedValue(week());

    renderScreen();

    expect(await screen.findByText(/nothing logged this week/i)).toBeInTheDocument();
  });

  test('shows the week total and the timezone the days were bucketed in', async () => {
    // The timezone is not decoration: work logs carry only created_at, so which
    // day an entry lands on depends on it.
    myTime().mockResolvedValue(week({ total_minutes: 150, timezone: 'Asia/Kolkata' }));

    renderScreen();

    expect(await screen.findByText(/Asia\/Kolkata/)).toBeInTheDocument();
  });

  test('lists an entry under its day, linking to the issue', async () => {
    myTime().mockResolvedValue(week({
      total_minutes: 90,
      by_day: week().by_day.map((d) => (d.date === '2026-08-11' ? { ...d, minutes: 90 } : d)),
      entries: [{
        id: 'w1', issue_id: 'i1', issue_key: 'ATL-7', title: 'Fix the thing',
        project_key: 'ATL', minutes: 90, source: 'timer', comment: null,
        created_at: '2026-08-11 09:00:00', date: '2026-08-11',
      }],
    }));

    renderScreen();

    const link = await screen.findByRole('link', { name: 'ATL-7' });
    expect(link).toHaveAttribute('href', '/atl/ATL-7');
    // Measured time is badged so it reads differently from time entered by hand.
    expect(screen.getByText('timer')).toBeInTheDocument();
  });

  test('moving to the previous week requests the earlier range', async () => {
    myTime().mockResolvedValue(week());
    renderScreen();
    await screen.findByText(/nothing logged/i);
    const firstFrom = myTime().mock.calls[0][0];

    await userEvent.click(screen.getByRole('button', { name: /previous week/i }));

    await waitFor(() => expect(myTime().mock.calls.length).toBeGreaterThan(1));
    const nextFrom = myTime().mock.calls[myTime().mock.calls.length - 1][0];
    expect(new Date(nextFrom).getTime()).toBeLessThan(new Date(firstFrom).getTime());
  });

  test('a load failure offers a retry rather than an empty week', async () => {
    myTime().mockRejectedValue(new Error('offline'));

    renderScreen();

    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});
