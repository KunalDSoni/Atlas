import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('SprintCard — a completed sprint is view-only', () => {
  it('offers no status control, no edit and no delete', () => {
    renderCard(completed);

    expect(screen.queryByRole('combobox', { name: 'Status for Sprint 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Sprint 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Sprint 1' })).not.toBeInTheDocument();
  });

  it('still shows the sprint and links to its detail screen', () => {
    renderCard(completed);

    expect(screen.getByRole('link', { name: 'Sprint 1' })).toHaveAttribute('href', '/aus/sprints/sprint-1');
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('14/15 · 93%')).toBeInTheDocument();
  });
});

describe('SprintCard — an open sprint stays editable', () => {
  it.each([
    ['planning', planning],
    ['active', active],
  ])('%s sprints keep the status, edit and delete controls', (_label, sprint) => {
    renderCard(sprint);

    expect(screen.getByRole('combobox', { name: `Status for ${sprint.name}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Edit ${sprint.name}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Delete ${sprint.name}` })).toBeInTheDocument();
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
