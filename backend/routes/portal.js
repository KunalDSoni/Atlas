// ===== IDEA PORTAL V2 (EPIC 52) =====
// Public browsing is anonymous. Actions that create identity-specific state
// (submit, vote, follow, and "mine") require a real Atlas session.
//
// GET    /api/portal/features              - public roadmap
// GET    /api/portal/features/:id          - public-safe feature detail
// POST   /api/portal/features/:id/vote     - toggle the caller's vote
// POST   /api/portal/features/:id/follow   - follow, idempotently
// DELETE /api/portal/features/:id/follow   - unfollow, idempotently
// GET    /api/portal/me                    - caller's submissions and follows
// POST   /api/portal/ideas                 - submit an idea as raw feedback

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { notifyNewMentions } = require('../utils/notify');
const { toPublicFeature, toPublicSubmission } = require('../utils/portal');

const router = express.Router();

const PORTAL_FEATURE_SELECT = `
  SELECT f.*,
    (SELECT COUNT(*) FROM pb_votes pv WHERE pv.feature_id = f.id) AS vote_count,
    (SELECT COUNT(*) FROM pb_portal_followers pf WHERE pf.feature_id = f.id) AS follower_count,
    (SELECT COUNT(*) FROM pb_votes mine WHERE mine.feature_id = f.id AND mine.user_id = ?) AS has_voted,
    (SELECT COUNT(*) FROM pb_portal_followers minef WHERE minef.feature_id = f.id AND minef.user_id = ?) AS is_following
  FROM pb_features f`;

function viewerParams(userId) {
  // An impossible empty id keeps the query identical for anonymous and signed-
  // in readers, and avoids assembling identity-dependent response shapes.
  const id = userId || '';
  return [id, id];
}

async function portalFeature(db, featureId, userId) {
  return queryOne(db,
    `${PORTAL_FEATURE_SELECT}
      WHERE f.id = ? AND f.portal_status IS NOT NULL`,
    [...viewerParams(userId), featureId]);
}

async function publicFeatureOr404(db, req, res) {
  const row = await portalFeature(db, req.params.id, req.userId);
  if (!row) {
    res.status(404).json({ error: 'Feature not found' });
    return null;
  }
  return row;
}

// Anonymous public roadmap. Authentication middleware still populates req.userId
// when a valid token is present, so has_voted/is_following remain useful.
router.get('/portal/features', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      // merged_into_id: a duplicate folded into another feature must not keep
      // its own public entry, or customers see and vote on both halves of a
      // request the team has already treated as one.
      `${PORTAL_FEATURE_SELECT}
        WHERE f.portal_status IS NOT NULL AND f.merged_into_id IS NULL
        ORDER BY vote_count DESC, f.created_at DESC`, viewerParams(req.userId));
    res.json(rows.map(toPublicFeature));
  } catch (e) { serverError(res, e); }
});

router.get('/portal/features/:id', async (req, res) => {
  try {
    const db = await getDb();
    const row = await publicFeatureOr404(db, req, res);
    if (row) res.json(toPublicFeature(row));
  } catch (e) { serverError(res, e); }
});

router.post('/portal/features/:id/vote', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!await publicFeatureOr404(db, req, res)) return;
    const existing = await queryOne(db,
      'SELECT id FROM pb_votes WHERE feature_id = ? AND user_id = ?',
      [req.params.id, req.userId]);
    if (existing) {
      await run(db, 'DELETE FROM pb_votes WHERE id = ?', [existing.id]);
    } else {
      await run(db, 'INSERT INTO pb_votes (id, feature_id, user_id) VALUES (?, ?, ?)',
        [uuidv4(), req.params.id, req.userId]);
    }
    res.json(toPublicFeature(await portalFeature(db, req.params.id, req.userId)));
  } catch (e) { serverError(res, e); }
});

router.post('/portal/features/:id/follow', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!await publicFeatureOr404(db, req, res)) return;
    const existing = await queryOne(db,
      'SELECT feature_id FROM pb_portal_followers WHERE feature_id = ? AND user_id = ?',
      [req.params.id, req.userId]);
    if (!existing) {
      await run(db, 'INSERT INTO pb_portal_followers (feature_id, user_id) VALUES (?, ?)',
        [req.params.id, req.userId]);
    }
    res.json(toPublicFeature(await portalFeature(db, req.params.id, req.userId)));
  } catch (e) { serverError(res, e); }
});

router.delete('/portal/features/:id/follow', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!await publicFeatureOr404(db, req, res)) return;
    await run(db, 'DELETE FROM pb_portal_followers WHERE feature_id = ? AND user_id = ?',
      [req.params.id, req.userId]);
    res.json(toPublicFeature(await portalFeature(db, req.params.id, req.userId)));
  } catch (e) { serverError(res, e); }
});

router.get('/portal/me', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const submissions = await queryAll(db,
      `SELECT id, title, content, processed, dismissed_at, created_at
         FROM pb_insights
        WHERE source = 'portal' AND created_by = ?
        ORDER BY created_at DESC`, [req.userId]);
    const follows = await queryAll(db,
      `${PORTAL_FEATURE_SELECT}
        JOIN pb_portal_followers followed
          ON followed.feature_id = f.id AND followed.user_id = ?
        WHERE f.portal_status IS NOT NULL
        ORDER BY followed.created_at DESC`, [...viewerParams(req.userId), req.userId]);
    res.json({
      submissions: submissions.map(toPublicSubmission),
      follows: follows.map(toPublicFeature),
    });
  } catch (e) { serverError(res, e); }
});

// A portal idea remains raw feedback for the PM to triage. It is attributed to
// a customer record when the signed-in user's email matches one.
router.post('/portal/ideas', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!title) return res.status(400).json({ error: 'title required' });

    const user = await queryOne(db, 'SELECT email FROM users WHERE id = ?', [req.userId]);
    const customer = user?.email
      ? await queryOne(db, 'SELECT id FROM pb_customers WHERE LOWER(email) = LOWER(?)', [user.email])
      : null;

    const id = uuidv4();
    await run(db, `INSERT INTO pb_insights
        (id, title, content, source, customer_id, created_by, origin_kind, origin_excerpt)
      VALUES (?, ?, ?, 'portal', ?, ?, 'portal', ?)`,
      [id, title, content, customer?.id || null, req.userId,
       String(content || title).slice(0, 500)]);
    // Staff drafting an idea can mention a colleague. A customer cannot: the
    // picker is closed to them, and honouring a hand-typed name here would let
    // anyone outside the company notify staff at will.
    if (req.userRole !== 'client') {
      await notifyNewMentions(db, {
        text: content,
        actorId: req.userId,
        where: `the idea "${title}"`,
        link: '/product/insights',
      });
    }

    const created = await queryOne(db,
      'SELECT id, title, content, processed, dismissed_at, created_at FROM pb_insights WHERE id = ?', [id]);
    res.status(201).json({ ok: true, ...toPublicSubmission(created) });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
