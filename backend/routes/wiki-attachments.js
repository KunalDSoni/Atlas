// ===== WIKI PAGE ATTACHMENTS =====
// POST   /api/wiki/pages/:pageId/attachments - Upload file(s) to a page
// GET    /api/wiki/pages/:pageId/attachments - List a page's attachments
// GET    /api/wiki/attachments/:id/raw        - Serve inline (images embed via this)
// DELETE /api/wiki/attachments/:id            - Delete
//
// Mirrors the issue-attachments module (shared uploads dir + signed URLs so the
// browser can load images without an auth header).

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { fileSigQuery, verifyFileSig } = require('../utils/signing');
const { putFile, getFileStream, deleteFile, pipeToResponse } = require('../utils/storage');

const router = express.Router();

// Held in memory only until handed to the storage layer (utils/storage.js).
const storage = multer.memoryStorage();

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/json',
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => ALLOWED.has(file.mimetype) ? cb(null, true) : cb(new Error('File type not allowed: ' + file.mimetype)),
});

const INLINE_SAFE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);

function withUrls(att) {
  if (!att) return att;
  return { ...att, raw_url: `/api/wiki/attachments/${att.id}/raw${fileSigQuery(att.id)}`, is_image: /^image\//.test(att.mime_type || '') };
}

function safeFilename(name) { return String(name || 'file').replace(/[^\w.\- ]+/g, '_'); }

// POST /api/wiki/pages/:pageId/attachments
router.post('/wiki/pages/:pageId/attachments', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    const db = await getDb();
    const page = await queryOne(db, 'SELECT id FROM wiki_pages WHERE id = ?', [req.params.pageId]);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const results = [];
    for (const file of (req.files || [])) {
      const id = uuidv4();
      const filename = uuidv4() + path.extname(file.originalname);
      await putFile(filename, file.buffer, file.mimetype);

      await run(db, `INSERT INTO wiki_attachments (id, page_id, filename, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, req.params.pageId, filename, file.originalname, file.mimetype, file.size, req.userId]);
      const att = await queryOne(db,
        `SELECT a.*, u.name as uploader_name FROM wiki_attachments a LEFT JOIN users u ON a.uploaded_by = u.id WHERE a.id = ?`, [id]);
      results.push(withUrls(att));
    }
    res.status(201).json(results);
  } catch (e) { serverError(res, e); }
});

// GET /api/wiki/pages/:pageId/attachments
router.get('/wiki/pages/:pageId/attachments', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT a.*, u.name as uploader_name FROM wiki_attachments a LEFT JOIN users u ON a.uploaded_by = u.id
       WHERE a.page_id = ? ORDER BY a.created_at DESC`, [req.params.pageId]);
    res.json(rows.map(withUrls));
  } catch (e) { serverError(res, e); }
});

// Authorise via session token OR a valid signed URL (browser <img> loads).
function requireAuthOrSignature(req, res, next) {
  if (req.userId) return next();
  if (verifyFileSig(req.params.id, req.query.exp, req.query.sig)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// GET /api/wiki/attachments/:id/raw — inline serve (images embed via this URL)
router.get('/wiki/attachments/:id/raw', requireAuthOrSignature, async (req, res) => {
  try {
    const db = await getDb();
    const att = await queryOne(db, 'SELECT * FROM wiki_attachments WHERE id = ?', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const stream = await getFileStream(att.filename);
    if (!stream) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Disposition', INLINE_SAFE.has(att.mime_type) ? 'inline' : `attachment; filename="${safeFilename(att.original_name)}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
    pipeToResponse(stream, res);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/wiki/attachments/:id
router.delete('/wiki/attachments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const att = await queryOne(db, 'SELECT * FROM wiki_attachments WHERE id = ?', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    await deleteFile(att.filename);
    await run(db, 'DELETE FROM wiki_attachments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// Inline wiki images are stored with a stable, unsigned src and re-signed fresh
// on every page fetch — so the signature can't expire in persisted content.
const RAW_RE = /\/api\/wiki\/attachments\/([\w-]+)\/raw(\?[^"'\s)]*)?/g;

/** Strip signatures from wiki-image srcs before persisting a page body. */
function unsignWikiImages(html) {
  return String(html || '').replace(RAW_RE, (_m, id) => `/api/wiki/attachments/${id}/raw`);
}

/** Add a fresh short-lived signature to wiki-image srcs when serving a page. */
function signWikiImages(html) {
  return String(html || '').replace(RAW_RE, (_m, id) => `/api/wiki/attachments/${id}/raw${fileSigQuery(id)}`);
}

module.exports = router;
module.exports.unsignWikiImages = unsignWikiImages;
module.exports.signWikiImages = signWikiImages;
