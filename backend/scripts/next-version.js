// ===== NEXT VERSION =====
// What is this push to main worth?
//
// Pure computation on purpose: no git, no filesystem, no network. The workflow
// gathers the commits and writes the files; everything decidable lives here so
// it can be tested without a repository.
//
// Conventional Commits, which this repo already follows:
//   feat            -> minor      fix, perf       -> patch
//   type!  or  BREAKING CHANGE in the body        -> major
//   everything else (docs, chore, ci, test, build, style, refactor) -> no release
//
// Docs and chores deliberately cut nothing. Releasing on every commit would
// burn a version on a typo and push a container image for it.

const RANK = { patch: 1, minor: 2, major: 3 };

// A conventional subject: type, optional (scope), optional !, then ': '.
const SUBJECT_RE = /^([a-z]+)(\([^)]*\))?(!)?:\s/;

// Only the literal token, uppercase, as its own word — so prose about
// "breaking change handling" does not cut a major release.
const BREAKING_RE = /(^|\n)BREAKING[ -]CHANGE:/;

/** The bump one commit justifies, or null if it justifies none. */
function bumpForCommit({ subject = '', body = '' } = {}) {
  const match = SUBJECT_RE.exec(subject);
  if (!match) return null;
  const [, type, , bang] = match;

  if (bang || BREAKING_RE.test(body)) return 'major';
  if (type === 'feat') return 'minor';
  if (type === 'fix' || type === 'perf') return 'patch';
  return null;
}

/**
 * The version this batch of commits earns, or null when none of them warrant a
 * release. The highest bump present wins, regardless of order.
 */
function nextVersion(currentVersion, commits) {
  const parts = String(currentVersion).split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`"${currentVersion}" is not a semver x.y.z version`);
  }

  let highest = null;
  for (const commit of commits) {
    const bump = bumpForCommit(commit);
    if (bump && (!highest || RANK[bump] > RANK[highest])) highest = bump;
  }
  if (!highest) return null;

  const [major, minor, patch] = parts.map(Number);
  if (highest === 'major') return { version: `${major + 1}.0.0`, bump: 'major' };
  if (highest === 'minor') return { version: `${major}.${minor + 1}.0`, bump: 'minor' };
  return { version: `${major}.${minor}.${patch + 1}`, bump: 'patch' };
}

module.exports = { bumpForCommit, nextVersion };
