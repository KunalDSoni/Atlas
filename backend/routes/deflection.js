// ===== KB DEFLECTION — agent side, and the service desk report =====
// Curating articles decides what customers may be shown (utils/deflection.js),
// so it is board-admin only. The report is agent-only by virtue of being
// mounted after blockClients.
//
// GET    /api/request-types/:id/articles
// POST   /api/request-types/:id/articles              (board admin)
// DELETE /api/request-types/:id/articles/:pageId      (board admin)
// GET    /api/projects/:projectId/servicedesk-report

const express = require('express');
const { getDb, queryOne, queryAll, run } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { slaState } = require('../utils/sla');

const router = express.Router();
const requireBoardAdmin = requireRole('admin', 'board_admin');

// GET /api/request-types/:id/articles
router.get('/request-types/:id/articles', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db,
      `SELECT ta.page_id, ta.position, pg.title, pg.slug, pg.status, pg.space_id, s.name AS space_name
         FROM sd_type_articles ta
         JOIN wiki_pages pg ON pg.id = ta.page_id
         LEFT JOIN wiki_spaces s ON s.id = pg.space_id
        WHERE ta.request_type_id = ?
        ORDER BY ta.position, pg.title`, [req.params.id]);
    res.json(rows);
  } catch (e) { serverError(res, e); }
});

// POST /api/request-types/:id/articles
router.post('/request-types/:id/articles', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const type = await queryOne(db, 'SELECT id FROM sd_request_types WHERE id = ?', [req.params.id]);
    if (!type) return res.status(404).json({ error: 'Request type not found' });

    const { page_id, position } = req.body;
    const page = await queryOne(db, 'SELECT id, status FROM wiki_pages WHERE id = ?', [page_id]);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    // Curating a page publishes it to customers, so refuse anything not
    // actually published — the alternative is a draft leaking the moment
    // somebody attaches it "to finish later".
    if (page.status !== 'current') {
      return res.status(400).json({ error: 'Only a published page can be a help article' });
    }

    const existing = await queryOne(db,
      'SELECT page_id FROM sd_type_articles WHERE request_type_id = ? AND page_id = ?',
      [req.params.id, page_id]);
    if (existing) return res.status(409).json({ error: 'Already an article for this request type' });

    await run(db, 'INSERT INTO sd_type_articles (request_type_id, page_id, position) VALUES (?, ?, ?)',
      [req.params.id, page_id, Number(position) || 0]);
    res.status(201).json({ ok: true, page_id });
  } catch (e) { serverError(res, e); }
});

// DELETE /api/request-types/:id/articles/:pageId
router.delete('/request-types/:id/articles/:pageId', requireAuth, requireBoardAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'DELETE FROM sd_type_articles WHERE request_type_id = ? AND page_id = ?',
      [req.params.id, req.params.pageId]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/projects/:projectId/servicedesk-report
//
// Every panel is computed from rows we actually store — no backfill is invented
// for requests raised before a goal, an article, or a rating existed. The
// `since_tracking_began` flag is the API saying so out loud, so the UI cannot
// present these as lifetime figures.
router.get('/projects/:projectId/servicedesk-report', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const projectId = req.params.projectId;

    const volume = await queryAll(db,
      `SELECT rt.id, rt.name, COUNT(i.id) AS count
         FROM sd_request_types rt
         LEFT JOIN issues i ON i.request_type_id = rt.id AND i.type = 'request'
        WHERE rt.project_id = ?
        GROUP BY rt.id, rt.name
        ORDER BY count DESC, rt.name`, [projectId]);

    // Clocks, joined back to their request type so breach rate can be grouped.
    const clocks = await queryAll(db,
      `SELECT c.*, i.request_type_id, rt.name AS request_type_name
         FROM sd_sla_clocks c
         JOIN issues i ON i.id = c.issue_id
         LEFT JOIN sd_request_types rt ON rt.id = i.request_type_id
        WHERE i.project_id = ?`, [projectId]);

    const elapsed = { first_response: [], resolution: [] };
    const breach = new Map();
    for (const clock of clocks) {
      const state = slaState(clock, { target_minutes: clock.target_minutes });
      if (!state) continue;
      // Only a STOPPED clock has a real duration; a running one would drag the
      // median toward "however long ago we started measuring".
      if (state.stopped && elapsed[clock.metric]) elapsed[clock.metric].push(state.elapsed_minutes);

      const name = clock.request_type_name || 'Uncategorised';
      if (!breach.has(name)) breach.set(name, { name, total: 0, breached: 0 });
      const row = breach.get(name);
      row.total += 1;
      if (state.status === 'breached') row.breached += 1;
    }

    const median = (xs) => {
      if (xs.length === 0) return null;
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    };

    const ratings = await queryAll(db,
      `SELECT sat.rating FROM sd_satisfaction sat
         JOIN issues i ON i.id = sat.issue_id
        WHERE i.project_id = ?`, [projectId]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) distribution[Number(r.rating)] += 1;

    const helpedRow = await queryOne(db,
      `SELECT COUNT(*) AS c FROM sd_article_hits h
         JOIN sd_request_types rt ON rt.id = h.request_type_id
        WHERE rt.project_id = ? AND h.helped = 1`, [projectId]);
    const raisedRow = await queryOne(db,
      "SELECT COUNT(*) AS c FROM issues WHERE project_id = ? AND type = 'request'", [projectId]);
    const helped = Number(helpedRow?.c || 0);
    const raised = Number(raisedRow?.c || 0);

    res.json({
      // Both terms come from rows we store, so the denominator needs no
      // form-open telemetry to be honest.
      deflection: {
        helped,
        requests_raised: raised,
        rate: helped + raised === 0 ? 0 : helped / (helped + raised),
      },
      volume_by_type: volume.map((v) => ({ ...v, count: Number(v.count) })),
      median_minutes: {
        first_response: median(elapsed.first_response),
        resolution: median(elapsed.resolution),
      },
      sla_breach_by_type: [...breach.values()].map((r) => ({
        ...r, rate: r.total === 0 ? 0 : r.breached / r.total,
      })),
      csat: {
        count: ratings.length,
        average: ratings.length === 0 ? null
          : Math.round((ratings.reduce((a, r) => a + Number(r.rating), 0) / ratings.length) * 100) / 100,
        distribution,
      },
      since_tracking_began: true,
    });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
