/**
 * Behaviour tests for the @ picker.
 *
 * These drive a real controlled textarea through user events, which is what the
 * suite they replace never did: it asserted on internal dropdown state while
 * the feature was completely dead in the browser, because the ref it depended
 * on was silently null against a non-forwardRef Textarea.
 */
import { useState } from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '@/components/ui/textarea';
import { useMentions } from '../use-mentions';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { mentions: { search: vi.fn() } },
}));

const MEMBERS = [
  { id: 'u-ann', name: 'Ann Lee', email: 'ann@example.com', avatar_color: '#111', is_member: true },
  { id: 'u-john', name: 'John Doe', email: 'john@example.com', avatar_color: '#222', is_member: true },
  { id: 'u-sara', name: 'Sara Vale', email: 'sara@example.com', avatar_color: '#333', is_member: false },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const mentions = useMentions({ projectId: 'p1', value, onChange: setValue });
  return (
    <div>
      <Textarea aria-label="body" value={value} {...mentions.inputProps} ref={mentions.ref} />
      {mentions.dropdown}
      <output data-testid="value">{value}</output>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.mentions.search as any).mockResolvedValue(MEMBERS);
});

async function typeInBody(text: string) {
  const user = userEvent.setup();
  render(<Harness />);
  const box = screen.getByLabelText('body');
  await user.click(box);
  await user.type(box, text);
  return { user, box };
}

describe('opening the dropdown', () => {
  test('@ at the start of an empty field opens it', async () => {
    await typeInBody('@');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  test('@ after a space opens it', async () => {
    await typeInBody('hello @an');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
  });

  test('an email address does not open it', async () => {
    await typeInBody('mail me at foo@bar');
    await waitFor(() => expect(api.mentions.search).not.toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('a query with one space still matches a full name', async () => {
    await typeInBody('cc @John Do');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.mentions.search).toHaveBeenCalledWith('John Do', 'p1'),
    );
  });

  test('a second space closes it', async () => {
    await typeInBody('cc @John Doe x');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});

describe('choosing someone', () => {
  test('Enter inserts the token and closes the dropdown', async () => {
    const { user } = await typeInBody('hi @an');
    await screen.findByRole('listbox');
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('value')).toHaveTextContent(
      'hi @[Ann Lee](user:u-ann)',
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('Tab completes, like Jira', async () => {
    const { user } = await typeInBody('hi @an');
    await screen.findByRole('listbox');
    await user.keyboard('{Tab}');
    expect(screen.getByTestId('value')).toHaveTextContent('@[Ann Lee](user:u-ann)');
  });

  test('ArrowDown moves the selection before inserting', async () => {
    const { user } = await typeInBody('@');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('@[John Doe](user:u-john)');
  });

  test('ArrowUp from the first option stays put', async () => {
    const { user } = await typeInBody('@');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('@[Ann Lee](user:u-ann)');
  });

  test('clicking an option inserts it', async () => {
    const { user } = await typeInBody('@');
    await screen.findByRole('listbox');
    await user.click(screen.getByText('Sara Vale'));
    expect(screen.getByTestId('value')).toHaveTextContent('@[Sara Vale](user:u-sara)');
  });

  test('the caret lands after the inserted token', async () => {
    const { user, box } = await typeInBody('hi @an');
    await screen.findByRole('listbox');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const el = box as HTMLTextAreaElement;
      expect(el.selectionStart).toBe('hi @[Ann Lee](user:u-ann) '.length);
    });
  });
});

describe('dismissing', () => {
  test('Escape closes it and leaves the literal @ in place', async () => {
    const { user } = await typeInBody('hi @an');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveTextContent('hi @an');
  });

  test('Escape does not reopen on the next keystroke in the same query', async () => {
    const { user } = await typeInBody('hi @an');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await user.keyboard('n');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('non-members', () => {
  test('a non-member option carries a warning', async () => {
    await typeInBody('@sara');
    await screen.findByRole('listbox');
    expect(screen.getByText(/not a member/i)).toBeInTheDocument();
  });

  test('members carry no warning', async () => {
    (api.mentions.search as any).mockResolvedValue([MEMBERS[0]]);
    await typeInBody('@ann');
    await screen.findByRole('listbox');
    expect(screen.queryByText(/not a member/i)).not.toBeInTheDocument();
  });
});

describe('failure', () => {
  test('a failed lookup leaves typing untouched and shows no listbox', async () => {
    (api.mentions.search as any).mockRejectedValue(new Error('offline'));
    const { user, box } = await typeInBody('hi @an');
    await waitFor(() => expect(api.mentions.search).toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.type(box, 'more');
    expect(screen.getByTestId('value')).toHaveTextContent('hi @anmore');
  });

  test('no results means no listbox', async () => {
    (api.mentions.search as any).mockResolvedValue([]);
    await typeInBody('@zzz');
    await waitFor(() => expect(api.mentions.search).toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('accessibility', () => {
  test('the input is a combobox wired to the listbox', async () => {
    await typeInBody('@an');
    const list = await screen.findByRole('listbox');
    const box = screen.getByLabelText('body');

    expect(box).toHaveAttribute('role', 'combobox');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute('aria-controls', list.id);
    expect(box).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
  });
});
