const { parseToAst, tokenize } = require('./parse');
const { compileAst } = require('./compile');
const { FIELDS } = require('./fields');

/**
 * Parses and compiles JQL v2 to parameterized SQL against aliases `i`
 * (issues) and `p` (projects). The public shape is unchanged from JQL v1.
 */
function parseJql(query, userId) {
  const parsed = parseToAst(query);
  if (parsed.error) return { error: parsed.error, column: parsed.column };
  return compileAst(parsed.ast, { userId });
}

// Plain text stays a LIKE search. JQL v2 can be recognized by comparison, set,
// or emptiness operators; the field-shaped prefix avoids treating "log in now"
// as a query merely because it contains the English word "in".
function isJqlLike(query) {
  return /[a-zA-Z_][a-zA-Z0-9_]*\s*(?:!=|=|(?:NOT\s+)?IN\s*\(|IS\s+(?:NOT\s+)?EMPTY\b)/i
    .test(String(query || ''));
}

module.exports = { parseJql, isJqlLike, FIELDS, parseToAst, compileAst, tokenize };
