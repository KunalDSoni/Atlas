import { useQuery, useMutation, UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { apiFetch, apiFetchForm } from './client';

export interface QueryOptions {
  enabled?: boolean;
  retry?: number;
  staleTime?: number;
}

export interface MutationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

// ============ ISSUES ============
// Backend only exposes issue listing scoped to a project
// (GET /projects/:projectId/issues) - there is no cross-project list endpoint.

export interface FetchIssuesParams {
  projectId?: string;
  status?: string;
  assignee?: string;
  priority?: string;
  label?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const useIssues = (params?: FetchIssuesParams, options?: QueryOptions) => {
  const projectId = params?.projectId;
  return useQuery({
    queryKey: ['issues', params],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (key === 'projectId') return;
          if (value !== undefined && value !== null) {
            queryParams.append(key, String(value));
          }
        });
      }
      const qs = queryParams.toString();
      const response = await apiFetch<any[]>(`/projects/${projectId}/issues${qs ? `?${qs}` : ''}`);
      return response;
    },
    enabled: (options?.enabled ?? true) && !!projectId,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 60000,
  }) as UseQueryResult<any[], Error>;
};

export const useIssueDetail = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => {
      return apiFetch<any>(`/issues/${issueId}`);
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any, Error>;
};

export const useCreateIssue = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async ({ projectId, ...data }: any) => {
      return apiFetch<any>(`/projects/${projectId}/issues`, { method: 'POST', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useUpdateIssue = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      return apiFetch<any>(`/issues/${issueId}`, { method: 'PUT', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useDeleteIssue = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (issueId: string) => {
      await apiFetch(`/issues/${issueId}`, { method: 'DELETE' });
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, string>;
};

// ============ COMMENTS ============

export const useComments = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['comments', issueId],
    queryFn: async () => {
      return apiFetch<any[]>(`/issues/${issueId}/comments`);
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any[], Error>;
};

export const useCreateComment = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (text: string) => {
      return apiFetch<any>(`/issues/${issueId}/comments`, { method: 'POST', body: { text } });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, string>;
};

export const useUpdateComment = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async ({ commentId, text }: { commentId: string; text: string }) => {
      return apiFetch<any>(`/comments/${commentId}`, { method: 'PUT', body: { text } });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, { commentId: string; text: string }>;
};

export const useDeleteComment = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (commentId: string) => {
      await apiFetch(`/comments/${commentId}`, { method: 'DELETE' });
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, string>;
};

// ============ SEARCH ============

export const useSearch = (query: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['search', query],
    queryFn: async () => {
      const response = await apiFetch<{ issues: any[]; pages: any[] }>(`/search?q=${encodeURIComponent(query)}`);
      return response.issues;
    },
    enabled: options?.enabled ?? (query.length > 0),
    retry: options?.retry ?? 2,
    staleTime: options?.staleTime ?? 60000,
  }) as UseQueryResult<any[], Error>;
};

// ============ WATCHERS ============

export const useWatchers = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['watchers', issueId],
    queryFn: async () => {
      return apiFetch<any[]>(`/issues/${issueId}/watchers`);
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useAddWatcher = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (userId: string) => {
      return apiFetch<any>(`/issues/${issueId}/watchers`, { method: 'POST', body: { userId } });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, string>;
};

export const useRemoveWatcher = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async ({ issueId, userId }: { issueId: string; userId: string }) => {
      await apiFetch(`/issues/${issueId}/watchers/${userId}`, { method: 'DELETE' });
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, { issueId: string; userId: string }>;
};

// ============ NOTIFICATIONS ============

export const useNotifications = (options?: QueryOptions) => {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await apiFetch<any[]>('/notifications');
      return response.map((n: any) => ({ ...n, read: !!n.is_read }));
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any[], Error>;
};

export const useMarkNotificationAsRead = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (notificationId: string) => {
      return apiFetch<any>(`/notifications/${notificationId}/read`, { method: 'PUT' });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, string>;
};

// Note: the backend has no delete-notification endpoint (only read/read-all).
// This mutation is wired for when that endpoint lands; until then it 404s
// and surfaces the existing onError toast rather than crashing the screen.
export const useDeleteNotification = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (notificationId: string) => {
      await apiFetch(`/notifications/${notificationId}`, { method: 'DELETE' });
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, string>;
};

// ============ SPRINTS ============

export const useSprints = (projectId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['sprints', projectId],
    queryFn: async () => {
      return apiFetch<any[]>(`/projects/${projectId}/sprints`);
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useSprintDetail = (sprintId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['sprint', sprintId],
    queryFn: async () => {
      return apiFetch<any>(`/sprints/${sprintId}`);
    },
    enabled: options?.enabled ?? !!sprintId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any, Error>;
};

export const useCreateSprint = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async ({ projectId, ...data }: any) => {
      return apiFetch<any>(`/projects/${projectId}/sprints`, { method: 'POST', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useUpdateSprint = (sprintId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      return apiFetch<any>(`/sprints/${sprintId}`, { method: 'PUT', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

// ============ FILTERS ============

export const useFilters = (projectId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['filters', projectId],
    queryFn: async () => {
      return apiFetch<any[]>(`/projects/${projectId}/filters`);
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useCreateFilter = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async ({ projectId, ...data }: any) => {
      return apiFetch<any>(`/projects/${projectId}/filters`, { method: 'POST', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useDeleteFilter = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (filterId: string) => {
      await apiFetch(`/filters/${filterId}`, { method: 'DELETE' });
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, string>;
};

// ============ ATTACHMENTS ============

export const useAttachments = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['attachments', issueId],
    queryFn: async () => {
      return apiFetch<any[]>(`/issues/${issueId}/attachments`);
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useUploadAttachment = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (formData: FormData) => {
      return apiFetchForm<any>(`/issues/${issueId}/attachments`, formData);
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, FormData>;
};

export const useDeleteAttachment = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      await apiFetch(`/attachments/${attachmentId}`, { method: 'DELETE' });
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, string>;
};

// ============ ACTIVITY ============
// Note: the backend only exposes per-issue activity (GET /issues/:id/activity).
// There is no project-wide or global activity feed endpoint, so a
// project-less/global useActivity() call is disabled rather than hitting a
// route that doesn't exist. Standing up a real feed for ActivityFeedScreen
// needs a backend endpoint - a product decision, not a hooks-layer fix.

export const useActivity = (projectId?: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['activity', projectId],
    queryFn: async () => {
      return [] as any[];
    },
    enabled: false,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any[], Error>;
};

export const useIssueActivity = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['issueActivity', issueId],
    queryFn: async () => {
      return apiFetch<any[]>(`/issues/${issueId}/activity`);
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

// ============ EPICS ============

export const useEpics = (projectId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['epics', projectId],
    queryFn: async () => {
      return apiFetch<any[]>(`/projects/${projectId}/epics`);
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

// ============ ISSUE LINKS ============

export const useIssueLinks = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['links', issueId],
    queryFn: async () => {
      return apiFetch<any[]>(`/issues/${issueId}/links`);
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useCreateLink = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      return apiFetch<any>(`/issues/${issueId}/links`, { method: 'POST', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useDeleteLink = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (linkId: string) => {
      await apiFetch(`/issue-links/${linkId}`, { method: 'DELETE' });
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, string>;
};

// ============ PROFILE & SETTINGS ============

export const useProfile = (options?: QueryOptions) => {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      return apiFetch<any>('/profile');
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any, Error>;
};

export const useUpdateProfile = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      return apiFetch<any>('/profile', { method: 'PUT', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useSettings = (options?: QueryOptions) => {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      return apiFetch<any>('/settings');
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any, Error>;
};

export const useUpdateSettings = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      return apiFetch<any>('/settings', { method: 'PUT', body: data });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

// ============ CUSTOM FIELDS ============

export const useCustomFields = (projectId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['customFields', projectId],
    queryFn: async () => {
      return apiFetch<any[]>(`/projects/${projectId}/fields`);
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

// ============ REPORTS ============
// Both reports are project-scoped on the backend (there is no
// sprint-scoped burndown endpoint), so useSprintBurndown takes a projectId.

export const useSprintBurndown = (projectId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['burndown', projectId],
    queryFn: async () => {
      return apiFetch<any>(`/projects/${projectId}/reports/burndown`);
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 2,
    staleTime: options?.staleTime ?? 300000,
  }) as UseQueryResult<any, Error>;
};

export const useVelocity = (projectId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['velocity', projectId],
    queryFn: async () => {
      return apiFetch<any>(`/projects/${projectId}/reports/velocity`);
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 2,
    staleTime: options?.staleTime ?? 300000,
  }) as UseQueryResult<any, Error>;
};
