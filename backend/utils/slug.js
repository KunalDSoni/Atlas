/** A URL segment from a human name: "Sprint 1" -> "sprint-1", "v1.2" -> "v1-2". */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}

/** Appends -2, -3, ... until the slug is free within its project. */
function uniqueSlug(base, taken) {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

module.exports = { slugify, uniqueSlug };
