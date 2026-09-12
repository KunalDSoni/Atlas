import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { api, setToken, clearToken, ApiError } from '@/lib/api';
import {
  BlockerList,
  blockersOf,
  blockerTitle,
  isCompletionBlocked,
  notifyBulkOutcome,
  notifyCompletionBlocked,
} from '@/lib/completion-blockers';

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));

function mockFetch(response: unknown, { ok = true, status = 200 } = {}) {
  const spy = vi.fn(async () => ({
    ok,
    status,
    text: async () => JSON.stringify(response),
  }) as unknown as Response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const blocker = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'id-1',
  issue_key: 'ATL-14',
  title: 'Write the tests',
  type: 'subtask',
  status: 'in_progress',
  status_label: 'In Progress',
  ...over,
});

const guardBody = (blockers: unknown[]) => ({
  error: 'ATL-12 has 2 open subtasks. Finish them first: ATL-14 (In Progress), ATL-15 (To Do).',
  summary: 'ATL-12 has 2 open subtasks. Finish them first.',
  blockers,
});

beforeEach(() => {
  setToken('test-token');
  toast.error.mockClear();
  toast.success.mockClear();
  toast.warning.mockClear();
});
afterEach(() => {
  clearToken();
  vi.unstubAllGlobals();
});

describe('the api client carries the guard payload through', () => {
  it('puts blockers and summary on the thrown ApiError', async () => {
    mockFetch(guardBody([blocker(), blocker({ id: 'id-2', issue_key: 'ATL-15' })]), {
      ok: false,
      status: 409,
    });

    const err = await api.issues.update('issue-1', { status: 'done' }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.blockers).toHaveLength(2);
    expect(err.summary).toBe('ATL-12 has 2 open subtasks. Finish them first.');
    // `message` stays the standalone one-liner, so any surface that only knows
    // how to show a string still names the blockers.
    expect(err.message).toContain('ATL-14 (In Progress)');
  });

  it('leaves blockers empty for an ordinary error', async () => {
    mockFetch({ error: 'Unknown status for this project' }, { ok: false, status: 400 });

    const err = await api.issues.update('issue-1', { status: 'nope' }).catch((e) => e);

    expect(err.blockers).toEqual([]);
    expect(err.summary).toBe('');
    expect(isCompletionBlocked(err)).toBe(false);
  });

  it('survives a body whose blockers field is not a list', async () => {
    mockFetch({ error: 'broken', blockers: 'three' }, { ok: false, status: 409 });
    const err = await api.issues.update('issue-1', { status: 'done' }).catch((e) => e);
    expect(err.blockers).toEqual([]);
  });
});

describe('blockersOf / blockerTitle', () => {
  it('reads nothing off a plain Error', () => {
    expect(blockersOf(new Error('boom'))).toEqual([]);
    expect(blockersOf(undefined)).toEqual([]);
  });

  it('prefers the summary, falling back to the full message', () => {
    expect(blockerTitle(new ApiError('full line', 409, [], 'short summary'))).toBe('short summary');
    expect(blockerTitle(new ApiError('full line', 409, []))).toBe('full line');
    expect(blockerTitle(new Error('boom'))).toBe('Update failed');
  });
});

describe('BlockerList', () => {
  it('gives every blocker its key, title and current state', () => {
    render(<BlockerList blockers={[blocker(), blocker({ id: 'id-2', issue_key: 'ATL-15', title: 'Ship it', status_label: 'To Do' })] as never} />);

    expect(screen.getByText('ATL-14')).toBeInTheDocument();
    expect(screen.getByText('Write the tests')).toBeInTheDocument();
    expect(screen.getByText('— In Progress')).toBeInTheDocument();
    expect(screen.getByText('ATL-15')).toBeInTheDocument();
    expect(screen.getByText('— To Do')).toBeInTheDocument();
  });

  it('caps the list and counts the remainder', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      blocker({ id: `id-${i}`, issue_key: `ATL-${i}` }));
    render(<BlockerList blockers={many as never} />);

    expect(screen.getByText('ATL-5')).toBeInTheDocument();
    expect(screen.queryByText('ATL-6')).not.toBeInTheDocument();
    expect(screen.getByText('and 3 more')).toBeInTheDocument();
  });
});

describe('notifyCompletionBlocked', () => {
  it('handles a guard rejection and reports that it did', () => {
    const err = new ApiError('full line', 409, [blocker()] as never, 'ATL-12 has 1 open subtask. Finish it first.');
    expect(notifyCompletionBlocked(err)).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(
      'ATL-12 has 1 open subtask. Finish it first.',
      expect.objectContaining({ description: expect.anything() }),
    );
  });

  it('declines anything else so the caller can show its own toast', () => {
    expect(notifyCompletionBlocked(new Error('offline'))).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('notifyBulkOutcome', () => {
  it('reports a clean run as a success', () => {
    notifyBulkOutcome(3, [], 'issue');
    expect(toast.success).toHaveBeenCalledWith('Updated 3 issues');
  });

  it('uses the singular for one issue', () => {
    notifyBulkOutcome(1, [], 'issue');
    expect(toast.success).toHaveBeenCalledWith('Updated 1 issue');
  });

  it('warns on a partial run and names what was blocked', () => {
    notifyBulkOutcome(9, [
      { issueKey: 'ATL-12', error: new ApiError('x', 409, [blocker(), blocker({ id: 'b' })] as never) },
    ], 'issue');

    expect(toast.warning).toHaveBeenCalledWith(
      'Updated 9 issues, 1 blocked',
      expect.objectContaining({ description: expect.anything() }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('treats a run where nothing moved as an outright failure', () => {
    notifyBulkOutcome(0, [
      { issueKey: 'ATL-12', error: new ApiError('x', 409, [blocker()] as never) },
      { issueKey: 'ATL-13', error: new ApiError('x', 409, [blocker()] as never) },
    ], 'request');

    expect(toast.error).toHaveBeenCalledWith(
      'Could not update 2 requests',
      expect.objectContaining({ description: expect.anything() }),
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('describes blocked and non-blocked failures differently', () => {
    notifyBulkOutcome(1, [
      { issueKey: 'ATL-12', error: new ApiError('x', 409, [blocker()] as never) },
      { issueKey: 'ATL-13', error: new Error('Network unreachable') },
    ], 'issue');

    const { description } = toast.warning.mock.calls[0][1] as { description: React.ReactElement };
    render(description);
    expect(screen.getByText('— 1 open subtask')).toBeInTheDocument();
    expect(screen.getByText('— Network unreachable')).toBeInTheDocument();
  });

  it('calls epic children child issues, not subtasks', () => {
    notifyBulkOutcome(1, [
      { issueKey: 'ATL-1', error: new ApiError('x', 409, [blocker({ type: 'story' }), blocker({ id: 'b2', type: 'task' })] as never) },
    ], 'issue');

    const { description } = toast.warning.mock.calls[0][1] as { description: React.ReactElement };
    render(description);
    expect(screen.getByText('— 2 open child issues')).toBeInTheDocument();
  });
});
