import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateIssueScreen } from '../screens/CreateIssueScreen';
import * as issuesApi from '../api/issues';
import { ApiError } from '../api/client';

jest.mock('../api/issues');

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const route = { params: { projectId: 'p1' } };

test('does not submit without a title', async () => {
  const navigate = jest.fn();
  const goBack = jest.fn();
  const screen = await renderWithClient(<CreateIssueScreen route={route as any} navigation={{ navigate, goBack } as any} />);
  const { getByText } = screen;

  await fireEvent.press(getByText('Create'));

  expect(issuesApi.createIssue).not.toHaveBeenCalled();
});

test('submits title and navigates back on success', async () => {
  (issuesApi.createIssue as jest.Mock).mockResolvedValue({ id: 'i2', issue_key: 'ATLAS-2' });
  const navigate = jest.fn();
  const goBack = jest.fn();
  const screen = await renderWithClient(<CreateIssueScreen route={route as any} navigation={{ navigate, goBack } as any} />);
  const { getByPlaceholderText, getByText } = screen;

  await fireEvent.changeText(getByPlaceholderText('Title'), 'New issue');
  await fireEvent.press(getByText('Create'));

  await waitFor(() => expect(issuesApi.createIssue).toHaveBeenCalledWith('p1', { title: 'New issue', description: '' }));
  await waitFor(() => expect(goBack).toHaveBeenCalled());
});

test('shows permission error on 403', async () => {
  (issuesApi.createIssue as jest.Mock).mockRejectedValue(new ApiError(403, { error: 'Insufficient permissions' }));
  const navigate = jest.fn();
  const goBack = jest.fn();
  const screen = await renderWithClient(<CreateIssueScreen route={route as any} navigation={{ navigate, goBack } as any} />);
  const { getByPlaceholderText, getByText, findByText } = screen;

  await fireEvent.changeText(getByPlaceholderText('Title'), 'New issue');
  await fireEvent.press(getByText('Create'));

  await findByText("You don't have permission to create issues in this project.");
});
