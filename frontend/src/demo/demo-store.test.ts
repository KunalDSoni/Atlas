import { describe, expect, it } from 'vitest';
import { createDemoStore, DemoNotFound, type Fixtures } from './demo-store';

const ME = { id: 'u-admin', name: 'Kunal Soni', avatar_color: '#0c66e4' };
const ALEX = { id: 'u-alex', name: 'Alex Rivera', avatar_color: '#22a06b' };

function issue(over: Record<string, unknown>) {
  return {
    id: 'i-1', project_id: 'p-atl', sprint_id: 's-1', issue_key: 'ATL-1', issue_number: 1,
    title: 'First', status: 'todo', assignee_id: null, assignee_name: null, assignee_color: null,
    comment_count: 0, subtask_count: 0, parent_id: null, ...over,
  };
}

function fixtures(): Fixtures {
  const one = issue({});
  const two = issue({ id: 'i-2', issue_key: 'ATL-2', issue_number: 2, title: 'Second', sprint_id: null });
  return {
    '/auth/me': ME,
    '/users': [ME, ALEX],
    '/projects': [{ id: 'p-atl', key: 'ATL', name: 'Atlas Platform' }],
    '/projects/p-atl/issues': [one, two],
    '/projects/p-atl/issues?sprint_id=s-1': [issue({})],
    '/projects/p-atl/epics': [{ id: 'e-1', issue_key: 'ATL-9', children: [{ id: 'i-1', issue_key: 'ATL-1', status: 'todo' }] }],
    '/issues/i-1/comments': [],
  };
}

const NOW = new Date('2026-09-17T10:00:00.000Z');
const store = () => createDemoStore(fixtures(), () => NOW);

describe('demo store reads', () => {
  it('returns a recorded response by exact path and query', () => {
    expect(store().read('/projects')).toEqual([{ id: 'p-atl', key: 'ATL', name: 'Atlas Platform' }]);
  });

  it('returns a copy, so callers cannot mutate the store', () => {
    const s = store();
    (s.read('/projects') as { name: string }[])[0].name = 'Changed';
    expect((s.read('/projects') as { name: string }[])[0].name).toBe('Atlas Platform');
  });

  it('finds an unrecorded issue by id or key in any recorded list', () => {
    const s = store();
    expect(s.read('/issues/i-2')).toMatchObject({ issue_key: 'ATL-2', title: 'Second' });
    expect(s.read('/issues/by-key/atl-2')).toMatchObject({ id: 'i-2' });
  });

  it('prefers the richest copy of an issue over a summary', () => {
    expect(store().read('/issues/i-1')).toMatchObject({ title: 'First', project_id: 'p-atl' });
  });

  it('answers an unrecorded issue sub-collection with an empty list', () => {
    expect(store().read('/issues/i-2/activity')).toEqual([]);
  });

  it('throws DemoNotFound for anything else', () => {
    expect(() => store().read('/nope')).toThrow(DemoNotFound);
  });
});

describe('demo store writes that stick', () => {
  it('a move updates every copy of the issue', () => {
    const s = store();
    s.write('PUT', '/issues/i-1/move', { status: 'in_progress', board_order: 3 });
    expect((s.read('/projects/p-atl/issues') as { status: string }[])[0].status).toBe('in_progress');
    expect((s.read('/projects/p-atl/epics') as { children: { status: string }[] }[])[0].children[0].status).toBe('in_progress');
    expect(s.read('/issues/i-1')).toMatchObject({ status: 'in_progress', updated_at: NOW.toISOString() });
  });

  it('an edit resolves the assignee name from the recorded users', () => {
    const s = store();
    const out = s.write('PUT', '/issues/i-1', { assignee_id: 'u-alex' });
    expect(out).toMatchObject({ assignee_id: 'u-alex', assignee_name: 'Alex Rivera', assignee_color: '#22a06b' });
  });

  it('moving an issue out of a sprint drops it from that sprint list, and back in re-adds it', () => {
    const s = store();
    s.write('PUT', '/issues/i-1', { sprint_id: null });
    expect(s.read('/projects/p-atl/issues?sprint_id=s-1')).toEqual([]);
    s.write('PUT', '/issues/i-2', { sprint_id: 's-1' });
    expect((s.read('/projects/p-atl/issues?sprint_id=s-1') as { id: string }[]).map((i) => i.id)).toEqual(['i-2']);
  });

  it('create assigns the next key, credits the demo user and lands in the project list', () => {
    const s = store();
    const created = s.write('POST', '/projects/p-atl/issues', { title: 'New one', type: 'task', status: 'todo', sprint_id: 's-1', assignee_id: 'u-alex' }) as Record<string, unknown>;
    expect(created).toMatchObject({ issue_key: 'ATL-3', issue_number: 3, reporter_name: 'Kunal Soni', assignee_name: 'Alex Rivera', created_at: NOW.toISOString() });
    expect((s.read('/projects/p-atl/issues') as { id: string }[]).map((i) => i.id)).toContain(created.id);
    expect((s.read('/projects/p-atl/issues?sprint_id=s-1') as { id: string }[]).map((i) => i.id)).toContain(created.id);
    expect(s.read(`/issues/${created.id as string}`)).toMatchObject({ title: 'New one' });
  });

  it('creating a subtask bumps the parent subtask count', () => {
    const s = store();
    s.write('POST', '/projects/p-atl/issues', { title: 'Child', type: 'subtask', parent_id: 'i-1' });
    expect(s.read('/issues/i-1')).toMatchObject({ subtask_count: 1 });
  });

  it('a comment is appended by the demo user and counted on the issue', () => {
    const s = store();
    const c = s.write('POST', '/issues/i-2/comments', { body: 'Looks good' });
    expect(c).toMatchObject({ issue_id: 'i-2', body: 'Looks good', author_name: 'Kunal Soni' });
    expect(s.read('/issues/i-2/comments')).toEqual([c]);
    expect(s.read('/issues/i-2')).toMatchObject({ comment_count: 1 });
  });
});

describe('demo store writes that do not stick', () => {
  it('echoes the body with the id from the path and changes nothing', () => {
    const s = store();
    const sprint = '6f1c2a4e-8d3b-4c1a-9e2f-1a2b3c4d5e6f';
    const before = JSON.stringify(fixtures());
    expect(s.write('POST', `/sprints/${sprint}/reopen`, { end_date: '2026-10-01' })).toEqual({ end_date: '2026-10-01', id: sprint });
    for (const key of Object.keys(fixtures())) expect(s.read(key)).toEqual((JSON.parse(before) as Fixtures)[key]);
  });

  it('DELETE answers ok and removes nothing', () => {
    const s = store();
    expect(s.write('DELETE', '/issues/i-1')).toEqual({ ok: true });
    expect(s.read('/issues/i-1')).toMatchObject({ id: 'i-1' });
  });

  it('issue key resolution answers an empty set', () => {
    expect(store().write('POST', '/issues/resolve', { keys: ['ATL-1'] })).toEqual({ issues: [] });
  });
});
