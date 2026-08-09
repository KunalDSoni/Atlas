import { useQuery, useMutation, UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { apiClient } from './client';

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
  return useQuery({
    queryKey: ['issues', params],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            queryParams.append(key, String(value));
          }
        });
      }
      const response = await apiClient.get(`/issues?${queryParams.toString()}`);
      return response.data;
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 60000,
  }) as UseQueryResult<any[], Error>;
};

export const useIssueDetail = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => {
      const response = await apiClient.get(`/issues/${issueId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any, Error>;
};

export const useCreateIssue = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.post('/issues', data);
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useUpdateIssue = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.put(`/issues/${issueId}`, data);
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useDeleteIssue = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (issueId: string) => {
      await apiClient.delete(`/issues/${issueId}`);
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
      const response = await apiClient.get(`/issues/${issueId}/comments`);
      return response.data;
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any[], Error>;
};

export const useCreateComment = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (text: string) => {
      const response = await apiClient.post(`/issues/${issueId}/comments`, { text });
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, string>;
};

export const useUpdateComment = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async ({ commentId, text }: { commentId: string; text: string }) => {
      const response = await apiClient.put(`/comments/${commentId}`, { text });
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, { commentId: string; text: string }>;
};

export const useDeleteComment = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (commentId: string) => {
      await apiClient.delete(`/comments/${commentId}`);
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
      const response = await apiClient.get(`/search?q=${encodeURIComponent(query)}`);
      return response.data;
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
      const response = await apiClient.get(`/issues/${issueId}/watchers`);
      return response.data;
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useAddWatcher = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.post(`/issues/${issueId}/watchers`, { userId });
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, string>;
};

export const useRemoveWatcher = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async ({ issueId, userId }: { issueId: string; userId: string }) => {
      await apiClient.delete(`/issues/${issueId}/watchers/${userId}`);
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
      const response = await apiClient.get('/notifications');
      return response.data;
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any[], Error>;
};

export const useMarkNotificationAsRead = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await apiClient.put(`/notifications/${notificationId}`, { read: true });
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, string>;
};

export const useDeleteNotification = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (notificationId: string) => {
      await apiClient.delete(`/notifications/${notificationId}`);
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
      const response = await apiClient.get(`/sprints?projectId=${projectId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useSprintDetail = (sprintId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['sprint', sprintId],
    queryFn: async () => {
      const response = await apiClient.get(`/sprints/${sprintId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!sprintId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any, Error>;
};

export const useCreateSprint = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.post('/sprints', data);
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useUpdateSprint = (sprintId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.put(`/sprints/${sprintId}`, data);
      return response.data;
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
      const response = await apiClient.get(`/filters?projectId=${projectId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useCreateFilter = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.post('/filters', data);
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useDeleteFilter = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (filterId: string) => {
      await apiClient.delete(`/filters/${filterId}`);
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
      const response = await apiClient.get(`/issues/${issueId}/attachments`);
      return response.data;
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useUploadAttachment = (issueId: string, options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await apiClient.post(`/issues/${issueId}/attachments`, formData);
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, FormData>;
};

export const useDeleteAttachment = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      await apiClient.delete(`/attachments/${attachmentId}`);
      return { success: true };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<{ success: boolean }, Error, string>;
};

// ============ ACTIVITY ============

export const useActivity = (projectId?: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['activity', projectId],
    queryFn: async () => {
      const url = projectId ? `/activity?projectId=${projectId}` : '/activity';
      const response = await apiClient.get(url);
      return response.data;
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
    staleTime: options?.staleTime ?? 30000,
  }) as UseQueryResult<any[], Error>;
};

export const useIssueActivity = (issueId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['issueActivity', issueId],
    queryFn: async () => {
      const response = await apiClient.get(`/issues/${issueId}/activity`);
      return response.data;
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
      const response = await apiClient.get(`/issues?type=Epic&projectId=${projectId}`);
      return response.data;
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
      const response = await apiClient.get(`/issues/${issueId}/links`);
      return response.data;
    },
    enabled: options?.enabled ?? !!issueId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

export const useCreateLink = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.post('/links', data);
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useDeleteLink = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (linkId: string) => {
      await apiClient.delete(`/links/${linkId}`);
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
      const response = await apiClient.get('/profile');
      return response.data;
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any, Error>;
};

export const useUpdateProfile = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.put('/profile', data);
      return response.data;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  }) as UseMutationResult<any, Error, any>;
};

export const useSettings = (options?: QueryOptions) => {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await apiClient.get('/settings');
      return response.data;
    },
    enabled: options?.enabled ?? true,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any, Error>;
};

export const useUpdateSettings = (options?: MutationOptions) => {
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await apiClient.put('/settings', data);
      return response.data;
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
      const response = await apiClient.get(`/custom-fields?projectId=${projectId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 3,
  }) as UseQueryResult<any[], Error>;
};

// ============ REPORTS ============

export const useSprintBurndown = (sprintId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['burndown', sprintId],
    queryFn: async () => {
      const response = await apiClient.get(`/reports/sprint-burndown?sprintId=${sprintId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!sprintId,
    retry: options?.retry ?? 2,
    staleTime: options?.staleTime ?? 300000,
  }) as UseQueryResult<any, Error>;
};

export const useVelocity = (projectId: string, options?: QueryOptions) => {
  return useQuery({
    queryKey: ['velocity', projectId],
    queryFn: async () => {
      const response = await apiClient.get(`/reports/velocity?projectId=${projectId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!projectId,
    retry: options?.retry ?? 2,
    staleTime: options?.staleTime ?? 300000,
  }) as UseQueryResult<any, Error>;
};
