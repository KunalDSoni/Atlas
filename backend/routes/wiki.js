// ===== WIKI (CONFLUENCE) MODULE =====
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { sanitizeRichText } = require('../utils/sanitize');
const { syncPageIssueLinks } = require('../utils/issue-keys');
const { extractTasks } = require('../utils/wiki-tasks');
const { placeholders } = require('../utils/sql');
const { signWikiImages, unsignWikiImages } = require('./wiki-attachments');
const { notify, mentionedUserIds } = require('../utils/notify');
const router = express.Router();

/**
 * Access for many pages in two queries. The rules live here and nowhere else —
 * pageAccess() below delegates, so the singular and batch paths cannot drift.
 */
async function pageAccessBatch(db, pageIds, userId, userRole) {
  const result = new Map();
  if (pageIds.length === 0) return result;

  const ph = placeholders(pageIds);
  const [rows, pages] = await Promise.all([
    queryAll(db, `SELECT page_id, user_id, can_edit FROM wiki_page_restrictions WHERE page_id IN (${ph})`, pageIds),
    queryAll(db, `SELECT id, author_id FROM wiki_pages WHERE id IN (${ph})`, pageIds),
  ]);

  const authorOf = new Map(pages.map((p) => [p.id, p.author_id]));
  const byPage = new Map();
  for (const r of rows) {
    if (!byPage.has(r.page_id)) byPage.set(r.page_id, []);
    byPage.get(r.page_id).push(r);
  }

  const isAdmin = userRole === 'admin';
  for (const pageId of pageIds) {
    const pageRows = byPage.get(pageId) || [];
    // A page with no restriction rows — including one that does not exist — is
    // open. This matches the pre-refactor behaviour exactly.
    if (pageRows.length === 0) {
      result.set(pageId, { view: true, edit: true, restricted: false });
      continue;
    }
    const isOwner = authorOf.has(pageId) && authorOf.get(pageId) === userId;
    if (isOwner || isAdmin) {
      result.set(pageId, { view: true, edit: true, restricted: true });
      continue;
    }
    const mine = pageRows.find((r) => r.user_id === userId);
    if (!mine) {
      result.set(pageId, { view: false, edit: false, restricted: true });
      continue;
    }
    const anyEditRows = pageRows.some((r) => Number(r.can_edit) === 1);
    result.set(pageId, {
      view: true,
      edit: anyEditRows ? Number(mine.can_edit) === 1 : true,
      restricted: true,
    });
  }
  return result;
}

// ===== PAGE RESTRICTIONS =====
// Rows grant access: a page with any restriction rows is visible only to the
// listed users, its author, and admins. can_edit=1 rows additionally gate editing.
async function pageAccess(db, pageId, userId, userRole) {
  const map = await pageAccessBatch(db, [pageId], userId, userRole);
  return map.get(pageId);
}


// ===== SPACES =====
router.get('/wiki/spaces', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const spaces = await queryAll(db, `
      SELECT s.*, u.name as owner_name, u.avatar_color as owner_color,
        (SELECT COUNT(*) FROM wiki_pages WHERE space_id = s.id AND status = 'current') as page_count,
        EXISTS(SELECT 1 FROM wiki_stars WHERE space_id = s.id AND user_id = ?) as starred
      FROM wiki_spaces s LEFT JOIN users u ON s.owner_id = u.id ORDER BY s.name
    `, [req.userId]);
    res.json(spaces);
  } catch (e) { serverError(res, e); }
});

router.post('/wiki/spaces', requireAuth, async (req, res) => {
  try {
    const { name, space_key, key, description, icon, color } = req.body;
    const spaceKey = space_key || key;
    if (!name || !spaceKey) return res.status(400).json({ error: 'Name and key required' });
    const db = await getDb();
    const id = uuidv4();
    await run(db, "INSERT INTO wiki_spaces (id, space_key, name, description, icon, color, owner_id) VALUES (?,?,?,?,?,?,?)",
      [id, spaceKey.toUpperCase(), name, description || '', icon || '📄', color || '#0c66e4', req.userId]);
    const space = await queryOne(db, 'SELECT * FROM wiki_spaces WHERE id = ?', [id]);
    res.status(201).json(space);
  } catch (e) { serverError(res, e); }
});

router.get('/wiki/spaces/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const space = await queryOne(db, 'SELECT s.*, u.name as owner_name FROM wiki_spaces s LEFT JOIN users u ON s.owner_id = u.id WHERE s.id = ?', [req.params.id]);
    if (!space) return res.status(404).json({ error: 'Space not found' });
    res.json(space);
  } catch (e) { serverError(res, e); }
});

router.put('/wiki/spaces/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, description, icon, color } = req.body;
    const updates = []; const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
    if (color !== undefined) { updates.push('color = ?'); params.push(color); }
    if (updates.length) { updates.push("updated_at = datetime('now')"); params.push(req.params.id); await run(db, `UPDATE wiki_spaces SET ${updates.join(', ')} WHERE id = ?`, params); }
    res.json(await queryOne(db, 'SELECT * FROM wiki_spaces WHERE id = ?', [req.params.id]));
  } catch (e) { serverError(res, e); }
});

router.delete('/wiki/spaces/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pages = await queryAll(db, 'SELECT id FROM wiki_pages WHERE space_id = ?', [req.params.id]);
    for (const p of pages) {
      await run(db, 'DELETE FROM wiki_page_comments WHERE page_id = ?', [p.id]);
      await run(db, 'DELETE FROM wiki_page_versions WHERE page_id = ?', [p.id]);
      await run(db, 'DELETE FROM wiki_labels WHERE page_id = ?', [p.id]);
      await run(db, 'DELETE FROM wiki_stars WHERE page_id = ?', [p.id]);
      await run(db, 'DELETE FROM wiki_page_likes WHERE page_id = ?', [p.id]);
    }
    await run(db, 'DELETE FROM wiki_pages WHERE space_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_templates WHERE space_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_stars WHERE space_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_spaces WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ===== PAGES =====
router.get('/wiki/spaces/:spaceId/pages', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const status = req.query.status || 'current';
    const pages = await queryAll(db, `
      SELECT p.*, u.name as author_name, u.avatar_color as author_color,
        e.name as editor_name,
        (SELECT COUNT(*) FROM wiki_page_comments WHERE page_id = p.id) as comment_count,
        (SELECT COUNT(*) FROM wiki_page_likes WHERE page_id = p.id) as like_count,
        (SELECT GROUP_CONCAT(label) FROM wiki_labels WHERE page_id = p.id) as labels_str
      FROM wiki_pages p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN users e ON p.last_editor_id = e.id
      WHERE p.space_id = ? AND p.status = ?
      ${req.query.type ? "AND COALESCE(p.page_type,'page') = ?" : ''}
      ORDER BY ${req.query.type === 'blog' ? 'p.created_at DESC' : 'p.position, p.title'}
    `, req.query.type ? [req.params.spaceId, status, req.query.type] : [req.params.spaceId, status]);
    pages.forEach(p => { p.labels = p.labels_str ? p.labels_str.split(',') : []; delete p.labels_str; });
    res.json(pages);
  } catch (e) { serverError(res, e); }
});

router.get('/wiki/pages/recent', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pages = await queryAll(db, `
      SELECT p.*, s.name as space_name, s.space_key, s.icon as space_icon,
        u.name as author_name, u.avatar_color as author_color,
        e.name as editor_name
      FROM wiki_pages p
      JOIN wiki_spaces s ON p.space_id = s.id
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN users e ON p.last_editor_id = e.id
      WHERE p.status = 'current'
      ORDER BY p.updated_at DESC LIMIT 20
    `);
    res.json(pages);
  } catch (e) { serverError(res, e); }
});

router.get('/wiki/pages/starred', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pages = await queryAll(db, `
      SELECT p.*, s.name as space_name, s.space_key, s.icon as space_icon,
        u.name as author_name, u.avatar_color as author_color
      FROM wiki_stars ws
      JOIN wiki_pages p ON ws.page_id = p.id
      JOIN wiki_spaces s ON p.space_id = s.id
      LEFT JOIN users u ON p.author_id = u.id
      WHERE ws.user_id = ? AND p.status = 'current'
      ORDER BY ws.created_at DESC
    `, [req.userId]);
    res.json(pages);
  } catch (e) { serverError(res, e); }
});

router.post('/wiki/spaces/:spaceId/pages', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { title, parent_id, body_format, labels } = req.body;
    const pageType = req.body.page_type === 'blog' ? 'blog' : 'page';
    // User-authored HTML is rendered into other users' browsers — clean it on write.
    // Strip signatures from inline wiki images so persisted content never expires.
    const body = unsignWikiImages(sanitizeRichText(req.body.body));
    if (!title) return res.status(400).json({ error: 'Title required' });
    const id = uuidv4();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const maxPos = await queryOne(db, 'SELECT COALESCE(MAX(position),0)+1 as p FROM wiki_pages WHERE space_id = ? AND parent_id IS ?', [req.params.spaceId, parent_id || null]);
    const maxNum = await queryOne(db, 'SELECT COALESCE(MAX(page_number),0)+1 as n FROM wiki_pages WHERE space_id = ?', [req.params.spaceId]);
    await run(db, `INSERT INTO wiki_pages (id, space_id, parent_id, title, slug, body, body_format, author_id, last_editor_id, position, page_type, page_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.params.spaceId, parent_id || null, title, slug, body || '', body_format || 'html', req.userId, req.userId, maxPos.p, pageType, maxNum.n]);
    await run(db, "INSERT INTO wiki_page_versions (id, page_id, version, title, body, editor_id, change_message) VALUES (?,?,1,?,?,?,'Created')",
      [uuidv4(), id, title, body || '', req.userId]);
    if (labels && Array.isArray(labels)) {
      for (const l of labels) {
        try { await run(db, "INSERT INTO wiki_labels (id, page_id, label) VALUES (?,?,?)", [uuidv4(), id, l.toLowerCase().trim()]); } catch(e){}
      }
    }
    await syncPageIssueLinks(db, id, body || '');
    await notifyPageMentions(db, {
      pageId: id, title, actorId: req.userId, body: body || '', previousBody: '',
    });
    const page = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [id]);
    res.status(201).json(page);
  } catch (e) { serverError(res, e); }
});

/**
 * Notify people newly mentioned in a page body or comment. Only ids absent
 * from `previousBody` are notified, so editing a paragraph next to a mention
 * does not ping that person again.
 */
async function notifyPageMentions(db, { pageId, title, actorId, body, previousBody = '', commentQuote }) {
  const before = new Set(await mentionedUserIds(db, previousBody, actorId));
  const after = await mentionedUserIds(db, body, actorId);
  const fresh = after.filter((id) => !before.has(id));
  if (fresh.length === 0) return;

  const actor = await queryOne(db, 'SELECT name FROM users WHERE id = ?', [actorId]);
  const where = commentQuote ? `a comment on "${title}"` : `"${title}"`;
  for (const userId of fresh) {
    await notify(db, {
      userId,
      actorId,
      type: 'mention',
      message: `${actor?.name || 'Someone'} mentioned you in ${where}`,
      link: `/wiki/page/${pageId}`,
      wikiPageId: pageId,
    });
  }
}

/**
 * Full enrichment for one page: access check, view count, labels, breadcrumb,
 * children, approval, tasks, linked issues, image re-signing. `whereClause`
 * and `params` select the row (by id in one caller, by key in another) —
 * everything after that row lookup is identical between the two callers.
 */
async function getPageDetail(db, req, whereClause, params) {
  const page = await queryOne(db, `
    SELECT p.*, s.name as space_name, s.space_key, s.icon as space_icon, s.id as space_id,
      u.name as author_name, u.avatar_color as author_color,
      e.name as editor_name, e.avatar_color as editor_color,
      (SELECT COUNT(*) FROM wiki_page_likes WHERE page_id = p.id) as like_count,
      EXISTS(SELECT 1 FROM wiki_page_likes WHERE page_id = p.id AND user_id = ?) as liked,
      EXISTS(SELECT 1 FROM wiki_stars WHERE page_id = p.id AND user_id = ?) as starred
    FROM wiki_pages p
    JOIN wiki_spaces s ON p.space_id = s.id
    LEFT JOIN users u ON p.author_id = u.id
    LEFT JOIN users e ON p.last_editor_id = e.id
    WHERE ${whereClause}
  `, [req.userId, req.userId, ...params]);
  if (!page) return { status: 404, body: { error: 'Page not found' } };
  const access = await pageAccess(db, page.id, req.userId, req.userRole);
  if (!access.view) return { status: 403, body: { error: 'This page is restricted' } };
  page.restricted = access.restricted ? 1 : 0;
  page.can_edit_page = access.edit ? 1 : 0;
  page.page_key = `${page.space_key}-WIKI-${page.page_number}`;
  // Increment view
  await run(db, 'UPDATE wiki_pages SET view_count = view_count + 1 WHERE id = ?', [page.id]);
  // Labels
  page.labels = (await queryAll(db, 'SELECT label FROM wiki_labels WHERE page_id = ?', [page.id])).map(l => l.label);
  // Breadcrumb
  const breadcrumb = [];
  let current = page;
  while (current.parent_id) {
    const parent = await queryOne(db, 'SELECT id, title, parent_id FROM wiki_pages WHERE id = ?', [current.parent_id]);
    if (!parent) break;
    breadcrumb.unshift({ id: parent.id, title: parent.title });
    current = parent;
  }
  page.breadcrumb = breadcrumb;
  // Children
  page.children = await queryAll(db, "SELECT id, title, slug, status FROM wiki_pages WHERE parent_id = ? AND status = 'current' ORDER BY position, title", [page.id]);
  page.approval = await pageApproval(db, page);
  page.tasks = await pageTasks(db, page);
  // Issues this page mentions, resolved at write time (see utils/issue-keys.js).
  // Returned inline so chips render on first paint with no extra round trip.
  page.linked_issues = await queryAll(db, `
    SELECT i.id, i.issue_key, i.title, i.status, i.type, i.priority,
           u.name AS assignee_name, u.avatar_color AS assignee_color
    FROM wiki_page_issues l
    JOIN issues i ON i.id = l.issue_id
    LEFT JOIN users u ON u.id = i.assignee_id
    WHERE l.page_id = ?`, [page.id]);
  // Re-sign inline wiki images so the browser can load them for this session.
  page.body = signWikiImages(page.body);
  return { status: 200, body: page };
}

// GET /api/wiki/pages/by-key/:pageKey — resolve a human-readable key
// (DOCS-WIKI-1), the wiki mirror of GET /api/issues/by-key/:key.
router.get('/wiki/pages/by-key/:pageKey', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const key = String(req.params.pageKey).toUpperCase();
    const cut = key.lastIndexOf('-WIKI-');
    if (cut < 0) return res.status(404).json({ error: 'Page not found' });
    const spaceKey = key.slice(0, cut);
    const pageNumber = Number(key.slice(cut + '-WIKI-'.length));
    if (!Number.isInteger(pageNumber)) return res.status(404).json({ error: 'Page not found' });
    const { status, body } = await getPageDetail(
      db, req,
      'UPPER(s.space_key) = ? AND p.page_number = ?',
      [spaceKey, pageNumber]);
    res.status(status).json(body);
  } catch (e) { serverError(res, e); }
});

router.get('/wiki/pages/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { status, body } = await getPageDetail(db, req, 'p.id = ?', [req.params.id]);
    res.status(status).json(body);
  } catch (e) { serverError(res, e); }
});

router.put('/wiki/pages/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const access = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!access.edit) return res.status(403).json({ error: 'You cannot edit this restricted page' });
    const { title, parent_id, status, position, change_message } = req.body;
    const body = req.body.body === undefined ? undefined : unsignWikiImages(sanitizeRichText(req.body.body));
    const updates = []; const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (body !== undefined) { updates.push('body = ?'); params.push(body); }
    if (parent_id !== undefined) { updates.push('parent_id = ?'); params.push(parent_id); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (position !== undefined) { updates.push('position = ?'); params.push(position); }
    if (title !== undefined || body !== undefined) {
      updates.push('version = version + 1');
      updates.push('last_editor_id = ?'); params.push(req.userId);
      const newVersion = page.version + 1;
      await run(db, "INSERT INTO wiki_page_versions (id, page_id, version, title, body, editor_id, change_message) VALUES (?,?,?,?,?,?,?)",
        [uuidv4(), req.params.id, newVersion, title || page.title, body || page.body, req.userId, change_message || '']);
    }
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    await run(db, `UPDATE wiki_pages SET ${updates.join(', ')} WHERE id = ?`, params);

    // Content edits notify the page's watchers.
    if (title !== undefined || body !== undefined) {
      const actor = await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.userId]);
      const watchers = await queryAll(db, 'SELECT user_id FROM wiki_page_watchers WHERE page_id = ?', [req.params.id]);
      for (const w of watchers) {
        await notify(db, {
          userId: w.user_id, actorId: req.userId, type: 'wiki_update',
          message: `${actor?.name || 'Someone'} updated "${title || page.title}"`,
          link: `/wiki/page/${req.params.id}`, wikiPageId: req.params.id,
        });
      }
    }

    // Only a body edit can change which issues, or which people, the page mentions.
    if (body !== undefined) {
      await syncPageIssueLinks(db, req.params.id, body);
      await notifyPageMentions(db, {
        pageId: req.params.id,
        title: title || page.title,
        actorId: req.userId,
        body,
        previousBody: page.body || '',
      });
    }

    // A rename bumps the version but does not change what a reviewer read, so
    // carry an existing approval forward rather than letting it read as stale.
    // A body edit deliberately does NOT do this — that is what staleness is for.
    if (body === undefined && title !== undefined
        && page.approved_version !== null && page.approved_version !== undefined
        && Number(page.approved_version) === Number(page.version)) {
      await run(db, 'UPDATE wiki_pages SET approved_version = version WHERE id = ?', [req.params.id]);
    }

    const updated = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { serverError(res, e); }
});

router.delete('/wiki/pages/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const delAccess = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!delAccess.edit) return res.status(403).json({ error: 'You cannot delete this restricted page' });
    // Move children to parent
    const page = await queryOne(db, 'SELECT parent_id FROM wiki_pages WHERE id = ?', [req.params.id]);
    await run(db, 'UPDATE wiki_pages SET parent_id = ? WHERE parent_id = ?', [page?.parent_id || null, req.params.id]);
    await run(db, 'DELETE FROM wiki_page_comments WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_versions WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_labels WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_stars WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_likes WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_issues WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_approvals WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_tasks WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_pages WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ===== TASK LISTS =====
// Tasks are parsed from the body, but their checked state and the issue they
// were converted into live in wiki_page_tasks. Ticking a box is therefore not
// an edit: no version bump, no version-history row, no stale approval.

/** Tasks for a page, merged with their stored state. One query. */
async function pageTasks(db, page) {
  const parsed = extractTasks(page.body || '');
  if (parsed.length === 0) return [];

  const rows = await queryAll(db, `
    SELECT t.task_key, t.checked, t.checked_by, t.checked_at, t.issue_id,
           u.name AS checked_by_name,
           i.issue_key AS issue_key, i.status AS issue_status, i.title AS issue_title
    FROM wiki_page_tasks t
    LEFT JOIN users u ON u.id = t.checked_by
    LEFT JOIN issues i ON i.id = t.issue_id
    WHERE t.page_id = ?`, [page.id]);
  const byKey = new Map(rows.map((r) => [r.task_key, r]));

  return parsed.map((t) => {
    const row = byKey.get(t.key);
    return {
      key: t.key,
      text: t.text,
      // The stored row wins over the body marker: the marker is only what the
      // author typed, the row is what someone actually ticked.
      checked: row ? Number(row.checked) === 1 : t.checked,
      checked_by: row?.checked_by ?? null,
      checked_by_name: row?.checked_by_name ?? null,
      checked_at: row?.checked_at ?? null,
      issue_id: row?.issue_id ?? null,
      issue_key: row?.issue_key ?? null,
      issue_status: row?.issue_status ?? null,
    };
  });
}

// PUT /api/wiki/pages/:id/tasks/:taskKey — tick or untick.
router.put('/wiki/pages/:id/tasks/:taskKey', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT id, body FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    // Viewing is the bar: ticking a checkbox is participation, not authorship.
    const access = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!access.view) return res.status(403).json({ error: 'This page is restricted' });

    // The key must correspond to a task actually present in the body, so a
    // stale or invented key cannot accumulate orphan rows.
    const known = extractTasks(page.body || '').some((t) => t.key === req.params.taskKey);
    if (!known) return res.status(404).json({ error: 'Task not found on this page' });

    const checked = req.body?.checked === true;
    const existing = await queryOne(db,
      'SELECT task_key FROM wiki_page_tasks WHERE page_id = ? AND task_key = ?',
      [req.params.id, req.params.taskKey]);

    if (existing) {
      await run(db, `UPDATE wiki_page_tasks SET checked = ?, checked_by = ?, checked_at = ?
        WHERE page_id = ? AND task_key = ?`,
        [checked ? 1 : 0, checked ? req.userId : null, checked ? nowMs() : null,
          req.params.id, req.params.taskKey]);
    } else {
      await run(db, `INSERT INTO wiki_page_tasks (page_id, task_key, checked, checked_by, checked_at)
        VALUES (?, ?, ?, ?, ?)`,
        [req.params.id, req.params.taskKey, checked ? 1 : 0,
          checked ? req.userId : null, checked ? nowMs() : null]);
    }

    const fresh = await queryOne(db, 'SELECT id, body FROM wiki_pages WHERE id = ?', [req.params.id]);
    const tasks = await pageTasks(db, fresh);
    res.json(tasks.find((t) => t.key === req.params.taskKey));
  } catch (e) { serverError(res, e); }
});

// POST /api/wiki/pages/:id/tasks/:taskKey/convert — turn a task into an issue.
// Idempotent: converting an already-converted task returns the same issue.
router.post('/wiki/pages/:id/tasks/:taskKey/convert', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT id, body FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const access = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!access.view) return res.status(403).json({ error: 'This page is restricted' });

    const task = extractTasks(page.body || '').find((t) => t.key === req.params.taskKey);
    if (!task) return res.status(404).json({ error: 'Task not found on this page' });

    const existing = await queryOne(db,
      'SELECT issue_id FROM wiki_page_tasks WHERE page_id = ? AND task_key = ?',
      [req.params.id, req.params.taskKey]);
    if (existing?.issue_id) {
      const already = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [existing.issue_id]);
      if (already) return res.status(200).json({ issue: already, created: false });
    }

    const projectId = req.body?.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id is required' });
    const project = await queryOne(db, 'SELECT id, key FROM projects WHERE id = ?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const countRow = await queryOne(db, 'SELECT COUNT(*) as count FROM issues WHERE project_id = ?', [projectId]);
    const issueNumber = Number(countRow.count) + 1;
    const issueId = uuidv4();
    await run(db, `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id)
      VALUES (?, ?, ?, ?, ?, ?, 'task', 'todo', 'medium', ?)`,
      [issueId, projectId, `${project.key}-${issueNumber}`, issueNumber, task.text,
        `Created from wiki page task.`, req.userId]);

    if (existing) {
      await run(db, 'UPDATE wiki_page_tasks SET issue_id = ? WHERE page_id = ? AND task_key = ?',
        [issueId, req.params.id, req.params.taskKey]);
    } else {
      await run(db, 'INSERT INTO wiki_page_tasks (page_id, task_key, checked, issue_id) VALUES (?, ?, 0, ?)',
        [req.params.id, req.params.taskKey, issueId]);
    }
    // Register the page↔issue link so the issue's "Mentioned on pages" panel
    // shows where the work came from, without needing the key typed in prose.
    await run(db, 'INSERT INTO wiki_page_issues (page_id, issue_id) VALUES (?, ?)',
      [req.params.id, issueId]);

    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [issueId]);
    res.status(201).json({ issue, created: true });
  } catch (e) { serverError(res, e); }
});

// ===== PAGE APPROVALS =====
// Approval is pinned to the version it covers. An edit does not erase the
// approval — it marks it stale, so a reader can still see who signed off on
// what, and that the page has moved on since.

/** 'YYYY-MM-DD HH:MM:SS.mmm' — matches the stored datetime format at ms
 *  precision, so the append-only log sorts in true insertion order rather than
 *  tying on the second and falling back to a random UUID. */
function nowMs() {
  return new Date().toISOString().slice(0, 23).replace('T', ' ');
}

/** Approval state for a page row (needs its id + current version). */
async function pageApproval(db, page) {
  const empty = {
    approved: false, version: null, stale: false,
    approved_by: null, approved_by_name: null, approved_at: null, note: null,
  };
  if (page.approved_version === null || page.approved_version === undefined) return empty;

  const last = await queryOne(db, `
    SELECT a.user_id, a.version, a.note, a.created_at, u.name AS user_name
    FROM wiki_page_approvals a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.page_id = ? AND a.action = 'approved'
    ORDER BY a.created_at DESC, a.version DESC LIMIT 1`, [page.id]);
  if (!last) return empty;

  return {
    approved: true,
    version: Number(page.approved_version),
    stale: Number(page.approved_version) !== Number(page.version),
    approved_by: last.user_id,
    approved_by_name: last.user_name || null,
    approved_at: last.created_at,
    note: last.note || null,
  };
}

// POST /api/wiki/pages/:id/approve
router.post('/wiki/pages/:id/approve', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT id, version FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    // Approving is an editorial act — gate it on the same rule as editing.
    const access = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!access.edit) return res.status(403).json({ error: 'You cannot approve this restricted page' });

    const note = typeof req.body?.note === 'string' && req.body.note.trim()
      ? req.body.note.trim().slice(0, 500)
      : null;
    await run(db, `INSERT INTO wiki_page_approvals (id, page_id, version, user_id, action, note, created_at)
      VALUES (?, ?, ?, ?, 'approved', ?, ?)`, [uuidv4(), page.id, page.version, req.userId, note, nowMs()]);
    await run(db, 'UPDATE wiki_pages SET approved_version = ? WHERE id = ?', [page.version, page.id]);

    const updated = await queryOne(db, 'SELECT id, version, approved_version FROM wiki_pages WHERE id = ?', [page.id]);
    res.json(await pageApproval(db, updated));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/wiki/pages/:id/approve — revoke. Idempotent: revoking an
// unapproved page succeeds and changes nothing.
router.delete('/wiki/pages/:id/approve', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT id, version, approved_version FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const access = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!access.edit) return res.status(403).json({ error: 'You cannot change approval on this restricted page' });

    if (page.approved_version !== null && page.approved_version !== undefined) {
      await run(db, `INSERT INTO wiki_page_approvals (id, page_id, version, user_id, action, note, created_at)
        VALUES (?, ?, ?, ?, 'revoked', NULL, ?)`, [uuidv4(), page.id, page.version, req.userId, nowMs()]);
      await run(db, 'UPDATE wiki_pages SET approved_version = NULL WHERE id = ?', [page.id]);
    }
    const updated = await queryOne(db, 'SELECT id, version, approved_version FROM wiki_pages WHERE id = ?', [page.id]);
    res.json(await pageApproval(db, updated));
  } catch (e) { serverError(res, e); }
});

// GET /api/wiki/pages/:id/approvals — append-only log, newest first.
router.get('/wiki/pages/:id/approvals', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const access = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!access.view) return res.status(403).json({ error: 'This page is restricted' });
    const rows = await queryAll(db, `
      SELECT a.id, a.version, a.action, a.note, a.created_at, a.user_id, u.name AS user_name
      FROM wiki_page_approvals a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.page_id = ?
      ORDER BY a.created_at DESC, a.id DESC`, [req.params.id]);
    res.json(rows);
  } catch (e) { serverError(res, e); }
});

// ===== ISSUE → PAGES =====
// Pages mentioning an issue. Restricted pages the caller cannot view are
// removed: a page title alone can disclose sensitive context (e.g. a page
// named "ATLAS-29 breach retro" reveals both its existence and its subject).
router.get('/issues/:id/pages', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pages = await queryAll(db, `
      SELECT p.id, p.title, p.slug, p.space_id, p.updated_at,
             s.name AS space_name, s.space_key
      FROM wiki_page_issues l
      JOIN wiki_pages p ON p.id = l.page_id
      JOIN wiki_spaces s ON s.id = p.space_id
      WHERE l.issue_id = ? AND p.status = 'current'
      ORDER BY p.updated_at DESC`, [req.params.id]);
    if (pages.length === 0) return res.json([]);

    const access = await pageAccessBatch(db, pages.map((p) => p.id), req.userId, req.userRole);
    res.json(pages.filter((p) => access.get(p.id)?.view));
  } catch (e) { serverError(res, e); }
});

// ===== EXPORT =====
// Crude but dependency-free HTML → Markdown for the sanitised tag subset we store.
function htmlToMarkdown(html) {
  let md = String(html || '');
  md = md.replace(/<\s*br\s*\/?>/gi, '\n');
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/(ul|ol)>/gi, '\n');
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, inner) =>
    inner.split('\n').map((l) => `> ${l.trim()}`).join('\n') + '\n');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*');
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  md = md.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (m, inner) => {
    const cells = [...inner.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1].replace(/<[^>]+>/g, '').trim());
    return cells.length ? `| ${cells.join(' | ')} |\n` : '';
  });
  md = md.replace(/<\/(p|div|table|thead|tbody|figure)>/gi, '\n');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Content is returned as JSON — the SPA turns it into a Blob download, since a bare
// <a href> cannot carry the auth header.
router.get('/wiki/pages/:id/export', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const access = await pageAccess(db, req.params.id, req.userId, req.userRole);
    if (!access.view) return res.status(403).json({ error: 'This page is restricted' });

    const slug = page.slug || 'page';
    if (req.query.format === 'markdown') {
      res.json({ filename: `${slug}.md`, mime: 'text/markdown', content: `# ${page.title}\n\n${htmlToMarkdown(page.body)}` });
    } else {
      const html = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${page.title}</title></head><body><h1>${page.title}</h1>\n${page.body || ''}\n</body></html>`;
      res.json({ filename: `${slug}.html`, mime: 'text/html', content: html });
    }
  } catch (e) { serverError(res, e); }
});

// ===== PAGE VERSIONS =====
router.get('/wiki/pages/:id/versions', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const versions = await queryAll(db, `
      SELECT v.*, u.name as editor_name, u.avatar_color as editor_color
      FROM wiki_page_versions v LEFT JOIN users u ON v.editor_id = u.id
      WHERE v.page_id = ? ORDER BY v.version DESC
    `, [req.params.id]);
    res.json(versions);
  } catch (e) { serverError(res, e); }
});

// ===== COMMENTS =====
router.get('/wiki/pages/:id/comments', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const comments = await queryAll(db, `
      SELECT c.*, u.name as author_name, u.avatar_color as author_color
      FROM wiki_page_comments c LEFT JOIN users u ON c.author_id = u.id
      WHERE c.page_id = ? ORDER BY c.created_at
    `, [req.params.id]);
    res.json(comments);
  } catch (e) { serverError(res, e); }
});

router.post('/wiki/pages/:id/comments', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { parent_id, quote } = req.body;
    const body = sanitizeRichText(req.body.body);
    if (!body) return res.status(400).json({ error: 'Comment body required' });
    const id = uuidv4();
    await run(db, "INSERT INTO wiki_page_comments (id, page_id, parent_id, author_id, body, quote) VALUES (?,?,?,?,?,?)",
      [id, req.params.id, parent_id || null, req.userId, body, quote ? String(quote).slice(0, 500) : null]);
    const page = await queryOne(db, 'SELECT title FROM wiki_pages WHERE id = ?', [req.params.id]);
    await notifyPageMentions(db, {
      pageId: req.params.id,
      title: page?.title || 'a page',
      actorId: req.userId,
      body,
      commentQuote: true,
    });
    const comment = await queryOne(db, `SELECT c.*, u.name as author_name, u.avatar_color as author_color FROM wiki_page_comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.id = ?`, [id]);
    res.status(201).json(comment);
  } catch (e) { serverError(res, e); }
});

router.delete('/wiki/comments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM wiki_page_comments WHERE parent_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_comments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ===== RESTRICTIONS API =====
router.get('/wiki/pages/:id/restrictions', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, `
      SELECT r.user_id, r.can_edit, u.name, u.avatar_color
      FROM wiki_page_restrictions r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.page_id = ?`, [req.params.id]);
    res.json(rows.map((r) => ({ ...r, can_edit: Number(r.can_edit) })));
  } catch (e) { serverError(res, e); }
});

// Replace-all semantics: only the page author or an admin may change restrictions.
router.put('/wiki/pages/:id/restrictions', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT author_id FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (page.author_id !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Only the page author or an admin can change restrictions' });
    }
    const restrictions = Array.isArray(req.body.restrictions) ? req.body.restrictions : [];
    await run(db, 'DELETE FROM wiki_page_restrictions WHERE page_id = ?', [req.params.id]);
    for (const r of restrictions) {
      if (!r || !r.user_id) continue;
      await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, ?)',
        [req.params.id, r.user_id, r.can_edit ? 1 : 0]);
    }
    res.json({ ok: true, count: restrictions.length });
  } catch (e) { serverError(res, e); }
});

// ===== LABELS =====
router.post('/wiki/pages/:id/labels', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { label } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });
    try { await run(db, "INSERT INTO wiki_labels (id, page_id, label) VALUES (?,?,?)", [uuidv4(), req.params.id, label.toLowerCase().trim()]); } catch(e){}
    const labels = (await queryAll(db, 'SELECT label FROM wiki_labels WHERE page_id = ?', [req.params.id])).map(l => l.label);
    res.json(labels);
  } catch (e) { serverError(res, e); }
});

router.delete('/wiki/pages/:pageId/labels/:label', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM wiki_labels WHERE page_id = ? AND label = ?', [req.params.pageId, req.params.label]);
    const labels = (await queryAll(db, 'SELECT label FROM wiki_labels WHERE page_id = ?', [req.params.pageId])).map(l => l.label);
    res.json(labels);
  } catch (e) { serverError(res, e); }
});

// ===== STARS =====
router.post('/wiki/star', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { page_id, space_id } = req.body;
    const existing = page_id
      ? await queryOne(db, 'SELECT id FROM wiki_stars WHERE user_id = ? AND page_id = ?', [req.userId, page_id])
      : await queryOne(db, 'SELECT id FROM wiki_stars WHERE user_id = ? AND space_id = ?', [req.userId, space_id]);
    if (existing) {
      await run(db, 'DELETE FROM wiki_stars WHERE id = ?', [existing.id]);
      res.json({ starred: false });
    } else {
      await run(db, "INSERT INTO wiki_stars (id, user_id, page_id, space_id) VALUES (?,?,?,?)", [uuidv4(), req.userId, page_id || null, space_id || null]);
      res.json({ starred: true });
    }
  } catch (e) { serverError(res, e); }
});

// ===== LIKES =====
router.post('/wiki/pages/:id/like', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM wiki_page_likes WHERE page_id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (existing) {
      await run(db, 'DELETE FROM wiki_page_likes WHERE id = ?', [existing.id]);
      res.json({ liked: false });
    } else {
      await run(db, "INSERT INTO wiki_page_likes (id, page_id, user_id) VALUES (?,?,?)", [uuidv4(), req.params.id, req.userId]);
      res.json({ liked: true });
    }
    const count = await queryOne(db, 'SELECT COUNT(*) as c FROM wiki_page_likes WHERE page_id = ?', [req.params.id]);
    res.locals.likeCount = count.c;
  } catch (e) { serverError(res, e); }
});

// ===== SEARCH =====
router.get('/wiki/search', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const q = req.query.q;
    if (!q) return res.json([]);
    const pages = await queryAll(db, `
      SELECT p.id, p.title, p.slug, p.body, p.updated_at, p.space_id,
        s.name as space_name, s.space_key, s.icon as space_icon,
        u.name as author_name
      FROM wiki_pages p
      JOIN wiki_spaces s ON p.space_id = s.id
      LEFT JOIN users u ON p.author_id = u.id
      WHERE p.status = 'current' AND (p.title LIKE ? OR p.body LIKE ?)
      ORDER BY p.updated_at DESC LIMIT 30
    `, [`%${q}%`, `%${q}%`]);
    // Strip HTML from body for snippet
    pages.forEach(p => {
      const plain = (p.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const idx = plain.toLowerCase().indexOf(q.toLowerCase());
      p.snippet = idx >= 0 ? '...' + plain.substring(Math.max(0, idx - 40), idx + q.length + 80) + '...' : plain.substring(0, 120) + '...';
      delete p.body;
    });
    res.json(pages);
  } catch (e) { serverError(res, e); }
});

// ===== TEMPLATES =====
router.get('/wiki/templates', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const spaceId = req.query.space_id;
    const templates = await queryAll(db,
      'SELECT * FROM wiki_templates WHERE is_global = 1 OR space_id = ? ORDER BY name',
      [spaceId || '']);
    res.json(templates);
  } catch (e) { serverError(res, e); }
});

// ===== PAGE TREE =====
router.get('/wiki/spaces/:spaceId/tree', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pages = await queryAll(db, "SELECT id, title, parent_id, position, slug FROM wiki_pages WHERE space_id = ? AND status = 'current' AND COALESCE(page_type,'page') = 'page' ORDER BY position, title", [req.params.spaceId]);
    // Build tree
    const map = {}; const roots = [];
    pages.forEach(p => { map[p.id] = { ...p, children: [] }; });
    pages.forEach(p => {
      if (p.parent_id && map[p.parent_id]) map[p.parent_id].children.push(map[p.id]);
      else roots.push(map[p.id]);
    });
    res.json(roots);
  } catch (e) { serverError(res, e); }
});

module.exports = router;
module.exports.pageAccess = pageAccess;
module.exports.pageAccessBatch = pageAccessBatch;
