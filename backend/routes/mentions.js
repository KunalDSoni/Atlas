// ===== MENTION SEARCH =====
// Backs the @ picker. Jira ranks project members first but keeps everyone
// searchable, so you can pull in a colleague from another team without adding
// them to the project first; the is_member flag lets the client warn that the
// person may not be able to open what you are mentioning them in.
//
// Client-role users are excluded. They are confined to the help center by
// blockClients in server.js, so a mention would notify them about an issue
// they cannot open. This route is mounted after that boundary, so clients
// cannot call it either.

const express = require('express');
const router = express.Router();
const { getDb, queryAll } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const LIMIT = 10;

// GET /api/mentions/search?q=&projectId=
router.get('/mentions/search', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const q = String(req.query.q || '').trim().toLowerCase();
    const projectId = req.query.projectId ? String(req.query.projectId) : null;

    // A bare '@' with nothing typed yet offers the project's own members —
    // reaching outside the project is deliberate, so it takes a search term.
    // Once the user types, everyone becomes reachable.
    const membersOnly = q === '' && projectId !== null;

    // LIKE over name and email: the picker is a type-ahead, and a partial
    // email is a common way to disambiguate two people with the same name.
    const like = `%${q}%`;
    const rows = await queryAll(db, `
      SELECT u.id, u.name, u.email, u.avatar_color,
             CASE WHEN pm.user_id IS NULL THEN 0 ELSE 1 END AS is_member
      FROM users u
      LEFT JOIN project_members pm
        ON pm.user_id = u.id AND pm.project_id = ?
      WHERE u.is_active = 1
        AND u.role != 'client'
        AND (? = '' OR LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ?)
        AND (? = 0 OR pm.user_id IS NOT NULL)
      ORDER BY is_member DESC, u.name ASC
      LIMIT ?
    `, [projectId, q, like, like, membersOnly ? 1 : 0, LIMIT]);

    res.json(rows.map((r) => ({ ...r, is_member: Boolean(r.is_member) })));
  } catch (e) { serverError(res, e); }
});

module.exports = router;
