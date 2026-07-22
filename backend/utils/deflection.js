// ===== KB DEFLECTION — the customer-facing wiki boundary =====
//
// This is the only place wiki content is served to a `client`, so it is the
// wave's widest leak surface. Two rules make it safe, and both live here rather
// than in the route so no future endpoint can serve suggestions without them:
//
//   1. CURATION BOUNDS THE SEARCH. A request type's suggestions may only come
//      from spaces an admin curated an article into. A type with no curated
//      articles suggests NOTHING. The spec calls this "spaces the request type
//      draws from"; deriving those spaces from the curation table means there
//      is no separate setting to get wrong, and the default is closed.
//   2. ONLY PUBLISHED, UNRESTRICTED PAGES. `status='current'` excludes drafts,
//      archived and trashed pages; anything with a row in
//      `wiki_page_restrictions` is excluded outright — a restricted page has an
//      explicit reader list, and a customer is never on it.
//
// The same query answers "may this customer see this page?", so
// `suggestionsFor()` and `isSuggestible()` cannot drift apart.

const { queryAll, queryOne } = require('../database');

const MAX_SUGGESTIONS = 3;
const EXCERPT_CHARS = 180;

/** Strips wiki HTML down to a plain-text lead-in for the suggestion card. */
function excerpt(body) {
  return String(body || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EXCERPT_CHARS);
}

/** The projection a customer sees. An allow-list, like toPublicRequest(). */
function toPublicArticle(page) {
  return { id: page.id, title: page.title, slug: page.slug, excerpt: excerpt(page.body) };
}

/**
 * The visibility predicate, as SQL over alias `pg`.
 * Kept as one string so every caller applies exactly the same rules.
 */
const VISIBLE = `pg.status = 'current'
  AND NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = pg.id)`;

/** The spaces a request type draws from — i.e. where its curated articles live. */
async function curatedSpaceIds(db, requestTypeId) {
  const rows = await queryAll(db,
    `SELECT DISTINCT pg.space_id AS space_id
       FROM sd_type_articles ta JOIN wiki_pages pg ON pg.id = ta.page_id
      WHERE ta.request_type_id = ? AND ${VISIBLE}`, [requestTypeId]);
  return rows.map((r) => r.space_id);
}

/**
 * Up to three suggestions: curated articles first, then a text search bounded
 * to the curated spaces. Returns [] for an uncurated request type.
 */
async function suggestionsFor(db, requestTypeId, query) {
  if (!requestTypeId) return [];

  const curated = await queryAll(db,
    `SELECT pg.id, pg.title, pg.slug, pg.body
       FROM sd_type_articles ta JOIN wiki_pages pg ON pg.id = ta.page_id
      WHERE ta.request_type_id = ? AND ${VISIBLE}
      ORDER BY ta.position, pg.title`, [requestTypeId]);

  const picked = [];
  const seen = new Set();
  const q = String(query || '').trim().toLowerCase();

  // A curated article is a deliberate answer to this request type, so it ranks
  // above anything the text search turns up — but when the customer has typed
  // something, curated articles that match it come first among those.
  const ranked = q
    ? [...curated].sort((a, b) => Number(b.title.toLowerCase().includes(q)) - Number(a.title.toLowerCase().includes(q)))
    : curated;
  for (const page of ranked) {
    if (picked.length >= MAX_SUGGESTIONS) break;
    picked.push(page); seen.add(page.id);
  }

  const spaceIds = await curatedSpaceIds(db, requestTypeId);
  if (picked.length < MAX_SUGGESTIONS && q && spaceIds.length > 0) {
    const like = `%${q}%`;
    const holes = spaceIds.map(() => '?').join(',');
    const found = await queryAll(db,
      `SELECT pg.id, pg.title, pg.slug, pg.body
         FROM wiki_pages pg
        WHERE pg.space_id IN (${holes}) AND ${VISIBLE}
          AND (LOWER(pg.title) LIKE ? OR LOWER(pg.body) LIKE ?)
        ORDER BY pg.view_count DESC, pg.title
        LIMIT ?`, [...spaceIds, like, like, MAX_SUGGESTIONS * 2]);
    for (const page of found) {
      if (picked.length >= MAX_SUGGESTIONS) break;
      if (seen.has(page.id)) continue;
      picked.push(page); seen.add(page.id);
    }
  }

  return picked.map(toPublicArticle);
}

/**
 * Could this page have been suggested for this request type?
 *
 * Guards hit logging. Without it the hits endpoint is an oracle: post page ids
 * until one returns 201 and the wiki is enumerated.
 */
async function isSuggestible(db, requestTypeId, pageId) {
  if (!requestTypeId || !pageId) return false;
  const curated = await queryOne(db,
    `SELECT pg.id FROM sd_type_articles ta JOIN wiki_pages pg ON pg.id = ta.page_id
      WHERE ta.request_type_id = ? AND pg.id = ? AND ${VISIBLE}`, [requestTypeId, pageId]);
  if (curated) return true;

  const spaceIds = await curatedSpaceIds(db, requestTypeId);
  if (spaceIds.length === 0) return false;
  const holes = spaceIds.map(() => '?').join(',');
  const inSpace = await queryOne(db,
    `SELECT pg.id FROM wiki_pages pg
      WHERE pg.id = ? AND pg.space_id IN (${holes}) AND ${VISIBLE}`, [pageId, ...spaceIds]);
  return !!inSpace;
}

module.exports = { MAX_SUGGESTIONS, excerpt, toPublicArticle, suggestionsFor, isSuggestible };
