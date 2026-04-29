// ===== ATTACHMENTS MODULE =====
// POST   /api/issues/:id/attachments - Upload file(s)
// GET    /api/issues/:id/attachments - List attachments
// GET    /api/attachments/:id/download - Download file
// DELETE /api/attachments/:id - Delete attachment

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowed = [
      'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain','text/csv',
      'video/mp4','video/webm','video/quicktime',
      'application/zip','application/x-zip-compressed',
      'application/json'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed: ' + file.mimetype));
  }
});

// POST /api/issues/:issueId/attachments - Upload one or more files
router.post('/issues/:issueId/attachments', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    const db = await getDb();
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.issueId]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const results = [];
    for (const file of (req.files || [])) {
      const id = uuidv4();
      await run(db, `INSERT INTO attachments (id, issue_id, filename, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, req.params.issueId, file.filename, file.originalname, file.mimetype, file.size, req.userId]);

      const att = await queryOne(db, `SELECT a.*, u.name as uploader_name, u.avatar_color as uploader_color FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id WHERE a.id = ?`, [id]);
      results.push(att);
    }
    res.status(201).json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/issues/:issueId/attachments
router.get('/issues/:issueId/attachments', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const attachments = await queryAll(db,
      `SELECT a.*, u.name as uploader_name, u.avatar_color as uploader_color
       FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id
       WHERE a.issue_id = ? ORDER BY a.created_at DESC`,
      [req.params.issueId]);
    res.json(attachments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/attachments/:id/download
router.get('/attachments/:id/download', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const att = await queryOne(db, 'SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    const filePath = path.join(UPLOADS_DIR, att.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    res.setHeader('Content-Disposition', `attachment; filename="${att.original_name}"`);
    res.setHeader('Content-Type', att.mime_type);
    res.sendFile(filePath);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/attachments/:id/preview — serve file inline for previewing images/PDFs
router.get('/attachments/:id/preview', async (req, res) => {
  try {
    const db = await getDb();
    const att = await queryOne(db, 'SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    const filePath = path.join(UPLOADS_DIR, att.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    res.setHeader('Content-Type', att.mime_type);
    res.sendFile(filePath);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/attachments/:id
router.delete('/attachments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const att = await queryOne(db, 'SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    // Delete file from disk
    const filePath = path.join(UPLOADS_DIR, att.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Delete from DB
    await run(db, 'DELETE FROM attachments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
