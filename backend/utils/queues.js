// ===== AGENT QUEUES — pure helpers =====
// No HTTP, no database. A queue is a stored JQL string plus presentation
// (which columns, what order), so everything a queue can carry has to be
// validated against an allow-list before it is written: the query goes through
// parseJql, and `order_by` is interpolated into SQL rather than bound, so it
// can only ever be a key of ORDER_BY.

const { parseJql } = require('./jql');

// The columns a queue table may show. Presentation only — the API always
// returns the full enriched issue and the client picks from it — but stored
// values are validated so a typo surfaces when the queue is saved, not as a
// blank column later.
const QUEUE_COLUMNS = [
  'key', 'summary', 'type', 'status', 'priority', 'assignee', 'reporter',
  'request_type', 'created', 'updated', 'sla',
];

// `order_by` is INTERPOLATED into the ORDER BY clause (SQL has no placeholder
// for a column), so this map is the only thing standing between a stored queue
// and arbitrary SQL. Never build the clause from user input directly.
const ORDER_BY = {
  created_at: 'i.created_at DESC',
  created_at_asc: 'i.created_at ASC',
  updated_at: 'i.updated_at DESC',
  key: 'i.issue_number ASC',
  summary: 'i.title ASC',
  status: 'i.status ASC',
  // Priority sorts by severity, not alphabetically — 'highest' before 'low'.
  priority: `CASE i.priority WHEN 'highest' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
             WHEN 'low' THEN 3 ELSE 4 END ASC, i.created_at DESC`,
};

const DEFAULT_ORDER_BY = 'created_at';

/**
 * Validates a queue's stored definition.
 * `userId` is only used to resolve `= me` while checking the query parses.
 * Returns { ok: true, queue: {name, jql, columns, order_by, position} }
 *      or { ok: false, error }.
 */
function validateQueue(input, userId) {
  const name = String(input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Name required' };

  const jql = String(input.jql ?? '').trim();
  if (!jql) return { ok: false, error: 'A queue needs a JQL query' };
  const parsed = parseJql(jql, userId);
  if (parsed.error) return { ok: false, error: parsed.error };

  const order_by = input.order_by === undefined || input.order_by === null || input.order_by === ''
    ? DEFAULT_ORDER_BY
    : String(input.order_by);
  if (!ORDER_BY[order_by]) {
    return { ok: false, error: `Unknown sort "${order_by}". Try: ${Object.keys(ORDER_BY).join(', ')}` };
  }

  let columns = input.columns === undefined || input.columns === null
    ? ['key', 'summary', 'status', 'assignee', 'created']
    : input.columns;
  if (!Array.isArray(columns)) return { ok: false, error: 'columns must be an array' };
  columns = columns.map(String);
  const unknown = columns.find((c) => !QUEUE_COLUMNS.includes(c));
  if (unknown) {
    return { ok: false, error: `Unknown column "${unknown}". Try: ${QUEUE_COLUMNS.join(', ')}` };
  }
  if (columns.length === 0) return { ok: false, error: 'A queue needs at least one column' };

  return {
    ok: true,
    queue: {
      name,
      jql,
      columns,
      order_by,
      position: Number.isFinite(Number(input.position)) ? Number(input.position) : 0,
    },
  };
}

module.exports = { QUEUE_COLUMNS, ORDER_BY, DEFAULT_ORDER_BY, validateQueue };
