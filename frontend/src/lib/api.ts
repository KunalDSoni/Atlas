// Typed Atlas API client.
//
// Authentication is a session token sent as `x-auth-token`. The server derives identity
// and role from that token alone — client-supplied identity headers are ignored.

import type {
  ActivityEntry, AdminStats, Attachment, AuditLogPage, AuthUser, Comment, Issue,
  ProfileResponse, Project, ProjectMember, ProjectStats, Settings, Sprint, User,
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

  if (res.status === 401) {
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
const del = <T>(p: string) => request<T>(p, { method: 'DELETE' });

export const api = {
  auth: {
    login: (email: string, password: string) => post<AuthUser>('/auth/login', { email, password }),
    logout: () => post<{ ok: boolean }>('/auth/logout'),
    me: () => get<User>('/auth/me'),
  },

  users: {
    list: () => get<User[]>('/users'),
    get: (id: string) => get<User>(`/users/${id}`),
    create: (body: { name: string; email: string; role?: string; avatar_color?: string }) =>
      post<User & { initial_password: string }>('/users', body),
    update: (id: string, body: Partial<Pick<User, 'name' | 'email' | 'role' | 'avatar_color' | 'is_active'>>) =>
      put<User>(`/users/${id}`, body),
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
    update: (id: string, body: Partial<Issue>) => put<Issue>(`/issues/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/issues/${id}`),
    move: (id: string, body: { status: string; board_order?: number; sprint_id?: string | null }) =>
      put<Issue>(`/issues/${id}/move`, body),
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

  admin: {
    stats: () => get<AdminStats>('/admin/stats'),
    auditLog: (params: { page?: number; limit?: number; category?: string; q?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
      return get<AuditLogPage>(`/admin/audit-log${qs.toString() ? `?${qs}` : ''}`);
    },
  },

  reports: {
    velocity: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/velocity`),
    workload: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/workload`),
    typeDistribution: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/type-distribution`),
    priorityDistribution: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/priority-distribution`),
    createdVsResolved: (projectId: string) => get<unknown>(`/projects/${projectId}/reports/created-vs-resolved`),
    csvUrl: (projectId: string) => `/api/projects/${projectId}/reports/export/csv`,
  },
};
