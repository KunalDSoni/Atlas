import { Suspense, lazy, useEffect, useState } from 'react';
import {
  Navigate, Route, Routes, useLocation, useNavigate, useParams, type Location,
} from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { ProjectNotFound } from '@/screens/not-found';
import { IssueDetailSheet } from '@/components/app/issue-detail-sheet';
import { isIssueKey, issueUrl } from '@/lib/urls';

const Board = lazy(() => import('@/screens/board'));
const Backlog = lazy(() => import('@/screens/backlog'));
const Epics = lazy(() => import('@/screens/epics'));
const Sprints = lazy(() => import('@/screens/sprints'));
const SprintDetail = lazy(() => import('@/screens/sprint-detail'));
const Releases = lazy(() => import('@/screens/releases'));
const ReleaseDetail = lazy(() => import('@/screens/release-detail'));
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
 * The drawer, driven by the URL. Resolves the key the same way the full page
 * does — the two differ only in what surrounds the body.
 */
function IssueSheetRoute({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [issueId, setIssueId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setIssueId(null);
    api.issues.getByKey(issueKey)
      .then((issue) => { if (live) setIssueId(issue.id); })
      .catch(() => { if (live) onClose(); });
    return () => { live = false; };
    // onClose is a fresh closure each render; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);

  return (
    <IssueDetailSheet
      issueId={issueId}
      onOpenChange={(open) => { if (!open) onClose(); }}
      onOpenIssue={(key) => navigate(issueUrl(key))}
    />
  );
}

/**
 * Everything under /:projectKey. The key is resolved once, here, and every
 * screen below reads it through useProjects() exactly as it always did.
 */
export function ProjectScope() {
  const { projectKey = '' } = useParams<{ projectKey: string }>();
  const { projects, loading } = useProjects();
  const location = useLocation();
  const navigate = useNavigate();

  // Pushed by every issue link that had a screen underneath it. Its ABSENCE is
  // what a pasted link looks like: same route, nothing to layer over, so the
  // route resolves to the full page instead.
  const background = (location.state as { background?: Location } | null)?.background;
  const segment = location.pathname.split('/').filter(Boolean)[1] ?? '';
  const asDrawer = Boolean(background) && isIssueKey(segment);

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
      <Routes location={asDrawer ? background : location}>
        <Route path="" element={<Navigate to="board" replace />} />
        <Route path="board" element={<Board />} />
        <Route path="backlog" element={<Backlog />} />
        <Route path="epics" element={<Epics />} />
        <Route path="roadmap" element={<Roadmap />} />
        <Route path="sprints" element={<Sprints />} />
        <Route path="sprints/:sprintSlug" element={<SprintDetail />} />
        <Route path="releases" element={<Releases />} />
        <Route path="releases/:releaseSlug" element={<ReleaseDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="automation" element={<Automation />} />
        <Route path="servicedesk" element={<ServiceDeskQueues />} />
        <Route path="servicedesk/settings" element={<ServiceDeskSettings />} />
        <Route path="servicedesk/report" element={<ServiceDeskReport />} />
        <Route path=":issueKey" element={<IssuePage />} />
      </Routes>
      {asDrawer && (
        <IssueSheetRoute issueKey={segment} onClose={() => navigate(-1)} />
      )}
    </Suspense>
  );
}
