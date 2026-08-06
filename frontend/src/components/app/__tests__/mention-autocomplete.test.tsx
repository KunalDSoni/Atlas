import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MentionAutocomplete } from '../mention-autocomplete';
import * as api from '@/lib/api';

// Mock the API
vi.mock('@/lib/api', () => ({
  api: {
    projects: {
      members: vi.fn(),
    },
  },
}));

const mockMembers = [
  { id: '1', name: 'John Doe', email: 'john@example.com', avatar_color: '#FF5733', role: 'ADMIN', role_in_project: 'ADMIN' },
  { id: '2', name: 'Jane Smith', email: 'jane@example.com', avatar_color: '#33FF57', role: 'USER', role_in_project: 'USER' },
  { id: '3', name: 'Bob Johnson', email: 'bob@example.com', avatar_color: '#3357FF', role: 'USER', role_in_project: 'USER' },
  { id: '4', name: 'Alice Brown', email: 'alice@example.com', avatar_color: '#FF33F5', role: 'USER', role_in_project: 'USER' },
];

describe('MentionAutocomplete', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    // Mock the API to return members excluding the author
    (api.api.projects.members as any).mockResolvedValue(
      mockMembers.filter((m) => m.id !== 'currentUser')
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders textarea and shows dropdown on @ input', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea placeholder="Type a message..." data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    // Type @ to trigger autocomplete
    await userEvent.type(textarea, '@');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  it('filters users by typed characters', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @jo to filter
    await userEvent.type(textarea, '@jo');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
      expect(screen.queryByText('Bob Johnson')).not.toBeInTheDocument();
    });
  });

  it('inserts mention on selection', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @ to show dropdown
    await userEvent.type(textarea, '@');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Click on John Doe
    const johnOption = screen.getByText('John Doe').closest('.mention-item');
    await userEvent.click(johnOption!);

    // Check that the mention was inserted
    expect(textarea.value).toBe('@John Doe');
    expect(onMentionInsert).toHaveBeenCalledWith('@John Doe');
  });

  it('closes dropdown on ESC key', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @ to show dropdown
    await userEvent.type(textarea, '@');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Press ESC
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Dropdown should close
    await waitFor(() => {
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });
  });

  it('handles arrow key navigation (up/down)', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @ to show dropdown
    await userEvent.type(textarea, '@');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Initially John Doe should be selected (index 0)
    let johnOption = screen.getByText('John Doe').closest('.mention-item');
    expect(johnOption).toHaveClass('selected');

    // Press ArrowDown to select next
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await waitFor(() => {
      const janeOption = screen.getByText('Jane Smith').closest('.mention-item');
      expect(janeOption).toHaveClass('selected');
    });

    // Press ArrowUp to go back
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => {
      johnOption = screen.getByText('John Doe').closest('.mention-item');
      expect(johnOption).toHaveClass('selected');
    });
  });

  it('handles Enter to select', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @ to show dropdown
    await userEvent.type(textarea, '@');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Press Enter to select first item
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Check that the mention was inserted
    await waitFor(() => {
      expect(textarea.value).toBe('@John Doe');
      expect(onMentionInsert).toHaveBeenCalledWith('@John Doe');
    });
  });

  it('excludes self from suggestions', async () => {
    // Mock API to return all members including the author
    (api.api.projects.members as any).mockResolvedValue(
      mockMembers
    );

    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="1" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    // Wait for members to load
    await waitFor(() => {
      // The component should filter out the author (id: 1, which is John Doe)
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });

    // But other members should be available
    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;
    await userEvent.type(textarea, '@');
    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Johnson')).toBeInTheDocument();
    });
  });

  it('handles empty project members gracefully', async () => {
    // Mock API to return empty members
    (api.api.projects.members as any).mockResolvedValue([]);

    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @ - should not show dropdown since no members
    await userEvent.type(textarea, '@');

    // Wait a bit to ensure no dropdown appears
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('does not show dropdown for partial @ query with no matches', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @xyz which should not match any member
    await userEvent.type(textarea, '@xyz');

    // Dropdown should not appear
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('handles mention with space in name', async () => {
    const onMentionInsert = vi.fn();
    render(
      <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
        <textarea data-testid="textarea" />
      </MentionAutocomplete>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @john to find "John Doe"
    await userEvent.type(textarea, '@john');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Click on John Doe to insert full name
    const johnOption = screen.getByText('John Doe').closest('.mention-item');
    await userEvent.click(johnOption!);

    // Should insert "@John Doe" with the full name
    expect(textarea.value).toBe('@John Doe');
  });

  it('closes dropdown on outside click', async () => {
    const onMentionInsert = vi.fn();
    const { container } = render(
      <div>
        <MentionAutocomplete projectId="proj1" authorId="currentUser" onMentionInsert={onMentionInsert}>
          <textarea data-testid="textarea" />
        </MentionAutocomplete>
        <button data-testid="outside-button">Outside</button>
      </div>
    );

    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;

    // Type @ to show dropdown
    await userEvent.type(textarea, '@');
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Click outside
    const outsideButton = screen.getByTestId('outside-button');
    fireEvent.mouseDown(outsideButton);

    // Dropdown should close
    await waitFor(() => {
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });
  });
});
