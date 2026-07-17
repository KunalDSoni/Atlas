// Notification fan-out helpers. Fire-and-forget: notification failures must never
// fail the request that triggered them — callers should not await-and-throw.

const { v4: uuidv4 } = require('uuid');
const { run, queryAll } = require('../database');

/** Insert one notification; silently skips self-notification. */
async function notify(db, { userId, actorId, type, message, link, issueId, wikiPageId }) {
  if (!userId || userId === actorId) return;
  try {
    await run(db, `INSERT INTO notifications (id, user_id, actor_id, type, message, link, issue_id, wiki_page_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, actorId || null, type, message, link || null, issueId || null, wikiPageId || null]);
  } catch (e) { console.error('notify failed:', e.message); }
}

/**
 * Parse @mentions out of free text against the user table.
 * Matches @First (case-insensitive first name) and @First Last (full name).
 * Returns unique user ids, excluding the author.
 */
async function mentionedUserIds(db, text, authorId) {
  if (!text || !text.includes('@')) return [];
  const users = await queryAll(db, 'SELECT id, name FROM users WHERE is_active = 1');
  const lower = text.toLowerCase();
  const hits = new Set();
  for (const u of users) {
    if (u.id === authorId) continue;
    const full = u.name.toLowerCase();
    const first = full.split(/\s+/)[0];
    if (lower.includes(`@${full}`) || lower.includes(`@${first}`)) hits.add(u.id);
  }
  return [...hits];
}

module.exports = { notify, mentionedUserIds };
