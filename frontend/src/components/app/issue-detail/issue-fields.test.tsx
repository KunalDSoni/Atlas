import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Issue, Sprint, SprintStatus } from '@/lib/types';
import { IssueFields } from './issue-fields';
import type { IssueDetail } from './use-issue-detail';

vi.mock('@/lib/api', () => ({ api: {} }));

function sprintWith(name: string, status: SprintStatus): Sprint {
  return {
    id: name,
    project_id: 'project-1',
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    goal: null,
    status,
    start_date: null,
    end_date: null,
    created_at: '2026-07-01T00:00:00.000Z',
    issue_count: 0,
    done_count: 0,
    total_points: 0,
    done_points: 0,
  };
}

const sprintOne = sprintWith('Sprint 1', 'completed');
const sprintTwo = sprintWith('Sprint 2', 'completed');
const sprintThree = sprintWith('Sprint 3', 'active');

function renderFields(issue: Partial<Issue>, sprints = [sprintOne, sprintTwo, sprintThree]) {
  // The rail reads a wide slice of IssueDetail; this suite is only about the
  // sprint field, so everything else is the quietest stub that renders.
  const detail = {
    issue: {
      id: 'issue-1',
      type: 'task',
      status: 'todo',
      priority: 'medium',
      assignee_id: null,
      parent_id: null,
      sprint_id: null,
      fix_version_id: null,
      component_id: null,
      story_points: null,
      due_date: null,
      start_date: null,
      original_estimate: null,
      time_spent: null,
      labels_parsed: [],
      custom_fields: [],
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      reporter_name: 'Kunal Soni',
      ...issue,
    },
    members: [],
    sprints,
    epics: [],
    worklogs: [],
    versions: [],
    components: [],
    workflow: { statuses: [{ key: 'todo', label: 'To Do', category: 'todo' }] },
    user: { role: 'admin' },
    canEdit: true,
    timer: null,
    timerBusy: false,
    pausedNotice: null,
    logOpen: false,
    logHours: '',
    logComment: '',
    estimateHours: '',
    loggingWork: false,
    setLogOpen: vi.fn(),
    setLogHours: vi.fn(),
    setLogComment: vi.fn(),
    setEstimateHours: vi.fn(),
    patch: vi.fn(),
    logWork: vi.fn(),
    removeWorkLog: vi.fn(),
    editWorkLog: vi.fn(),
    saveEstimate: vi.fn(),
    startTimer: vi.fn(),
    pauseTimer: vi.fn(),
  } as unknown as IssueDetail;

  return render(<IssueFields detail={detail} />);
}

// Requirement 1: work that slips from one sprint to the next says so on the
// ticket, naming the sprints it came from.
describe('the sprints an issue rolled over from', () => {
  it('names them under the sprint field', () => {
    renderFields({
      sprint_id: 'Sprint 3',
      previous_sprints: [
        { id: 'Sprint 1', name: 'Sprint 1', slug: 'sprint-1' },
        { id: 'Sprint 2', name: 'Sprint 2', slug: 'sprint-2' },
      ],
    });

    expect(screen.getByText('Previously: Sprint 1, Sprint 2')).toBeInTheDocument();
  });

  it('says nothing at all when the issue never rolled over', () => {
    renderFields({ sprint_id: 'Sprint 3', previous_sprints: [] });

    expect(screen.queryByText(/^Previously:/)).not.toBeInTheDocument();
  });

  // An older server, or any payload without the field, must not render
  // "Previously: " with nothing after it.
  it('says nothing when the server did not send the field', () => {
    renderFields({ sprint_id: 'Sprint 3' });

    expect(screen.queryByText(/^Previously:/)).not.toBeInTheDocument();
  });
});

// Requirement 2: a completed sprint is not somewhere new work can be put. Which
// sprints survive the filter is covered directly in
// src/lib/__tests__/assignable-sprints.test.ts — opening a Radix menu needs
// pointer APIs jsdom does not have. What is checkable here is that the field
// still reads its real value in the case the filter has to make an exception for.
describe('the sprint field', () => {
  it('reads the open sprint the issue is in', () => {
    renderFields({ sprint_id: 'Sprint 3' });

    expect(screen.getByRole('combobox', { name: 'Sprint' })).toHaveTextContent('Sprint 3');
  });

  // The done work a sprint keeps after it closes still has to read correctly.
  it('reads a completed sprint the issue is still in, and says it is completed', () => {
    renderFields({ sprint_id: 'Sprint 1' });

    expect(screen.getByRole('combobox', { name: 'Sprint' })).toHaveTextContent('Sprint 1 (completed)');
  });
});
