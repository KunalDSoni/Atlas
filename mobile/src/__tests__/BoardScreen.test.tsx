import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BoardScreen } from '../screens/BoardScreen';
import * as statusesApi from '../api/statuses';
import * as issuesApi from '../api/issues';

jest.mock('../api/statuses');
jest.mock('../api/issues');

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const route = { params: { projectId: 'p1', projectName: 'Atlas Core' } };

test('groups issues into status columns and navigates to detail on press', async () => {
  (statusesApi.fetchProjectStatuses as jest.Mock).mockResolvedValue([
    { id: 's1', key: 'todo', label: 'To Do', category: 'todo', position: 0 },
    { id: 's2', key: 'done', label: 'Done', category: 'done', position: 1 },
  ]);
  (issuesApi.fetchProjectIssues as jest.Mock).mockResolvedValue([
    { id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', status: 'todo', type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null, project_id: 'p1' },
  ]);
  const navigate = jest.fn();

  const { findByText } = await renderWithClient(<BoardScreen route={route} navigation={{ navigate }} />);

  await findByText('To Do');
  await findByText('Done');
  const card = await findByText('ATLAS-1');
  await fireEvent.press(card);

  await waitFor(() => expect(navigate).toHaveBeenCalledWith('IssueDetail', { issueId: 'i1' }));
});
