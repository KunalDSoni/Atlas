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
}
export type IssueType = 'story' | 'bug' | 'task' | 'epic' | 'subtask';
export type Priority = 'highest' | 'high' | 'medium' | 'low';
export type SprintStatus = 'planned' | 'active' | 'completed';
export type LinkType = 'relates_to' | 'blocks' | 'is_blocked_by' | 'duplicates' | 'is_duplicated_by';

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
  lead_id: string | null;
  created_at: string;
  lead_name: string | null;
  lead_color: string | null;
  issue_count: number;
  member_count: number;
}

export interface Sprint {
  id: string;
  project_id: string;
  name: string;
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
  subtask_count: number;
  subtask_done_count: number;
  original_estimate: number | null;
  time_spent: number | null;
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
}

/** Saved backlog filter (per user, per project). */
export interface SavedFilter {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  params: string;
  created_at: string;
  params_parsed: {
    query?: string;
    status?: string;
    type?: string;
    assignee?: string;
    label?: string;
  };
}

/** Fix version (release) with issue rollups. */
export interface Version {
  id: string;
  project_id: string;
  name: string;
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
export interface WorkLog {
  id: string;
  issue_id: string;
  user_id: string;
  minutes: number;
  comment: string | null;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
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
}

export interface ProjectStats {
  total: number;
  byStatus: { status: IssueStatus; count: number }[];
  byType: { type: IssueType; count: number }[];
  byAssignee: { assignee_id: string | null; name: string | null; count: number }[];
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
export type ObjectiveStatus = 'on_track' | 'at_risk' | 'off_track' | 'done';

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

export interface PbInsight {
  id: string;
  title: string;
  content: string | null;
  source: InsightSource;
  customer_id: string | null;
  created_by: string | null;
  processed: number;
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
  owner_name?: string | null;
  project_name?: string | null;
  project_key?: string | null;
  release_name?: string | null;
  user_impact: number;
  insight_count: number;
  vote_count: number;
  delivery_total: number;
  delivery_done: number;
  rice: number | null;
  insights?: PbFeatureInsight[];
  issues?: PbFeatureIssue[];
  objectives?: PbFeatureObjective[];
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
  has_voted: boolean;
}
