// Typed Atlas API client.
//
// Authentication is a session token sent as `x-auth-token`. The server derives identity
// and role from that token alone — client-supplied identity headers are ignored.

import type {
  ActivityEntry, AdminStats, AppNotification, Attachment, AuditLogPage, AuthUser,
  AutomationAction, AutomationCondition, AutomationRule, AutomationTrigger, Comment, Issue, EpicSummary,
  DashboardGadget, DashboardLayout,
  ProfileResponse, Project, ProjectComponent, ProjectMember, ProjectStats, SavedFilter, SearchResults, Settings, Sprint, User, Version,
  IssueLink, LinkType, LinkedIssueSummary, MentioningPage, JqlSearchIssue,
  CycleTimeResponse, TimeInStatusResponse, CumulativeFlowResponse, ControlChartResponse, VersionReportResponse,
  WikiComment, WikiPage, WikiRestriction, WikiSpace, WikiTemplate, WikiTreeNode, WikiVersion,
  PageApproval, PageApprovalEntry, PageTask,
  WikiAttachment, ApiToken, Webhook, CustomField,
  WorkLog, WorkflowStatus, TimerState, MyTimer,
  PbCompany, PbCustomer, PbInsight, PbFeature, PbFeatureOutcome, PbObjective,
  ImpactMetricType, PbFeatureImpact, PbImpactDashboard, PbImpactMetric,
  PbOutcomesResponse, PbTheme, PbThemeSuggestion, PortalFeature, PortalMe, PortalSubmission,
  PublicRequest, RequestType, Queue, QueueIssue, SlaGoal, SlaState,
  ArticleSuggestion, CuratedArticle, ServiceDeskReport,
} from './types';

const TOKEN_KEY = 'atlas_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fired when the server rejects our token, so the app can bounce to /login. */
const UNAUTHORIZED_EVENT = 'atlas:unauthorized';
export function onUnauthorized(handler: () => void) {
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers['x-auth-token'] = token;

  const res = await fetch(`/api${path}`, { ...options, headers });

  // A 401 from login means bad credentials, not an expired session — let the
  // server's message fall through to the normal error path below.
  if (res.status === 401 && path !== '/auth/login') {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const serverMessage =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : '';
    throw new ApiError(serverMessage || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(p: string) => request<T>(p, { method: 'DELETE' });

export const api = {
  // Service desk — the customer surface. Every response here is the projected
  // shape, never a raw issue.
  help: {
    requestTypes: () => get<RequestType[]>('/help/request-types'),
    raise: (body: { request_type_id: string; summary: string; fields: Record<string, string> }) =>
      post<PublicRequest>('/help/requests', body),
    myRequests: () => get<PublicRequest[]>('/help/requests'),
    getRequest: (key: string) => get<PublicRequest>(`/help/requests/${key}`),
    reply: (key: string, body: string) =>
      post<{ id: string; body: string; created_at: string }>(`/help/requests/${key}/comments`, { body }),
    resolve: (key: string) => post<PublicRequest>(`/help/requests/${key}/resolve`),
    /** Debounce this — it fires as the customer types and must never block submission. */
    suggestions: (type: string, q: string) =>
      get<ArticleSuggestion[]>(`/help/suggestions?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`),
    logArticleHit: (body: { page_id: string; request_type_id: string; helped?: boolean }) =>
      post<{ ok: boolean }>('/help/article-hits', body),
    rate: (key: string, rating: number, comment?: string) =>
      post<{ rating: number; comment: string | null }>(`/help/requests/${key}/satisfaction`, { rating, comment }),
  },

  // KB deflection — curating articles is what bounds what customers may be
  // shown, so it is board-admin only on the server.
  articles: {
    list: (requestTypeId: string) => get<CuratedArticle[]>(`/request-types/${requestTypeId}/articles`),
    attach: (requestTypeId: string, page_id: string) =>
      post<{ ok: boolean }>(`/request-types/${requestTypeId}/articles`, { page_id }),
    detach: (requestTypeId: string, pageId: string) =>
      del<{ ok: boolean }>(`/request-types/${requestTypeId}/articles/${pageId}`),
  },

  serviceDeskReport: (projectId: string) =>
    get<ServiceDeskReport>(`/projects/${projectId}/servicedesk-report`),

  requestTypes: {
    list: (projectId: string) => get<RequestType[]>(`/projects/${projectId}/request-types`),
    create: (projectId: string, body: Partial<RequestType>) =>
      post<RequestType>(`/projects/${projectId}/request-types`, body),
    update: (id: string, body: Partial<RequestType>) => put<RequestType>(`/request-types/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/request-types/${id}`),
  },

  // Agent queues — saved JQL views over a service desk project. The listing
  // carries live counts, so the sidebar needs no second call per queue.
  queues: {
    list: (projectId: string) => get<Queue[]>(`/projects/${projectId}/queues`),
    get: (id: string) => get<Queue>(`/queues/${id}`),
    create: (projectId: string, body: Partial<Queue>) =>
      post<Queue>(`/projects/${projectId}/queues`, body),
    update: (id: string, body: Partial<Queue>) => put<Queue>(`/queues/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/queues/${id}`),
    issues: (id: string) => get<QueueIssue[]>(`/queues/${id}/issues`),
  },

  sla: {
    goals: (requestTypeId: string) => get<SlaGoal[]>(`/request-types/${requestTypeId}/sla-goals`),
    createGoal: (requestTypeId: string, body: Partial<SlaGoal>) =>
      post<SlaGoal>(`/request-types/${requestTypeId}/sla-goals`, body),
    updateGoal: (id: string, body: Partial<SlaGoal>) => put<SlaGoal>(`/sla-goals/${id}`, body),
    removeGoal: (id: string) => del<{ ok: boolean }>(`/sla-goals/${id}`),
    /** Live state for one issue, by id or key. */
    forIssue: (idOrKey: string) => get<SlaState[]>(`/issues/${idOrKey}/sla`),
  },

  auth: {
    login: (email: string, password: string) => post<AuthUser>('/auth/login', { email, password }),
    logout: () => post<{ ok: boolean }>('/auth/logout'),
    me: () => get<User>('/auth/me'),
  },

  users: {
    list: () => get<User[]>('/users'),
    get: (id: string) => get<User>(`/users/${id}`),
    create: (body: { name: string; email: string; role?: string; avatar_color?: string; password?: string }) =>
      post<User & { initial_password: string }>('/users', body),
    /**
     * Returns the new one-time password — the ONLY time it is ever readable.
     * Revokes the user's sessions server-side.
     */
    resetPassword: (id: string, password?: string) =>
      post<{ id: string; email: string; password: string }>(`/users/${id}/reset-password`,
        password ? { password } : {}),
    // An admin may edit every field on the account, profile fields included —
    // the person it describes may never log in to set them themselves.
    update: (
      id: string,
      body: Partial<Pick<User,
        'name' | 'email' | 'role' | 'avatar_color' | 'is_active'
        | 'phone' | 'department' | 'job_title' | 'bio' | 'timezone'>>,
    ) => put<User>(`/users/${id}`, body),
    deactivate: (id: string) => del<{ ok: boolean }>(`/users/${id}`),
  },

  profile: {
    get: () => get<ProfileResponse>('/profile'),
    update: (body: Partial<Pick<User, 'name' | 'phone' | 'department' | 'job_title' | 'bio' | 'timezone' | 'avatar_color'>>) =>
      put<User>('/profile', body),
    changePassword: (current_password: string, new_password: string) =>
      put<{ ok: boolean }>('/profile/password', { current_password, new_password }),
    changeEmail: (email: string) => put<User>('/profile/email', { email }),
  },

  settings: {
    get: () => get<Settings>('/settings'),
    update: (body: Partial<Settings>) => put<Settings>('/settings', body),
    emailStatus: () => get<{ email_configured: boolean }>('/settings/email-status'),
  },

  projects: {
    list: () => get<Project[]>('/projects'),
    create: (body: { name: string; key: string; description?: string; lead_id?: string }) =>
      post<Project>('/projects', body),
    update: (id: string, body: Partial<Project>) => put<Project>(`/projects/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/projects/${id}`),
    stats: (id: string) => get<ProjectStats>(`/projects/${id}/stats`),
    members: (id: string) => get<ProjectMember[]>(`/projects/${id}/members`),
    addMember: (id: string, user_id: string, role_in_project?: string) =>
      post<ProjectMember>(`/projects/${id}/members`, { user_id, role_in_project }),
    removeMember: (id: string, userId: string) => del<{ ok: boolean }>(`/projects/${id}/members/${userId}`),
  },

  dashboard: {
    layout: (projectId: string) => get<DashboardLayout>(`/projects/${projectId}/dashboard-layout`),
    saveLayout: (projectId: string, gadgets: DashboardGadget[]) =>
      put<DashboardLayout>(`/projects/${projectId}/dashboard-layout`, { gadgets }),
  },

  sprints: {
    list: (projectId: string) => get<Sprint[]>(`/projects/${projectId}/sprints`),
    create: (projectId: string, body: Partial<Sprint>) => post<Sprint>(`/projects/${projectId}/sprints`, body),
    get: (id: string) => get<Sprint>(`/sprints/${id}`),
    update: (id: string, body: Partial<Sprint>) => put<Sprint>(`/sprints/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/sprints/${id}`),
  },

  issues: {
    list: (projectId: string, sprintId?: string) =>
      get<Issue[]>(`/projects/${projectId}/issues${sprintId ? `?sprint_id=${encodeURIComponent(sprintId)}` : ''}`),
    create: (projectId: string, body: Partial<Issue>) => post<Issue>(`/projects/${projectId}/issues`, body),
    get: (id: string) => get<Issue>(`/issues/${id}`),
    /** Boot an issue straight from its URL — /atlas/ATLAS-3 has a key, not an id. */
    getByKey: (key: string) => get<Issue>(`/issues/by-key/${encodeURIComponent(key)}`),
    update: (id: string, body: Partial<Issue>) => put<Issue>(`/issues/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/issues/${id}`),
    move: (id: string, body: { status: string; board_order?: number; sprint_id?: string | null }) =>
      put<Issue>(`/issues/${id}/move`, body),
    /** Issue summaries for a batch of keys — for wiki content not yet saved. */
    resolve: (keys: string[]) => post<{ issues: LinkedIssueSummary[] }>('/issues/resolve', { keys }),
    /** Wiki pages mentioning this issue (restricted pages already filtered out). */
    pages: (id: string) => get<MentioningPage[]>(`/issues/${id}/pages`),
  },

  epics: {
    list: (projectId: string) => get<EpicSummary[]>(`/projects/${projectId}/epics`),
    children: (issueId: string) => get<Issue[]>(`/issues/${issueId}/children`),
  },

  automations: {
    list: (projectId: string) => get<AutomationRule[]>(`/projects/${projectId}/automations`),
    create: (projectId: string, body: {
      name: string;
      trigger_type: AutomationTrigger;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
    }) => post<AutomationRule>(`/projects/${projectId}/automations`, body),
    update: (id: string, body: Partial<{ name: string; enabled: boolean; conditions: AutomationCondition[]; actions: AutomationAction[] }>) =>
      put<AutomationRule>(`/automations/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/automations/${id}`),
  },

  workflow: {
    list: (projectId: string) => get<WorkflowStatus[]>(`/projects/${projectId}/statuses`),
    create: (projectId: string, body: { label: string; key?: string; category?: string }) =>
      post<WorkflowStatus>(`/projects/${projectId}/statuses`, body),
    update: (
      id: string,
      body: Partial<Pick<WorkflowStatus, 'label' | 'category' | 'position'>>
        & { waiting_for_customer?: boolean },
    ) => put<WorkflowStatus>(`/statuses/${id}`, body),
    remove: (id: string, migrateTo?: string) =>
      del<{ ok: boolean; migrated_to: string }>(`/statuses/${id}${migrateTo ? `?migrate_to=${encodeURIComponent(migrateTo)}` : ''}`),
  },

  versions: {
    list: (projectId: string) => get<Version[]>(`/projects/${projectId}/versions`),
    create: (projectId: string, body: { name: string; description?: string; release_date?: string }) =>
      post<Version>(`/projects/${projectId}/versions`, body),
    update: (id: string, body: Partial<Pick<Version, 'name' | 'description' | 'status' | 'release_date'>>) =>
      put<Version>(`/versions/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/versions/${id}`),
  },

  components: {
    list: (projectId: string) => get<ProjectComponent[]>(`/projects/${projectId}/components`),
    create: (projectId: string, body: { name: string; description?: string }) =>
      post<ProjectComponent>(`/projects/${projectId}/components`, body),
    update: (id: string, body: Partial<Pick<ProjectComponent, 'name' | 'description'>>) =>
      put<ProjectComponent>(`/components/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/components/${id}`),
  },

  worklogs: {
    list: (issueId: string) => get<WorkLog[]>(`/issues/${issueId}/worklogs`),
    create: (issueId: string, minutes: number, comment?: string) =>
      post<WorkLog>(`/issues/${issueId}/worklogs`, { minutes, comment }),
    update: (id: string, updates: { minutes?: number; comment?: string }) =>
      patch<WorkLog>(`/worklogs/${id}`, updates),
    remove: (id: string) => del<{ ok: boolean }>(`/worklogs/${id}`),
  },

  timers: {
    get: (issueId: string) => get<TimerState>(`/issues/${issueId}/timer`),
    start: (issueId: string) => post<TimerState>(`/issues/${issueId}/timer/start`, {}),
    pause: (issueId: string) => post<TimerState>(`/issues/${issueId}/timer/pause`, {}),
    commit: (issueId: string) => post<{ ok: boolean; minutes: number }>(`/issues/${issueId}/timer/commit`, {}),
    mine: () => get<MyTimer | null>('/me/timer'),
  },

  notifications: {
    list: () => get<AppNotification[]>('/notifications'),
    unreadCount: () => get<{ count: number }>('/notifications/unread-count'),
    markRead: (id: string) => put<{ ok: boolean }>(`/notifications/${id}/read`),
    markAllRead: () => put<{ ok: boolean }>('/notifications/read-all'),
  },

  search: {
    query: (q: string, projectId?: string, forceJql = false) =>
      get<SearchResults>(`/search?q=${encodeURIComponent(q)}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ''}${forceJql ? '&jql=true' : ''}`),
    /** JQL v2 evaluation for the wiki [jql:] macro. 400s carry the parse error. */
    jql: (q: string) => get<{ issues: JqlSearchIssue[]; jql?: boolean }>(`/search?q=${encodeURIComponent(q)}&jql=true`),
  },

  filters: {
    list: (projectId: string) => get<SavedFilter[]>(`/projects/${projectId}/filters`),
    create: (projectId: string, name: string, params: SavedFilter['params_parsed']) =>
      post<SavedFilter>(`/projects/${projectId}/filters`, { name, params }),
    update: (id: string, body: { name?: string; params?: SavedFilter['params_parsed'] }) =>
      put<SavedFilter>(`/filters/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/filters/${id}`),
  },

  comments: {
    list: (issueId: string) => get<Comment[]>(`/issues/${issueId}/comments`),
    create: (issueId: string, body: string) => post<Comment>(`/issues/${issueId}/comments`, { body }),
    update: (id: string, body: string) => put<Comment>(`/comments/${id}`, { body }),
    remove: (id: string) => del<{ ok: boolean }>(`/comments/${id}`),
  },

  attachments: {
    list: (issueId: string) => get<Attachment[]>(`/issues/${issueId}/attachments`),
    upload: (issueId: string, files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      return request<Attachment[]>(`/issues/${issueId}/attachments`, { method: 'POST', body: fd });
    },
    remove: (id: string) => del<{ ok: boolean }>(`/attachments/${id}`),
  },

  activity: {
    list: (issueId: string) => get<ActivityEntry[]>(`/issues/${issueId}/activity`),
  },

  watchers: {
    list: (issueId: string) => get<User[]>(`/issues/${issueId}/watchers`),
    watch: (issueId: string) => post<{ ok: boolean }>(`/issues/${issueId}/watchers`),
    unwatch: (issueId: string) => del<{ ok: boolean }>(`/issues/${issueId}/watchers`),
  },

  links: {
    list: (issueId: string) => get<IssueLink[]>(`/issues/${issueId}/links`),
    create: (issueId: string, target_issue_id: string, link_type: LinkType) =>
      post<IssueLink>(`/issues/${issueId}/links`, { target_issue_id, link_type }),
    remove: (linkId: string) => del<{ ok: boolean }>(`/issue-links/${linkId}`),
  },

  admin: {
    stats: () => get<AdminStats>('/admin/stats'),
    auditLog: (params: { page?: number; limit?: number; category?: string; q?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
      return get<AuditLogPage>(`/admin/audit-log${qs.toString() ? `?${qs}` : ''}`);
    },
  },

  wiki: {
    spaces: () => get<WikiSpace[]>('/wiki/spaces'),
    space: (id: string) => get<WikiSpace>(`/wiki/spaces/${id}`),
    createSpace: (body: { name: string; space_key: string; description?: string; icon?: string; color?: string }) =>
      post<WikiSpace>('/wiki/spaces', body),
    deleteSpace: (id: string) => del<{ ok: boolean }>(`/wiki/spaces/${id}`),

    pages: (spaceId: string, type?: 'page' | 'blog') =>
      get<WikiPage[]>(`/wiki/spaces/${spaceId}/pages${type ? `?type=${type}` : ''}`),
    tree: (spaceId: string) => get<WikiTreeNode[]>(`/wiki/spaces/${spaceId}/tree`),
    recent: () => get<WikiPage[]>('/wiki/pages/recent'),
    starred: () => get<WikiPage[]>('/wiki/pages/starred'),

    page: (id: string) => get<WikiPage>(`/wiki/pages/${id}`),
    createPage: (spaceId: string, body: Partial<WikiPage>) =>
      post<WikiPage>(`/wiki/spaces/${spaceId}/pages`, body),
    updatePage: (id: string, body: Partial<WikiPage> & { change_message?: string }) =>
      put<WikiPage>(`/wiki/pages/${id}`, body),
    deletePage: (id: string) => del<{ ok: boolean }>(`/wiki/pages/${id}`),

    versions: (id: string) => get<WikiVersion[]>(`/wiki/pages/${id}/versions`),
    approve: (id: string, note?: string) => post<PageApproval>(`/wiki/pages/${id}/approve`, { note }),
    revokeApproval: (id: string) => del<PageApproval>(`/wiki/pages/${id}/approve`),
    approvals: (id: string) => get<PageApprovalEntry[]>(`/wiki/pages/${id}/approvals`),
    setTask: (pageId: string, taskKey: string, checked: boolean) =>
      put<PageTask>(`/wiki/pages/${pageId}/tasks/${encodeURIComponent(taskKey)}`, { checked }),
    convertTask: (pageId: string, taskKey: string, projectId: string) =>
      post<{ issue: Issue; created: boolean }>(
        `/wiki/pages/${pageId}/tasks/${encodeURIComponent(taskKey)}/convert`, { project_id: projectId }),
    comments: (id: string) => get<WikiComment[]>(`/wiki/pages/${id}/comments`),
    addComment: (id: string, body: string, quote?: string) => post<WikiComment>(`/wiki/pages/${id}/comments`, { body, quote }),
    deleteComment: (id: string) => del<{ ok: boolean }>(`/wiki/comments/${id}`),

    like: (id: string) => post<{ liked: boolean; like_count: number }>(`/wiki/pages/${id}/like`),
    star: (body: { space_id?: string; page_id?: string }) => post<{ starred: boolean }>('/wiki/star', body),

    search: (q: string) => get<WikiPage[]>(`/wiki/search?q=${encodeURIComponent(q)}`),
    templates: () => get<WikiTemplate[]>('/wiki/templates'),

    attachments: (pageId: string) => get<WikiAttachment[]>(`/wiki/pages/${pageId}/attachments`),
    uploadAttachments: (pageId: string, files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      return request<WikiAttachment[]>(`/wiki/pages/${pageId}/attachments`, { method: 'POST', body: fd });
    },
    removeAttachment: (id: string) => del<{ ok: boolean }>(`/wiki/attachments/${id}`),

    watchState: (pageId: string) => get<{ count: number; watching: boolean }>(`/wiki/pages/${pageId}/watchers`),
    restrictions: (pageId: string) => get<WikiRestriction[]>(`/wiki/pages/${pageId}/restrictions`),
    exportPage: (pageId: string, format: 'markdown' | 'html') =>
      get<{ filename: string; mime: string; content: string }>(`/wiki/pages/${pageId}/export?format=${format}`),
    setRestrictions: (pageId: string, restrictions: { user_id: string; can_edit: boolean }[]) =>
      put<{ ok: boolean; count: number }>(`/wiki/pages/${pageId}/restrictions`, { restrictions }),
    watch: (pageId: string) => post<{ ok: boolean; watching: boolean }>(`/wiki/pages/${pageId}/watch`),
    unwatch: (pageId: string) => del<{ ok: boolean; watching: boolean }>(`/wiki/pages/${pageId}/watch`),
  },

  product: {
    // Companies & customers
    companies: () => get<PbCompany[]>('/product/companies'),
    createCompany: (body: { name: string; tier?: string; arr?: number | null; notes?: string }) =>
      post<PbCompany>('/product/companies', body),
    updateCompany: (id: string, body: Partial<Pick<PbCompany, 'name' | 'tier' | 'arr' | 'notes'>>) =>
      put<PbCompany>(`/product/companies/${id}`, body),
    removeCompany: (id: string) => del<{ ok: boolean }>(`/product/companies/${id}`),
    customers: () => get<PbCustomer[]>('/product/customers'),
    createCustomer: (body: { name: string; email?: string; company_id?: string | null }) =>
      post<PbCustomer>('/product/customers', body),
    updateCustomer: (id: string, body: Partial<Pick<PbCustomer, 'name' | 'email' | 'company_id'>>) =>
      put<PbCustomer>(`/product/customers/${id}`, body),
    removeCustomer: (id: string) => del<{ ok: boolean }>(`/product/customers/${id}`),

    // Insights (feedback)
    insights: (params: { processed?: 0 | 1; dismissed?: 0 | 1; source?: string; customer_id?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v !== undefined && qs.set(k, String(v)));
      return get<PbInsight[]>(`/product/insights${qs.toString() ? `?${qs}` : ''}`);
    },
    // Capture turns text that already exists in Atlas into a triageable
    // insight. The server snapshots the excerpt and verifies the caller may
    // see the source, so the client only names it.
    captureInsight: (body: {
      origin_kind: 'request' | 'comment' | 'wiki';
      origin_id: string;
      title?: string;
      customer_id?: string;
    }) => post<PbInsight>('/product/insights/capture', body),
    dismissInsight: (id: string) => post<{ ok: boolean }>(`/product/insights/${id}/dismiss`, {}),

    // Themes — a grouping of insights above feedback and below a feature.
    themes: () => get<PbTheme[]>('/product/themes'),
    theme: (id: string) => get<PbTheme>(`/product/themes/${id}`),
    createTheme: (body: { name: string; summary?: string; insight_ids?: string[] }) =>
      post<PbTheme>('/product/themes', body),
    removeTheme: (id: string) => del<{ ok: boolean }>(`/product/themes/${id}`),
    addToTheme: (id: string, insight_ids: string[]) =>
      post<PbTheme>(`/product/themes/${id}/insights`, { insight_ids }),
    promoteTheme: (id: string, project_id: string) =>
      post<{ id: string; name: string; insight_count: number }>(`/product/themes/${id}/promote`, { project_id }),
    /** Proposes only — nothing is stored until createTheme is called. */
    suggestThemes: () =>
      post<{ enabled: boolean; suggestions: PbThemeSuggestion[]; error?: string }>('/product/themes/suggest', {}),

    /** Idempotent: returns the existing page when one has already been drafted. */
    draftSpec: (featureId: string, space_id: string) =>
      post<{ page_id: string; created: boolean }>(`/product/features/${featureId}/spec`, { space_id }),
    insight: (id: string) => get<PbInsight>(`/product/insights/${id}`),
    createInsight: (body: { title: string; content?: string; source?: string; customer_id?: string | null }) =>
      post<PbInsight>('/product/insights', body),
    updateInsight: (id: string, body: Partial<Pick<PbInsight, 'title' | 'content' | 'source' | 'customer_id' | 'processed'>>) =>
      put<PbInsight>(`/product/insights/${id}`, body),
    removeInsight: (id: string) => del<{ ok: boolean }>(`/product/insights/${id}`),
    linkInsight: (insightId: string, body: { feature_id: string; importance?: number; quote?: string }) =>
      post<unknown>(`/product/insights/${insightId}/links`, body),
    unlinkInsight: (linkId: string) => del<{ ok: boolean }>(`/product/insight-links/${linkId}`),

    // Features & prioritization
    features: (params: { project_id?: string; status?: string; timeframe?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
      return get<PbFeature[]>(`/product/features${qs.toString() ? `?${qs}` : ''}`);
    },
    feature: (id: string) => get<PbFeature>(`/product/features/${id}`),
    createFeature: (body: Partial<PbFeature>) => post<PbFeature>('/product/features', body),
    updateFeature: (id: string, body: Partial<PbFeature>) => put<PbFeature>(`/product/features/${id}`, body),
    removeFeature: (id: string) => del<{ ok: boolean }>(`/product/features/${id}`),
    linkIssue: (featureId: string, issue_id: string) =>
      post<PbFeature>(`/product/features/${featureId}/issues`, { issue_id }),
    pushToDelivery: (featureId: string, body: { project_id?: string; type?: string }) =>
      post<PbFeature>(`/product/features/${featureId}/push`, body),
    unlinkIssue: (linkId: string) => del<{ ok: boolean }>(`/product/feature-issues/${linkId}`),
    voteFeature: (featureId: string) =>
      post<{ voted: boolean; vote_count: number }>(`/product/features/${featureId}/vote`),

    // Impact measurement. These endpoints wrap their payload in `{ data }`
    // rather than returning it bare like the rest of the API — unwrap here so
    // callers never have to know about the seam.
    impact: (featureId: string) =>
      get<{ data: PbFeatureImpact }>(`/product-features/${featureId}/impact-metrics`).then(r => r.data),
    recordImpactMetric: (featureId: string, body: {
      metricType: ImpactMetricType;
      actualValue: number;
      unit?: string;
      dataSource?: string;
      notes?: string;
      measurementDate?: string;
    }) => post<{ data: PbImpactMetric }>(`/product-features/${featureId}/impact-metrics`, body).then(r => r.data),
    /** Omitted fields keep their current value; explicit null clears one. */
    saveForecast: (featureId: string, body: { forecastAdoption?: number | null; forecastRevenue?: number | null }) =>
      put<{ data: PbFeature }>(`/product-features/${featureId}/forecast-metrics`, body).then(r => r.data),
    impactDashboard: () =>
      get<{ data: PbImpactDashboard }>('/product-features/impact-dashboard').then(r => r.data),

    // Outcomes — the metric can be set before launch; measured/verdict records
    // the later review. The queue window is caller-configurable and defaults to
    // the deployment setting on the server.
    outcomes: (reviewAfterDays?: number) =>
      get<PbOutcomesResponse>(`/product/outcomes${reviewAfterDays ? `?review_after_days=${reviewAfterDays}` : ''}`),
    saveOutcome: (featureId: string, body: Partial<Pick<PbFeatureOutcome,
      'metric' | 'target' | 'baseline' | 'measured' | 'verdict' | 'notes'>>) =>
      put<PbFeatureOutcome>(`/product/features/${featureId}/outcome`, body),

    // Objectives
    objectives: () => get<PbObjective[]>('/product/objectives'),
    objective: (id: string) => get<PbObjective>(`/product/objectives/${id}`),
    createObjective: (body: { name: string; description?: string; status?: string; target_date?: string; owner_id?: string }) =>
      post<PbObjective>('/product/objectives', body),
    updateObjective: (id: string, body: Partial<Pick<PbObjective, 'name' | 'description' | 'status' | 'target_date' | 'owner_id'>>) =>
      put<PbObjective>(`/product/objectives/${id}`, body),
    removeObjective: (id: string) => del<{ ok: boolean }>(`/product/objectives/${id}`),
    linkObjectiveFeature: (objectiveId: string, feature_id: string) =>
      post<PbObjective>(`/product/objectives/${objectiveId}/features`, { feature_id }),
    unlinkObjectiveFeature: (linkId: string) => del<{ ok: boolean }>(`/product/objective-features/${linkId}`),
  },

  portal: {
    features: () => get<PortalFeature[]>('/portal/features'),
    feature: (featureId: string) => get<PortalFeature>(`/portal/features/${featureId}`),
    submitIdea: (body: { title: string; content?: string }) =>
      post<PortalSubmission & { ok: true }>('/portal/ideas', body),
    vote: (featureId: string) => post<PortalFeature>(`/portal/features/${featureId}/vote`),
    follow: (featureId: string) => post<PortalFeature>(`/portal/features/${featureId}/follow`),
    unfollow: (featureId: string) => del<PortalFeature>(`/portal/features/${featureId}/follow`),
    mine: () => get<PortalMe>('/portal/me'),
  },

  customFields: {
    list: (projectId: string) => get<CustomField[]>(`/projects/${projectId}/fields`),
    create: (projectId: string, body: { name: string; field_type: string; options?: string[] }) =>
      post<CustomField>(`/projects/${projectId}/fields`, body),
    update: (id: string, body: { name?: string; options?: string[]; position?: number }) =>
      put<CustomField>(`/fields/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/fields/${id}`),
    setValues: (issueId: string, values: Record<string, string>) =>
      put<{ ok: boolean }>(`/issues/${issueId}/fields`, { values }),
  },

  tokens: {
    list: () => get<ApiToken[]>('/tokens'),
    create: (name: string) => post<ApiToken>('/tokens', { name }),
    remove: (id: string) => del<{ ok: boolean }>(`/tokens/${id}`),
  },

  webhooks: {
    list: (projectId: string) => get<Webhook[]>(`/projects/${projectId}/webhooks`),
    create: (projectId: string, body: { url: string; events: string[] }) => post<Webhook>(`/projects/${projectId}/webhooks`, body),
    update: (id: string, body: Partial<Pick<Webhook, 'url' | 'events'>> & { enabled?: boolean }) => put<Webhook>(`/webhooks/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/webhooks/${id}`),
  },

  ai: {
    status: () => get<{ enabled: boolean; model: string | null }>('/ai/status'),
    summarize: (body: { page_id?: string; text?: string; title?: string }) =>
      post<{ summary: string }>('/ai/summarize', body),
    write: (body: { action: 'draft' | 'improve' | 'shorten' | 'expand' | 'fix'; text?: string; prompt?: string }) =>
      post<{ html: string }>('/ai/write', body),
    ask: (body: { question: string; space_id?: string }) =>
      post<{ answer: string; sources: { index: number; id: string; title: string; space_id: string }[] }>('/ai/ask', body),
  },

  reports: {
    velocity: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/velocity`),
    sprint: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/sprint`),
    burndown: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/burndown`),
    resolution: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/resolution`),
    workload: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/workload`),
    typeDistribution: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/type-distribution`),
    priorityDistribution: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/priority-distribution`),
    createdVsResolved: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/created-vs-resolved`),
    cycleTime: (projectId: string) => get<CycleTimeResponse>(`/projects/${projectId}/reports/cycle-time`),
    timeInStatus: (projectId: string) => get<TimeInStatusResponse>(`/projects/${projectId}/reports/time-in-status`),
    cumulativeFlow: (projectId: string, days = 30) => get<CumulativeFlowResponse>(`/projects/${projectId}/reports/cumulative-flow?days=${days}`),
    averageAge: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/average-age`),
    controlChart: (projectId: string) => get<ControlChartResponse>(`/projects/${projectId}/reports/control-chart`),
    epicBurndown: (projectId: string, epicId: string) => get<unknown>(`/projects/${projectId}/reports/epics/${epicId}`),
    versions: (projectId: string) => get<Array<{ id: string; name: string }>>(`/projects/${projectId}/versions`),
    versionReport: (projectId: string, versionId: string) => get<VersionReportResponse>(`/projects/${projectId}/reports/versions/${versionId}`),
    csvUrl: (projectId: string) => `/api/projects/${projectId}/reports/export/csv`,
  },
};
