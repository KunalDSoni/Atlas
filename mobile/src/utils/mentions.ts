// ===== MENTION TOKENS =====
// A mention is a reference to a user id, not a display name:
//
//     @[Kunal Soni](user:8f3c1d20-4e5a-4c1b-9f2e-7a6b5c4d3e2f)
//
// The id is authoritative and the name is a readable fallback for anywhere the
// renderer does not run. Matching on names instead (the previous approach)
// could not tell two people apart, broke when someone was renamed, and treated
// foo@bar.com as a mention.
//
// Mirrors backend/utils/mentions.js and frontend/src/lib/mentions.ts — three
// package roots with no shared build. docs/mention-test-vectors.json drives all
// three test suites, so a drifting implementation fails its own tests. Change
// the fixture, not one copy.

export interface MentionUser {
  id: string;
  name: string;
}

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; id: string; name: string };

/** Display: 1-100 chars, no ']' (the delimiter) and no newline. Id: url-safe. */
export const MENTION_RE = /@\[([^\]\n]{1,100})\]\(user:([A-Za-z0-9_-]{1,64})\)/g;

/** The HTML form, written into wiki page bodies by the rich-text editor. */
export const MENTION_SPAN_RE = /data-mention-id=["']([A-Za-z0-9_-]{1,64})["']/g;

/** Longest query we will keep an autocomplete open for. */
const MAX_QUERY = 50;

/** Characters that may precede '@' for it to open a mention. Anything else —
 *  a letter, a digit — means it is part of a word, e.g. an email address. */
function canTriggerAfter(ch: string | undefined): boolean {
  return ch === undefined || /[\s([]/.test(ch);
}

/**
 * Unique user ids referenced by `text`, in the order they first appear.
 *
 * Two shapes count. Plain-text fields store the token; HTML fields (wiki page
 * bodies) store a `data-mention-id` span. Callers see both kinds of body and
 * cannot always tell them apart, so both are scanned here.
 */
export function parseMentionIds(text: string | null | undefined): string[] {
  if (!text || typeof text !== 'string' || !text.includes('@')) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const collect = (re: RegExp, group: number) => {
    for (const m of text.matchAll(re)) {
      const id = m[group];
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  };
  collect(MENTION_RE, 2);
  if (text.includes('data-mention-id')) collect(MENTION_SPAN_RE, 1);
  return ids;
}

/** Split `text` into ordered text and mention segments for rendering. */
export function tokenizeMentions(text: string | null | undefined): MentionSegment[] {
  if (!text || typeof text !== 'string') return [];
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index! > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push({ type: 'mention', id: m[2], name: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Replace tokens with their readable '@Name' form. Use this anywhere stored
 *  text is shown without going through the renderer: previews, titles, exports. */
export function stripMentionSyntax(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return '';
  return text.replace(MENTION_RE, (_full, name: string) => `@${name}`);
}

/**
 * The in-progress '@query' immediately before `caret`, or null when the caret
 * is not inside one. Shared by the picker and insertMention so the trigger
 * rules cannot disagree between detecting and completing a mention.
 */
export function findMentionQuery(
  text: string | null | undefined,
  caret: number,
): { start: number; query: string } | null {
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

/**
 * Expand legacy plain-text mentions inside already-tokenized segments.
 *
 * Content written before mentions carried ids still says "@Kunal Soni". Both
 * the full name and the first name are candidates, longest first, and a name is
 * only honoured when exactly one active user answers to it — two people called
 * Sarah Chen means the text stays prose rather than pointing at the wrong one.
 * A matched span is consumed even when ambiguous, so "@Sarah Chen" cannot fall
 * through and resolve to an unrelated user merely called Sarah.
 *
 * Mirrors legacyMentionIds in backend/utils/notify.js — the render and the
 * notification must agree on who was mentioned.
 *
 * @param nameIndex lowercase name (full or first) to the ids answering to it
 */
export function expandLegacyMentions(
  segments: MentionSegment[],
  nameIndex: Map<string, string[]>,
): MentionSegment[] {
  if (nameIndex.size === 0) return segments;
  const names = [...nameIndex.keys()].sort((a, b) => b.length - a.length);

  return segments.flatMap((seg): MentionSegment[] => {
    if (seg.type !== 'text' || !seg.value.includes('@')) return [seg];

    const text = seg.value;
    const lower = text.toLowerCase();
    // id at a matched span, or null when the name was ambiguous (consumed, but
    // rendered as prose).
    const found: Array<{ at: number; end: number; id: string | null; label: string }> = [];
    const consumed = new Array(text.length).fill(false);

    for (const name of names) {
      const needle = `@${name}`;
      let from = 0;
      for (;;) {
        const at = lower.indexOf(needle, from);
        if (at === -1) break;
        const end = at + needle.length;
        from = end;

        let overlaps = false;
        for (let i = at; i < end; i++) if (consumed[i]) { overlaps = true; break; }
        if (overlaps) continue;

        const prev = at > 0 ? text[at - 1] : undefined;
        if (prev !== undefined && !/[\s([]/.test(prev)) continue;
        if (text[end] !== undefined && /\w/.test(text[end])) continue;

        for (let i = at; i < end; i++) consumed[i] = true;
        const ids = nameIndex.get(name)!;
        found.push({ at, end, id: ids.length === 1 ? ids[0] : null, label: text.slice(at, end) });
      }
    }

    if (found.length === 0) return [seg];
    found.sort((a, b) => a.at - b.at);

    const out: MentionSegment[] = [];
    let cursor = 0;
    for (const hit of found) {
      if (hit.at > cursor) out.push({ type: 'text', value: text.slice(cursor, hit.at) });
      if (hit.id) out.push({ type: 'mention', id: hit.id, name: hit.label.slice(1) });
      else out.push({ type: 'text', value: hit.label });
      cursor = hit.end;
    }
    if (cursor < text.length) out.push({ type: 'text', value: text.slice(cursor) });
    return out;
  });
}

/** Build the stored token for a user. The display name is a fallback only, so
 *  neutralising the delimiters costs nothing and stops a crafted name from
 *  closing the token early and forging a second one. */
export function formatMention(user: MentionUser): string {
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
export function insertMention(
  text: string,
  caret: number,
  user: MentionUser,
): { text: string; caret: number } {
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
