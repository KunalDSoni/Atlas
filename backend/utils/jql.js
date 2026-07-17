// ===== JQL-lite =====
// A tiny structured query language for the global search box, e.g.
//   status = done AND type = bug AND assignee = me
//   project = ATLAS AND priority != low AND label = backend
//
// Grammar: CLAUSE (AND CLAUSE)*  where  CLAUSE = field OP value
//   OP    = '=' | '!='
//   value = bare token or "quoted string"
// Supported fields map to issue columns. Unknown fields are a hard error so a
// typo doesn't silently fall through to a text search. isJqlLike() decides
// whether a raw query should be parsed as JQL at all (it contains an operator).

const FIELDS = {
  project: { column: 'p.key', ci: true },
  status: { column: 'i.status', ci: true },
  type: { column: 'i.type', ci: true },
  priority: { column: 'i.priority', ci: true },
  assignee: { column: 'assignee', special: 'assignee' },
  reporter: { column: 'reporter', special: 'reporter' },
  label: { column: 'i.labels', special: 'label' },
};

// A query is treated as JQL when it contains an `=` operator (with or without
// surrounding spaces). Plain text like "login bug" stays a LIKE search.
function isJqlLike(q) {
  return /[a-zA-Z_]+\s*(!=|=)/.test(q);
}

// Split on AND at the top level (case-insensitive, whitespace-delimited).
function splitClauses(q) {
  return q.split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean);
}

function stripQuotes(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// Parse a JQL-lite string into { where, params } SQL against aliases
// i (issues), p (projects), and correlated subqueries for assignee/reporter.
// Returns { error } for anything malformed. `userId` resolves `= me`.
function parseJql(q, userId) {
  const clauses = splitClauses(q);
  if (clauses.length === 0) return { error: 'Empty query' };

  const where = [];
  const params = [];

  for (const clause of clauses) {
    const m = clause.match(/^([a-zA-Z_]+)\s*(!=|=)\s*(.+)$/);
    if (!m) return { error: `Could not parse "${clause}"` };
    const field = m[1].toLowerCase();
    const op = m[2];
    const rawValue = stripQuotes(m[3]);
    const def = FIELDS[field];
    if (!def) return { error: `Unknown field "${field}". Try: ${Object.keys(FIELDS).join(', ')}` };

    const negate = op === '!=';

    if (def.special === 'label') {
      // Labels are stored as a JSON array string; match the quoted token.
      const frag = `i.labels LIKE ?`;
      where.push(negate ? `NOT (${frag})` : frag);
      params.push(`%"${rawValue}"%`);
      continue;
    }

    if (def.special === 'assignee' || def.special === 'reporter') {
      const col = def.special === 'assignee' ? 'i.assignee_id' : 'i.reporter_id';
      const lowered = rawValue.toLowerCase();
      if (lowered === 'unassigned' || lowered === 'none' || lowered === 'empty') {
        where.push(negate ? `${col} IS NOT NULL` : `${col} IS NULL`);
        continue;
      }
      if (lowered === 'me' || lowered === 'currentuser') {
        where.push(`${col} ${negate ? '!=' : '='} ?`);
        params.push(userId);
        continue;
      }
      // Match by user name (case-insensitive). Correlated subquery keeps the
      // base query's single JOIN shape intact.
      const sub = `${col} IN (SELECT id FROM users WHERE LOWER(name) = ?)`;
      where.push(negate ? `NOT (${sub})` : sub);
      params.push(lowered);
      continue;
    }

    // Simple column comparison
    if (def.ci) {
      where.push(`LOWER(${def.column}) ${negate ? '!=' : '='} ?`);
      params.push(rawValue.toLowerCase());
    } else {
      where.push(`${def.column} ${negate ? '!=' : '='} ?`);
      params.push(rawValue);
    }
  }

  return { where: where.join(' AND '), params };
}

module.exports = { parseJql, isJqlLike, FIELDS };
