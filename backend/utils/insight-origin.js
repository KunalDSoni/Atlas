// ===== INSIGHT ORIGIN RESOLUTION =====
// Turns an (origin_kind, origin_id) pair into verified capture material: a
// title, an excerpt snapshot, and — where the source knows one — the customer
// the feedback came from.
//
// Two rules this file exists to enforce:
//
//   1. The caller must be allowed to see the source. Product routes are
//      staff-only, but "staff" does not imply "may read every restricted wiki
//      page", so wiki captures delegate to the same pageAccess() the wiki
//      routes use rather than reimplementing restriction logic — two
//      implementations of one rule is how they eventually disagree.
//
//   2. The excerpt is a SNAPSHOT, not a join. Sources get edited and deleted;
//      evidence that silently rewrites itself is not evidence, and a
//      prioritisation decision made on a quote that no longer exists cannot be
//      audited.

const { queryOne } = require('../database');

const ORIGIN_KINDS = ['request', 'comment', 'wiki', 'portal', 'manual'];

// Excerpts are stored, listed, and rendered in an inbox table row. Long enough
// to carry the point, short enough not to bloat the list payload.
const MAX_EXCERPT = 500;

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function excerptOf(s) {
  const text = stripHtml(s);
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 1)}…` : text;
}

// A source authored by someone with a matching pb_customers row attributes the
// insight to that customer. No match is not an error — it is an unattributed
// insight, which epic 48 counts separately rather than folding into demand.
async function customerForUser(db, userId) {
  if (!userId) return null;
  const row = await queryOne(db,
    `SELECT cu.id FROM users u JOIN pb_customers cu ON LOWER(cu.email) = LOWER(u.email)
     WHERE u.id = ?`, [userId]);
  return row ? row.id : null;
}

async function resolveOrigin(db, kind, originId, userId, userRole) {
  if (!ORIGIN_KINDS.includes(kind)) {
    return { ok: false, status: 400, error: `origin_kind must be one of: ${ORIGIN_KINDS.join(', ')}` };
  }
  // 'portal' is stamped by routes/portal.js on the insight it already creates,
  // and 'manual' is the plain POST /product/insights form. Neither has a
  // separate source row to resolve.
  if (kind === 'manual' || kind === 'portal') {
    return { ok: false, status: 400, error: `${kind} insights are not captured through this endpoint` };
  }
  if (!originId) return { ok: false, status: 400, error: 'origin_id required' };

  if (kind === 'request') {
    const issue = await queryOne(db,
      'SELECT id, title, description, reporter_id, type FROM issues WHERE id = ?', [originId]);
    if (!issue) return { ok: false, status: 404, error: 'Request not found' };
    if (issue.type !== 'request') {
      return { ok: false, status: 400, error: 'Issue is not a service desk request' };
    }
    return {
      ok: true,
      title: issue.title,
      excerpt: excerptOf(issue.description),
      customer_id: await customerForUser(db, issue.reporter_id),
    };
  }

  if (kind === 'comment') {
    const comment = await queryOne(db,
      `SELECT c.id, c.body, c.author_id, i.title AS issue_title
       FROM comments c JOIN issues i ON c.issue_id = i.id
       WHERE c.id = ?`, [originId]);
    if (!comment) return { ok: false, status: 404, error: 'Comment not found' };
    return {
      ok: true,
      title: comment.issue_title,
      excerpt: excerptOf(comment.body),
      customer_id: await customerForUser(db, comment.author_id),
    };
  }

  // kind === 'wiki'
  const page = await queryOne(db, 'SELECT id, title, body FROM wiki_pages WHERE id = ?', [originId]);
  if (!page) return { ok: false, status: 404, error: 'Page not found' };

  // Required inside the function, not at module scope: routes/wiki.js requires
  // this module's siblings at load time, and a top-level require here resolves
  // to an empty object once the test harness clears the require cache.
  const { pageAccess } = require('../routes/wiki');
  const access = await pageAccess(db, originId, userId, userRole);
  if (!access || !access.view) {
    return { ok: false, status: 403, error: 'This page is restricted' };
  }
  return { ok: true, title: page.title, excerpt: excerptOf(page.body), customer_id: null };
}

module.exports = { ORIGIN_KINDS, resolveOrigin, excerptOf, stripHtml, MAX_EXCERPT };
