import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { useIssueDetail } from '@/components/app/issue-detail/use-issue-detail';
import { IssueDetailBody } from '@/components/app/issue-detail/issue-detail-body';
import { IssueActions } from '@/components/app/issue-detail/issue-detail-actions';
import { CopyIssueLink } from '@/components/app/copy-issue-link';
import { IssueNotFound } from '@/screens/not-found';
import { TypeIcon } from '@/components/app/primitives';
import { TYPE_LABEL } from '@/lib/domain';
import { isIssueKey, issueUrl, projectUrl } from '@/lib/urls';

/**
 * The full-page rendering of /:projectKey/:issueKey.
 *
 * Same route and same body as the drawer — the only difference is that nothing
 * is layered underneath, which is exactly what "opened cold" means: a pasted
 * link, a bookmark, a notification followed from an inbox.
 */
export default function IssuePage() {
  const { issueKey = '' } = useParams<{ issueKey: string }>();
  const { currentProject } = useProjects();
  const navigate = useNavigate();
  const [issueId, setIssueId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isIssueKey(issueKey)) { setMissing(true); return; }
    let live = true;
    setMissing(false);
    setIssueId(null);
    api.issues.getByKey(issueKey)
      .then((issue) => { if (live) setIssueId(issue.id); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [issueKey]);

  const detail = useIssueDetail(issueId, {
    onOpenIssue: (key) => navigate(issueUrl(key)),
    onClosed: () => navigate(projectUrl(currentProject?.key ?? '')),
  });

  if (missing) return <IssueNotFound issueKey={issueKey} />;
  if (!detail.issue) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { issue } = detail;
  return (
    <div className="mx-auto max-w-6xl px-6 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1 px-2">
          <Link to={projectUrl(currentProject?.key ?? '')}>
            <ChevronLeft className="size-4" /> Board
          </Link>
        </Button>
        <TypeIcon type={issue.type} />
        <span className="font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
        <span className="text-xs text-muted-foreground">· {TYPE_LABEL[issue.type]}</span>
        <span className="flex-1" />
        <CopyIssueLink issueKey={issue.issue_key} />
        <IssueActions detail={detail} />
      </div>

      {issue.type === 'subtask' && issue.parent_key && (
        <Link
          to={issueUrl(issue.parent_key)}
          className="mb-1 flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {issue.parent_type && <TypeIcon type={issue.parent_type} className="size-3.5" />}
          <span className="font-mono">{issue.parent_key}</span>
          <span className="truncate">{issue.parent_title}</span>
        </Link>
      )}
      <h1 className="mb-5 text-2xl font-semibold leading-snug">{issue.title}</h1>

      <IssueDetailBody detail={detail} variant="page" />
    </div>
  );
}
