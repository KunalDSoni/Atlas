import { apiFetch } from './client';

export type Issue = {
  id: string;
  issue_key: string;
  title: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  project_id: string;
  time_spent: number | null;
  in_progress_minutes_live: number | null;
};

export function fetchProjectIssues(projectId: string): Promise<Issue[]> {
  return apiFetch<Issue[]>(`/projects/${projectId}/issues`);
}

export function fetchIssue(issueId: string): Promise<Issue> {
  return apiFetch<Issue>(`/issues/${issueId}`);
}

export function updateIssue(issueId: string, updates: Partial<Pick<Issue, 'status' | 'assignee_id' | 'title' | 'description'>>): Promise<Issue> {
  return apiFetch<Issue>(`/issues/${issueId}`, { method: 'PUT', body: updates });
}

export type CreateIssueInput = {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  assignee_id?: string | null;
};

export function createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
  return apiFetch<Issue>(`/projects/${projectId}/issues`, { method: 'POST', body: input });
}
