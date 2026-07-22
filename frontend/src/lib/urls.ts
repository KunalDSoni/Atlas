/**
 * The only place the frontend spells an app route.
 *
 * The project key is the first path segment and the source of truth for which
 * project is open: /atlas/board is project ATLAS whoever opens it, which is
 * what makes a pasted link mean the same thing to two people.
 *
 * backend/utils/links.js mirrors issueUrl for notification links. Keep them
 * in step.
 */

/**
 * ATLAS-3, US-101, MY-TEAM-42. Screen segments are lowercase words with no
 * trailing number, so this never collides with /atlas/board.
 */
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*-\d+$/;

/** The screens that live under a project key. */
export const PROJECT_SCREENS = [
  'board', 'backlog', 'epics', 'roadmap', 'sprints',
  'releases', 'reports', 'automation', 'servicedesk',
] as const;

export function isIssueKey(segment: string): boolean {
  return ISSUE_KEY.test(segment);
}

/**
 * The project an issue key belongs to: ATLAS-3 -> atlas.
 * Splits on the LAST hyphen — MY-TEAM-42 belongs to MY-TEAM, not to MY.
 */
export function projectKeyOf(issueKey: string): string {
  const cut = issueKey.lastIndexOf('-');
  return (cut > 0 ? issueKey.slice(0, cut) : issueKey).toLowerCase();
}

export function projectUrl(projectKey: string, screen: string = 'board'): string {
  return `/${projectKey.toLowerCase()}/${screen}`;
}

/**
 * Permanent path for an issue. The project is derivable from the key, so
 * callers never have to know which project they are linking into — which is
 * what makes a cross-project link work without special handling.
 */
export function issueUrl(issueKey: string): string {
  return `/${projectKeyOf(issueKey)}/${issueKey.toUpperCase()}`;
}

export function sprintUrl(projectKey: string, slug: string): string {
  return `/${projectKey.toLowerCase()}/sprints/${slug}`;
}

export function releaseUrl(projectKey: string, slug: string): string {
  return `/${projectKey.toLowerCase()}/releases/${slug}`;
}

/** For Copy Link — a URL that survives being pasted into Slack. */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
