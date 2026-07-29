/**
 * In-app paths for entities. The frontend has a mirror of this in
 * frontend/src/lib/urls.ts — these two files are the only places in the system
 * that know how a route is spelled.
 */

/**
 * Permanent path for an issue: ATLAS-3 -> /atlas/ATLAS-3.
 *
 * Splits on the LAST hyphen, not the first: a project key may itself contain
 * hyphens (MY-TEAM-42 belongs to MY-TEAM, not to MY).
 */
function issueLink(issueKey) {
  const key = String(issueKey);
  const cut = key.lastIndexOf('-');
  const projectKey = cut > 0 ? key.slice(0, cut) : key;
  return `/${projectKey.toLowerCase()}/${key}`;
}

/**
 * Permanent path for a wiki page: DOCS-WIKI-12 -> /wiki/DOCS-WIKI-12.
 * Unlike issues, wiki pages are not scoped under a project-key path segment —
 * mirrors frontend/src/lib/urls.ts's wikiPageUrl, which must stay in step.
 */
function wikiPageLink(pageKey) {
  return `/wiki/${String(pageKey).toUpperCase()}`;
}

module.exports = { issueLink, wikiPageLink };
