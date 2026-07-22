import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { issueUrl, projectUrl } from '@/lib/urls';

/**
 * The pre-URL-scheme paths: /board, /backlog, ... and /board?issue=<uuid>.
 *
 * These are not dead weight. Notification rows written before this change are
 * still in the database holding /board?issue=<uuid>, emails carrying them are
 * still in inboxes, and browsers still hold bookmarks. They resolve forever.
 */
export function LegacyProjectRedirect({ screen }: { screen: string }) {
  const [params] = useSearchParams();
  const { currentProject, loading } = useProjects();
  const legacyIssueId = params.get('issue');
  const [issuePath, setIssuePath] = useState<string | null>(null);
  const [resolved, setResolved] = useState(!legacyIssueId);

  useEffect(() => {
    if (!legacyIssueId) return;
    let live = true;
    api.issues.get(legacyIssueId)
      .then((issue) => { if (live) setIssuePath(issueUrl(issue.issue_key)); })
      .catch(() => undefined)
      .finally(() => { if (live) setResolved(true); });
    return () => { live = false; };
  }, [legacyIssueId]);

  if (loading || !resolved) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (issuePath) return <Navigate to={issuePath} replace />;
  if (!currentProject) return <Navigate to="/dashboard" replace />;
  return <Navigate to={projectUrl(currentProject.key, screen)} replace />;
}
