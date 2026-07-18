const { categoryOf, statusTimeline, hoursBetween, percentile } = require('../../utils/flow');

const STATUSES = [
  { key: 'todo', category: 'todo' },
  { key: 'in_progress', category: 'in_progress' },
  { key: 'qa', category: 'in_progress' },
  { key: 'done', category: 'done' },
];

describe('categoryOf', () => {
  test('uses the project status list', () => {
    expect(categoryOf('qa', STATUSES)).toBe('in_progress');
    expect(categoryOf('done', STATUSES)).toBe('done');
  });
  test('falls back to built-ins for keys missing from the list', () => {
    expect(categoryOf('in_review', STATUSES)).toBe('in_progress');
  });
  test('unknown keys are todo', () => {
    expect(categoryOf('someday', STATUSES)).toBe('todo');
  });
});

describe('statusTimeline', () => {
  const issue = { created_at: '2026-07-01 09:00:00', status: 'done' };

  test('replays transitions into contiguous segments', () => {
    const t = statusTimeline(issue, [
      { old_value: 'todo', new_value: 'in_progress', created_at: '2026-07-02 09:00:00' },
      { old_value: 'in_progress', new_value: 'done', created_at: '2026-07-04 09:00:00' },
    ]);
    expect(t).toEqual([
      { status: 'todo', from: '2026-07-01 09:00:00', to: '2026-07-02 09:00:00' },
      { status: 'in_progress', from: '2026-07-02 09:00:00', to: '2026-07-04 09:00:00' },
      { status: 'done', from: '2026-07-04 09:00:00', to: null },
    ]);
  });

  test('no transitions: one open segment in the current status', () => {
    expect(statusTimeline(issue, [])).toEqual([
      { status: 'done', from: '2026-07-01 09:00:00', to: null },
    ]);
  });

  test('first segment status comes from the first transition, not current status', () => {
    const t = statusTimeline({ ...issue, status: 'in_progress' }, [
      { old_value: 'todo', new_value: 'in_progress', created_at: '2026-07-03 09:00:00' },
    ]);
    expect(t[0].status).toBe('todo');
  });
});

describe('hoursBetween', () => {
  test('whole and fractional hours', () => {
    expect(hoursBetween('2026-07-01 09:00:00', '2026-07-01 12:30:00')).toBeCloseTo(3.5);
  });
  test('ISO-with-T inputs also parse', () => {
    expect(hoursBetween('2026-07-01T09:00:00', '2026-07-01T10:00:00')).toBeCloseTo(1);
  });
});

describe('percentile', () => {
  test('nearest-rank on sorted input', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.85)).toBe(40);
  });
  test('empty input is null, single element is itself', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.85)).toBe(7);
  });
});
