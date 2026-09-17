import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { isIssueKey } from '@/lib/urls';
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
// The demo keeps its own key so it never re-points a real session on the same origin.
const LAST_PROJECT_KEY = __ATLAS_DEMO__ ? 'atlas_demo_last_project' : 'atlas_last_project';

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [remembered, setRemembered] = useState<string | null>(
    () => localStorage.getItem(LAST_PROJECT_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.projects.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    void reload();
  }, [user, reload]);

  // The URL is the source of truth. Deriving synchronously rather than syncing
  // into state in an effect matters: an effect would let the board render one
  // frame against the PREVIOUS project and fire a wasted round of fetches.
  const routeKey = location.pathname.split('/')[1] ?? '';
  const fromRoute = projects.find((p) => p.key.toLowerCase() === routeKey.toLowerCase()) ?? null;

  // localStorage now has exactly one job: where a project-less screen points.
  const currentProject = fromRoute
    ?? projects.find((p) => p.id === remembered)
    ?? projects[0]
    ?? null;

  useEffect(() => {
    if (!fromRoute) return;
    localStorage.setItem(LAST_PROJECT_KEY, fromRoute.id);
    setRemembered(fromRoute.id);
  }, [fromRoute]);

  /**
   * Switching project is a navigation, not a state change — that is the whole
   * point of the scheme. You keep the screen you were on, under the new key.
   */
  const setCurrentProjectId = useCallback((id: string) => {
    const next = projects.find((p) => p.id === id);
    if (!next) return;
    localStorage.setItem(LAST_PROJECT_KEY, id);
    setRemembered(id);

    // On a global screen (/dashboard, /wiki) there is nothing to re-scope.
    if (!fromRoute) return;

    const rest = location.pathname.split('/').filter(Boolean).slice(1);
    // ATLAS-3 has no counterpart in another project, so fall back to the board.
    const screen = rest.length === 0 || isIssueKey(rest[0]) ? 'board' : rest.join('/');
    navigate(`/${next.key.toLowerCase()}/${screen}`);
  }, [projects, fromRoute, location.pathname, navigate]);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      currentProject,
      currentProjectId: currentProject?.id ?? null,
      setCurrentProjectId,
      loading,
      error,
      reload,
    }),
    [projects, currentProject, setCurrentProjectId, loading, error, reload],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}
