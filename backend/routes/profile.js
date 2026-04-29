// ===== PROFILE MODULE =====
// GET /api/profile - Get current user's profile with stats
// PUT /api/profile - Update profile fields
// PUT /api/profile/password - Change password
// PUT /api/profile/email - Change email

const express = require('express');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/profile
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get projects
    const projects = await queryAll(db, `SELECT p.id, p.name, p.key, pm.role_in_project FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ?`, [req.userId]);

    // Get stats
    const assigned = await queryOne(db, `SELECT COUNT(*) as count FROM issues WHERE assignee_id = ? AND status != 'done'`, [req.userId]);
    const completed = await queryOne(db, `SELECT COUNT(*) as count FROM issues WHERE assignee_id = ? AND status = 'done'`, [req.userId]);
    const comments = await queryOne(db, `SELECT COUNT(*) as count FROM comments WHERE author_id = ?`, [req.userId]);

    delete user.password;
    res.json({
      ...user, projects,
      stats: { assigned: assigned.count, completed: completed.count, comments: comments.count }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/profile
router.put('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, phone, department, job_title, bio, timezone, avatar_color } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (department !== undefined) { updates.push('department = ?'); params.push(department); }
    if (job_title !== undefined) { updates.push('job_title = ?'); params.push(job_title); }
    if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
    if (timezone !== undefined) { updates.push('timezone = ?'); params.push(timezone); }
    if (avatar_color !== undefined) { updates.push('avatar_color = ?'); params.push(avatar_color); }

    if (updates.length > 0) {
      params.push(req.userId);
      await run(db, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const user = await queryOne(db, 'SELECT id, name, email, role, avatar_color, avatar_url, phone, department, job_title, bio, timezone, is_active, last_login, created_at FROM users WHERE id = ?', [req.userId]);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/profile/password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = await getDb();
    const user = await queryOne(db, 'SELECT password FROM users WHERE id = ?', [req.userId]);
    if (user.password !== current_password) return res.status(400).json({ error: 'Current password is incorrect' });

    await run(db, 'UPDATE users SET password = ? WHERE id = ?', [new_password, req.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/profile/email
router.put('/email', requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const db = await getDb();
    const existing = await queryOne(db, 'SELECT id FROM users WHERE email = ? AND id != ?', [email, req.userId]);
    if (existing) return res.status(400).json({ error: 'Email already taken' });

    await run(db, 'UPDATE users SET email = ? WHERE id = ?', [email, req.userId]);
    const user = await queryOne(db, 'SELECT id, name, email, role, avatar_color FROM users WHERE id = ?', [req.userId]);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
