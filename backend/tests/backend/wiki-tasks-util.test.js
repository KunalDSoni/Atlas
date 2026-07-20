const { extractTasks, taskKey } = require('../../utils/wiki-tasks');

describe('extractTasks', () => {
  test('finds unchecked and checked items in a list', () => {
    const t = extractTasks('<ul><li>[ ] Ship the thing</li><li>[x] Write the docs</li></ul>');
    expect(t.map((x) => x.text)).toEqual(['Ship the thing', 'Write the docs']);
    expect(t.map((x) => x.checked)).toEqual([false, true]);
  });

  test('accepts [X] as checked', () => {
    expect(extractTasks('<ul><li>[X] Done</li></ul>')[0].checked).toBe(true);
  });

  test('ignores list items with no task marker', () => {
    const t = extractTasks('<ul><li>Just a bullet</li><li>[ ] A task</li></ul>');
    expect(t.map((x) => x.text)).toEqual(['A task']);
  });

  test('ignores markers that are not at the start of the item', () => {
    expect(extractTasks('<ul><li>See [ ] notation</li></ul>')).toEqual([]);
  });

  test('strips inline markup from the task text', () => {
    const t = extractTasks('<ul><li>[ ] Ship <strong>fast</strong></li></ul>');
    expect(t[0].text).toBe('Ship fast');
  });

  test('returns [] for empty or non-string input', () => {
    expect(extractTasks('')).toEqual([]);
    expect(extractTasks(null)).toEqual([]);
    expect(extractTasks(42)).toEqual([]);
  });

  test('handles ordered lists too', () => {
    expect(extractTasks('<ol><li>[ ] First</li></ol>')[0].text).toBe('First');
  });
});

describe('taskKey — identity that survives edits', () => {
  test('same text yields the same key regardless of position', () => {
    const a = extractTasks('<ul><li>[ ] Alpha</li><li>[ ] Beta</li></ul>');
    const b = extractTasks('<ul><li>[ ] Beta</li><li>[ ] Alpha</li></ul>');
    // Reordering a list must not move checkmarks between tasks.
    expect(a.find((t) => t.text === 'Alpha').key).toBe(b.find((t) => t.text === 'Alpha').key);
    expect(a.find((t) => t.text === 'Beta').key).toBe(b.find((t) => t.text === 'Beta').key);
  });

  test('checking a box does not change the key', () => {
    const before = extractTasks('<ul><li>[ ] Same task</li></ul>')[0].key;
    const after = extractTasks('<ul><li>[x] Same task</li></ul>')[0].key;
    expect(after).toBe(before);
  });

  test('duplicate task text gets distinct keys by occurrence', () => {
    const t = extractTasks('<ul><li>[ ] Review</li><li>[ ] Review</li></ul>');
    expect(t[0].key).not.toBe(t[1].key);
  });

  test('keys are stable across calls and safe as a column value', () => {
    const k = taskKey('Ship the thing', 0);
    expect(k).toBe(taskKey('Ship the thing', 0));
    expect(k).toMatch(/^[a-f0-9]{16}-\d+$/);
  });

  test('editing task text changes the key — state does not follow to different work', () => {
    const a = extractTasks('<ul><li>[ ] Deploy to staging</li></ul>')[0].key;
    const b = extractTasks('<ul><li>[ ] Deploy to production</li></ul>')[0].key;
    expect(a).not.toBe(b);
  });
});
