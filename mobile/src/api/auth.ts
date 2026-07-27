import { apiFetch } from './client';

export type LoginResponse = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_color: string | null;
  avatar_url: string | null;
  token: string;
};

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' });
}

export function getMe(): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/me');
}
