import { describe, expect, it } from 'vitest';
import type { Sprint, SprintStatus } from '@/lib/types';
import { assignableSprints } from '@/lib/domain';

function sprintWith(id: string, status: SprintStatus): Sprint {
  return {
    id,
    project_id: 'project-1',
    name: id,
    slug: id,
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

const closedOne = sprintWith('Sprint 1', 'completed');
const closedTwo = sprintWith('Sprint 2', 'completed');
const running = sprintWith('Sprint 3', 'active');
const upcoming = sprintWith('Sprint 4', 'planning');
const all = [closedOne, closedTwo, running, upcoming];

// Requirement: a sprint that has been completed is not somewhere new work can be
// put, so it stops being an option. The server returns 409 either way — this is
// the half that keeps people from meeting one.
describe('assignableSprints', () => {
  it('drops completed sprints', () => {
    expect(assignableSprints(all).map((s) => s.id)).toEqual(['Sprint 3', 'Sprint 4']);
  });

  it('keeps the sprint the issue is already in, completed or not', () => {
    expect(assignableSprints(all, 'Sprint 1').map((s) => s.id))
      .toEqual(['Sprint 1', 'Sprint 3', 'Sprint 4']);
  });

  it('keeps only that one, not every completed sprint', () => {
    expect(assignableSprints(all, 'Sprint 1').map((s) => s.id)).not.toContain('Sprint 2');
  });

  it('drops them all when the issue is in no sprint', () => {
    expect(assignableSprints(all, null).map((s) => s.id)).toEqual(['Sprint 3', 'Sprint 4']);
  });

  it('leaves an open sprint list untouched', () => {
    expect(assignableSprints([running, upcoming], 'Sprint 3')).toHaveLength(2);
  });
});
