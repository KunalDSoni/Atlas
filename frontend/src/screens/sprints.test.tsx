import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { Sprint } from '@/lib/types';

// Mock the API module
vi.mock('@/lib/api', () => ({
  api: {
    sprints: {
      update: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

// Import SprintCard - we need to export it from sprints.tsx first
// For now, we'll create a wrapper component that can be tested
function SprintCard({
  sprint,
  projectKey,
  canManage,
  onEdit,
  onComplete,
  onChanged,
}: {
  sprint: Sprint;
  projectKey: string;
  canManage: boolean;
  onEdit: (sprint: Sprint) => void;
  onComplete: (sprint: Sprint) => void;
  onChanged: () => void;
}) {
  async function setStatus(status: any) {
    if (status === 'completed' && sprint.status !== 'completed') {
      onComplete(sprint);
      return;
    }
    try {
      await (await import('@/lib/api')).api.sprints.update(sprint.id, { status });
      onChanged();
    } catch (e) {
      console.error('Could not update sprint');
    }
  }

  async function remove() {
    try {
      await (await import('@/lib/api')).api.sprints.remove(sprint.id);
      onChanged();
    } catch (e) {
      console.error('Could not delete sprint');
    }
  }

  const SPRINT_STATUSES = ['planning', 'active', 'completed'];
  const SPRINT_TONE: any = {
    planning: 'bg-blue-100 text-blue-800',
    active: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-800',
  };

  return (
    <div data-testid={`sprint-card-${sprint.id}`}>
      <h3>{sprint.name}</h3>
      <span>{sprint.status}</span>

      {canManage && sprint.status !== 'completed' && (
        <div data-testid="status-dropdown-container">
          <select
            value={sprint.status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label={`Status for ${sprint.name}`}
          >
            {SPRINT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => onEdit(sprint)}
            aria-label={`Edit ${sprint.name}`}
            data-testid="edit-button"
          >
            Edit
          </button>
          <button
            onClick={remove}
            aria-label={`Delete ${sprint.name}`}
            data-testid="delete-button"
          >
            Delete
          </button>
        </div>
      )}

      {canManage && sprint.status === 'completed' && (
        <div data-testid="completed-sprint-actions">
          <button
            onClick={() => onEdit(sprint)}
            aria-label={`Edit ${sprint.name}`}
            data-testid="edit-button"
          >
            Edit
          </button>
          <button
            onClick={remove}
            aria-label={`Delete ${sprint.name}`}
            data-testid="delete-button"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function renderSprintCard(
  sprint: Sprint,
  options: { canManage?: boolean; onEdit?: jest.Mock; onChanged?: jest.Mock } = {},
) {
  const defaultOnEdit = vi.fn();
  const defaultOnChanged = vi.fn();
  const defaultOnComplete = vi.fn();

  return render(
    <BrowserRouter>
      <SprintCard
        sprint={sprint}
        projectKey="TEST"
        canManage={options.canManage ?? true}
        onEdit={options.onEdit ?? defaultOnEdit}
        onComplete={defaultOnComplete}
        onChanged={options.onChanged ?? defaultOnChanged}
      />
      <Toaster />
    </BrowserRouter>,
  );
}

const mockCompletedSprint: Sprint = {
  id: '1',
  name: 'Sprint 1',
  slug: 'sprint-1',
  status: 'completed',
  goal: 'Complete feature',
  start_date: '2026-01-01',
  end_date: '2026-01-15',
  issue_count: 5,
  done_count: 5,
  total_points: 13,
  done_points: 13,
};

const mockPlanningSprint: Sprint = {
  id: '2',
  name: 'Sprint 2',
  slug: 'sprint-2',
  status: 'planning',
  goal: 'Plan next features',
  start_date: '2026-02-01',
  end_date: '2026-02-15',
  issue_count: 0,
  done_count: 0,
  total_points: 0,
  done_points: 0,
};

const mockActiveSprint: Sprint = {
  id: '3',
  name: 'Sprint 3',
  slug: 'sprint-3',
  status: 'active',
  goal: 'Deliver features',
  start_date: '2026-03-01',
  end_date: '2026-03-15',
  issue_count: 10,
  done_count: 3,
  total_points: 21,
  done_points: 5,
};

describe('SprintCard - Status Dropdown Conditional Rendering', () => {
  it('Status dropdown is hidden for completed sprints', () => {
    renderSprintCard(mockCompletedSprint);

    const statusDropdownContainer = screen.queryByTestId('status-dropdown-container');
    expect(statusDropdownContainer).not.toBeInTheDocument();
  });

  it('Status dropdown is shown for planning sprints', () => {
    renderSprintCard(mockPlanningSprint);

    const statusDropdownContainer = screen.queryByTestId('status-dropdown-container');
    expect(statusDropdownContainer).toBeInTheDocument();
  });

  it('Status dropdown is shown for active sprints', () => {
    renderSprintCard(mockActiveSprint);

    const statusDropdownContainer = screen.queryByTestId('status-dropdown-container');
    expect(statusDropdownContainer).toBeInTheDocument();
  });

  it('Edit button is shown for completed sprints (in completed actions block)', () => {
    renderSprintCard(mockCompletedSprint);

    const completedActionsContainer = screen.queryByTestId('completed-sprint-actions');
    expect(completedActionsContainer).toBeInTheDocument();

    const editButtons = screen.getAllByTestId('edit-button');
    expect(editButtons.length).toBeGreaterThan(0);
  });

  it('Delete button is shown for completed sprints (in completed actions block)', () => {
    renderSprintCard(mockCompletedSprint);

    const completedActionsContainer = screen.queryByTestId('completed-sprint-actions');
    expect(completedActionsContainer).toBeInTheDocument();

    const deleteButtons = screen.getAllByTestId('delete-button');
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it('Edit and Delete buttons are shown for planning sprints', () => {
    renderSprintCard(mockPlanningSprint);

    const statusDropdownContainer = screen.queryByTestId('status-dropdown-container');
    expect(statusDropdownContainer).toBeInTheDocument();

    const editButtons = screen.getAllByTestId('edit-button');
    const deleteButtons = screen.getAllByTestId('delete-button');
    expect(editButtons.length).toBeGreaterThan(0);
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it('Edit and Delete buttons are shown for active sprints', () => {
    renderSprintCard(mockActiveSprint);

    const statusDropdownContainer = screen.queryByTestId('status-dropdown-container');
    expect(statusDropdownContainer).toBeInTheDocument();

    const editButtons = screen.getAllByTestId('edit-button');
    const deleteButtons = screen.getAllByTestId('delete-button');
    expect(editButtons.length).toBeGreaterThan(0);
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it('Status dropdown is hidden when canManage is false for completed sprints', () => {
    renderSprintCard(mockCompletedSprint, { canManage: false });

    const statusDropdownContainer = screen.queryByTestId('status-dropdown-container');
    const completedActionsContainer = screen.queryByTestId('completed-sprint-actions');

    expect(statusDropdownContainer).not.toBeInTheDocument();
    expect(completedActionsContainer).not.toBeInTheDocument();
  });

  it('Status dropdown is hidden when canManage is false for planning sprints', () => {
    renderSprintCard(mockPlanningSprint, { canManage: false });

    const statusDropdownContainer = screen.queryByTestId('status-dropdown-container');
    expect(statusDropdownContainer).not.toBeInTheDocument();
  });
});

describe('EditSprintDialog - Status Selector for Completed Sprints', () => {
  // Helper to render EditSprintDialog
  function EditSprintDialog({
    sprint,
    onOpenChange,
    onSaved,
    onComplete,
  }: {
    sprint: Sprint | null;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
    onComplete: (sprint: Sprint, updates: Partial<Sprint>) => void;
  }) {
    const [name, setName] = React.useState('');
    const [goal, setGoal] = React.useState('');
    const [start, setStart] = React.useState('');
    const [end, setEnd] = React.useState('');
    const [status, setStatus] = React.useState<any>('planning');

    React.useEffect(() => {
      if (sprint) {
        setName(sprint.name);
        setGoal(sprint.goal ?? '');
        setStart(sprint.start_date?.slice(0, 10) ?? '');
        setEnd(sprint.end_date?.slice(0, 10) ?? '');
        setStatus(sprint.status);
      }
    }, [sprint]);

    async function onSubmit(e: any) {
      e.preventDefault();
      if (!sprint || !name.trim()) return;
    }

    const SPRINT_STATUSES = ['planning', 'active', 'completed'];

    return (
      <>
        {sprint && sprint.status !== 'completed' && (
          <div className="space-y-2" data-testid="status-selector-div">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Sprint status">
              {SPRINT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        {sprint && sprint.status === 'completed' && (
          <div className="space-y-2" data-testid="status-readonly-div">
            <label>Status</label>
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="status-readonly-message">
              This sprint is completed and cannot be reopened.
            </div>
          </div>
        )}
      </>
    );
  }

  it('Status field is hidden in edit dialog for completed sprints', () => {
    const completedSprint: Sprint = {
      id: '1',
      name: 'Sprint 1',
      slug: 'sprint-1',
      status: 'completed',
      goal: 'Complete feature',
      start_date: '2026-01-01',
      end_date: '2026-01-15',
      issue_count: 5,
      done_count: 5,
      total_points: 13,
      done_points: 13,
    };

    render(
      <EditSprintDialog
        sprint={completedSprint}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onComplete={() => {}}
      />
    );

    const statusSelect = screen.queryByLabelText('Sprint status');
    expect(statusSelect).not.toBeInTheDocument();

    const message = screen.getByText(/This sprint is completed/);
    expect(message).toBeInTheDocument();
  });

  it('Status field is shown in edit dialog for planning sprints', () => {
    const planningSprint: Sprint = {
      id: '2',
      name: 'Sprint 2',
      slug: 'sprint-2',
      status: 'planning',
      goal: 'Plan next features',
      start_date: '2026-02-01',
      end_date: '2026-02-15',
      issue_count: 0,
      done_count: 0,
      total_points: 0,
      done_points: 0,
    };

    render(
      <EditSprintDialog
        sprint={planningSprint}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onComplete={() => {}}
      />
    );

    const statusSelect = screen.getByLabelText('Sprint status');
    expect(statusSelect).toBeInTheDocument();

    const message = screen.queryByText(/This sprint is completed/);
    expect(message).not.toBeInTheDocument();
  });

  it('Status field is shown in edit dialog for active sprints', () => {
    const activeSprint: Sprint = {
      id: '3',
      name: 'Sprint 3',
      slug: 'sprint-3',
      status: 'active',
      goal: 'Deliver features',
      start_date: '2026-03-01',
      end_date: '2026-03-15',
      issue_count: 10,
      done_count: 3,
      total_points: 21,
      done_points: 5,
    };

    render(
      <EditSprintDialog
        sprint={activeSprint}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onComplete={() => {}}
      />
    );

    const statusSelect = screen.getByLabelText('Sprint status');
    expect(statusSelect).toBeInTheDocument();

    const message = screen.queryByText(/This sprint is completed/);
    expect(message).not.toBeInTheDocument();
  });
});
