// ===== FEATURE SPEC ASSEMBLY =====
// Turns what the database already knows about a feature — its objectives, the
// evidence linked to it, and the revenue behind that evidence — into a wiki page
// body.
//
// Deliberately pure and model-free. Assembly is the part that always works, so
// a deployment with no ANTHROPIC_API_KEY still gets a spec worth editing; the
// AI draft in routes/product-features.js layers prose on top of this and is
// allowed to fail without taking the page with it.

// Evidence and company names are customer-authored text arriving through
// insights, and the page they land in renders HTML. This is the injection path
// if anything is, so everything interpolated below goes through esc().
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

function buildSpecBody({ feature, objectives = [], evidence = [], demandBreakdown = [] }) {
  const parts = [];

  parts.push(`<h1>${esc(feature.name)}</h1>`);
  if (feature.description) parts.push(`<p>${esc(feature.description)}</p>`);

  parts.push('<h2>Problem</h2>');
  parts.push('<p><em>What is broken today, in the customer&#39;s terms.</em></p>');

  parts.push('<h2>Evidence</h2>');
  if (evidence.length === 0) {
    parts.push('<p>No evidence linked yet — link insights to this feature and draft again.</p>');
  } else {
    parts.push('<ul>');
    for (const e of evidence) {
      const who = e.company_name ? ` — ${esc(e.company_name)}` : '';
      parts.push(`<li>“${esc(e.quote || '')}”${who} <em>(importance ${Number(e.importance) || 1})</em></li>`);
    }
    parts.push('</ul>');
  }

  if (demandBreakdown.length > 0) {
    parts.push('<h2>Demand</h2><ul>');
    for (const d of demandBreakdown) {
      // An estimated row used its tier median because the company has no ARR
      // recorded. Saying so in the spec keeps the caveat attached to the number
      // once it leaves the screen that computed it.
      const est = d.estimated ? ' <em>(estimated)</em>' : '';
      parts.push(`<li>${esc(d.company_name || 'Unknown company')} — ${money(d.contribution)}${est}</li>`);
    }
    parts.push('</ul>');
  }

  if (objectives.length > 0) {
    parts.push('<h2>Objectives</h2><ul>');
    for (const o of objectives) parts.push(`<li>${esc(o.name)}</li>`);
    parts.push('</ul>');
  }

  parts.push('<h2>Proposed solution</h2>');
  parts.push('<p><em>How this gets solved.</em></p>');
  parts.push('<h2>Open questions</h2>');
  parts.push('<ul><li><em>What still needs deciding?</em></li></ul>');

  return parts.join('\n');
}

module.exports = { buildSpecBody, esc, money };
