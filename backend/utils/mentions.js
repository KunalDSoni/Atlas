// ===== MENTION TOKENS =====
// A mention is a reference to a user id, not a display name:
//
//     @[Kunal Soni](user:8f3c1d20-4e5a-4c1b-9f2e-7a6b5c4d3e2f)
//
// The id is authoritative and the name is a readable fallback for anywhere the
// renderer does not run — emails, push payloads, exports, search. Matching on
// names instead (the previous approach) could not tell two people apart, broke
// when someone was renamed, and treated foo@bar.com as a mention.
//
// This module is duplicated in frontend/src/lib/mentions.ts and
// mobile/src/utils/mentions.ts — three package roots with no shared build.
// docs/mention-test-vectors.json drives all three test suites, so a drifting
// implementation fails its own tests. Change the fixture, not one copy.

/** Display: 1-100 chars, no ']' (the delimiter) and no newline. Id: url-safe. */
const MENTION_RE = /@\[([^\]\n]{1,100})\]\(user:([A-Za-z0-9_-]{1,64})\)/g;

/** Longest query we will keep an autocomplete open for. */
const MAX_QUERY = 50;

/** Characters that may precede '@' for it to open a mention. Anything else —
 *  a letter, a digit — means it is part of a word, e.g. an email address. */
function canTriggerAfter(ch) {
  return ch === undefined || /[\s([]/.test(ch);
}

/** Unique user ids referenced by `text`, in the order they first appear. */
function parseMentionIds(text) {
  if (!text || typeof text !== 'string' || !text.includes('@[')) return [];
  const ids = [];
  const seen = new Set();
  for (const m of text.matchAll(MENTION_RE)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    ids.push(m[2]);
  }
  return ids;
}

/** Split `text` into ordered text and mention segments for rendering. */
function tokenizeMentions(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push({ type: 'mention', id: m[2], name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Replace tokens with their readable '@Name' form. Use this anywhere stored
 *  text reaches a user without going through the renderer: notification
 *  messages, email bodies, push payloads, card previews, exports. */
function stripMentionSyntax(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(MENTION_RE, (_full, name) => `@${name}`);
}

/**
 * The in-progress '@query' immediately before `caret`, or null when the caret
 * is not inside one. Shared by the picker and insertMention so the trigger
 * rules cannot disagree between detecting and completing a mention.
 */
function findMentionQuery(text, caret) {
  if (!text || typeof text !== 'string' || caret <= 0) return null;

  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') { at = i; break; }
    // A newline always ends a mention. So does a second space: one is allowed
    // so "@John Doe" can be typed, but two means this is ordinary prose.
    if (ch === '\n') return null;
    if (caret - i > MAX_QUERY + 1) return null;
  }
  if (at < 0) return null;
  if (!canTriggerAfter(text[at - 1])) return null;

  const query = text.slice(at + 1, caret);
  if (query.length > MAX_QUERY) return null;
  if (query.includes('\n')) return null;
  if ((query.match(/ /g) || []).length > 1) return null;
  // '[' means a completed token starts here, not a query being typed.
  if (query.startsWith('[')) return null;

  return { start: at, query };
}

/** Build the stored token for a user. The display name is a fallback only, so
 *  neutralising the delimiters costs nothing and stops a crafted name from
 *  closing the token early and forging a second one. */
function formatMention(user) {
  const name = String(user.name || '')
    .replace(/[\]\n]/g, (c) => (c === '\n' ? ' ' : ''))
    .slice(0, 100)
    .trim();
  return `@[${name}](user:${user.id})`;
}

/**
 * Complete the mention at `caret`, returning the new body and caret position.
 * Leaves the text untouched when no query is active.
 */
function insertMention(text, caret, user) {
  const found = findMentionQuery(text, caret);
  if (!found) return { text, caret };

  const token = formatMention(user);
  const before = text.slice(0, found.start);
  const after = text.slice(caret);
  // Only add a separator when the caller is not already sitting on one.
  const needsSpace = !after.startsWith(' ');
  const next = `${before}${token}${needsSpace ? ' ' : ''}${after}`;
  return { text: next, caret: before.length + token.length + (needsSpace ? 1 : 0) };
}

module.exports = {
  MENTION_RE,
  parseMentionIds,
  tokenizeMentions,
  stripMentionSyntax,
  findMentionQuery,
  formatMention,
  insertMention,
};
