// ===== ISSUE KEY EXTRACTION =====
// Finds issue keys (ATLAS-29) in wiki page HTML so pages can be linked to the
// issues they mention. Deliberately naive about what a key means: anything
// matching the pattern is returned, and the caller resolves it against the
// issues table. That resolution is what stops prose like COVID-19 or ISO-8601
// from becoming a link.

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

// Keys inside code samples and existing links are not references. Mirrors the
// exclusion applyMacros already applies client-side (rich-text.tsx).
const EXCLUDED_BLOCKS_RE = /<(code|pre|a)\b[^>]*>[\s\S]*?<\/\1>/gi;

const TAG_RE = /<[^>]+>/g;

/** Deduped issue keys mentioned in a page body, in document order. */
function extractIssueKeys(html) {
  if (typeof html !== 'string' || !html) return [];
  // Drop excluded blocks, then all remaining markup, so attribute values and
  // tag names can never be mistaken for prose.
  const text = html.replace(EXCLUDED_BLOCKS_RE, ' ').replace(TAG_RE, ' ');
  return [...new Set(text.match(ISSUE_KEY_RE) || [])];
}

module.exports = { extractIssueKeys };
