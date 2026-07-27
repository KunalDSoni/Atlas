import { apiFetch } from './client';

export type ProjectStatus = {
  id: string;
  key: string;
  label: string;
  category: 'todo' | 'in_progress' | 'done';
  position: number;
};

export function fetchProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
  return apiFetch<ProjectStatus[]>(`/projects/${projectId}/statuses`);
}
