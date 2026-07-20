// ===== WIKI TASK LISTS =====
// A list item beginning with `[ ]` or `[x]` is a task. Their checked state
// lives in wiki_page_tasks, NOT in the page body: ticking a box would otherwise
// rewrite the body, bumping the page version, spamming version history, and
// staling the page's approval — for something that is not an editorial change.
//
// That split needs a task identity that is stable across edits, which is what
// taskKey provides.

const crypto = require('crypto');

// A task item: marker at the very start of the list item's text.
const TASK_RE = /^\[( |x|X)\]\s*(.*)$/;

/**
 * Identity for a task: a hash of its text plus its occurrence index among
 * tasks with identical text.
 *
 * Keying on text rather than position means reordering a list keeps each
 * checkmark with its own task. The tradeoff is deliberate and the safer of the
 * two: editing a task's wording mints a new key, so its checked state resets
 * rather than silently carrying over to what is now different work.
 */
function taskKey(text, occurrence) {
  const norm = String(text).trim().replace(/\s+/g, ' ').toLowerCase();
  const hash = crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
  return `${hash}-${occurrence}`;
}

/**
 * Tasks in a page body, in document order.
 * Returns [{ key, text, checked }] — `checked` here is only the marker written
 * in the body; the authoritative state comes from wiki_page_tasks.
 */
function extractTasks(html) {
  if (typeof html !== 'string' || !html) return [];

  const items = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
  const seen = new Map();
  const tasks = [];

  for (const item of items) {
    // Inner text only: strip tags so inline markup doesn't break the marker
    // match or leak into the task text.
    const inner = item
      .replace(/^<li\b[^>]*>/i, '')
      .replace(/<\/li>$/i, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim();

    const m = inner.match(TASK_RE);
    if (!m) continue;

    const text = m[2].trim();
    if (!text) continue;

    const norm = text.replace(/\s+/g, ' ').toLowerCase();
    const occurrence = seen.get(norm) || 0;
    seen.set(norm, occurrence + 1);

    tasks.push({
      key: taskKey(text, occurrence),
      text,
      checked: m[1].toLowerCase() === 'x',
    });
  }
  return tasks;
}

module.exports = { extractTasks, taskKey };
