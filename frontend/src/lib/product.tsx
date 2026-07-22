// Shared display helpers for the Product module (labels, colors, score math).
import type {
  CompanyTier, FeatureStatus, InsightOrigin, InsightSource, ObjectiveStatus, PortalStatus, Timeframe,
} from './types';

export const FEATURE_STATUS_LABELS: Record<FeatureStatus, string> = {
  idea: 'Idea',
  discovery: 'Discovery',
  planned: 'Planned',
  in_progress: 'In progress',
  launched: 'Launched',
  archived: 'Archived',
};

export const FEATURE_STATUS_CLASS: Record<FeatureStatus, string> = {
  idea: 'bg-slate-500/15 text-slate-500',
  discovery: 'bg-violet-500/15 text-violet-500',
  planned: 'bg-blue-500/15 text-blue-500',
  in_progress: 'bg-amber-500/15 text-amber-600',
  launched: 'bg-emerald-500/15 text-emerald-600',
  archived: 'bg-neutral-500/15 text-neutral-500',
};

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  now: 'Now',
  next: 'Next',
  later: 'Later',
};

export const TIMEFRAME_CLASS: Record<Timeframe, string> = {
  now: 'bg-emerald-500/15 text-emerald-600',
  next: 'bg-blue-500/15 text-blue-500',
  later: 'bg-slate-500/15 text-slate-500',
};

export const INSIGHT_SOURCE_LABELS: Record<InsightSource, string> = {
  portal: 'Portal',
  email: 'Email',
  support: 'Support',
  sales: 'Sales',
  interview: 'Interview',
  other: 'Other',
};

// Where a captured insight came from. Distinct from `source`, which is the
// broad category (support/sales/…): origin names the specific surface, so the
// inbox can chip "Request" or "Wiki" and link back to the row it came from.
export const INSIGHT_ORIGIN_LABELS: Record<InsightOrigin, string> = {
  request: 'Request',
  comment: 'Comment',
  wiki: 'Wiki',
  portal: 'Portal',
  manual: 'Manual',
};

export const TIER_LABELS: Record<CompanyTier, string> = {
  strategic: 'Strategic',
  growth: 'Growth',
  standard: 'Standard',
};

export const TIER_CLASS: Record<CompanyTier, string> = {
  strategic: 'bg-fuchsia-500/15 text-fuchsia-600',
  growth: 'bg-blue-500/15 text-blue-500',
  standard: 'bg-slate-500/15 text-slate-500',
};

export const TIER_WEIGHT: Record<CompanyTier, number> = {
  strategic: 3,
  growth: 2,
  standard: 1,
};

export const OBJECTIVE_STATUS_LABELS: Record<ObjectiveStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  done: 'Done',
};

export const OBJECTIVE_STATUS_CLASS: Record<ObjectiveStatus, string> = {
  on_track: 'bg-emerald-500/15 text-emerald-600',
  at_risk: 'bg-amber-500/15 text-amber-600',
  off_track: 'bg-red-500/15 text-red-500',
  done: 'bg-blue-500/15 text-blue-500',
};

export const PORTAL_STATUS_LABELS: Record<PortalStatus, string> = {
  under_consideration: 'Under consideration',
  planned: 'Planned',
  launched: 'Launched',
};

export const PORTAL_STATUS_CLASS: Record<PortalStatus, string> = {
  under_consideration: 'bg-slate-500/15 text-slate-500',
  planned: 'bg-blue-500/15 text-blue-500',
  launched: 'bg-emerald-500/15 text-emerald-600',
};

export const FEATURE_STATUS_OPTIONS = Object.keys(FEATURE_STATUS_LABELS) as FeatureStatus[];
export const TIMEFRAME_OPTIONS = Object.keys(TIMEFRAME_LABELS) as Timeframe[];
export const INSIGHT_SOURCE_OPTIONS = Object.keys(INSIGHT_SOURCE_LABELS) as InsightSource[];
export const TIER_OPTIONS = Object.keys(TIER_LABELS) as CompanyTier[];
export const OBJECTIVE_STATUS_OPTIONS = Object.keys(OBJECTIVE_STATUS_LABELS) as ObjectiveStatus[];
export const PORTAL_STATUS_OPTIONS = Object.keys(PORTAL_STATUS_LABELS) as PortalStatus[];

/** RICE = reach × impact × (confidence/100) / max(effort,1). Mirrors the server. */
export function computeRice(f: { reach: number | null; impact: number | null; confidence: number | null; effort: number | null }): number | null {
  if (!f.reach || !f.impact || !f.confidence) return null;
  return Math.round((f.reach * f.impact * (f.confidence / 100)) / Math.max(f.effort || 1, 1) * 10) / 10;
}

/** Value/effort quadrant for the prioritization matrix. */
export function quadrant(value: number, effort: number): string {
  const highValue = value >= 5.5;
  const highEffort = effort >= 5.5;
  if (highValue && !highEffort) return 'Quick wins';
  if (highValue && highEffort) return 'Big bets';
  if (!highValue && !highEffort) return 'Fill-ins';
  return 'Money pit';
}
