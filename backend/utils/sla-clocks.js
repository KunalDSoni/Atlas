// ===== SLA CLOCKS — the lifecycle =====
// Where utils/sla.js derives state from a clock row, this file is the only
// place clock rows are WRITTEN. Every hook is:
//
//   - a no-op unless the issue is a request that has clocks, so it can be
//     called unconditionally from generic issue/comment routes; and
//   - guarded so an SLA failure never fails the user's actual action — an
//     agent's reply must land even if a clock update throws.
//
// Hooks, in the order a request meets them:
//   onRequestRaised  → start a clock per matching goal
//   onComment        → first public agent reply stops first_response;
//                      a customer reply resumes a paused clock
//   onStatusChange   → done stops resolution (reopening restarts it);
//                      a waiting-for-customer status pauses, leaving it resumes
//   readClocks       → derive state, opportunistically stamp breached_at

const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, run } = require('../database');
const { slaState, slaBoundaries, sqlTimestamp, parseTime } = require('./sla');

const METRICS = ['first_response', 'resolution'];

/** Persist the same boundaries slaState() derives, without dialect date math. */
async function refreshClockBoundaries(db, clock) {
  const boundaries = slaBoundaries(clock);
  if ((clock.due_at || null) !== boundaries.due_at ||
      (clock.at_risk_at || null) !== boundaries.at_risk_at) {
    await run(db, 'UPDATE sd_sla_clocks SET due_at = ?, at_risk_at = ? WHERE id = ?',
      [boundaries.due_at, boundaries.at_risk_at, clock.id]);
  }
  return { ...clock, ...boundaries };
}

async function refreshBoundaries(db, issueId, metric = null) {
  const params = [issueId];
  let sql = 'SELECT * FROM sd_sla_clocks WHERE issue_id = ?';
  if (metric) { sql += ' AND metric = ?'; params.push(metric); }
  const clocks = await queryAll(db, sql, params);
  return Promise.all(clocks.map((clock) => refreshClockBoundaries(db, clock)));
}

/**
 * The goals that apply to a request, one per metric.
 * A goal naming the request's priority beats the any-priority goal — the
 * ORDER BY puts the specific one last so it overwrites in the map.
 */
async function goalsFor(db, requestTypeId, priority) {
  if (!requestTypeId) return [];
  const rows = await queryAll(db,
    `SELECT * FROM sd_sla_goals
      WHERE request_type_id = ? AND (priority IS NULL OR priority = ?)
      ORDER BY CASE WHEN priority IS NULL THEN 0 ELSE 1 END`,
    [requestTypeId, priority || null]);

  const byMetric = new Map();
  for (const g of rows) byMetric.set(g.metric, g);
  return [...byMetric.values()];
}

/** Starts one clock per goal. Existing clocks are left alone. */
async function onRequestRaised(db, issue) {
  if (!issue || issue.type !== 'request') return;
  const goals = await goalsFor(db, issue.request_type_id, issue.priority);
  for (const goal of goals) {
    const existing = await queryOne(db,
      'SELECT id FROM sd_sla_clocks WHERE issue_id = ? AND metric = ?', [issue.id, goal.metric]);
    if (existing) continue;
    const startedAt = sqlTimestamp(Date.now());
    const boundaries = slaBoundaries({
      started_at: startedAt,
      target_minutes: goal.target_minutes,
      paused_total_minutes: 0,
    });
    await run(db,
      `INSERT INTO sd_sla_clocks
        (id, issue_id, metric, goal_id, target_minutes, started_at, due_at, at_risk_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), issue.id, goal.metric, goal.id, goal.target_minutes, startedAt,
        boundaries.due_at, boundaries.at_risk_at]);
  }
}

async function clocksOf(db, issueId) {
  return queryAll(db, 'SELECT * FROM sd_sla_clocks WHERE issue_id = ?', [issueId]);
}

/** Stops a running clock. A clock already stopped keeps its original time. */
async function stopMetric(db, issueId, metric) {
  await run(db,
    `UPDATE sd_sla_clocks SET stopped_at = ?
      WHERE issue_id = ? AND metric = ? AND stopped_at IS NULL`,
    [sqlTimestamp(Date.now()), issueId, metric]);
  await refreshBoundaries(db, issueId, metric);
}

/**
 * Banks any in-flight pause, then clears the stop so the clock runs again.
 * Resolution time measures raise → actually resolved, so a reopened request
 * continues accruing rather than starting over and under-reporting.
 */
async function restartMetric(db, issueId, metric) {
  await run(db,
    'UPDATE sd_sla_clocks SET stopped_at = NULL WHERE issue_id = ? AND metric = ?',
    [issueId, metric]);
  await refreshBoundaries(db, issueId, metric);
}

/** Freezes every still-running clock at now. */
async function pauseClocks(db, issueId) {
  await run(db,
    `UPDATE sd_sla_clocks SET paused_at = ?
      WHERE issue_id = ? AND stopped_at IS NULL AND paused_at IS NULL`,
    [sqlTimestamp(Date.now()), issueId]);
  await refreshBoundaries(db, issueId);
}

/**
 * Banks the paused interval into paused_total_minutes and clears paused_at.
 * The arithmetic is done here rather than in SQL because date subtraction has
 * no portable form across sql.js and MySQL.
 */
async function resumeClocks(db, issueId) {
  const rows = await queryAll(db,
    'SELECT * FROM sd_sla_clocks WHERE issue_id = ? AND paused_at IS NOT NULL', [issueId]);
  const now = Date.now();
  for (const clock of rows) {
    const pausedAt = parseTime(clock.paused_at);
    const banked = pausedAt === null ? 0 : Math.max(0, Math.round((now - pausedAt) / 60_000));
    const pausedTotal = (Number(clock.paused_total_minutes) || 0) + banked;
    const boundaries = slaBoundaries({ ...clock, paused_total_minutes: pausedTotal });
    await run(db,
      `UPDATE sd_sla_clocks
          SET paused_at = NULL, paused_total_minutes = ?, due_at = ?, at_risk_at = ?
        WHERE id = ?`,
      [pausedTotal, boundaries.due_at, boundaries.at_risk_at, clock.id]);
  }
}

/**
 * A comment moved the request on.
 * `byCustomer` is the caller's judgement (the help center knows its callers are
 * customers; the agent comment route knows its callers are staff) rather than
 * something re-derived from roles here.
 */
async function onComment(db, issue, { byCustomer, visibility = 'public' } = {}) {
  if (!issue || issue.type !== 'request') return;

  if (byCustomer) {
    // The customer answered, so whatever we were waiting for has arrived.
    await resumeClocks(db, issue.id);
    return;
  }
  // An internal note is a note to ourselves, not a response to the customer —
  // that distinction is the whole reason comment visibility exists.
  if (visibility === 'internal') return;
  await stopMetric(db, issue.id, 'first_response');
}

/** Resolves a status key to its category and waiting flag for a project. */
async function statusMeta(db, projectId, statusKey) {
  const row = await queryOne(db,
    'SELECT category, waiting_for_customer FROM project_statuses WHERE project_id = ? AND key = ?',
    [projectId, statusKey]);
  if (row) {
    return { category: row.category, waiting: !!Number(row.waiting_for_customer) };
  }
  // Projects on the built-in workflow have no rows; 'done' is the only status
  // there with a category that matters, and none can wait on a customer.
  return { category: statusKey === 'done' ? 'done' : 'in_progress', waiting: false };
}

async function onStatusChange(db, issue, newStatus) {
  if (!issue || issue.type !== 'request') return;
  const clocks = await clocksOf(db, issue.id);
  if (clocks.length === 0) return;

  const { category, waiting } = await statusMeta(db, issue.project_id, newStatus);

  if (category === 'done') {
    await stopMetric(db, issue.id, 'resolution');
    // A resolved request is not waiting on anybody; bank any pause so the
    // stopped clock does not carry a dangling paused_at.
    await resumeClocks(db, issue.id);
    return;
  }

  // Not done any more: whether it was resolved or not, the clock runs again.
  await restartMetric(db, issue.id, 'resolution');

  if (waiting) await pauseClocks(db, issue.id);
  else await resumeClocks(db, issue.id);
}

/**
 * The read path. Derives state through slaState() and records the moment a
 * breach was first OBSERVED — reads never depend on breached_at, so clearing
 * or missing it changes nothing about what this returns.
 */
async function readClocks(db, issueId) {
  // This also repairs a row imported or edited outside the lifecycle hooks.
  // Normal reads are a no-op because the persisted values already agree.
  const clocks = await refreshBoundaries(db, issueId);
  const out = [];
  for (const clock of clocks) {
    const state = slaState(clock, { target_minutes: clock.target_minutes });
    if (!state) continue;
    if (state.status === 'breached' && !clock.breached_at) {
      await run(db, 'UPDATE sd_sla_clocks SET breached_at = ? WHERE id = ?',
        [sqlTimestamp(Date.now()), clock.id]);
    }
    out.push({
      metric: clock.metric,
      started_at: clock.started_at,
      stopped_at: clock.stopped_at,
      breached_at: clock.breached_at,
      due_at: clock.due_at,
      at_risk_at: clock.at_risk_at,
      ...state,
    });
  }
  return out;
}

/**
 * Wraps a hook so an SLA bookkeeping failure can never fail the action that
 * triggered it. A dropped clock update is a reporting gap; a 500 on an agent's
 * reply is lost work.
 */
function safely(fn) {
  return async (...args) => {
    try { await fn(...args); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sla] hook failed:', e.message);
    }
  };
}

module.exports = {
  METRICS,
  goalsFor,
  readClocks,
  refreshBoundaries,
  onRequestRaised: safely(onRequestRaised),
  onComment: safely(onComment),
  onStatusChange: safely(onStatusChange),
};
