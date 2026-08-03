import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TYPE_LABEL } from '@/lib/domain';
import { SprintBadge, TypeIcon } from './primitives';
import { CopyIssueLink } from './copy-issue-link';
import { useIssueDetail } from './issue-detail/use-issue-detail';
import { IssueDetailBody } from './issue-detail/issue-detail-body';
import { IssueActions } from './issue-detail/issue-detail-actions';

/**
 * The drawer. Chrome only — the body below is the same component the full page
 * at /atlas/ATLAS-3 renders, because they are the same resource.
 */
export function IssueDetailSheet({
  issueId,
  onOpenChange,
  onChanged,
  onOpenIssue,
}: {
  issueId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  /** Navigate the sheet to another issue by KEY (used by linked issues). */
  onOpenIssue?: (issueKey: string) => void;
}) {
  const detail = useIssueDetail(issueId, { onChanged, onOpenIssue, onClosed: () => onOpenChange(false) });
  const { issue, loading } = detail;

  return (
    <Sheet open={Boolean(issueId)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {loading && !issue ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !issue ? null : (
          <>
            <SheetHeader className="gap-2 border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <TypeIcon type={issue.type} />
                <span className="font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
                <span className="text-xs text-muted-foreground">· {TYPE_LABEL[issue.type]}</span>
                {issue.sprint_name && issue.type !== 'subtask' && issue.type !== 'epic' && (
                  <SprintBadge name={issue.sprint_name} />
                )}
                <span className="flex-1" />
                <CopyIssueLink issueKey={issue.issue_key} />
                <IssueActions detail={detail} />
              </div>
              {issue.type === 'subtask' && issue.parent_id && issue.parent_key && (
                <button
                  onClick={() => onOpenIssue?.(issue.parent_key!)}
                  className="flex w-fit max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {issue.parent_type && <TypeIcon type={issue.parent_type} className="size-3.5" />}
                  <span className="font-mono">{issue.parent_key}</span>
                  <span className="truncate">{issue.parent_title}</span>
                </button>
              )}
              <SheetTitle className="text-left text-lg leading-snug">{issue.title}</SheetTitle>
            </SheetHeader>

            <IssueDetailBody detail={detail} variant="sheet" />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
