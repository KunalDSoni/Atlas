// Notification fan-out helpers. Fire-and-forget: notification failures must never
// fail the request that triggered them — callers should not await-and-throw.

const { v4: uuidv4 } = require('uuid');
const { run, queryAll, queryOne } = require('../database');
const { sendNotificationEmail } = require('./email');

/** Insert one notification; silently skips self-notification. Also delivers an
 *  email best-effort (a no-op when SMTP is unconfigured or the user opted out). */
async function notify(db, { userId, actorId, type, message, link, issueId, wikiPageId }) {
  if (!userId || userId === actorId) return;
  try {
    await run(db, `INSERT INTO notifications (id, user_id, actor_id, type, message, link, issue_id, wiki_page_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, actorId || null, type, message, link || null, issueId || null, wikiPageId || null]);

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
