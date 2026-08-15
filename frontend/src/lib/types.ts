// Domain types mirroring the Atlas API responses.

export type Role = 'admin' | 'board_admin' | 'user' | 'client';
/** Status keys are per-project since custom workflows; the four defaults remain common. */
export type IssueStatus = string;
export type StatusCategory = 'todo' | 'in_progress' | 'done';

/** Row from GET /projects/:id/statuses (id is "default-<key>" until customized). */
export interface WorkflowStatus {
  id: string;
  project_id: string;
  key: string;
  label: string;
  category: StatusCategory;
  position: number;
  builtin: boolean;
  /** 1 while the request sits with the customer — pauses its SLA clocks (epic 43). */
  waiting_for_customer?: number;
}
export type IssueType = 'story' | 'bug' | 'task' | 'epic' | 'subtask' | 'request';
export type Priority = 'highest' | 'high' | 'medium' | 'low';
export type SprintStatus = 'planning' | 'active' | 'completed';
export type LinkType = 'relates_to' | 'blocks' | 'is_blocked_by' | 'duplicates' | 'is_duplicated_by';

/**
 * Working hours, stored as JSON on both projects and users. `work_days` holds
 * ISO weekday numbers (1 = Monday), and `end_hour` must be strictly later than
 * `start_hour` — the server rejects anything else, because a profile it cannot
 * order reads back as unconfigured.
 */
export interface BusinessHours {
  timezone: string;
  work_days: number[];
  start_hour: number;
  end_hour: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar_color: string;
  avatar_url: string | null;
  phone: string | null;
  department: string | null;
  job_title: string | null;
  bio: string | null;
  timezone: string | null;
  /** Personal override of the project's working hours; null = use the project's. */
  business_hours?: string | null;
  is_active: number;
  last_login: string | null;
  created_at: string;
}

export interface AuthUser extends User {
  token: string;
}

export interface Project {
  id: string;
  name: string;
  key: string;
  description: string | null;
  wip_limits: string | null;
  /** Working hours for everyone on the project; a user may override it. */
  business_hours?: string | null;
  lead_id: string | null;
  created_at: string;
  lead_name: string | null;
  lead_color: string | null;
  issue_count: number;
  member_count: number;
  /** 1 when the project is a service desk — gates queues, SLAs and the help center. */
  is_service_desk?: number;
}

export interface Sprint {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  goal: string | null;
  status: SprintStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  issue_count: number;
  done_count: number;
  total_points: number;
  done_points: number;
}

export interface CycleTimeResponse {
  issues: { id: string; issue_key: string; title: string; type: string; completed_at: string; lead_time_h: number; cycle_time_h: number | null }[];
  avg_cycle_h: number | null;
  p50_cycle_h: number | null;
  p85_cycle_h: number | null;
  avg_lead_h: number | null;
  count: number;
}

export interface TimeInStatusResponse {
  statuses: { status: string; avg_h: number; total_h: number; issues: number }[];
}

export interface CumulativeFlowResponse {
  days: { date: string; todo: number; in_progress: number; done: number }[];
}

export interface ControlChartResponse {
  issues: { resolved_date: string; cycle_time_days: number; issue_key: string; title: string }[];
  p50_cycle_days: number;
  p85_cycle_days: number;
}

export interface VersionReportResponse {
  version: { id: string; name: string };
  issues: { id: string; issue_key: string; title: string; status: string; points: number }[];
  done_count: number;
  total_count: number;
  done_points: number;
  total_points: number;
}

/** A row from the JQL branch of /api/search, as rendered by the wiki macro. */
export interface JqlSearchIssue {
  id: string;
  issue_key: string;
  title: string;
  type: string;
  status: IssueStatus;
  priority: string;
  project_id: string;
  project_key: string;
  assignee_name: string | null;
  sprint_name: string | null;
  sprint_slug: string | null;
}

/** Compact issue state for wiki chips — what a hover card shows. */
export interface LinkedIssueSummary {
  id: string;
  issue_key: string;
  title: string;
  status: IssueStatus;
  type: string;
  priority: string;
  assignee_name: string | null;
  assignee_color: string | null;
}

/** A wiki page that mentions an issue, for the issue's back-link panel. */
/** A candidate in the @ picker. `is_member` drives the "may not have access"
 *  warning — non-members are still mentionable, and still get notified. */
export interface MentionCandidate {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  is_member: boolean;
}

export interface MentioningPage {
  id: string;
  title: string;
  slug: string;
  space_id: string;
  space_name: string;
  space_key: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  sprint_id: string | null;
  issue_key: string;
  issue_number: number;
  title: string;
  description: string | null;
  type: IssueType;
  status: IssueStatus;
  priority: Priority;
  assignee_id: string | null;
  reporter_id: string | null;
  parent_id: string | null;
  story_points: number | null;
  labels: string | null;
  due_date: string | null;
  start_date: string | null;
  board_order: number;
  created_at: string;
  updated_at: string;
  assignee_name: string | null;
  assignee_color: string | null;
  reporter_name: string | null;
  reporter_color: string | null;
  comment_count: number;
  attachment_count: number;
  watcher_count: number;
  link_count: number;
  epic_color: string | null;
  epic_key: string | null;
  epic_title: string | null;
  epic_badge_color: string | null;
  parent_key: string | null;
  parent_title: string | null;
  parent_type: IssueType | null;
  sprint_name: string | null;
  sprint_slug: string | null;
  subtask_count: number;
  subtask_done_count: number;
  original_estimate: number | null;
  time_spent: number | null;
  /**
   * How long the issue has sat in an in-progress status. Derived from the
   * status timeline — unrelated to the stopwatch, and never part of `time_spent`.
   */
  in_progress_minutes_live: number | null;
  /** False when the figure above is raw wall-clock (no business-hours profile). */
  in_progress_business_hours?: boolean | null;
  fix_version_id: string | null;
  component_id: string | null;
  fix_version_name: string | null;
  fix_version_status: string | null;
  component_name: string | null;
  labels_parsed: string[];
  custom_fields?: CustomField[];
}

/**
 * Epic row with child rollups, from GET /projects/:id/epics.
 * Raw DB row + assignee join + rollups — NOT enriched like Issue
 * (no labels_parsed, comment_count, epic_key, watcher/link counts).
 */
export interface EpicSummary extends Pick<Issue,
  | 'id' | 'project_id' | 'sprint_id' | 'issue_key' | 'issue_number' | 'title' | 'description'
  | 'type' | 'status' | 'priority' | 'assignee_id' | 'reporter_id' | 'parent_id'
  | 'story_points' | 'labels' | 'due_date' | 'start_date' | 'board_order' | 'created_at' | 'updated_at'
  | 'epic_color' | 'assignee_name' | 'assignee_color'> {
  child_count: number;
  done_count: number;
  total_points: number;
  done_points: number;
}

/** Lightweight hit rows from GET /search. */
export interface SearchIssueHit {
  id: string;
  issue_key: string;
  title: string;
  type: IssueType;
  status: IssueStatus;
  priority: Priority;
  project_id: string;
  project_key: string;
  project_name: string;
  assignee_name?: string | null;
  sprint_name?: string | null;
  sprint_slug?: string | null;
}

export interface SearchPageHit {
  id: string;
  title: string;
  slug: string;
  space_id: string;
  space_name: string;
  space_key: string;
}

export interface SearchResults {
  issues: SearchIssueHit[];
  pages: SearchPageHit[];
  jql?: boolean;
}

export interface BacklogSavedFilterParams {
  kind: 'backlog';
  query: string;
  status: string;
  type: string;
  assignee: string;
  label: string;
}

export interface JqlSavedFilterParams {
  kind: 'jql';
  jql: string;
}

export type SavedFilterParams = BacklogSavedFilterParams | JqlSavedFilterParams;

/** Personal saved filter, isolated by user and project. */
export interface SavedFilter {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  params: string;
  created_at: string;
  params_parsed: SavedFilterParams;
}

/** Fix version (release) with issue rollups. */
export interface Version {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'unreleased' | 'released';
  release_date: string | null;
  created_at: string;
  issue_count: number;
  done_count: number;
}

/** Project component with issue count. */
export interface ProjectComponent {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  issue_count: number;
}

/** Automation rule: trigger → conditions (all must match) → actions. */
export type AutomationTrigger = 'issue_created' | 'status_changed' | 'all_subtasks_done';

export interface AutomationCondition {
  field: 'type' | 'priority' | 'status';
  value: string;
}

export interface AutomationAction {
  type: 'set_status' | 'set_assignee' | 'add_label' | 'notify_user';
  value: string;
}

export interface AutomationRule {
  id: string;
  project_id: string;
  name: string;
  trigger_type: AutomationTrigger;
  conditions: string;
  actions: string;
  enabled: number;
  created_at: string;
  conditions_parsed: AutomationCondition[];
  actions_parsed: AutomationAction[];
}

/** In-app notification row from GET /notifications. */
export interface AppNotification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: 'assigned' | 'comment' | 'mention' | 'wiki_update' | string;
  message: string;
  link: string | null;
  issue_id: string | null;
  wiki_page_id: string | null;
  is_read: number;
  created_at: string;
  actor_name: string | null;
  actor_color: string | null;
}

/** Work log entry from GET /issues/:id/worklogs. Minutes-based. */
/** Where a work log came from: entered by hand, derived from status, or measured. */
export type WorkLogSource = 'manual' | 'auto' | 'timer';

export interface WorkLog {
  id: string;
  issue_id: string;
  user_id: string;
  minutes: number;
  comment: string | null;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
  source: WorkLogSource;
  locked_from_auto: number;
}

export interface TimerUserTotal {
  user_id: string;
  name: string;
  minutes: number;
}

/** Why the server closed a timer segment the user never paused. */
export type TimerStopReason = 'workday_end' | 'abandoned' | 'issue_done' | 'switched_issue';

export interface TimerState {
  running: boolean;
  started_at: string | null;
  elapsed_minutes: number;
  /** Open for more than 12h — surfaced as a warning, never auto-corrected. */
  runaway: boolean;
  /**
   * A stop the user did not ask for, within the last 24h. Null while a timer
   * is running. Without this a server-side close is indistinguishable from the
   * timer breaking, which is how it was reported.
   */
  auto_stopped: { reason: TimerStopReason; stopped_at: string } | null;
  by_user: TimerUserTotal[];
  /** Set on a start response when it displaced a timer on another issue. */
  paused_issue?: { id: string; issue_key: string } | null;
}

export interface MyTimer {
  issue_id: string;
  issue_key: string;
  title: string;
  started_at: string;
  elapsed_minutes: number;
  runaway: boolean;
}

/**
 * A timer the server stopped without crediting any time, because it had no
 * evidence for how long the session really was. It stays here until the person
 * who ran it logs the real time or dismisses it — nobody else can answer.
 */
export interface UnresolvedTimer {
  id: string;
  issue_id: string;
  issue_key: string;
  title: string;
  started_at: string;
  ended_at: string;
}

/** One work-log entry in the personal timesheet, with its issue and project. */
export interface MyTimeEntry {
  id: string;
  issue_id: string;
  issue_key: string;
  title: string;
  project_key: string;
  minutes: number;
  source: WorkLogSource;
  comment: string | null;
  created_at: string;
  /** Calendar date the entry falls on, in the user's timezone. */
  date: string;
}

export interface MyTimeResponse {
  from: string;
  to: string;
  /** The zone the days were bucketed in — surfaced so totals are unambiguous. */
  timezone: string;
  total_minutes: number;
  by_day: { date: string; minutes: number }[];
  entries: MyTimeEntry[];
}

export interface Comment {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_color: string;
}

export interface Attachment {
  id: string;
  issue_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  uploaded_by: string;
  created_at: string;
  uploader_name: string;
  uploader_color: string;
  /** Short-lived signed URLs — browsers cannot send auth headers on <img>/<a>. */
  preview_url: string;
  download_url: string;
}

export interface ActivityEntry {
  id: string;
  issue_id: string;
  user_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  user_name: string;
  user_color: string;
}

export interface ProjectMember {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  role: Role;
  role_in_project: string;
  is_active?: number | boolean; // User active status from users table
}

export interface ProjectStats {
  total: number;
  byStatus: { status: IssueStatus; count: number }[];
  byType: { type: IssueType; count: number }[];
  byAssignee: { name: string; avatar_color: string | null; count: number }[];
}

export type DashboardGadgetKey =
  | 'summary'
  | 'status'
  | 'active_sprint'
  | 'recent_activity'
  | 'priority_breakdown'
  | 'type_breakdown'
  | 'team_workload';

export interface DashboardGadget {
  key: DashboardGadgetKey;
  /** One or both columns of the desktop dashboard grid. */
  span: 1 | 2;
}

export interface DashboardLayout {
  gadgets: DashboardGadget[];
  customized: boolean;
  updated_at: string | null;
}

export interface AdminStats {
  users: number;
  projects: number;
  issues: number;
  byRole: { role: Role; count: number }[];
}

export interface Settings {
  id: string;
  user_id: string;
  theme: string;
  language: string;
  email_notifications: number;
  push_notifications: number;
  notify_assigned: number;
  notify_mentions: number;
  notify_comments: number;
  notify_status_changes: number;
  notify_sprint_updates: number;
  compact_view: number;
  default_project_id: string | null;
  items_per_page: number;
  updated_at: string;
}

export interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  details: string | null;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
}

export interface AuditLogPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface ProfileResponse extends User {
  projects: { id: string; name: string; key: string; role_in_project: string }[];
  stats: { assigned: number; completed: number; comments: number };
}

// ===== Wiki =====

export interface WikiSpace {
  id: string;
  space_key: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  owner_id: string;
  is_personal: number;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  owner_color: string | null;
  page_count: number;
  starred: number;
}

export interface WikiPage {
  id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  body: string;
  body_format: string;
  status: string;
  position: number;
  author_id: string;
  last_editor_id: string;
  version: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  author_name: string | null;
  author_color: string | null;
  editor_name: string | null;
  comment_count: number;
  like_count: number;
  restricted?: number;
  can_edit_page?: number;
  page_type?: 'page' | 'blog' | string;
  page_number?: number;
  /** Derived server-side: `${space_key}-WIKI-${page_number}`. */
  page_key?: string;
  labels: string[];
  space_name?: string;
  space_key?: string;
  space_icon?: string;
  /** Issues this page mentions, resolved server-side at write time. */
  linked_issues?: LinkedIssueSummary[];
  breadcrumb?: { id: string; title: string }[];
  children?: { id: string; title: string; slug: string; status: string }[];
  /** Sign-off state, pinned to the version that was approved. */
  approval?: PageApproval;
  /** Task-list items parsed from the body, merged with their stored state. */
  tasks?: PageTask[];
}

export interface PageTask {
  key: string;
  text: string;
  checked: boolean;
  checked_by: string | null;
  checked_by_name: string | null;
  checked_at: string | null;
  /** Set when this task was converted into a real issue. */
  issue_id: string | null;
  issue_key: string | null;
  issue_status: string | null;
}

export interface PageApproval {
  approved: boolean;
  /** The page version the approval covers; null when never approved. */
  version: number | null;
  /** True when the page has been edited since it was approved. */
  stale: boolean;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  note: string | null;
}

export interface PageApprovalEntry {
  id: string;
  version: number;
  action: 'approved' | 'revoked';
  note: string | null;
  created_at: string;
  user_id: string;
  user_name: string | null;
}

export type CustomFieldType = 'text' | 'number' | 'select' | 'date' | 'checkbox';

export interface CustomField {
  id: string;
  field_id?: string; // present on enriched issue values
  project_id?: string;
  name: string;
  field_type: CustomFieldType;
  options: string[];
  position: number;
  value?: string | null; // present on enriched issue values
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
  token?: string; // only present in the create response
}

export interface Webhook {
  id: string;
  project_id: string;
  url: string;
  events: string[];
  enabled: number;
  last_status: number | null;
  last_delivered_at: string | null;
  created_at: string;
  secret?: string; // only present in the create response
}

export interface WikiAttachment {
  id: string;
  page_id: string;
  original_name: string;
  mime_type: string | null;
  size: number | null;
  raw_url: string;
  is_image: boolean;
  uploader_name: string | null;
  created_at: string;
}

export interface WikiTreeNode {
  id: string;
  title: string;
  parent_id: string | null;
  position: number;
  slug: string;
  children: WikiTreeNode[];
}

export interface WikiComment {
  id: string;
  page_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  quote: string | null;
  created_at: string;
  author_name: string;
  author_color: string;
}

/** Row from GET /wiki/pages/:id/restrictions. */
export interface WikiRestriction {
  user_id: string;
  can_edit: number;
  name: string | null;
  avatar_color: string | null;
}

export interface WikiVersion {
  id: string;
  page_id: string;
  version: number;
  title: string;
  body: string;
  editor_id: string;
  change_message: string | null;
  created_at: string;
  editor_name: string | null;
}

export interface WikiTemplate {
  id: string;
  space_id: string | null;
  name: string;
  description: string | null;
  body: string;
  icon: string | null;
  is_global: number;
  created_at: string;
}

export interface IssueLink {
  id: string;
  source_issue_id: string;
  target_issue_id: string;
  link_type: LinkType;
  created_by: string | null;
  created_at: string;
  source_key: string;
  source_title: string;
  source_status: IssueStatus;
  source_type: IssueType;
  target_key: string;
  target_title: string;
  target_status: IssueStatus;
  target_type: IssueType;
  created_by_name?: string | null;
}

// ===== Product module (Productboard parity) =====

export type CompanyTier = 'strategic' | 'growth' | 'standard';
export type InsightSource = 'portal' | 'email' | 'support' | 'sales' | 'interview' | 'other';
export type FeatureStatus = 'idea' | 'discovery' | 'planned' | 'in_progress' | 'launched' | 'archived';
export type Timeframe = 'now' | 'next' | 'later';
export type PortalStatus = 'under_consideration' | 'planned' | 'launched';

export type ImpactStatus = 'not_launched' | 'launched' | 'measuring' | 'analyzed';

export type ImpactMetricType = 'adoption' | 'satisfaction' | 'revenue' | 'bug_rate' | 'engagement';

export interface PbImpactMetric {
  id: string;
  feature_id: string;
  metric_type: ImpactMetricType;
  /** Snapshot of the forecast in force when this was recorded, not the live one. */
  forecast_value: number | null;
  actual_value: number | null;
  unit: string | null;
  measurement_date: string;
  data_source: string;
  notes: string | null;
  created_at: string;
  created_by_id: string | null;
  /** (actual - forecast) / forecast * 100. Null when there is no usable forecast. */
  variance: number | null;
  /** False once past the 30-day window — the row is audit trail from then on. */
  editable: boolean;
}

export interface PbFeatureImpact {
  feature_id: string;
  impact_status: ImpactStatus | null;
  forecast_adoption: number | null;
  forecast_revenue: number | null;
  actual_adoption: number | null;
  actual_revenue: number | null;
  metrics: Partial<Record<ImpactMetricType, PbImpactMetric[]>>;
}

export interface PbImpactDashboardFeature {
  id: string;
  name: string;
  forecast_adoption: number | null;
  forecast_revenue: number | null;
  actual_adoption: number | null;
  actual_revenue: number | null;
  impact_status: ImpactStatus | null;
}

export interface PbImpactDashboard {
  total_features_analyzed: number;
  avg_adoption_variance: number | null;
  avg_revenue_variance: number | null;
  features: PbImpactDashboardFeature[];
}
export type ObjectiveStatus = 'on_track' | 'at_risk' | 'off_track' | 'done';
export type OutcomeVerdict = 'achieved' | 'partial' | 'missed' | 'too_early';

export interface PbCompany {
  id: string;
  name: string;
  tier: CompanyTier;
  arr: number | null;
  notes: string | null;
  created_at: string;
  customer_count?: number;
  insight_count?: number;
}

export interface PbCustomer {
  id: string;
  name: string;
  email: string | null;
  company_id: string | null;
  created_at: string;
  company_name?: string | null;
  company_tier?: CompanyTier | null;
  insight_count?: number;
}

export type InsightOrigin = 'request' | 'comment' | 'wiki' | 'portal' | 'manual';

/** One company's contribution to a feature's demand. `arr` is null when the
 *  figure was estimated from the tier median, so an estimate can never be
 *  read as recorded revenue. */
export interface PbDemandRow {
  company_id: string;
  company_name: string | null;
  tier: CompanyTier | null;
  arr: number | null;
  estimated: boolean;
  insight_count: number;
  contribution: number;
}

export interface PbTheme {
  id: string;
  name: string;
  summary: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
  insight_count: number;
  insights?: Pick<PbInsight, 'id' | 'title' | 'origin_kind' | 'origin_excerpt' | 'source' | 'created_at'>[];
}

/** A proposed grouping. Nothing is stored until a human confirms it through
 *  the ordinary create-theme endpoint. */
export interface PbThemeSuggestion {
  name: string;
  summary: string;
  insight_ids: string[];
}

export interface PbInsight {
  id: string;
  title: string;
  content: string | null;
  source: InsightSource;
  customer_id: string | null;
  created_by: string | null;
  processed: number;
  /** Where this came from. Null on insights that predate epic 47. */
  origin_kind: InsightOrigin | null;
  /** Backlink to the source row. Null for portal ideas (the insight IS the
   *  submission) and may dangle if the source was deleted — the excerpt is the
   *  evidence, not this. */
  origin_id: string | null;
  origin_excerpt: string | null;
  dismissed_at: string | null;
  created_at: string;
  customer_name?: string | null;
  customer_email?: string | null;
  company_name?: string | null;
  company_tier?: CompanyTier | null;
  created_by_name?: string | null;
  feature_count?: number;
  features?: PbInsightFeatureLink[];
}

export interface PbInsightFeatureLink {
  link_id: string;
  importance: number;
  quote: string | null;
  id: string;
  name: string;
  status: FeatureStatus;
  timeframe: Timeframe | null;
}

export interface PbFeature {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  status: FeatureStatus;
  timeframe: Timeframe | null;
  portal_status: PortalStatus | null;
  owner_id: string | null;
  effort: number | null;
  value: number | null;
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  release_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Where this feature sits in the post-launch measurement lifecycle. */
  impact_status: ImpactStatus | null;
  forecast_adoption: number | null;
  forecast_revenue: number | null;
  /** Rolled up from the newest matching row in feature_impact_metrics. */
  actual_adoption: number | null;
  actual_revenue: number | null;
  owner_name?: string | null;
  project_name?: string | null;
  project_key?: string | null;
  release_name?: string | null;
  /** Tier-weighted evidence: SUM(importance x tier). Predates demand and
   *  remains the features screen's default sort — the two answer different
   *  questions and are shown side by side rather than merged. */
  user_impact: number;
  /** Revenue-weighted evidence: SUM(arr x importance), in currency. */
  demand: number;
  /** Per-company contributions, ranked. Present on single-feature responses. */
  demand_breakdown?: PbDemandRow[];
  /** Evidence with no company attached — counted, never folded into demand. */
  demand_unattributed?: number;
  /** The wiki page drafted for this feature, if one exists. */
  spec_page_id: string | null;
  /** Set once, on the first transition into launched. Later feature edits do
   *  not move the boundary used for post-launch feedback. */
  launched_at: string | null;
  insight_count: number;
  vote_count: number;
  delivery_total: number;
  delivery_done: number;
  rice: number | null;
  request_count: number;
  /** JSON array of the child feature ids folded into this one. Non-empty means
   *  this feature is itself a merge parent; a child that has been merged away
   *  keeps `'[]'` here, so this never tells you a feature *was* merged. */
  merged_from_ids?: string | null;
  merged_at?: string | null;
  merged_by_id?: string | null;
  insights?: PbFeatureInsight[];
  issues?: PbFeatureIssue[];
  objectives?: PbFeatureObjective[];
  outcome?: PbFeatureOutcome | null;
  needs_outcome_metric?: boolean;
  post_launch_insight_count?: number;
  post_launch_insights?: PbPostLaunchInsight[];
}

/** A possible duplicate, as scored by the server's name/description similarity. */
export interface PbMergeCandidate {
  feature: PbFeature;
  /** 0-1. The server only returns candidates at or above its threshold. */
  similarity: number;
}

export interface PbMergeHistoryEntry {
  id: string;
  parent_feature_id: string;
  child_feature_id: string;
  merged_by_id: string;
  merged_at: string;
  /** What the child contributed to the parent's total, kept so an undo can
   *  subtract exactly what was added rather than recounting. */
  child_request_count: number;
  reason?: string | null;
}

export interface PbFeatureOutcome {
  feature_id: string;
  metric: string | null;
  target: string | null;
  baseline: string | null;
  measured: string | null;
  verdict: OutcomeVerdict | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name?: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PbPostLaunchInsight {
  feature_id: string;
  id: string;
  title: string;
  content: string | null;
  source: InsightSource;
  origin_kind: InsightOrigin | null;
  origin_excerpt: string | null;
  created_at: string;
  importance: number;
  quote: string | null;
  customer_name?: string | null;
  company_name?: string | null;
  company_tier?: CompanyTier | null;
}

export interface PbOutcomeFeature {
  id: string;
  project_id: string | null;
  project_name: string | null;
  project_key: string | null;
  name: string;
  description: string | null;
  status: 'launched';
  owner_id: string | null;
  owner_name: string | null;
  launched_at: string;
  days_since_launch: number;
  outcome: PbFeatureOutcome | null;
  needs_outcome_metric: boolean;
  post_launch_insight_count: number;
  post_launch_insights: PbPostLaunchInsight[];
  review_due: boolean;
}

export interface PbOutcomesResponse {
  review_after_days: number;
  features: PbOutcomeFeature[];
}

export interface PbFeatureInsight {
  link_id: string;
  importance: number;
  quote: string | null;
  id: string;
  title: string;
  content: string | null;
  source: InsightSource;
  customer_name?: string | null;
  company_name?: string | null;
  company_tier?: CompanyTier | null;
}

export interface PbFeatureIssue {
  link_id: string;
  id: string;
  issue_key: string;
  title: string;
  status: string;
  type: IssueType;
  project_id: string;
  is_done: number;
}

export interface PbFeatureObjective {
  link_id: string;
  id: string;
  name: string;
  status: ObjectiveStatus;
  target_date: string | null;
}

export interface PbObjective {
  id: string;
  name: string;
  description: string | null;
  status: ObjectiveStatus;
  target_date: string | null;
  owner_id: string | null;
  created_at: string;
  owner_name?: string | null;
  feature_count: number;
  launched_count: number;
  features?: PbObjectiveFeature[];
}

export interface PbObjectiveFeature {
  link_id: string;
  id: string;
  name: string;
  status: FeatureStatus;
  timeframe: Timeframe | null;
  delivery_total: number;
  delivery_done: number;
}

export interface PortalFeature {
  id: string;
  name: string;
  description: string | null;
  portal_status: PortalStatus;
  vote_count: number;
  follower_count: number;
  has_voted: boolean;
  is_following: boolean;
}

export type PortalSubmissionStatus = 'submitted' | 'reviewed' | 'closed';

export interface PortalSubmission {
  id: string;
  title: string;
  content: string;
  status: PortalSubmissionStatus;
  submitted_at: string;
}

export interface PortalMe {
  submissions: PortalSubmission[];
  follows: PortalFeature[];
}

// ===== SERVICE DESK =====

export type RequestFieldType = 'text' | 'textarea' | 'select' | 'date';

export interface RequestField {
  key: string;
  label: string;
  type: RequestFieldType;
  required: boolean;
  options?: string[];
}

export interface RequestType {
  id: string;
  project_id?: string;
  name: string;
  description: string;
  icon: string;
  fields: RequestField[];
  position?: number;
}

export interface PublicRequestComment {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
}

/** What a customer is allowed to see of a request — mirrors toPublicRequest(). */
export interface PublicRequest {
  key: string;
  summary: string;
  description: string;
  fields: Record<string, string>;
  request_type: { name: string; icon: string } | null;
  status: string;
  status_category: 'todo' | 'in_progress' | 'done' | null;
  created_at: string;
  updated_at: string;
  comments: PublicRequestComment[];
  /** The customer's own rating, once they've given one (epic 45). */
  satisfaction: { rating: number; comment: string } | null;
}

// ----- KB deflection (epic 44) -----

/** A suggested help article — the customer projection, nothing more. */
export interface ArticleSuggestion {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
}

/** A curated article row on the agent side. */
export interface CuratedArticle {
  page_id: string;
  position: number;
  title: string;
  slug: string;
  status: string;
  space_id: string;
  space_name: string | null;
}

// ----- Service desk report (epic 45) -----

export interface ServiceDeskReport {
  deflection: { helped: number; requests_raised: number; rate: number };
  volume_by_type: { id: string; name: string; count: number }[];
  median_minutes: { first_response: number | null; resolution: number | null };
  sla_breach_by_type: { name: string; total: number; breached: number; rate: number }[];
  csat: { count: number; average: number | null; distribution: Record<string, number> };
  /** Always true — panels count only rows we store, never a backfilled estimate. */
  since_tracking_began: boolean;
}

// ----- Agent queues (epic 42) -----

/** Columns a queue table may show — mirrors QUEUE_COLUMNS in utils/queues.js. */
export type QueueColumn =
  | 'key' | 'summary' | 'type' | 'status' | 'priority' | 'assignee'
  | 'reporter' | 'request_type' | 'created' | 'updated' | 'sla';

export interface Queue {
  id: string;
  project_id: string;
  name: string;
  /** JQL v2, parsed and evaluated server-side by utils/jql/. */
  jql: string;
  columns: QueueColumn[];
  order_by: string;
  position: number;
  /** Live count, present only on the project listing. */
  count?: number | null;
  /** Why a stored query no longer parses, if it does not. */
  invalid?: string | null;
}

// ----- SLAs (epic 43) -----

export type SlaMetric = 'first_response' | 'resolution';
export type SlaStatus = 'ok' | 'at_risk' | 'breached';

export interface SlaGoal {
  id: string;
  request_type_id: string;
  /** null means the goal applies at any priority. */
  priority: string | null;
  metric: SlaMetric;
  target_minutes: number;
}

/** Derived on read — mirrors slaState() in utils/sla.js. Never stored. */
export interface SlaState {
  metric: SlaMetric;
  elapsed_minutes: number;
  remaining_minutes: number;
  target_minutes: number;
  status: SlaStatus;
  paused: boolean;
  stopped: boolean;
  started_at?: string;
  stopped_at?: string | null;
  breached_at?: string | null;
  due_at?: string | null;
  at_risk_at?: string | null;
}

/** A row in a queue table. Lean by design — not a full enriched issue. */
export interface QueueIssue {
  id: string;
  issue_key: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  labels: string;
  created_at: string;
  updated_at: string;
  request_type_id: string | null;
  request_type_name: string | null;
  request_type_icon: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  reporter_name: string | null;
  reporter_color: string | null;
  /** Keyed by metric; `{}` when the request has no goals. */
  sla: Partial<Record<SlaMetric, SlaState>>;
}
