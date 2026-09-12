// ===== AUTOMATIC SPRINT SCHEDULING =====
// Sprints run on a fixed semi-monthly calendar: the 1st-15th and the 16th-end
// of month. Atlas creates each window's sprint, activates it when the window
// opens, completes the outgoing one, and sweeps unfinished work forward.
// Global — every project, no setting, no opt-out.
//
// No cron. Atlas has no scheduler (utils/sla.js:2), and derived state here is
// repaired lazily on the next read, the same way abandoned timer segments are
// (utils/timers.js:12). reconcileProject runs at the top of the sprint reads,
// so a boundary takes effect on the first request after it passes rather than
// at midnight exactly. Nobody is looking at a board at 00:00; the first person
// who looks sees the right state.
//
// Every write here is idempotent. Calling it twice in a row is a no-op, and two
// concurrent callers cannot both create the same sprint — UNIQUE(project_id,
// auto_key) lets exactly one insert through and the loser re-reads.

const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, run } = require('../database');
const { auditLog } = require('../middleware/logger');
const { slugify, uniqueSlug } = require('./slug');
const { currentAndNext } = require('./sprint-windows');
const { leavesClosingSprint } = require('./done-status');

// What the audit trail shows as the actor. audit_log.user_id stays null — there
// is no user — but a named actor reads better than a blank one in the log, and
// audit-log.tsx already falls back to "System" for entries that have neither.
const SYSTEM_ACTOR = 'Atlas scheduler';

/**
 * Moves every issue that should not stay in a closing sprint over to
 * `toSprintId` (null meaning the backlog). Returns how many moved.
 *
 * Each move writes an activity_log row with field 'sprint' and the old sprint
 * as old_value. That row is not bookkeeping — it is the sole source
 * `previousSprints` reads to build an issue's rollover history
 * (routes/issues.js:111). Without it, automatically-rolled work would silently
 * lose the history that hand-rolled work keeps.
 */
async function sweepUnfinished(db, fromSprintId, toSprintId) {
  const rows = await queryAll(db,
    `SELECT i.id FROM issues i WHERE i.sprint_id = ? AND ${leavesClosingSprint('i')}`,
    [fromSprintId]);

  for (const row of rows) {
    await run(db, 'UPDATE issues SET sprint_id = ? WHERE id = ?', [toSprintId, row.id]);
    await run(db,
      `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value)
       VALUES (?, ?, NULL, 'update', 'sprint', ?, ?)`,
      [uuidv4(), row.id, fromSprintId, toSprintId]);
  }

  return rows.length;
}

/**
 * The sprint for `window`, created if it is not there yet.
 *
 * The slug is deterministic in spirit but collision-tolerant in practice: a
 * hand-made sprint could already hold `sprint-2026-09-1`, and UNIQUE(project_id,
 * slug) would turn that into a 500 on an ordinary GET. Identity lives in
 * auto_key, not the slug, so falling back to a suffixed slug costs nothing.
 */
async function ensureWindowSprint(db, projectId, window, existing, takenSlugs) {
  if (existing) return existing;

  const id = uuidv4();
  const slug = uniqueSlug(slugify(window.slug), takenSlugs);
  takenSlugs.push(slug);

  try {
    await run(db,
      `INSERT INTO sprints (id, project_id, name, slug, goal, status, start_date, end_date, auto_key)
       VALUES (?, ?, ?, ?, '', 'planning', ?, ?, ?)`,
      [id, projectId, window.name, slug, window.start_date, window.end_date, window.key]);
  } catch (e) {
    // Lost a race to a concurrent request. The unique index did its job; read
    // the winner rather than failing someone's page load.
    const raced = await queryOne(db,
      'SELECT * FROM sprints WHERE project_id = ? AND auto_key = ?', [projectId, window.key]);
    if (raced) return raced;
    throw e;
  }

  auditLog({
    userId: null, userName: SYSTEM_ACTOR, action: 'Sprint auto-created', category: 'sprints',
    entityType: 'sprint', entityId: id, entityName: window.name,
    details: { window: window.key, start_date: window.start_date, end_date: window.end_date },
  });

  return queryOne(db, 'SELECT * FROM sprints WHERE id = ?', [id]);
}

/** Sweeps a sprint's unfinished work forward and closes it. */
async function completeOutgoing(db, sprint, destinationId) {
  const moved = await sweepUnfinished(db, sprint.id, destinationId);
  await run(db, "UPDATE sprints SET status = 'completed' WHERE id = ?", [sprint.id]);

  auditLog({
    userId: null, userName: SYSTEM_ACTOR, action: 'Sprint auto-completed', category: 'sprints',
    entityType: 'sprint', entityId: sprint.id, entityName: sprint.name,
    details: {
      from: sprint.status, to: 'completed', moved_issues: moved,
      // A hand-made sprint swept by the scheduler is the case most likely to
      // surprise someone, so it is called out rather than inferred later.
      was_manual: !sprint.auto_key,
    },
  });

  return moved;
}

/**
 * Brings `projectId`'s sprints in line with the calendar as of `now`.
 * Safe to call on every read; the steady state costs one query.
 */
async function reconcileProject(db, projectId, now = new Date()) {
  const { current, next } = currentAndNext(now);

  const sprints = await queryAll(db,
    'SELECT id, name, slug, status, auto_key FROM sprints WHERE project_id = ?', [projectId]);

  const byKey = new Map(sprints.filter((s) => s.auto_key).map((s) => [s.auto_key, s]));
  const actives = sprints.filter((s) => s.status === 'active');
  const currentExisting = byKey.get(current.key);

  // Steady state: this window's sprint is the one and only active sprint, and
  // the next window is already waiting. Nothing to do.
  if (currentExisting && byKey.has(next.key)
    && currentExisting.status === 'active'
    && actives.length === 1 && actives[0].id === currentExisting.id) {
    return;
  }

  const takenSlugs = sprints.map((s) => s.slug).filter(Boolean);
  const createdCurrent = !currentExisting;
  const currentRow = await ensureWindowSprint(db, projectId, current, currentExisting, takenSlugs);
  const nextRow = await ensureWindowSprint(db, projectId, next, byKey.get(next.key), takenSlugs);

  // The calendar acts at a HANDOVER, not merely because a window is current.
  // Between handovers a person is in charge, and the scheduler keeps its hands
  // off the active slot.
  //
  // Without this the scheduler re-activates the current window on every single
  // read, which quietly breaks two things a person is entitled to do:
  //
  //   - Parking the running sprint. Set it to planning, and the next page load
  //     puts it straight back.
  //   - Reopening a sprint at all. Reopen refuses while another sprint is
  //     active, so an always-active calendar sprint makes POST /sprints/:id/
  //     reopen permanently unreachable — and a reopen that did land would be
  //     completed again on the next read.
  //
  // A sprint whose end date is still ahead of us is somebody's deliberate
  // arrangement rather than something the calendar has overtaken: reopen sets a
  // new end date precisely to say "this one runs until then". Such a sprint is
  // not outgoing, so its presence alone does not trigger a handover.
  //
  // What counts as a handover is narrow on purpose: the calendar materialising
  // this window for the first time, or a sprint the calendar itself scheduled
  // for an EARLIER window still holding the slot past its end date. A sprint
  // somebody made by hand never triggers one. Letting it would be circular —
  // a hand-made sprint has no end date, so its own presence would trigger the
  // handover that immediately completes it, and no one could ever run a sprint
  // of their own. Such a sprint is still swept at the next real handover, which
  // is what "swept at the next boundary" was asked to mean.
  const today = dayOf(now);
  const stillRunning = (s) => s.end_date && dayOf(s.end_date) >= today;
  const overtaken = (s) => s.auto_key && s.auto_key !== current.key && !stillRunning(s);
  const handingOver = createdCurrent || actives.some(overtaken);
  if (!handingOver) return;

  // Unfinished work lands in the current window, unless a human already
  // completed it early — never sweep work into a closed sprint.
  const destination = [currentRow, nextRow].find((s) => s.status !== 'completed') ?? null;
  const destinationId = destination ? destination.id : null;

  // Once the calendar is handing over, EVERY other active sprint closes —
  // including one whose end date is still ahead. Only one sprint may be active,
  // and that deliberately covers hand-made sprints (auto_key IS NULL): global
  // scheduling means an in-flight manual sprint is swept at the first handover,
  // which is the behaviour this feature was asked for. Manual sprints still in
  // 'planning' are left alone — they are not active, so they block nothing.
  for (const active of actives) {
    if (active.id === currentRow.id) continue;
    await completeOutgoing(db, active, destinationId);
  }

  if (currentRow.status === 'planning') {
    await run(db, "UPDATE sprints SET status = 'active' WHERE id = ?", [currentRow.id]);
    auditLog({
      userId: null, userName: SYSTEM_ACTOR, action: 'Sprint auto-started', category: 'sprints',
      entityType: 'sprint', entityId: currentRow.id, entityName: currentRow.name,
      details: { window: current.key, from: 'planning', to: 'active' },
    });
  }
  // A completed current window is left completed. Bringing a sprint back from
  // completed is what POST /sprints/:id/reopen is for, and it stays the
  // deliberate, audited, human path it is today.
}

/** The calendar day of a Date or a stored date string, in UTC. */
function dayOf(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

module.exports = { reconcileProject, sweepUnfinished };
