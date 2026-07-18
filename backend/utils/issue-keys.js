// ===== ISSUE KEY EXTRACTION =====
// Finds issue keys (ATLAS-29) in wiki page HTML so pages can be linked to the
// issues they mention. Deliberately naive about what a key means: anything
// matching the pattern is returned, and the caller resolves it against the
// issues table. That resolution is what stops prose like COVID-19 or ISO-8601
// from becoming a link.

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

// [jql: …] macro blocks are queries, not references — their literal text must
// not create page↔issue links (the rendered table is live, not stored).
const JQL_BLOCK_RE = /\[jql:[^\]]*\]/gi;

// Keys inside code samples and existing links are not references. Mirrors the
// exclusion applyMacros already applies client-side (rich-text.tsx).
const EXCLUDED_BLOCKS_RE = /<(code|pre|a)\b[^>]*>[\s\S]*?<\/\1>/gi;

const TAG_RE = /<[^>]+>/g;

/** Deduped issue keys mentioned in a page body, in document order. */
function extractIssueKeys(html) {
  if (typeof html !== 'string' || !html) return [];
  // Drop excluded blocks, then all remaining markup, so attribute values and
  // tag names can never be mistaken for prose.
  const text = html.replace(JQL_BLOCK_RE, ' ').replace(EXCLUDED_BLOCKS_RE, ' ').replace(TAG_RE, ' ');
  return [...new Set(text.match(ISSUE_KEY_RE) || [])];
}

const { queryAll, run } = require('../database');
const { placeholders } = require('./sql');

/**
 * Rebuilds a page's issue links to match its body. Replace-all, matching the
 * idiom page restrictions already use. Returns the linked issue ids.
 *
 * Keys that resolve to no issue are silently dropped — that resolution step is
 * what keeps prose like COVID-19 out of the table.
 */
async function syncPageIssueLinks(db, pageId, html) {
  const keys = extractIssueKeys(html);
  await run(db, 'DELETE FROM wiki_page_issues WHERE page_id = ?', [pageId]);
  if (keys.length === 0) return [];

  const rows = await queryAll(db,
    `SELECT id FROM issues WHERE issue_key IN (${placeholders(keys)})`, keys);
  for (const r of rows) {
    await run(db, 'INSERT INTO wiki_page_issues (page_id, issue_id) VALUES (?, ?)', [pageId, r.id]);
  }
  return rows.map((r) => r.id);
}

/**
 * Rebuilds links for every current page. For deployments that predate this
 * feature, whose pages have no rows until they happen to be re-saved.
 * Idempotent — syncPageIssueLinks replaces each page's set.
 */
async function backfillPageIssueLinks(db) {
  const pages = await queryAll(db, "SELECT id, body FROM wiki_pages WHERE status = 'current'");
  for (const page of pages) {
    await syncPageIssueLinks(db, page.id, page.body || '');
  }
  return pages.length;
}

module.exports = { extractIssueKeys, syncPageIssueLinks, backfillPageIssueLinks };
