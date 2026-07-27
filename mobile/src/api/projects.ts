import { apiFetch } from './client';

export type Project = {
  id: string;
  key: string;
  name: string;
  lead_name: string | null;
  lead_color: string | null;
  issue_count: number;
  member_count: number;
};

export function fetchProjects(): Promise<Project[]> {
  return apiFetch<Project[]>('/projects');
}
