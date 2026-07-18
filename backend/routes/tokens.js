// ===== PERSONAL API TOKENS =====
// GET    /api/tokens        - List the caller's tokens (metadata only)
// POST   /api/tokens        - Create a token (plaintext returned ONCE)
// DELETE /api/tokens/:id    - Revoke a token
//
// Tokens authenticate the existing /api surface as their owning user via
// `Authorization: Bearer atlas_pat_...` (see middleware/auth.js). Only the
// SHA-256 hash is stored; the plaintext is shown exactly once at creation.

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

const PAT_PREFIX = 'atlas_pat_';
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// GET /api/tokens
router.get('/tokens', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      'SELECT id, name, prefix, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]);
    res.json(rows);
  } catch (e) { serverError(res, e); }
});

// POST /api/tokens { name }
router.post('/tokens', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });

    const secret = crypto.randomBytes(24).toString('hex');
    const token = `${PAT_PREFIX}${secret}`;
    const prefix = token.slice(0, PAT_PREFIX.length + 6); // e.g. atlas_pat_ab12cd — safe to display
    const id = uuidv4();
    await run(db, 'INSERT INTO api_tokens (id, user_id, name, prefix, token_hash) VALUES (?, ?, ?, ?, ?)',
      [id, req.userId, name, prefix, hashToken(token)]);

    // Plaintext returned once — never stored, never retrievable again.
    res.status(201).json({ id, name, prefix, token, created_at: new Date().toISOString() });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/tokens/:id
router.delete('/tokens/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const tok = await queryOne(db, 'SELECT user_id FROM api_tokens WHERE id = ?', [req.params.id]);
    if (!tok) return res.status(404).json({ error: 'Token not found' });
    if (tok.user_id !== req.userId) return res.status(403).json({ error: 'Not your token' });
    await run(db, 'DELETE FROM api_tokens WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
