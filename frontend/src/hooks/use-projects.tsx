import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import type { Project } from '@/lib/types';

interface ProjectsContextValue {
  projects: Project[];
  currentProject: Project | null;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);
const LAST_PROJECT_KEY = 'atlas_last_project';

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.projects.list();
      setProjects(list);

      // Keep the current selection if it still exists, else restore the last used, else first.
      setCurrentId((prev) => {
        const remembered = localStorage.getItem(LAST_PROJECT_KEY);
        const candidates = [prev, remembered].filter(Boolean) as string[];
        const found = candidates.find((id) => list.some((p) => p.id === id));
        return found ?? list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setCurrentId(null);
      setLoading(false);
      return;
    }
    void reload();
  }, [user, reload]);

  const setCurrentProjectId = useCallback((id: string) => {
    localStorage.setItem(LAST_PROJECT_KEY, id);
    setCurrentId(id);
  }, []);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      currentProject: projects.find((p) => p.id === currentProjectId) ?? null,
      currentProjectId,
      setCurrentProjectId,
      loading,
      error,
      reload,
    }),
    [projects, currentProjectId, setCurrentProjectId, loading, error, reload],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}
