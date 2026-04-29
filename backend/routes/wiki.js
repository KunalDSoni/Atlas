// ===== WIKI (CONFLUENCE) MODULE =====
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/wiki/spaces/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const space = await queryOne(db, 'SELECT s.*, u.name as owner_name FROM wiki_spaces s LEFT JOIN users u ON s.owner_id = u.id WHERE s.id = ?', [req.params.id]);
    if (!space) return res.status(404).json({ error: 'Space not found' });
    res.json(space);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      ORDER BY p.position, p.title
    `, [req.params.spaceId, status]);
    pages.forEach(p => { p.labels = p.labels_str ? p.labels_str.split(',') : []; delete p.labels_str; });
    res.json(pages);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wiki/spaces/:spaceId/pages', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { title, body, parent_id, body_format, labels } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const id = uuidv4();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const maxPos = await queryOne(db, 'SELECT COALESCE(MAX(position),0)+1 as p FROM wiki_pages WHERE space_id = ? AND parent_id IS ?', [req.params.spaceId, parent_id || null]);
    await run(db, `INSERT INTO wiki_pages (id, space_id, parent_id, title, slug, body, body_format, author_id, last_editor_id, position) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, req.params.spaceId, parent_id || null, title, slug, body || '', body_format || 'html', req.userId, req.userId, maxPos.p]);
    await run(db, "INSERT INTO wiki_page_versions (id, page_id, version, title, body, editor_id, change_message) VALUES (?,?,1,?,?,?,'Created')",
      [uuidv4(), id, title, body || '', req.userId]);
    if (labels && Array.isArray(labels)) {
      for (const l of labels) {
        try { await run(db, "INSERT INTO wiki_labels (id, page_id, label) VALUES (?,?,?)", [uuidv4(), id, l.toLowerCase().trim()]); } catch(e){}
      }
    }
    const page = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [id]);
    res.status(201).json(page);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/wiki/pages/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
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
      WHERE p.id = ?
    `, [req.userId, req.userId, req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    // Increment view
    await run(db, 'UPDATE wiki_pages SET view_count = view_count + 1 WHERE id = ?', [req.params.id]);
    // Labels
    page.labels = (await queryAll(db, 'SELECT label FROM wiki_labels WHERE page_id = ?', [req.params.id])).map(l => l.label);
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
    page.children = await queryAll(db, "SELECT id, title, slug, status FROM wiki_pages WHERE parent_id = ? AND status = 'current' ORDER BY position, title", [req.params.id]);
    res.json(page);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/wiki/pages/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [req.params.id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const { title, body, parent_id, status, position, change_message } = req.body;
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
    const updated = await queryOne(db, 'SELECT * FROM wiki_pages WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/wiki/pages/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    // Move children to parent
    const page = await queryOne(db, 'SELECT parent_id FROM wiki_pages WHERE id = ?', [req.params.id]);
    await run(db, 'UPDATE wiki_pages SET parent_id = ? WHERE parent_id = ?', [page?.parent_id || null, req.params.id]);
    await run(db, 'DELETE FROM wiki_page_comments WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_versions WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_labels WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_stars WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_likes WHERE page_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_pages WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wiki/pages/:id/comments', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { body, parent_id } = req.body;
    if (!body) return res.status(400).json({ error: 'Comment body required' });
    const id = uuidv4();
    await run(db, "INSERT INTO wiki_page_comments (id, page_id, parent_id, author_id, body) VALUES (?,?,?,?,?)",
      [id, req.params.id, parent_id || null, req.userId, body]);
    const comment = await queryOne(db, `SELECT c.*, u.name as author_name, u.avatar_color as author_color FROM wiki_page_comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.id = ?`, [id]);
    res.status(201).json(comment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/wiki/comments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM wiki_page_comments WHERE parent_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM wiki_page_comments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/wiki/pages/:pageId/labels/:label', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM wiki_labels WHERE page_id = ? AND label = ?', [req.params.pageId, req.params.label]);
    const labels = (await queryAll(db, 'SELECT label FROM wiki_labels WHERE page_id = ?', [req.params.pageId])).map(l => l.label);
    res.json(labels);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== PAGE TREE =====
router.get('/wiki/spaces/:spaceId/tree', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const pages = await queryAll(db, "SELECT id, title, parent_id, position, slug FROM wiki_pages WHERE space_id = ? AND status = 'current' ORDER BY position, title", [req.params.spaceId]);
    // Build tree
    const map = {}; const roots = [];
    pages.forEach(p => { map[p.id] = { ...p, children: [] }; });
    pages.forEach(p => {
      if (p.parent_id && map[p.parent_id]) map[p.parent_id].children.push(map[p.id]);
      else roots.push(map[p.id]);
    });
    res.json(roots);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
