const SLA_VALUES = ['ok', 'at_risk', 'breached', 'paused'];

function negate(sql, enabled) {
  return enabled ? `NOT (${sql})` : sql;
}

function compileLabel(clause) {
  const fragments = clause.values.map(() => 'i.labels LIKE ?');
  const sql = fragments.length === 1 ? fragments[0] : `(${fragments.join(' OR ')})`;
  const params = clause.values.map(({ value }) => `%"${value}"%`);
  if (clause.operator === 'IS EMPTY' || clause.operator === 'IS NOT EMPTY') {
    const empty = `(i.labels IS NULL OR i.labels = '' OR i.labels = '[]')`;
    return { sql: clause.operator === 'IS NOT EMPTY' ? `NOT ${empty}` : empty, params: [] };
  }
  return { sql: negate(sql, clause.operator === '!=' || clause.operator === 'NOT IN'), params };
}

function identityTerm(column, value, userId) {
  const lowered = value.toLowerCase();
  if (['unassigned', 'none', 'empty'].includes(lowered)) return { sql: `${column} IS NULL`, params: [] };
  if (['me', 'currentuser'].includes(lowered)) return { sql: `${column} = ?`, params: [userId] };
  return {
    sql: `${column} IN (SELECT id FROM users WHERE LOWER(name) = ?)`,
    params: [lowered],
  };
}

function compileIdentity(column) {
  return (clause, context) => {
    if (clause.operator === 'IS EMPTY' || clause.operator === 'IS NOT EMPTY') {
      return {
        sql: `${column} IS ${clause.operator === 'IS NOT EMPTY' ? 'NOT ' : ''}NULL`,
        params: [],
      };
    }
    const terms = clause.values.map(({ value }) => identityTerm(column, value, context.userId));
    const joined = terms.length === 1 ? terms[0].sql : `(${terms.map((t) => t.sql).join(' OR ')})`;
    const params = terms.flatMap((t) => t.params);
    const shouldNegate = clause.operator === '!=' || clause.operator === 'NOT IN';

    // Retain v1's exact SQL for its single-value special cases.
    if (terms.length === 1 && shouldNegate) {
      const lowered = clause.values[0].value.toLowerCase();
      if (['unassigned', 'none', 'empty'].includes(lowered)) {
        return { sql: `${column} IS NOT NULL`, params: [] };
      }
      if (['me', 'currentuser'].includes(lowered)) {
        return { sql: `${column} != ?`, params };
      }
    }
    return { sql: negate(joined, shouldNegate), params };
  };
}

function compileRequestType(clause) {
  if (clause.operator === 'IS EMPTY' || clause.operator === 'IS NOT EMPTY') {
    return {
      sql: `i.request_type_id IS ${clause.operator === 'IS NOT EMPTY' ? 'NOT ' : ''}NULL`,
      params: [],
    };
  }
  const marks = clause.values.map(() => '?').join(', ');
  const sql = `i.request_type_id IN (SELECT id FROM sd_request_types WHERE LOWER(name) IN (${marks}))`;
  return {
    sql: negate(sql, clause.operator === '!=' || clause.operator === 'NOT IN'),
    params: clause.values.map(({ value }) => value.toLowerCase()),
  };
}

const CATEGORY_EXPRESSION = `COALESCE(
  (SELECT LOWER(ps.category) FROM project_statuses ps
    WHERE ps.project_id = i.project_id AND ps.key = i.status LIMIT 1),
  CASE WHEN LOWER(i.status) = 'done' THEN 'done' ELSE 'in_progress' END
)`;

const WAITING_EXPRESSION = `COALESCE(
  (SELECT ps.waiting_for_customer FROM project_statuses ps
    WHERE ps.project_id = i.project_id AND ps.key = i.status LIMIT 1), 0
)`;

function compileWaiting(clause) {
  if (clause.operator === 'IS EMPTY') return { sql: '0 = 1', params: [] };
  if (clause.operator === 'IS NOT EMPTY') return { sql: '1 = 1', params: [] };
  const truthy = new Set(['true', 'yes', '1']);
  const mapped = clause.values.map(({ value }) => truthy.has(value.toLowerCase()) ? 1 : 0);
  const marks = mapped.map(() => '?').join(', ');
  const positive = mapped.length === 1
    ? `${WAITING_EXPRESSION} = ?`
    : `${WAITING_EXPRESSION} IN (${marks})`;
  return {
    sql: negate(positive, clause.operator === '!=' || clause.operator === 'NOT IN'),
    params: mapped,
  };
}

function slaStatePredicate(value) {
  const at = 'COALESCE(c.paused_at, CURRENT_TIMESTAMP)';
  if (value === 'breached') return `c.due_at IS NOT NULL AND c.due_at <= ${at}`;
  if (value === 'at_risk') {
    return `c.at_risk_at IS NOT NULL AND c.due_at IS NOT NULL AND c.at_risk_at <= ${at} AND c.due_at > ${at}`;
  }
  if (value === 'ok') return `c.at_risk_at IS NOT NULL AND c.at_risk_at > ${at}`;
  return 'c.paused_at IS NOT NULL';
}

function compileSla(metric = null) {
  return (clause) => {
    const params = [];
    const base = ['c.issue_id = i.id', 'c.stopped_at IS NULL'];
    if (metric) { base.push('c.metric = ?'); params.push(metric); }

    const exists = (extra = null) => `EXISTS (SELECT 1 FROM sd_sla_clocks c WHERE ${[
      ...base,
      ...(extra ? [`(${extra})`] : []),
    ].join(' AND ')})`;

    if (clause.operator === 'IS EMPTY' || clause.operator === 'IS NOT EMPTY') {
      const sql = exists();
      return { sql: clause.operator === 'IS EMPTY' ? `NOT (${sql})` : sql, params };
    }

    const states = clause.values.map(({ value }) => slaStatePredicate(value.toLowerCase())).join(' OR ');
    const sql = exists(states);
    return {
      sql: negate(sql, clause.operator === '!=' || clause.operator === 'NOT IN'),
      params,
    };
  };
}

const FIELDS = Object.freeze({
  project: { column: 'p.key', ci: true },
  status: { column: 'i.status', ci: true },
  type: { column: 'i.type', ci: true },
  priority: { column: 'i.priority', ci: true },
  assignee: { compile: compileIdentity('i.assignee_id') },
  reporter: { compile: compileIdentity('i.reporter_id') },
  label: { compile: compileLabel },
  sla: { values: SLA_VALUES, compile: compileSla() },
  first_response: { values: SLA_VALUES, compile: compileSla('first_response') },
  resolution: { values: SLA_VALUES, compile: compileSla('resolution') },
  request_type: { compile: compileRequestType },
  category: { column: CATEGORY_EXPRESSION, ci: true },
  waiting_for_customer: {
    values: ['true', 'false', 'yes', 'no', '1', '0'],
    compile: compileWaiting,
  },
});

module.exports = { FIELDS, SLA_VALUES };
