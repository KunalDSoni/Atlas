import { apiFetch } from './client';

export type MentionCandidate = {
  id: string;
  name: string;
  email: string;
  avatar_color: string | null;
  is_member: boolean;
};

/** Candidates for the @ picker: project members first, everyone else reachable
 *  by search, each flagged with is_member. */
export function searchMentions(q: string, projectId?: string): Promise<MentionCandidate[]> {
  const params = new URLSearchParams({ q });
  if (projectId) params.set('projectId', projectId);
  return apiFetch<MentionCandidate[]>(`/mentions/search?${params.toString()}`);
}
