import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import type { Sprint, SprintStatus } from '@/lib/types';
import { SprintCard } from '@/screens/sprints';

// The card only reads from the API when a control is used, and this suite is
// about which controls exist at all — so a bare stub is enough.
vi.mock('@/lib/api', () => ({
  api: { sprints: { update: vi.fn(), remove: vi.fn() } },
}));

function sprintWith(status: SprintStatus, name: string): Sprint {
  return {
    id: `id-${status}`,
    project_id: 'project-1',
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    goal: 'Ship the thing',
    status,
    start_date: '2026-07-22',
    end_date: '2026-07-31',
    created_at: '2026-07-01T00:00:00.000Z',
    issue_count: 15,
    done_count: 14,
    total_points: 0,
    done_points: 0,
  };
}

function renderCard(sprint: Sprint, { canManage = true } = {}) {
  return render(
    <BrowserRouter>
      <SprintCard
        sprint={sprint}
        projectKey="AUS"
        canManage={canManage}
        onEdit={vi.fn()}
        onComplete={vi.fn()}
        onChanged={vi.fn()}
      />
    </BrowserRouter>,
  );
}

const completed = sprintWith('completed', 'Sprint 1');
const planning = sprintWith('planning', 'Sprint 2');
const active = sprintWith('active', 'Sprint 3');

// Jira's rules: a completed sprint can still be renamed, so the pencil stays. Its
// status is fixed (reopening lives on the sprint detail screen) and it cannot be
// deleted. A running sprint cannot be deleted either — completing it is the way out.
describe('SprintCard — a completed sprint keeps only its rename', () => {
  it('offers edit, but no status control and no delete', () => {
    renderCard(completed);

    expect(screen.getByRole('button', { name: 'Edit Sprint 1' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Status for Sprint 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Sprint 1' })).not.toBeInTheDocument();
  });

  it('still shows the sprint and links to its detail screen', () => {
    renderCard(completed);

    expect(screen.getByRole('link', { name: 'Sprint 1' })).toHaveAttribute('href', '/aus/sprints/sprint-1');
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('14/15 · 93%')).toBeInTheDocument();
  });
});

describe('SprintCard — an active sprint cannot be deleted', () => {
  it('keeps the status control and edit, but offers no delete', () => {
    renderCard(active);

    expect(screen.getByRole('combobox', { name: 'Status for Sprint 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Sprint 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Sprint 3' })).not.toBeInTheDocument();
  });
});

describe('SprintCard — a planning sprint stays fully editable', () => {
  it('keeps the status, edit and delete controls', () => {
    renderCard(planning);

    expect(screen.getByRole('combobox', { name: 'Status for Sprint 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Sprint 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Sprint 2' })).toBeInTheDocument();
  });

  it('names the sprint the issues will move to', async () => {
    const successor = sprintWith('planning', 'Sprint 4');
    render(
      <BrowserRouter>
        <SprintCard
          sprint={planning}
          sprints={[planning, successor]}
          projectKey="AUS"
          canManage
          onEdit={vi.fn()}
          onComplete={vi.fn()}
          onChanged={vi.fn()}
        />
      </BrowserRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete Sprint 2' }));

    expect(screen.getByText(/Issues in this sprint move to Sprint 4/)).toBeInTheDocument();
  });

  it('falls back to the backlog when no sprint follows', async () => {
    renderCard(planning);

    await userEvent.click(screen.getByRole('button', { name: 'Delete Sprint 2' }));

    expect(screen.getByText(/Issues in this sprint move to the backlog/)).toBeInTheDocument();
  });
});

describe('SprintCard — without the board-admin role', () => {
  it.each([
    ['completed', completed],
    ['planning', planning],
    ['active', active],
  ])('%s sprints show no management controls', (_label, sprint) => {
    renderCard(sprint, { canManage: false });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Edit ${sprint.name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Delete ${sprint.name}` })).not.toBeInTheDocument();
  });
});
