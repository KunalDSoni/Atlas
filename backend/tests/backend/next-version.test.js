/**
 * VERSION COMPUTATION
 *
 * Decides what a push to main is worth. A wrong answer here either burns a
 * version on a docs typo or silently ships a breaking change as a patch, so
 * the mapping from commit type to bump is pinned exactly.
 */
const { bumpForCommit, nextVersion } = require('../../scripts/next-version');

describe('bumpForCommit', () => {
  test.each([
    ['feat: add mentions', 'minor'],
    ['feat(mentions): add picker', 'minor'],
    ['fix: repair the dropdown', 'patch'],
    ['fix(api): repair the dropdown', 'patch'],
    ['perf: batch the enrich queries', 'patch'],
  ])('%s -> %s', (subject, expected) => {
    expect(bumpForCommit({ subject, body: '' })).toBe(expected);
  });

  test.each([
    ['docs: update the spec'],
    ['chore(release): 14.1.10'],
    ['ci: run the mobile suite'],
    ['test: cover the parser'],
    ['build: refresh the bundle'],
    ['style: reformat'],
    ['refactor: extract a helper'],
    ['Merge pull request #32 from x/y'],
    ['no conventional prefix at all'],
  ])('%s -> no release', (subject) => {
    expect(bumpForCommit({ subject, body: '' })).toBeNull();
  });

  test('a bang marks a breaking change whatever the type', () => {
    expect(bumpForCommit({ subject: 'feat!: drop v1 auth', body: '' })).toBe('major');
    expect(bumpForCommit({ subject: 'fix(api)!: rename a field', body: '' })).toBe('major');
    expect(bumpForCommit({ subject: 'chore!: drop node 18', body: '' })).toBe('major');
  });

  test('a BREAKING CHANGE body marks a breaking change', () => {
    expect(bumpForCommit({
      subject: 'feat: new token format',
      body: 'BREAKING CHANGE: stored mentions change shape',
    })).toBe('major');
  });

  test('a body mentioning breaking changes in prose does not', () => {
    expect(bumpForCommit({
      subject: 'fix: guard against breaking changes in the parser',
      body: 'This avoids breaking change handling downstream.',
    })).toBe('patch');
  });
});

describe('nextVersion', () => {
  test('no releasable commits means no release', () => {
    expect(nextVersion('14.1.10', [
      { subject: 'docs: update the spec', body: '' },
      { subject: 'chore: tidy', body: '' },
    ])).toBeNull();
  });

  test('an empty commit list means no release', () => {
    expect(nextVersion('14.1.10', [])).toBeNull();
  });

  test('a fix bumps the patch', () => {
    expect(nextVersion('14.1.10', [{ subject: 'fix: a bug', body: '' }]))
      .toEqual({ version: '14.1.11', bump: 'patch' });
  });

  test('a feat bumps the minor and resets the patch', () => {
    expect(nextVersion('14.1.10', [{ subject: 'feat: a feature', body: '' }]))
      .toEqual({ version: '14.2.0', bump: 'minor' });
  });

  test('a breaking change bumps the major and resets the rest', () => {
    expect(nextVersion('14.1.10', [{ subject: 'feat!: a rewrite', body: '' }]))
      .toEqual({ version: '15.0.0', bump: 'major' });
  });

  test('the highest bump in the batch wins', () => {
    expect(nextVersion('14.1.10', [
      { subject: 'fix: a bug', body: '' },
      { subject: 'feat: a feature', body: '' },
      { subject: 'docs: notes', body: '' },
    ])).toEqual({ version: '14.2.0', bump: 'minor' });
  });

  test('order does not change the result', () => {
    expect(nextVersion('14.1.10', [
      { subject: 'feat: a feature', body: '' },
      { subject: 'fix: a bug', body: '' },
    ])).toEqual({ version: '14.2.0', bump: 'minor' });
  });

  test('a breaking change outranks a feat', () => {
    expect(nextVersion('2.3.4', [
      { subject: 'feat: a feature', body: '' },
      { subject: 'fix!: a breaking fix', body: '' },
    ])).toEqual({ version: '3.0.0', bump: 'major' });
  });

  test('rejects a version that is not three numeric parts', () => {
    expect(() => nextVersion('14.1', [{ subject: 'fix: x', body: '' }]))
      .toThrow('not a semver');
    expect(() => nextVersion('v14.1.10', [{ subject: 'fix: x', body: '' }]))
      .toThrow('not a semver');
  });
});
