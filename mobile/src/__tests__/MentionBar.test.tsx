/**
 * Behaviour of the mobile @ picker.
 *
 * The bar is driven by (value, caret) rather than a DOM caret, so these tests
 * assert the same trigger rules the web enforces: '@' only after whitespace,
 * one space allowed inside the query, and insertion that produces a token the
 * shared parser reads back.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { MentionBar } from '../components/MentionBar';
import { searchMentions } from '../api/mentions';
import { parseMentionIds } from '../utils/mentions';

jest.mock('../api/mentions', () => ({ searchMentions: jest.fn() }));

const MEMBERS = [
  { id: 'u-ann', name: 'Ann Lee', email: 'ann@example.com', avatar_color: '#111', is_member: true },
  { id: 'u-sara', name: 'Sara Vale', email: 'sara@example.com', avatar_color: '#222', is_member: false },
];

beforeEach(() => {
  jest.clearAllMocks();
  (searchMentions as jest.Mock).mockResolvedValue(MEMBERS);
});

// render() resolves asynchronously in this harness — the queries are not on the
// value it returns synchronously. The existing screen tests await it too.
async function renderBar(value: string, onInsert = jest.fn()) {
  const view = await render(
    <MentionBar value={value} caret={value.length} projectId="p1" onInsert={onInsert} />,
  );
  return { view, onInsert };
}

describe('when the bar appears', () => {
  test('an @ query shows candidates', async () => {
    const { view } = await renderBar('hi @an');
    expect(await view.findByText('Ann Lee')).toBeTruthy();
  });

  test('an email address shows nothing and queries nothing', async () => {
    const { view } = await renderBar('write to foo@bar');
    await waitFor(() => expect(searchMentions).not.toHaveBeenCalled());
    expect(view.queryByText('Ann Lee')).toBeNull();
  });

  test('a one-space query is still a query', async () => {
    await renderBar('cc @Ann Le');
    await waitFor(() => expect(searchMentions).toHaveBeenCalledWith('Ann Le', 'p1'));
  });

  test('a second space closes it', async () => {
    await renderBar('cc @Ann Lee x');
    await waitFor(() => expect(searchMentions).not.toHaveBeenCalled());
  });

  test('no results means no bar', async () => {
    (searchMentions as jest.Mock).mockResolvedValue([]);
    const { view } = await renderBar('@zzz');
    await waitFor(() => expect(searchMentions).toHaveBeenCalled());
    await waitFor(() => expect(view.queryByText('Ann Lee')).toBeNull());
  });

  test('a failed lookup shows no bar and does not throw', async () => {
    (searchMentions as jest.Mock).mockRejectedValue(new Error('offline'));
    const { view } = await renderBar('@an');
    await waitFor(() => expect(searchMentions).toHaveBeenCalled());
    await waitFor(() => expect(view.queryByText('Ann Lee')).toBeNull());
  });
});

describe('choosing someone', () => {
  test('tapping a candidate inserts a token the parser reads back', async () => {
    const { view, onInsert } = await renderBar('hi @an');
    fireEvent.press(await view.findByText('Ann Lee'));

    expect(onInsert).toHaveBeenCalledTimes(1);
    const { text, caret } = onInsert.mock.calls[0][0];
    expect(text).toBe('hi @[Ann Lee](user:u-ann) ');
    expect(caret).toBe(text.length);
    expect(parseMentionIds(text)).toEqual(['u-ann']);
  });

  test('a non-member is offered with a warning', async () => {
    const { view } = await renderBar('@sa');
    expect(await view.findByText('Sara Vale')).toBeTruthy();
    expect(view.getByText('Not a member')).toBeTruthy();
  });

  test('a member carries no warning', async () => {
    (searchMentions as jest.Mock).mockResolvedValue([MEMBERS[0]]);
    const { view } = await renderBar('@an');
    await view.findByText('Ann Lee');
    expect(view.queryByText('Not a member')).toBeNull();
  });
});

describe('dismissing', () => {
  test('the dismiss control hides the bar for that query', async () => {
    const { view } = await renderBar('hi @an');
    await view.findByText('Ann Lee');
    fireEvent.press(view.getByLabelText('Dismiss mention suggestions'));
    await waitFor(() => expect(view.queryByText('Ann Lee')).toBeNull());
  });
});
