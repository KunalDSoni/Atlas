import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IssueDetailScreen } from '../screens/IssueDetailScreen';
import * as issuesApi from '../api/issues';
import * as statusesApi from '../api/statuses';
import * as membersApi from '../api/members';

jest.mock('../api/issues');
jest.mock('../api/statuses');
jest.mock('../api/members');

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const route = { params: { issueId: 'i1' } };

test('renders issue and saves a status change', async () => {
  (issuesApi.fetchIssue as jest.Mock).mockResolvedValue({
    id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', description: 'desc', status: 'todo',
    type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null, project_id: 'p1',
  });
  (statusesApi.fetchProjectStatuses as jest.Mock).mockResolvedValue([
    { id: 's1', key: 'todo', label: 'To Do', category: 'todo', position: 0 },
    { id: 's2', key: 'done', label: 'Done', category: 'done', position: 1 },
  ]);
  (membersApi.fetchProjectMembers as jest.Mock).mockResolvedValue([]);
  (issuesApi.updateIssue as jest.Mock).mockResolvedValue({});

  const { findByText, getByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

  await findByText('ATLAS-1');
  await fireEvent.press(getByText('Done'));

  await waitFor(() => expect(issuesApi.updateIssue).toHaveBeenCalledWith('i1', { status: 'done' }));
});

test('assigning a member sends the user_id, not the project_members row id', async () => {
  (issuesApi.fetchIssue as jest.Mock).mockResolvedValue({
    id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', description: 'desc', status: 'todo',
    type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null, project_id: 'p1',
  });
  (statusesApi.fetchProjectStatuses as jest.Mock).mockResolvedValue([
    { id: 's1', key: 'todo', label: 'To Do', category: 'todo', position: 0 },
  ]);
  // Realistic payload: `id` is the project_members row id, `user_id` is the actual user id.
  // These must be deliberately different so the test fails if the wrong field is sent.
  (membersApi.fetchProjectMembers as jest.Mock).mockResolvedValue([
    { id: 'pm-row-1', user_id: 'user-42', name: 'Alex Rivera', avatar_color: '#123456' },
  ]);
  (issuesApi.updateIssue as jest.Mock).mockResolvedValue({});

  const { findByText, getByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

  await findByText('ATLAS-1');
  await fireEvent.press(getByText('Alex Rivera'));

  await waitFor(() => expect(issuesApi.updateIssue).toHaveBeenCalledWith('i1', { assignee_id: 'user-42' }));
  expect(issuesApi.updateIssue).not.toHaveBeenCalledWith('i1', { assignee_id: 'pm-row-1' });
});
