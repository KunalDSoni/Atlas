// ===== SERVICE DESK — pure helpers =====
// No HTTP, no database. Field-schema validation and the customer projection
// live here so they can be tested directly and reused by every route.

const FIELD_TYPES = ['text', 'textarea', 'select', 'date'];

/**
 * Validates a request type's `fields` schema.
 * Returns { ok: true, fields } or { ok: false, error }.
 */
function validateFieldSchema(raw) {
  if (raw === undefined || raw === null) return { ok: true, fields: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'fields must be an array' };
  const seen = new Set();
  for (const f of raw) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'each field must be an object' };
    if (!f.key || !String(f.key).trim()) return { ok: false, error: 'each field needs a key' };
    if (seen.has(f.key)) return { ok: false, error: `duplicate field key "${f.key}"` };
    seen.add(f.key);
    if (!FIELD_TYPES.includes(f.type)) {
      return { ok: false, error: `field "${f.key}" has an unknown type. Try: ${FIELD_TYPES.join(', ')}` };
    }
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) {
      return { ok: false, error: `field "${f.key}" is a select and needs options` };
    }
  }
  return {
    ok: true,
    fields: raw.map((f) => ({
      key: String(f.key).trim(),
      label: String(f.label || f.key).trim(),
      type: f.type,
      required: !!f.required,
      ...(f.type === 'select' ? { options: f.options.map(String) } : {}),
    })),
  };
}

/**
 * Validates submitted values against a field schema.
 * Unknown keys are dropped rather than stored — a customer controls this input,
 * so the schema is the allow-list.
 * Returns { ok: true, values } or { ok: false, error }.
 */
function validateSubmission(schema, submitted) {
  const input = submitted && typeof submitted === 'object' ? submitted : {};
  const values = {};
  for (const f of schema) {
    const raw = input[f.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) {
      if (f.required) return { ok: false, error: `"${f.label}" is required` };
      continue;
    }
    const s = String(raw).trim();
    if (f.type === 'select' && !f.options.includes(s)) {
      return { ok: false, error: `"${f.label}" is not a valid option` };
    }
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { ok: false, error: `"${f.label}" must be YYYY-MM-DD` };
    }
    values[f.key] = s.slice(0, 2000);
  }
  return { ok: true, values };
}

/** Renders submitted values into the issue description an agent reads. */
function renderSubmission(schema, values) {
  return schema
    .filter((f) => values[f.key] !== undefined)
    .map((f) => `**${f.label}**\n${values[f.key]}`)
    .join('\n\n');
}

/**
 * The ONLY way an issue becomes a customer-visible payload.
 *
 * This is an allow-list: it names every key a customer may see and copies
 * nothing else. Adding a column to `issues` can therefore never leak it here.
 * Rejected alternative: a deny-list of internal fields, which fails open the
 * day someone adds a column.
 */
function toPublicRequest(issue, { requestType, statusLabel, statusCategory, comments = [] } = {}) {
  let fields = {};
  try { fields = JSON.parse(issue.sd_fields || '{}'); } catch (e) { fields = {}; }

  return {
    key: issue.issue_key,
    summary: issue.title,
    description: issue.description || '',
    fields,
    request_type: requestType ? { name: requestType.name, icon: requestType.icon } : null,
    status: statusLabel || issue.status,
    status_category: statusCategory || null,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    comments: comments
      .filter((c) => c.visibility !== 'internal')
      .map((c) => ({
        id: c.id,
        body: c.body,
        author_name: c.author_name,
        created_at: c.created_at,
      })),
  };
}

module.exports = {
  FIELD_TYPES, validateFieldSchema, validateSubmission, renderSubmission, toPublicRequest,
};
