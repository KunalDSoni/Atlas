import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IssueDetailScreen } from '../screens/IssueDetailScreen';
import * as issuesApi from '../api/issues';
import * as statusesApi from '../api/statuses';
import * as membersApi from '../api/members';
import * as timersApi from '../api/timers';

jest.mock('../api/issues');
jest.mock('../api/statuses');
jest.mock('../api/members');
jest.mock('../api/timers');

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const route = { params: { issueId: 'i1' } };

test('renders issue and saves a status change', async () => {
  (issuesApi.fetchIssue as jest.Mock).mockResolvedValue({
    id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', description: 'desc', status: 'todo',
    type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null, project_id: 'p1',
    time_spent: 0, in_progress_minutes_live: null,
  });
  (statusesApi.fetchProjectStatuses as jest.Mock).mockResolvedValue([
    { id: 's1', key: 'todo', label: 'To Do', category: 'todo', position: 0 },
    { id: 's2', key: 'done', label: 'Done', category: 'done', position: 1 },
  ]);
  (membersApi.fetchProjectMembers as jest.Mock).mockResolvedValue([]);
  (issuesApi.updateIssue as jest.Mock).mockResolvedValue({});
  (timersApi.fetchTimer as jest.Mock).mockResolvedValue({
    running: false, started_at: null, elapsed_minutes: 0, runaway: false, by_user: [],
  });

  const { findByText, getByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

  await findByText('ATLAS-1');
  await fireEvent.press(getByText('Done'));

  await waitFor(() => expect(issuesApi.updateIssue).toHaveBeenCalledWith('i1', { status: 'done' }));
});

test('assigning a member sends the user_id, not the project_members row id', async () => {
  (issuesApi.fetchIssue as jest.Mock).mockResolvedValue({
    id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', description: 'desc', status: 'todo',
    type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null, project_id: 'p1',
    time_spent: 0, in_progress_minutes_live: null,
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
  (timersApi.fetchTimer as jest.Mock).mockResolvedValue({
    running: false, started_at: null, elapsed_minutes: 0, runaway: false, by_user: [],
  });

  const { findByText, getByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

  await findByText('ATLAS-1');
  await fireEvent.press(getByText('Alex Rivera'));

  await waitFor(() => expect(issuesApi.updateIssue).toHaveBeenCalledWith('i1', { assignee_id: 'user-42' }));
  expect(issuesApi.updateIssue).not.toHaveBeenCalledWith('i1', { assignee_id: 'pm-row-1' });
});

describe('IssueDetailScreen time section', () => {
  test('shows the in-progress value and a Start timer control', async () => {
    (issuesApi.fetchIssue as jest.Mock).mockResolvedValue({
      id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', description: 'desc', status: 'todo',
      type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null, project_id: 'p1',
      time_spent: 0, in_progress_minutes_live: 90,
    });
    (statusesApi.fetchProjectStatuses as jest.Mock).mockResolvedValue([
      { id: 's1', key: 'todo', label: 'To Do', category: 'todo', position: 0 },
    ]);
    (membersApi.fetchProjectMembers as jest.Mock).mockResolvedValue([]);
    (timersApi.fetchTimer as jest.Mock).mockResolvedValue({
      running: false, started_at: null, elapsed_minutes: 0, runaway: false, by_user: [],
    });

    const { findByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

    // Status age, deliberately not worded as tracked time — see the label note
    // in IssueDetailScreen and the web field rail.
    expect(await findByText(/in-progress status for/)).toBeTruthy();
    expect(await findByText('Start timer')).toBeTruthy();
  });

  test('shows Pause while a timer is running', async () => {
    (issuesApi.fetchIssue as jest.Mock).mockResolvedValue({
      id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', description: 'desc', status: 'todo',
      type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null, project_id: 'p1',
      time_spent: 0, in_progress_minutes_live: null,
    });
    (statusesApi.fetchProjectStatuses as jest.Mock).mockResolvedValue([
      { id: 's1', key: 'todo', label: 'To Do', category: 'todo', position: 0 },
    ]);
    (membersApi.fetchProjectMembers as jest.Mock).mockResolvedValue([]);
    (timersApi.fetchTimer as jest.Mock).mockResolvedValue({
      running: true, started_at: '2026-07-06 09:00:00', elapsed_minutes: 30, runaway: false, by_user: [],
    });

    const { findByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

    expect(await findByText('Pause')).toBeTruthy();
  });
});

// ===== A stop nobody asked for =====
// The server has returned auto_stopped since migration 030 and mobile could not
// see it, so a timer the server stopped simply vanished — the original "it
// stopped by itself" report, still live on the platform where people most often
// leave one running.
// See docs/superpowers/specs/2026-08-15-mobile-timer-parity-design.md

function baseMocks(timer: Partial<timersApi.TimerState> = {}) {
  (issuesApi.fetchIssue as jest.Mock).mockResolvedValue({
    id: 'i1', issue_key: 'ATLAS-1', title: 'Fix bug', description: 'desc', status: 'todo',
    type: 'task', priority: 'medium', assignee_id: null, assignee_name: null, assignee_color: null,
    project_id: 'p1', time_spent: 0, in_progress_minutes_live: null,
  });
  (statusesApi.fetchProjectStatuses as jest.Mock).mockResolvedValue([]);
  (membersApi.fetchProjectMembers as jest.Mock).mockResolvedValue([]);
  (timersApi.fetchTimer as jest.Mock).mockResolvedValue({
    running: false, started_at: null, elapsed_minutes: 0, runaway: false, by_user: [],
    auto_stopped: null, ...timer,
  });
}

test('explains a timer the server stopped, and offers to log the real time', async () => {
  baseMocks({ auto_stopped: { reason: 'abandoned', stopped_at: '2026-08-14 09:00:00' } });

  const { findByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

  // Nothing was credited, so the only useful action is to state the real duration.
  await findByText(/stopped without logging any time/i);
  await findByText('Log the time you worked');
});

test('does not explain a stop while a timer is running', async () => {
  baseMocks({ running: true, started_at: '2026-08-15 09:00:00', auto_stopped: { reason: 'abandoned', stopped_at: '2026-08-14 09:00:00' } });

  const { queryByText, findByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

  await findByText('ATLAS-1');
  expect(queryByText(/stopped without logging any time/i)).toBeNull();
});

test('an unrecognised reason still reports the stop rather than a sentence with a hole', async () => {
  // An older client against a newer server must not render "Your timer was  ()".
  baseMocks({ auto_stopped: { reason: 'something_new' as never, stopped_at: '2026-08-14 09:00:00' } });

  const { findByText } = await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);

  await findByText(/stopped automatically/i);
});

test('logging the time posts the minutes and closes the prompt', async () => {
  baseMocks({ auto_stopped: { reason: 'abandoned', stopped_at: '2026-08-14 09:00:00' } });
  (timersApi.logWork as jest.Mock).mockResolvedValue({});

  const { findByText, findByPlaceholderText, queryByPlaceholderText } =
    await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);
  fireEvent.press(await findByText('Log the time you worked'));

  fireEvent.changeText(await findByPlaceholderText('Minutes'), '90');
  fireEvent.press(await findByText('Log'));

  await waitFor(() => expect(timersApi.logWork).toHaveBeenCalledWith('i1', 90));
  await waitFor(() => expect(queryByPlaceholderText('Minutes')).toBeNull());
});

test('a failed post keeps the prompt open with what was typed', async () => {
  baseMocks({ auto_stopped: { reason: 'abandoned', stopped_at: '2026-08-14 09:00:00' } });
  (timersApi.logWork as jest.Mock).mockRejectedValue(new Error('offline'));

  const { findByText, findByPlaceholderText } =
    await renderWithClient(<IssueDetailScreen route={route as any} navigation={{} as any} />);
  fireEvent.press(await findByText('Log the time you worked'));
  const input = await findByPlaceholderText('Minutes');
  fireEvent.changeText(input, '45');
  fireEvent.press(await findByText('Log'));

  // A bad connection must never silently discard what someone typed.
  await waitFor(() => expect(input.props.value).toBe('45'));
});
