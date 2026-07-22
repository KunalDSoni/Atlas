/**
 * The controls that act on an issue: capture, watch, edit, delete.
 * Shared by the drawer's SheetHeader and the full page's header.
 */
import { Eye, EyeOff, Lightbulb, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/context/auth-provider';
import { isAdmin } from '@/lib/domain';
import type { IssueDetail } from './use-issue-detail';

export function IssueActions({ detail }: { detail: IssueDetail }) {
  const { issue, capturing, captureAsInsight, toggleWatch, watching, watchers,
    canEdit, setEditOpen, removeIssue } = detail;
  const { user } = useAuth();
  if (!issue) return null;

  return (
    <>
                {issue.type === 'request' && user?.role !== 'client' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={captureAsInsight}
                    disabled={capturing}
                    className="gap-1.5 text-xs"
                  >
                    <Lightbulb className="size-3.5" />
                    {capturing ? 'Capturing…' : 'Capture as insight'}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={toggleWatch} className="gap-1.5 text-xs">
                  {watching ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {watchers.length}
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditOpen(true)}
                    className="gap-1.5 text-xs"
                    aria-label="Edit issue"
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                )}
                {isAdmin(user?.role) && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete issue">
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {issue.issue_key}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes the issue and its comments. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={removeIssue}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
    </>
  );
}
