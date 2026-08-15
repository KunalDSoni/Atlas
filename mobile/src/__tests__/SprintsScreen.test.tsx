import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SprintsScreen } from '../screens/SprintsScreen';
import * as hooks from '../api/hooks';

jest.mock('../api/hooks');

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const route = { params: { projectId: 'p1' } };

const sprints = [
  { id: 's1', name: 'Sprint 1', status: 'active' as const },
  { id: 's2', name: 'Sprint 2', status: 'planned' as const },
  { id: 's3', name: 'Sprint 3', status: 'completed' as const },
];

beforeEach(() => {
  jest.clearAllMocks();
  (hooks.useCreateSprint as jest.Mock).mockReturnValue({ mutate: jest.fn(), isPending: false });
});

// The screen passed `sections` and `renderSectionHeader` — SectionList props —
// to a FlatList, which ignores both, so the grouping was written and never
// rendered. TypeScript flagged it and the error was carried as noise.
//
// Asserted on testID rather than text: every sprint card renders a status badge
// reading "Active"/"Planned"/"Completed" too, so a text query matches the badge
// and passes whether or not any header exists.
test('renders a section header per non-empty group', async () => {
  (hooks.useSprints as jest.Mock).mockReturnValue({ data: sprints, isLoading: false });

  const { findAllByTestId } = await renderWithClient(
    <SprintsScreen route={route} navigation={{} as never} />,
  );

  const headers = await findAllByTestId('sprint-section-header');
  expect(headers).toHaveLength(3);
});

test('a group with no sprints gets no header', async () => {
  (hooks.useSprints as jest.Mock).mockReturnValue({
    data: [{ id: 's1', name: 'Only active', status: 'active' as const }],
    isLoading: false,
  });

  const { findAllByTestId } = await renderWithClient(
    <SprintsScreen route={route} navigation={{} as never} />,
  );

  const headers = await findAllByTestId('sprint-section-header');
  expect(headers).toHaveLength(1);
});

test('still lists every sprint', async () => {
  (hooks.useSprints as jest.Mock).mockReturnValue({ data: sprints, isLoading: false });

  const { findByText } = await renderWithClient(
    <SprintsScreen route={route} navigation={{} as never} />,
  );

  await findByText('Sprint 1');
  await findByText('Sprint 2');
  await findByText('Sprint 3');
});
