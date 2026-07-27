import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectListScreen } from '../screens/ProjectListScreen';
import * as projectsApi from '../api/projects';

jest.mock('../api/projects');

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

test('renders fetched projects and navigates on press', async () => {
  (projectsApi.fetchProjects as jest.Mock).mockResolvedValue([
    { id: 'p1', key: 'ATLAS', name: 'Atlas Core', lead_name: 'Ada', issue_count: 5, member_count: 3 },
  ]);
  const navigate = jest.fn();

  const { findByText } = await renderWithClient(<ProjectListScreen navigation={{ navigate } as any} route={{} as any} />);

  const item = await findByText('Atlas Core');
  await fireEvent.press(item);

  await waitFor(() => expect(navigate).toHaveBeenCalledWith('Board', { projectId: 'p1', projectName: 'Atlas Core' }));
});
