const { parseJql } = require('./jql');

const FILTER_NAME_MAX = 80;
const JQL_MAX = 2000;
const BACKLOG_QUERY_MAX = 500;
const BACKLOG_VALUE_MAX = 120;

const BACKLOG_KEYS = new Set(['kind', 'query', 'status', 'type', 'assignee', 'label']);
const JQL_KEYS = new Set(['kind', 'jql']);

const BACKLOG_DEFAULTS = Object.freeze({
  kind: 'backlog',
  query: '',
  status: 'all',
  type: 'all',
  assignee: 'all',
  label: 'all',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownKey(input, allowed) {
  return Object.keys(input).find((key) => !allowed.has(key));
}

function boundedString(value, field, max, fallback) {
  if (value === undefined) return { value: fallback };
  if (typeof value !== 'string') return { error: `${field} must be a string` };
  if (value.length > max) return { error: `${field} must be ${max} characters or fewer` };
  return { value };
}

function validateFilterName(value) {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Filter name required' };
  const name = value.trim();
  if (name.length > FILTER_NAME_MAX) {
    return { error: `Filter name must be ${FILTER_NAME_MAX} characters or fewer` };
  }
  return { value: name };
}

/**
 * Normalizes both the pre-Epic-55 backlog document and the new typed documents.
 * Strict mode is used on writes; tolerant mode lets an old row remain editable
 * even if it contains a key a previous Atlas version happened to persist.
 */
function validateSavedFilterParams(input, userId, options = {}) {
  const strict = options.strict !== false;
  const validateJql = options.validateJql !== false;
  if (!isPlainObject(input)) return { error: 'Filter params must be an object' };

  // The original backlog feature had no discriminator. A `jql` member is an
  // unambiguous new document; every other legacy object is a backlog preset.
  const kind = input.kind ?? (Object.prototype.hasOwnProperty.call(input, 'jql') ? 'jql' : 'backlog');
  if (kind !== 'backlog' && kind !== 'jql') return { error: 'Filter kind must be backlog or jql' };

  if (kind === 'jql') {
    const extra = unknownKey(input, JQL_KEYS);
    if (strict && extra) return { error: `Unknown JQL filter field: ${extra}` };
    if (typeof input.jql !== 'string' || !input.jql.trim()) return { error: 'JQL query required' };
    const jql = input.jql.trim();
    if (jql.length > JQL_MAX) return { error: `JQL query must be ${JQL_MAX} characters or fewer` };
    if (validateJql) {
      const parsed = parseJql(jql, userId);
      if (parsed.error) return { error: parsed.error };
    }
    return { value: { kind: 'jql', jql } };
  }

  const extra = unknownKey(input, BACKLOG_KEYS);
  if (strict && extra) return { error: `Unknown backlog filter field: ${extra}` };

  const query = boundedString(input.query, 'Backlog query', BACKLOG_QUERY_MAX, BACKLOG_DEFAULTS.query);
  if (query.error) return query;
  const normalized = { kind: 'backlog', query: query.value };
  for (const field of ['status', 'type', 'assignee', 'label']) {
    const checked = boundedString(input[field], `Backlog ${field}`, BACKLOG_VALUE_MAX, BACKLOG_DEFAULTS[field]);
    if (checked.error) return checked;
    normalized[field] = checked.value;
  }
  return { value: normalized };
}

function parseStoredFilterParams(serialized, userId) {
  let parsed;
  try {
    parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  } catch {
    return { ...BACKLOG_DEFAULTS };
  }
  const normalized = validateSavedFilterParams(parsed, userId, { strict: false, validateJql: false });
  return normalized.error ? { ...BACKLOG_DEFAULTS } : normalized.value;
}

module.exports = {
  BACKLOG_DEFAULTS,
  FILTER_NAME_MAX,
  JQL_MAX,
  validateFilterName,
  validateSavedFilterParams,
  parseStoredFilterParams,
};
