// Small SQL helpers shared by the batched (non-N+1) read paths.

/**
 * Placeholder list for an IN clause: placeholders([a, b, c]) => '?,?,?'.
 * The values are still bound as parameters by the caller — only the count is
 * interpolated, so this stays injection-safe.
 */
function placeholders(values) {
  if (values.length === 0) throw new Error('placeholders() needs at least one value');
  return values.map(() => '?').join(',');
}

/** Index rows by a column, keeping the first row seen per key. */
function indexBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], row);
  }
  return map;
}

/** Map<key, count> from rows shaped { <key>, count }. */
function countsBy(rows, key, countColumn = 'count') {
  const map = new Map();
  for (const row of rows) map.set(row[key], Number(row[countColumn]));
  return map;
}

module.exports = { placeholders, indexBy, countsBy };
