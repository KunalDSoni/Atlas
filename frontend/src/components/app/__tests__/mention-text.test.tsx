/**
 * Rendering rules for stored mentions.
 *
 * The two that matter most: a badge always shows whoever the id really is (so a
 * hand-typed token cannot impersonate anyone), and an ambiguous legacy name
 * stays prose rather than pointing at a guess.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MentionText } from '../mention-text';
import { invalidateUserDirectory } from '@/hooks/use-user-directory';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { users: { list: vi.fn() } } }));

const ANN = { id: 'u-ann', name: 'Ann Lee', email: 'ann@example.com', avatar_color: '#111', role: 'user', is_active: 1 };
const BOB = { id: 'u-bob', name: 'Bob Roy', email: 'bob@example.com', avatar_color: '#222', role: 'user', is_active: 1 };
const GONE = { id: 'u-gone', name: 'Old Hand', email: 'old@example.com', avatar_color: '#333', role: 'user', is_active: 0 };

function withUsers(users: unknown[]) {
  (api.users.list as any).mockResolvedValue(users);
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateUserDirectory();
  withUsers([ANN, BOB, GONE]);
});

/** The badge for a given id, or null. */
function badge(id: string) {
  return document.querySelector(`.mention[data-user-id="${id}"]`);
}

describe('token mentions', () => {
  test('renders a badge showing the live name', async () => {
    render(<MentionText text="hi @[Ann Lee](user:u-ann) there" />);
    await waitFor(() => expect(badge('u-ann')).toBeInTheDocument());
    expect(badge('u-ann')).toHaveTextContent('@Ann Lee');
  });

  test('a renamed user shows the current name, not the stored one', async () => {
    withUsers([{ ...ANN, name: 'Ann Marie Lee' }]);
    render(<MentionText text="hi @[Ann Lee](user:u-ann)" />);
    await waitFor(() => expect(badge('u-ann')).toHaveTextContent('@Ann Marie Lee'));
  });

  test('an unresolvable id renders as plain text, never a badge', async () => {
    render(<MentionText text="hi @[Admin](user:not-a-real-id)" />);
    await waitFor(() => expect(api.users.list).toHaveBeenCalled());
    await waitFor(() => {
      expect(document.querySelectorAll('.mention')).toHaveLength(0);
    });
    expect(screen.getByText(/@Admin/)).toBeInTheDocument();
  });

  test('a deactivated user renders muted', async () => {
    render(<MentionText text="@[Old Hand](user:u-gone)" />);
    await waitFor(() => expect(badge('u-gone')).toBeInTheDocument());
    expect(badge('u-gone')).toHaveClass('mention-inactive');
  });

  test('surrounding text is preserved', async () => {
    const { container } = render(<MentionText text="before @[Ann Lee](user:u-ann) after" />);
    await waitFor(() => expect(badge('u-ann')).toBeInTheDocument());
    expect(container.textContent).toBe('before @Ann Lee after');
  });

  test('two mentions both render', async () => {
    render(<MentionText text="@[Ann Lee](user:u-ann) and @[Bob Roy](user:u-bob)" />);
    await waitFor(() => expect(badge('u-ann')).toBeInTheDocument());
    expect(badge('u-bob')).toBeInTheDocument();
  });
});

describe('legacy plain-text mentions', () => {
  test('an unambiguous full name becomes a badge', async () => {
    render(<MentionText text="cc @Ann Lee please" />);
    await waitFor(() => expect(badge('u-ann')).toBeInTheDocument());
  });

  test('an unambiguous first name becomes a badge', async () => {
    render(<MentionText text="cc @Bob please" />);
    await waitFor(() => expect(badge('u-bob')).toBeInTheDocument());
  });

  test('a name matching two active users stays prose', async () => {
    withUsers([ANN, { ...BOB, id: 'u-ann2', name: 'Ann Lee', email: 'ann2@example.com' }]);
    const { container } = render(<MentionText text="cc @Ann Lee" />);
    await waitFor(() => expect(api.users.list).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelectorAll('.mention')).toHaveLength(0));
    expect(container.textContent).toBe('cc @Ann Lee');
  });

  test('the longer name wins over a shorter one it contains', async () => {
    withUsers([ANN, { ...BOB, id: 'u-a', name: 'Ann' }]);
    render(<MentionText text="cc @Ann Lee" />);
    await waitFor(() => expect(badge('u-ann')).toBeInTheDocument());
    expect(badge('u-a')).not.toBeInTheDocument();
  });

  test('an email address is never a mention', async () => {
    const { container } = render(<MentionText text="write to ann@example.com" />);
    await waitFor(() => expect(api.users.list).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelectorAll('.mention')).toHaveLength(0));
    expect(container.textContent).toBe('write to ann@example.com');
  });

  test('a deactivated user is not matched by name', async () => {
    const { container } = render(<MentionText text="cc @Old Hand" />);
    await waitFor(() => expect(api.users.list).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelectorAll('.mention')).toHaveLength(0));
    expect(container.textContent).toBe('cc @Old Hand');
  });

  test('a token and a legacy name in the same text both render', async () => {
    render(<MentionText text="@[Ann Lee](user:u-ann) and @Bob" />);
    await waitFor(() => expect(badge('u-ann')).toBeInTheDocument());
    expect(badge('u-bob')).toBeInTheDocument();
  });
});

describe('degradation', () => {
  test('a failed directory fetch leaves the text readable', async () => {
    (api.users.list as any).mockRejectedValue(new Error('offline'));
    const { container } = render(<MentionText text="hi @[Ann Lee](user:u-ann)" />);
    await waitFor(() => expect(container.textContent).toBe('hi @Ann Lee'));
  });

  test('empty text renders nothing', async () => {
    const { container } = render(<MentionText text="" />);
    expect(container.textContent).toBe('');
    // The directory still loads behind the empty render; await it so the state
    // update lands inside the test rather than after it.
    await waitFor(() => expect(api.users.list).toHaveBeenCalled());
  });
});
