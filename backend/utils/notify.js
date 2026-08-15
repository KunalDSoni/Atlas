// Notification fan-out helpers. Fire-and-forget: notification failures must never
// fail the request that triggered them — callers should not await-and-throw.

const { v4: uuidv4 } = require('uuid');
const { run, queryAll, queryOne } = require('../database');
const { sendNotificationEmail } = require('./email');
const { publish } = require('./events');
const { parseMentionIds } = require('./mentions');

/** Insert one notification; silently skips self-notification. Also delivers an
 *  email best-effort (a no-op when SMTP is unconfigured or the user opted out). */
async function notify(db, { userId, actorId, type, message, link, issueId, wikiPageId }) {
  if (!userId || userId === actorId) return;
  try {
    await run(db, `INSERT INTO notifications (id, user_id, actor_id, type, message, link, issue_id, wiki_page_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, actorId || null, type, message, link || null, issueId || null, wikiPageId || null]);

    // Live push to the recipient's open SSE connections (bell updates instantly).
    publish({ type: 'notification', userId, notificationType: type, message });

    // Email fan-out — never blocks or fails the request.
    try {
      const recipient = await queryOne(db,
        `SELECT u.email, u.name, s.email_notifications, s.notify_assigned, s.notify_mentions,
                s.notify_comments, s.notify_status_changes
         FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
         WHERE u.id = ? AND u.is_active = 1`, [userId]);
      const actor = actorId ? await queryOne(db, 'SELECT name FROM users WHERE id = ?', [actorId]) : null;
      if (recipient) await sendNotificationEmail(recipient, { type, message, link, actorName: actor?.name });
    } catch (e) { console.error('notify email failed:', e.message); }
  } catch (e) { console.error('notify failed:', e.message); }
}

/**
 * Ids referenced by legacy plain-text mentions — content written before
 * mentions carried a user id. Both the full name and the first name are
 * candidates, longest first, and a name is only honoured when exactly one
 * active user answers to it. Two people called Sarah Chen means neither is
 * notified, which is the correct answer: guessing would notify the wrong one.
 *
 * A matched span is consumed even when it was ambiguous, so "@Sarah Chen"
 * cannot fall through and notify an unrelated user merely called Sarah.
 */
function legacyMentionIds(text, users) {
  const byName = new Map();
  for (const u of users) {
    for (const key of [u.name.toLowerCase(), u.name.toLowerCase().split(/\s+/)[0]]) {
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      if (!byName.get(key).includes(u.id)) byName.get(key).push(u.id);
    }
  }

  const lower = text.toLowerCase();
  const consumed = new Array(text.length).fill(false);
  const hits = [];

  for (const name of [...byName.keys()].sort((a, b) => b.length - a.length)) {
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

      // Same trigger rule as the picker: '@' mid-word is not a mention, so
      // sarah@example.com never resolves to Sarah.
      const prev = at > 0 ? text[at - 1] : undefined;
      if (prev !== undefined && !/[\s([]/.test(prev)) continue;
      // And the name must end at a boundary, so "@Sam" does not match "@Sammy".
      if (text[end] !== undefined && /\w/.test(text[end])) continue;

      for (let i = at; i < end; i++) consumed[i] = true;
      const ids = byName.get(name);
      if (ids.length === 1) hits.push(ids[0]);
    }
  }
  return hits;
}

/**
 * Users referenced by `text`, in document order, excluding the author and
 * anyone deactivated. Token mentions resolve by id; legacy plain-text mentions
 * fall back to unambiguous name matching.
 *
 * Options:
 *   allowClients — false suppresses client-role recipients. Used for internal
 *     service-desk notes: a client cannot see one, so notifying them would
 *     reveal it exists and link them to something they cannot open.
 */
async function mentionedUserIds(db, text, authorId, opts = {}) {
  if (!text || typeof text !== 'string' || !text.includes('@')) return [];
  const { allowClients = true } = opts;

  const users = await queryAll(db, 'SELECT id, name, role FROM users WHERE is_active = 1');
  const active = new Map(users.map((u) => [u.id, u]));

  const ids = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id) || id === authorId) return;
    const user = active.get(id);
    if (!user) return; // unknown id, or the account is deactivated
    if (!allowClients && user.role === 'client') return;
    seen.add(id);
    ids.push(id);
  };

  for (const id of parseMentionIds(text)) add(id);
  for (const id of legacyMentionIds(text, users)) add(id);
  return ids;
}

/**
 * Retained for callers that pass a project id positionally. Membership no
 * longer filters recipients — mentioning someone outside the project is
 * deliberate and the composer warns about it — so this is a thin alias.
 */
async function mentionedUserIdsInProject(db, text, authorId, _projectId) {
  return mentionedUserIds(db, text, authorId);
}

module.exports = { notify, mentionedUserIds, mentionedUserIdsInProject };
