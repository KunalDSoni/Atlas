import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkingHoursCard } from './working-hours-card';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    profile: {
      get: vi.fn(),
      setBusinessHours: vi.fn(),
    },
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const profileGet = () => vi.mocked(api.profile.get);
const setHours = () => vi.mocked(api.profile.setBusinessHours);

const stored = JSON.stringify({ timezone: 'UTC', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 17 });

beforeEach(() => {
  vi.clearAllMocks();
  setHours().mockResolvedValue({} as never);
});

describe('WorkingHoursCard', () => {
  test('explains the consequence when no override is set', async () => {
    profileGet().mockResolvedValue({ business_hours: null } as never);

    render(<WorkingHoursCard />);

    // Naming the consequence is the point: an empty form does not tell anyone
    // why they should fill it in.
    expect(await screen.findByText(/stopped without logging any time/i)).toBeInTheDocument();
  });

  test('shows the fields when an override is already stored', async () => {
    profileGet().mockResolvedValue({ business_hours: stored } as never);

    render(<WorkingHoursCard />);

    expect(await screen.findByLabelText('Time zone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save working hours/i })).toBeInTheDocument();
  });

  test('turning the override off clears it with an explicit null', async () => {
    // null is what the server reads as "clear"; omitting the field would leave
    // the stored value in place and the switch would lie.
    profileGet().mockResolvedValue({ business_hours: stored } as never);
    render(<WorkingHoursCard />);
    const toggle = await screen.findByLabelText('Use my own hours');

    await userEvent.click(toggle);

    await waitFor(() => expect(setHours()).toHaveBeenCalledWith(null));
  });

  test('turning the override on offers a default without saving it yet', async () => {
    profileGet().mockResolvedValue({ business_hours: null } as never);
    render(<WorkingHoursCard />);
    const toggle = await screen.findByLabelText('Use my own hours');

    await userEvent.click(toggle);

    expect(await screen.findByLabelText('Time zone')).toBeInTheDocument();
    expect(setHours()).not.toHaveBeenCalled();
  });

  test('a failed save leaves the card usable rather than throwing', async () => {
    profileGet().mockResolvedValue({ business_hours: stored } as never);
    setHours().mockRejectedValue(new Error('end_hour must be later than start_hour'));
    render(<WorkingHoursCard />);

    await userEvent.click(await screen.findByRole('button', { name: /save working hours/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save working hours/i })).toBeEnabled());
  });
});
