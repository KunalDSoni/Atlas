// ===== DEMO SEEDING =====
// Populates a single throwaway workspace for the public landing page's
// "Try the live demo" button.
//
// Deliberately independent of SEED_DEMO_DATA: production runs with that flag
// off, and must keep running with it off. This seed is gated on DEMO_EMAIL
// instead, so enabling a public demo never re-introduces the published
// password123 accounts.

const { v4: uuidv4 } = require('uuid');
const { queryOne, run } = require('./database');
const { hashPassword } = require('./utils/password');

const DEMO_PROJECT_KEY = 'DEMO';

function resetHours() {
  const raw = parseInt(process.env.DEMO_RESET_HOURS || '6', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 6;
}

/**
 * True when the demo project is missing, or old enough to be re-seeded.
 *
 * The project's own created_at IS the last-reset timestamp: a reset deletes
 * and recreates the row. That avoids inventing a settings table this schema
 * does not have.
 *
 * Requires the demo user ID to verify provenance: we only reset a DEMO-keyed
 * project if it was actually created by the demo seeder (lead_id matches).
 * This prevents destroying a real customer's project if they happen to key it
 * 'DEMO' before the demo gets enabled.
 */
async function isDemoStale(db, demoUserId) {
  const project = await queryOne(
    db,
    'SELECT created_at, lead_id FROM projects WHERE key = ? AND lead_id = ?',
    [DEMO_PROJECT_KEY, demoUserId]
  );
  if (!project) return true;

  const created = new Date(project.created_at).getTime();
  if (!Number.isFinite(created)) return true;

  return Date.now() - created > resetHours() * 60 * 60 * 1000;
}

/** Creates the demo user if absent. Returns its id either way. */
async function ensureDemoUser(db) {
  const email = process.env.DEMO_EMAIL;
  const existing = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', [email]);
  if (existing) {
    // Refuse to adopt an account this wasn't meant for — e.g. DEMO_EMAIL
    // mistakenly pointed at a real admin's address. Silently reusing it
    // would let /api/auth/demo hand out that account's session to anyone,
    // credential-free. Fail loudly here instead of quietly rewriting the
    // existing account's role, which would mutate a real user's permissions
    // as a side effect of a config typo.
    if (existing.role !== 'user') {
      throw new Error(`DEMO_EMAIL points at a non-demo account (role: ${existing.role}); refusing to seed`);
    }
    return existing.id;
  }

  const id = uuidv4();
  // The password is never used — /api/auth/demo issues a session directly and
  // there is no path that verifies it. It is random so the account cannot be
  // signed into through the normal login form.
  const password = await hashPassword(uuidv4());

  await run(
    db,
    `INSERT INTO users (id, name, email, password, role, avatar_color, is_active, created_at)
     VALUES (?, ?, ?, ?, 'user', '#0c66e4', 1, datetime('now'))`,
    [id, process.env.DEMO_NAME || 'Demo user', email, password]
  );
  return id;
}

const ISSUES = [
  { title: 'Landing page and one-click demo entry', type: 'story', status: 'inprogress', priority: 'high', points: 8 },
  { title: 'Rate-limit the demo login route', type: 'task', status: 'todo', priority: 'high', points: 3 },
  { title: 'Swimlanes and grouping on the board', type: 'story', status: 'todo', priority: 'medium', points: 5 },
  { title: 'CSV export for sprint reports', type: 'story', status: 'todo', priority: 'low', points: 5 },
  { title: 'Issue stopwatch across midnight', type: 'bug', status: 'inprogress', priority: 'high', points: 2 },
  { title: 'Credit rollup minutes to the work log author', type: 'bug', status: 'done', priority: 'medium', points: 2 },
  { title: 'Blocked status and its transitions', type: 'story', status: 'done', priority: 'medium', points: 3 },
];

/**
 * Idempotent. Safe to call on every boot and on every demo login.
 * Creates the demo user once; drops and recreates the demo project so each
 * reset hands the next visitor a clean workspace.
 */
async function seedDemo(db) {
  if (!process.env.DEMO_EMAIL) return; // Demo not enabled — do nothing.

  const userId = await ensureDemoUser(db);

  // Drop the previous demo project and everything hanging off it. Explicit
  // deletes rather than relying on cascade: the schema does not declare
  // ON DELETE CASCADE on these tables.
  //
  // Only delete if lead_id matches the demo user — this prevents destroying a
  // real customer's project in case DEMO_EMAIL was enabled after someone keyed
  // a project 'DEMO'. If a non-demo-seeded DEMO-keyed project exists, refuse to
  // reset and let the next visitor see a stale demo rather than losing their data.
  const old = await queryOne(
    db,
    'SELECT id, lead_id FROM projects WHERE key = ?',
    [DEMO_PROJECT_KEY]
  );
  if (old) {
    if (old.lead_id !== userId) {
      throw new Error('A DEMO-keyed project exists but was not created by the demo seeder; refusing to reset to avoid data loss');
    }
    await run(db, 'DELETE FROM issues WHERE project_id = ?', [old.id]);
    await run(db, 'DELETE FROM sprints WHERE project_id = ?', [old.id]);
    await run(db, 'DELETE FROM project_members WHERE project_id = ?', [old.id]);
    await run(db, 'DELETE FROM projects WHERE id = ?', [old.id]);
  }

  const projectId = uuidv4();
  await run(
    db,
    `INSERT INTO projects (id, name, key, description, lead_id, created_at)
     VALUES (?, 'Demo workspace', ?, 'A sample board, sprint and backlog.', ?, datetime('now'))`,
    [projectId, DEMO_PROJECT_KEY, userId]
  );

  await run(
    db,
    `INSERT INTO project_members (id, project_id, user_id, role_in_project, added_at)
     VALUES (?, ?, ?, 'member', datetime('now'))`,
    [uuidv4(), projectId, userId]
  );

  const sprintId = uuidv4();
  const now = Date.now();
  // MySQL's DATETIME columns reject the 'T'/'Z' from a raw toISOString() —
  // trim to 'YYYY-MM-DD HH:MM:SS', the same format used at database.js:2380
  // and routes/reports.js:487. Do not simplify this back to .toISOString().
  const startDate = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const endDate = new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await run(
    db,
    `INSERT INTO sprints (id, project_id, name, slug, goal, status, start_date, end_date, created_at)
     VALUES (?, ?, 'Sprint 14', 'sprint-14', 'Ship the public landing page', 'active',
             ?, ?, datetime('now'))`,
    [sprintId, projectId, startDate, endDate]
  );

  for (let i = 0; i < ISSUES.length; i++) {
    const issue = ISSUES[i];
    await run(
      db,
      `INSERT INTO issues
         (id, project_id, sprint_id, issue_key, issue_number, title, type, status,
          priority, reporter_id, assignee_id, story_points, board_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        uuidv4(), projectId, sprintId,
        `${DEMO_PROJECT_KEY}-${i + 1}`, i + 1,
        issue.title, issue.type, issue.status, issue.priority,
        userId, userId, issue.points, i,
      ]
    );
  }

  // One epic, outside the sprint, so the epics screen is not empty.
  await run(
    db,
    `INSERT INTO issues
       (id, project_id, issue_key, issue_number, title, type, status, priority,
        reporter_id, epic_color, board_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Platform readiness', 'epic', 'todo', 'medium', ?, 'purple', ?,
             datetime('now'), datetime('now'))`,
    [uuidv4(), projectId, `${DEMO_PROJECT_KEY}-${ISSUES.length + 1}`, ISSUES.length + 1, userId, ISSUES.length]
  );
}

module.exports = { seedDemo, isDemoStale, ensureDemoUser, DEMO_PROJECT_KEY };
