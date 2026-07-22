// ===== PERSONAL DASHBOARD LAYOUTS =====
// The dashboard has a deliberately small, closed gadget catalogue. Layouts are
// stored as one ordered JSON document per user/project, which makes saving an
// edit atomic and lets an empty dashboard remain distinct from "use defaults".

const GADGET_DEFINITIONS = Object.freeze({
  summary: { defaultSpan: 2 },
  status: { defaultSpan: 1 },
  active_sprint: { defaultSpan: 1 },
  recent_activity: { defaultSpan: 2 },
  priority_breakdown: { defaultSpan: 1 },
  type_breakdown: { defaultSpan: 1 },
  team_workload: { defaultSpan: 2 },
});

const DEFAULT_DASHBOARD_GADGETS = Object.freeze([
  Object.freeze({ key: 'summary', span: 2 }),
  Object.freeze({ key: 'status', span: 1 }),
  Object.freeze({ key: 'active_sprint', span: 1 }),
  Object.freeze({ key: 'recent_activity', span: 2 }),
]);

function defaultDashboardGadgets() {
  return DEFAULT_DASHBOARD_GADGETS.map((gadget) => ({ ...gadget }));
}

/** Validate untrusted API/stored JSON and return only the persisted contract. */
function validateDashboardGadgets(gadgets) {
  if (!Array.isArray(gadgets)) return { error: 'gadgets must be an array' };
  if (gadgets.length > Object.keys(GADGET_DEFINITIONS).length) {
    return { error: `A dashboard can contain at most ${Object.keys(GADGET_DEFINITIONS).length} gadgets` };
  }

  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < gadgets.length; index += 1) {
    const gadget = gadgets[index];
    if (!gadget || typeof gadget !== 'object' || Array.isArray(gadget)) {
      return { error: `Gadget ${index + 1} must be an object` };
    }
    if (!Object.hasOwn(GADGET_DEFINITIONS, gadget.key)) {
      return { error: `Unknown gadget "${String(gadget.key || '')}"` };
    }
    if (seen.has(gadget.key)) return { error: `Duplicate gadget "${gadget.key}"` };
    if (gadget.span !== 1 && gadget.span !== 2) {
      return { error: `Gadget "${gadget.key}" span must be 1 or 2` };
    }
    seen.add(gadget.key);
    normalized.push({ key: gadget.key, span: gadget.span });
  }
  return { gadgets: normalized };
}

function parseDashboardGadgets(raw) {
  try {
    const parsed = validateDashboardGadgets(JSON.parse(raw));
    return parsed.error ? defaultDashboardGadgets() : parsed.gadgets;
  } catch {
    return defaultDashboardGadgets();
  }
}

module.exports = {
  GADGET_DEFINITIONS,
  DEFAULT_DASHBOARD_GADGETS,
  defaultDashboardGadgets,
  validateDashboardGadgets,
  parseDashboardGadgets,
};
