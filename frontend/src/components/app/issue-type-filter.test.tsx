import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssueTypeFilter } from './issue-type-filter';

describe('IssueTypeFilter', () => {
  it('displays "All types" when no types are selected', () => {
    render(<IssueTypeFilter selectedTypes={[]} onSelectedTypesChange={() => {}} />);
    expect(screen.getByText('All types')).toBeInTheDocument();
  });

  it('displays the single type name when one type is selected', () => {
    render(<IssueTypeFilter selectedTypes={['story']} onSelectedTypesChange={() => {}} />);
    expect(screen.getByText('Story')).toBeInTheDocument();
  });

  it('displays count when multiple types are selected', () => {
    render(<IssueTypeFilter selectedTypes={['story', 'bug']} onSelectedTypesChange={() => {}} />);
    expect(screen.getByText('2 types selected')).toBeInTheDocument();
  });

  it('calls onSelectedTypesChange when a type is toggled', async () => {
    const user = userEvent.setup();
    const mockChange = vi.fn();
    render(<IssueTypeFilter selectedTypes={[]} onSelectedTypesChange={mockChange} />);

    await user.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText('Story')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Story'));

    expect(mockChange).toHaveBeenCalledWith(['story']);
  });

  it('removes a type when toggling it off', async () => {
    const user = userEvent.setup();
    const mockChange = vi.fn();
    render(<IssueTypeFilter selectedTypes={['story', 'bug']} onSelectedTypesChange={mockChange} />);

    await user.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText('Story')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Story'));

    expect(mockChange).toHaveBeenCalledWith(['bug']);
  });
});
