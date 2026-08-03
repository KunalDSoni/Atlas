import { apiFetch } from './client';

export type ProjectMember = {
  id: string;
  user_id: string;
  name: string;
  avatar_color: string | null;
};

export function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return apiFetch<ProjectMember[]>(`/projects/${projectId}/members`);
}
