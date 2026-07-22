import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useProjects } from '@/hooks/use-projects';
import { ProjectNotFound } from '@/screens/not-found';

const Board = lazy(() => import('@/screens/board'));
const Backlog = lazy(() => import('@/screens/backlog'));
const Epics = lazy(() => import('@/screens/epics'));
const Sprints = lazy(() => import('@/screens/sprints'));
const Releases = lazy(() => import('@/screens/releases'));
const Roadmap = lazy(() => import('@/screens/roadmap'));
const Automation = lazy(() => import('@/screens/automation'));
const Reports = lazy(() => import('@/screens/reports'));
const ServiceDeskQueues = lazy(() => import('@/screens/servicedesk-queues'));
const ServiceDeskSettings = lazy(() => import('@/screens/servicedesk-settings'));
const ServiceDeskReport = lazy(() => import('@/screens/servicedesk-report'));
const IssuePage = lazy(() => import('@/screens/issue'));

function Spinner() {
  return (
    <div className="grid h-64 place-items-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Everything under /:projectKey. The key is resolved once, here, and every
 * screen below reads it through useProjects() exactly as it always did.
 */
export function ProjectScope() {
  const { projectKey = '' } = useParams<{ projectKey: string }>();
  const { projects, loading } = useProjects();

  const known = projects.some((p) => p.key.toLowerCase() === projectKey.toLowerCase());
  if (loading && projects.length === 0) return <Spinner />;
  if (!known) return <ProjectNotFound requestedKey={projectKey} />;

  return (
    <Suspense fallback={<Spinner />}>
      {/*
        The issue route is declared last and matches a single dynamic segment.
        React Router ranks static segments above dynamic ones, so `board` always
        wins over `:issueKey` — no reserved-word list to maintain.
      */}
      <Routes>
        <Route path="" element={<Navigate to="board" replace />} />
        <Route path="board" element={<Board />} />
        <Route path="backlog" element={<Backlog />} />
        <Route path="epics" element={<Epics />} />
        <Route path="roadmap" element={<Roadmap />} />
        <Route path="sprints" element={<Sprints />} />
        <Route path="releases" element={<Releases />} />
        <Route path="reports" element={<Reports />} />
        <Route path="automation" element={<Automation />} />
        <Route path="servicedesk" element={<ServiceDeskQueues />} />
        <Route path="servicedesk/settings" element={<ServiceDeskSettings />} />
        <Route path="servicedesk/report" element={<ServiceDeskReport />} />
        <Route path=":issueKey" element={<IssuePage />} />
      </Routes>
    </Suspense>
  );
}
