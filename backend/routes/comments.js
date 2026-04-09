// ===== COMMENTS MODULE =====
// GET    /api/issues/:id/comments - List comments for issue
// POST   /api/issues/:id/comments - Add comment
// PUT    /api/comments/:id - Edit comment (author or admin only)
// DELETE /api/comments/:id - Delete comment (author or admin only)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function enrichComment(db, comment) {
  const author = queryOne(db, 'SELECT name, avatar_color FROM users WHERE id = ?', [comment.author_id]);
  return {
    ...comment,
    author_name: author?.name || 'Unknown',
    author_color: author?.avatar_color || '#666'
  };
}

// GET /api/issues/:issueId/comments
router.get('/issues/:issueId/comments', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const comments = queryAll(db, 'SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at', [req.params.issueId]);
    res.json(comments.map(c => enrichComment(db, c)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/issues/:issueId/comments
router.post('/issues/:issueId/comments', requireAuth, async (req, res) => {
  try {
    const { body: commentBody, author_id } = req.body;
    if (!commentBody) return res.status(400).json({ error: 'Comment body required' });

    const db = await getDb();
    const id = uuidv4();
    const authorId = author_id || req.userId;
    run(db, 'INSERT INTO comments (id, issue_id, author_id, body) VALUES (?, ?, ?, ?)',
      [id, req.params.issueId, authorId, commentBody]);

    const comment = queryOne(db, 'SELECT * FROM comments WHERE id = ?', [id]);
    res.status(201).json(enrichComment(db, comment));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/comments/:id
router.put('/comments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const comment = queryOne(db, 'SELECT * FROM comments WHERE id = ?', [req.params.id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only author or admin can edit
    if (comment.author_id !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to edit this comment' });
    }

    const { body: commentBody } = req.body;
    if (!commentBody) return res.status(400).json({ error: 'Comment body required' });

    run(db, "UPDATE comments SET body = ?, updated_at = datetime('now') WHERE id = ?", [commentBody, req.params.id]);
    const updated = queryOne(db, 'SELECT * FROM comments WHERE id = ?', [req.params.id]);
    res.json(enrichComment(db, updated));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/comments/:id
router.delete('/comments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const comment = queryOne(db, 'SELECT * FROM comments WHERE id = ?', [req.params.id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only author or admin can delete
    if (comment.author_id !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    run(db, 'DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
