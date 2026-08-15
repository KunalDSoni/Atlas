// ===== COMMENTS MODULE =====
// GET    /api/issues/:id/comments - List comments for issue
// POST   /api/issues/:id/comments - Add comment
// PUT    /api/comments/:id - Edit comment (author or admin only)
// DELETE /api/comments/:id - Delete comment (author or admin only)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { notify, notifyNewMentions } = require('../utils/notify');
const sla = require('../utils/sla-clocks');
const { issueLink } = require('../utils/links');

const router = express.Router();

async function enrichComment(db, comment) {
  const author = await queryOne(db, 'SELECT name, avatar_color FROM users WHERE id = ?', [comment.author_id]);
  return {
    ...comment,
    author_name: author?.name || 'Unknown',
    author_color: author?.avatar_color || '#666'
  };
}

// Service desk customers only ever see the public half of a conversation.
const VISIBILITIES = ['public', 'internal'];

// GET /api/issues/:issueId/comments
router.get('/issues/:issueId/comments', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const comments = await queryAll(db,
      req.userRole === 'client'
        ? "SELECT * FROM comments WHERE issue_id = ? AND visibility = 'public' ORDER BY created_at"
        : 'SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at',
      [req.params.issueId]);
    res.json(await Promise.all(comments.map(c => enrichComment(db, c))));
  } catch (e) { serverError(res, e); }
});

// POST /api/issues/:issueId/comments
router.post('/issues/:issueId/comments', requireAuth, async (req, res) => {
  try {
    const { body: commentBody, author_id } = req.body;
    if (!commentBody) return res.status(400).json({ error: 'Comment body required' });

    const visibility = req.body.visibility || 'public';
    if (!VISIBILITIES.includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be public or internal' });
    }
    // A customer may only ever speak publicly. Rejected outright rather than
    // silently downgraded, so a broken client surfaces instead of hiding.
    if (visibility === 'internal' && req.userRole === 'client') {
      return res.status(403).json({ error: 'Clients cannot post internal notes' });
    }

    const db = await getDb();
    const id = uuidv4();
    const authorId = author_id || req.userId;
    await run(db, 'INSERT INTO comments (id, issue_id, author_id, body, visibility) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.issueId, authorId, commentBody, visibility]);

    // Fan out: @mentions first (stronger signal), then issue watchers.
    const issue = await queryOne(db, 'SELECT * FROM issues WHERE id = ?', [req.params.issueId]);
    if (issue) {
      // On a service desk request, a public reply from staff is the first
      // response the SLA measures; an internal note deliberately is not.
      await sla.onComment(db, issue, {
        byCustomer: authorId === issue.reporter_id && req.userRole === 'client',
        visibility,
      });

      const actor = await queryOne(db, 'SELECT name FROM users WHERE id = ?', [authorId]);
      const actorName = actor?.name || 'Someone';
      // An internal note is invisible to clients, so a client mentioned in one
      // is deliberately not notified — the alert would reveal the note exists
      // and link them to something they cannot open.
      const mentioned = await notifyNewMentions(db, {
        text: commentBody,
        actorId: authorId,
        where: issue.issue_key,
        link: issueLink(issue.issue_key),
        issueId: issue.id,
        allowClients: visibility !== 'internal',
      });
      const watchers = await queryAll(db, 'SELECT user_id FROM issue_watchers WHERE issue_id = ?', [req.params.issueId]);
      for (const w of watchers) {
        if (mentioned.includes(w.user_id)) continue;
        await notify(db, {
          userId: w.user_id, actorId: authorId, type: 'comment',
          message: `${actorName} commented on ${issue.issue_key}`,
          link: issueLink(issue.issue_key), issueId: issue.id,
        });
      }
    }

    const comment = await queryOne(db, 'SELECT * FROM comments WHERE id = ?', [id]);
    res.status(201).json(await enrichComment(db, comment));
  } catch (e) { serverError(res, e); }
});

// PUT /api/comments/:id
router.put('/comments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const comment = await queryOne(db, 'SELECT * FROM comments WHERE id = ?', [req.params.id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only author or admin can edit
    if (comment.author_id !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to edit this comment' });
    }

    const { body: commentBody } = req.body;
    if (!commentBody) return res.status(400).json({ error: 'Comment body required' });

    await run(db, "UPDATE comments SET body = ?, updated_at = datetime('now') WHERE id = ?", [commentBody, req.params.id]);
    const updated = await queryOne(db, 'SELECT * FROM comments WHERE id = ?', [req.params.id]);
    res.json(await enrichComment(db, updated));
  } catch (e) { serverError(res, e); }
});

// DELETE /api/comments/:id
router.delete('/comments/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const comment = await queryOne(db, 'SELECT * FROM comments WHERE id = ?', [req.params.id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only author or admin can delete
    if (comment.author_id !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    await run(db, 'DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
