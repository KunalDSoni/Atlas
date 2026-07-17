import { useCallback, useEffect, useState } from 'react';
import { Clock, Eye, EyeOff, Loader2, Paperclip, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { EPIC_COLORS, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, TYPE_LABEL, canCreateIssues, epicColor, isAdmin } from '@/lib/domain';
import type { ActivityEntry, Attachment, Comment, EpicSummary, Issue, IssueStatus, Priority, Sprint, User, WorkLog } from '@/lib/types';
import { formatBytes, formatDuration, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PriorityIcon, StatusPill, TypeIcon, UserAvatar } from './primitives';
import { LabelsEditor } from './labels-editor';
import { LinkedIssues } from './linked-issues';

const UNASSIGNED = '__unassigned__';
const NO_SPRINT = '__backlog__';
const NO_EPIC = '__no_epic__';

export function IssueDetailSheet({
  issueId,
  onOpenChange,
  onChanged,
  onOpenIssue,
}: {
  issueId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  /** Navigate the sheet to another issue (used by linked issues). */
  onOpenIssue?: (id: string) => void;
}) {
  const { user } = useAuth();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [watchers, setWatchers] = useState<User[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [epics, setEpics] = useState<EpicSummary[]>([]);
  const [children, setChildren] = useState<Issue[]>([]);
  const [candidates, setCandidates] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [worklogs, setWorklogs] = useState<WorkLog[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logHours, setLogHours] = useState('');
  const [logComment, setLogComment] = useState('');
  const [estimateHours, setEstimateHours] = useState('');
  const [loggingWork, setLoggingWork] = useState(false);

  const canEdit = canCreateIssues(user?.role);

  const load = useCallback(async () => {
    if (!issueId) return;
    setLoading(true);
    try {
      const detail = await api.issues.get(issueId);
      setIssue(detail);
      setEstimateHours(detail.original_estimate ? String(Math.round((detail.original_estimate / 60) * 10) / 10) : '');
      const [c, a, act, w, u, sp, ep, ch, all, wl] = await Promise.all([
        api.comments.list(issueId).catch(() => []),
        api.attachments.list(issueId).catch(() => []),
        api.activity.list(issueId).catch(() => []),
        api.watchers.list(issueId).catch(() => []),
        api.users.list().catch(() => []),
        api.sprints.list(detail.project_id).catch(() => []),
        api.epics.list(detail.project_id).catch(() => []),
        detail.type !== 'subtask' ? api.epics.children(detail.id).catch(() => []) : Promise.resolve([]),
        detail.type === 'epic' ? api.issues.list(detail.project_id).catch(() => []) : Promise.resolve([]),
        api.worklogs.list(issueId).catch(() => []),
      ]);
      setComments(c);
      setAttachments(a);
      setActivity(act);
      setWatchers(w);
      setMembers(u.filter((x) => x.is_active));
      setSprints(sp);
      setEpics(ep.filter((e) => e.id !== detail.id));
      setChildren(ch);
      setCandidates(all.filter((i) => i.type !== 'epic' && i.type !== 'subtask' && !i.parent_id));
      setWorklogs(wl);
    } catch (e) {
      toast.error('Could not load issue', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  useEffect(() => {
    if (issueId) void load();
    else setIssue(null);
  }, [issueId, load]);

  async function patch(body: Partial<Issue>) {
    if (!issue) return;
    const previous = issue;
    setIssue({ ...issue, ...body } as Issue);
    try {
      await api.issues.update(issue.id, body);
      onChanged?.();
      void load();
    } catch (e) {
      setIssue(previous);
      toast.error('Update failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function addComment() {
    if (!issue || !commentBody.trim()) return;
    setPosting(true);
    try {
      await api.comments.create(issue.id, commentBody.trim());
      setCommentBody('');
      setComments(await api.comments.list(issue.id));
    } catch (e) {
      toast.error('Could not post comment', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setPosting(false);
    }
  }

  async function addSubtask() {
    if (!issue || !subtaskTitle.trim()) return;
    setAddingSubtask(true);
    try {
      await api.issues.create(issue.project_id, { title: subtaskTitle.trim(), type: 'subtask', parent_id: issue.id });
      setSubtaskTitle('');
      onChanged?.();
      void load();
    } catch (e) {
      toast.error('Could not add subtask', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setAddingSubtask(false);
    }
  }

  async function logWork() {
    if (!issue) return;
    const hours = parseFloat(logHours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    setLoggingWork(true);
    try {
      await api.worklogs.create(issue.id, Math.round(hours * 60), logComment.trim() || undefined);
      setLogHours('');
      setLogComment('');
      setWorklogs(await api.worklogs.list(issue.id));
      const fresh = await api.issues.get(issue.id);
      setIssue(fresh);
      onChanged?.();
      toast.success('Work logged');
    } catch (e) {
      toast.error('Could not log work', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoggingWork(false);
    }
  }

  async function removeWorkLog(id: string) {
    if (!issue) return;
    try {
      await api.worklogs.remove(id);
      setWorklogs(await api.worklogs.list(issue.id));
      const fresh = await api.issues.get(issue.id);
      setIssue(fresh);
    } catch (e) {
      toast.error('Could not delete work log', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function saveEstimate() {
    const hours = parseFloat(estimateHours);
    await patch({ original_estimate: estimateHours === '' ? null : Math.round((Number.isFinite(hours) ? hours : 0) * 60) });
  }

  async function toggleWatch() {
    if (!issue) return;
    const watching = watchers.some((w) => w.id === user?.id);
    try {
      if (watching) await api.watchers.unwatch(issue.id);
      else await api.watchers.watch(issue.id);
      setWatchers(await api.watchers.list(issue.id));
    } catch (e) {
      toast.error('Could not update watchers', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!issue || !files?.length) return;
    try {
      await api.attachments.upload(issue.id, Array.from(files));
      setAttachments(await api.attachments.list(issue.id));
      toast.success('Attachment uploaded');
    } catch (e) {
      toast.error('Upload failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeIssue() {
    if (!issue) return;
    try {
      await api.issues.remove(issue.id);
      toast.success(`${issue.issue_key} deleted`);
      onOpenChange(false);
      onChanged?.();
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  const watching = watchers.some((w) => w.id === user?.id);

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
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={toggleWatch} className="gap-1.5 text-xs">
                  {watching ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {watchers.length}
                </Button>
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
              </div>
              {issue.type === 'subtask' && issue.parent_id && issue.parent_key && (
                <button
                  onClick={() => onOpenIssue?.(issue.parent_id!)}
                  className="flex w-fit max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {issue.parent_type && <TypeIcon type={issue.parent_type} className="size-3.5" />}
                  <span className="font-mono">{issue.parent_key}</span>
                  <span className="truncate">{issue.parent_title}</span>
                </button>
              )}
              <SheetTitle className="text-left text-lg leading-snug">{issue.title}</SheetTitle>
            </SheetHeader>

            <div className="grid gap-6 p-6 md:grid-cols-[1fr_200px]">
              <div className="min-w-0 space-y-5">
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Description
                  </h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {issue.description || <span className="text-faint">No description.</span>}
                  </p>
                </section>

                {issue.type === 'epic' && (
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Child issues ({children.length})
                    </h3>
                    {children.length > 0 && (
                      <div className="mb-2 flex items-center gap-2">
                        <Progress
                          value={children.length === 0 ? 0 : Math.round((children.filter((c) => c.status === 'done').length / children.length) * 100)}
                          className="h-1.5"
                        />
                        <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                          {children.filter((c) => c.status === 'done').length}/{children.length} done
                        </span>
                      </div>
                    )}
                    <ul className="divide-y divide-border-light rounded-md border border-border">
                      {children.map((c) => (
                        <li key={c.id}>
                          <button
                            onClick={() => onOpenIssue?.(c.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                          >
                            <TypeIcon type={c.type} />
                            <span className="font-mono text-xs text-muted-foreground">{c.issue_key}</span>
                            <span className="min-w-0 flex-1 truncate">{c.title}</span>
                            <StatusPill status={c.status} className="shrink-0" />
                            {c.assignee_name && <UserAvatar name={c.assignee_name} color={c.assignee_color} className="size-5" />}
                          </button>
                        </li>
                      ))}
                      {children.length === 0 && (
                        <li className="px-3 py-3 text-sm text-muted-foreground">No child issues yet.</li>
                      )}
                    </ul>
                    {canEdit && candidates.length > 0 && (
                      <div className="mt-2">
                        <Select
                          value=""
                          onValueChange={async (childId) => {
                            try {
                              await api.issues.update(childId, { parent_id: issue.id });
                              onChanged?.();
                              void load();
                            } catch (e) {
                              toast.error('Could not add issue to epic', { description: e instanceof Error ? e.message : undefined });
                            }
                          }}
                        >
                          <SelectTrigger className="w-full text-muted-foreground">
                            <SelectValue placeholder="Add an existing issue…" />
                          </SelectTrigger>
                          <SelectContent>
                            {candidates.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-2">
                                  <TypeIcon type={c.type} />
                                  <span className="font-mono text-xs">{c.issue_key}</span> {c.title}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </section>
                )}

                {issue.type !== 'epic' && issue.type !== 'subtask' && (
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Subtasks ({children.length})
                    </h3>
                    {children.length > 0 && (
                      <>
                        <div className="mb-2 flex items-center gap-2">
                          <Progress
                            value={Math.round((children.filter((c) => c.status === 'done').length / children.length) * 100)}
                            className="h-1.5"
                          />
                          <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                            {children.filter((c) => c.status === 'done').length}/{children.length} done
                          </span>
                        </div>
                        <ul className="divide-y divide-border-light rounded-md border border-border">
                          {children.map((c) => (
                            <li key={c.id}>
                              <button
                                onClick={() => onOpenIssue?.(c.id)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                              >
                                <TypeIcon type={c.type} />
                                <span className="font-mono text-xs text-muted-foreground">{c.issue_key}</span>
                                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                                <StatusPill status={c.status} className="shrink-0" />
                                {c.assignee_name && <UserAvatar name={c.assignee_name} color={c.assignee_color} className="size-5" />}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {canEdit && (
                      <div className="mt-2 flex gap-2">
                        <Input
                          value={subtaskTitle}
                          onChange={(e) => setSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void addSubtask();
                            }
                          }}
                          placeholder="Add a subtask…"
                          aria-label="New subtask title"
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={addSubtask}
                          disabled={addingSubtask || !subtaskTitle.trim()}
                          aria-label="Add subtask"
                        >
                          {addingSubtask ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        </Button>
                      </div>
                    )}
                  </section>
                )}

                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Labels
                  </h3>
                  <LabelsEditor
                    labels={issue.labels_parsed ?? []}
                    canEdit={canEdit}
                    // The column stores JSON; labels_parsed is the decoded view.
                    onChange={(next) => patch({ labels: JSON.stringify(next) })}
                  />
                </section>

                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Linked issues
                  </h3>
                  <LinkedIssues
                    issueId={issue.id}
                    projectId={issue.project_id}
                    canEdit={canEdit}
                    onOpenIssue={onOpenIssue}
                  />
                </section>

                <Tabs defaultValue="comments">
                  <TabsList>
                    <TabsTrigger value="comments">Comments ({comments.length})</TabsTrigger>
                    <TabsTrigger value="attachments">Files ({attachments.length})</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                  </TabsList>

                  <TabsContent value="comments" className="space-y-3 pt-3">
                    <div className="flex gap-2">
                      <Textarea
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        placeholder="Add a comment…"
                        rows={2}
                        className="resize-none"
                      />
                      <Button
                        size="icon"
                        onClick={addComment}
                        disabled={posting || !commentBody.trim()}
                        aria-label="Post comment"
                      >
                        {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      </Button>
                    </div>
                    {comments.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">No comments yet.</p>
                    ) : (
                      <ul className="space-y-3">
                        {comments.map((c) => (
                          <li key={c.id} className="flex gap-2.5">
                            <UserAvatar name={c.author_name} color={c.author_color} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs">
                                <span className="font-semibold">{c.author_name}</span>{' '}
                                <span className="text-muted-foreground">{timeAgo(c.created_at)}</span>
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TabsContent>

                  <TabsContent value="attachments" className="space-y-3 pt-3">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border py-4 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground">
                      <Paperclip className="size-4" />
                      Upload files
                      <input type="file" multiple className="sr-only" onChange={(e) => uploadFiles(e.target.files)} />
                    </label>
                    {attachments.length === 0 ? (
                      <p className="py-2 text-center text-sm text-muted-foreground">No attachments.</p>
                    ) : (
                      <ul className="grid grid-cols-2 gap-2">
                        {attachments.map((a) => (
                          <li key={a.id} className="overflow-hidden rounded-md border border-border">
                            {a.mime_type.startsWith('image/') ? (
                              <img
                                src={a.preview_url}
                                alt={a.original_name}
                                className="h-24 w-full bg-surface object-cover"
                              />
                            ) : (
                              <div className="grid h-24 place-items-center bg-surface text-faint">
                                <Paperclip className="size-6" />
                              </div>
                            )}
                            <div className="px-2 py-1.5">
                              <a
                                href={a.download_url}
                                className="block truncate text-xs font-medium hover:underline"
                                title={a.original_name}
                              >
                                {a.original_name}
                              </a>
                              <p className="text-[11px] text-muted-foreground">{formatBytes(a.size)}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TabsContent>

                  <TabsContent value="activity" className="pt-3">
                    {activity.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">No activity recorded.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {activity.map((a) => (
                          <li key={a.id} className="flex items-start gap-2.5 text-sm">
                            <UserAvatar name={a.user_name} color={a.user_color} className="size-5" />
                            <p className="min-w-0 flex-1 text-muted-foreground">
                              <span className="font-medium text-foreground">{a.user_name}</span> changed{' '}
                              <span className="font-medium text-foreground">{a.field}</span>
                              {a.old_value && <> from <span className="text-foreground">{a.old_value}</span></>}
                              {a.new_value && <> to <span className="text-foreground">{a.new_value}</span></>}
                              <span className="ml-1 text-xs">· {timeAgo(a.created_at)}</span>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Field rail */}
              <aside className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select
                    value={issue.status}
                    onValueChange={(v) => patch({ status: v as IssueStatus })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Assignee</Label>
                  <Select
                    value={issue.assignee_id ?? UNASSIGNED}
                    onValueChange={(v) => patch({ assignee_id: v === UNASSIGNED ? null : v })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Priority</Label>
                  <Select
                    value={issue.priority}
                    onValueChange={(v) => patch({ priority: v as Priority })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          <span className="flex items-center gap-2"><PriorityIcon priority={p} />{PRIORITY_LABEL[p]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {issue.type !== 'epic' && issue.type !== 'subtask' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Sprint</Label>
                    <Select
                      value={issue.sprint_id ?? NO_SPRINT}
                      onValueChange={(v) => patch({ sprint_id: v === NO_SPRINT ? null : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SPRINT}>Backlog</SelectItem>
                        {sprints.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {issue.type !== 'epic' && issue.type !== 'subtask' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Epic</Label>
                    <Select
                      value={issue.parent_id ?? NO_EPIC}
                      onValueChange={(v) => patch({ parent_id: v === NO_EPIC ? null : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_EPIC}>No epic</SelectItem>
                        {epics.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            <span className="flex items-center gap-2">
                              <span className={cn('size-2.5 rounded-sm', epicColor(e.epic_color).swatch)} />
                              {e.title}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {issue.type === 'epic' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Epic color</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(EPIC_COLORS).map(([name, c]) => (
                        <button
                          key={name}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => patch({ epic_color: name })}
                          aria-label={c.label}
                          className={cn(
                            'size-5 rounded-full transition-transform hover:scale-110',
                            c.swatch,
                            issue.epic_color === name && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Time tracking</Label>
                  {(issue.original_estimate ?? 0) > 0 && (
                    <Progress
                      value={Math.min(100, Math.round(((issue.time_spent ?? 0) / (issue.original_estimate ?? 1)) * 100))}
                      className="h-1.5"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(issue.time_spent)} logged
                    {(issue.original_estimate ?? 0) > 0 && (
                      <> · {formatDuration(Math.max(0, (issue.original_estimate ?? 0) - (issue.time_spent ?? 0)))} left</>
                    )}
                  </p>
                  <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setLogOpen(true)}>
                    <Clock className="size-3.5" /> Log work
                  </Button>
                </div>

                <Separator />

                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Points</dt>
                    <dd className="tabular-nums">{issue.story_points ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Reporter</dt>
                    <dd className="truncate">{issue.reporter_name ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{timeAgo(issue.created_at)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd>{timeAgo(issue.updated_at)}</dd>
                  </div>
                </dl>
              </aside>
            </div>

            <Dialog open={logOpen} onOpenChange={setLogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Time tracking · {issue.issue_key}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {canEdit && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Original estimate (hours)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          value={estimateHours}
                          onChange={(e) => setEstimateHours(e.target.value)}
                          placeholder="e.g. 8"
                          aria-label="Original estimate in hours"
                        />
                        <Button variant="outline" onClick={saveEstimate}>Set</Button>
                      </div>
                    </div>
                  )}
                  {canEdit && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Log work</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={logHours}
                          onChange={(e) => setLogHours(e.target.value)}
                          placeholder="Hours"
                          aria-label="Hours worked"
                          className="w-28"
                        />
                        <Input
                          value={logComment}
                          onChange={(e) => setLogComment(e.target.value)}
                          placeholder="What did you work on?"
                          aria-label="Work description"
                        />
                        <Button onClick={logWork} disabled={loggingWork || !logHours}>
                          {loggingWork ? <Loader2 className="size-4 animate-spin" /> : 'Log'}
                        </Button>
                      </div>
                    </div>
                  )}
                  {worklogs.length === 0 ? (
                    <p className="py-2 text-center text-sm text-muted-foreground">No work logged yet.</p>
                  ) : (
                    <ul className="max-h-56 space-y-2 overflow-y-auto">
                      {worklogs.map((wlog) => (
                        <li key={wlog.id} className="flex items-start gap-2.5 text-sm">
                          <UserAvatar name={wlog.user_name} color={wlog.user_color} className="size-6" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs">
                              <span className="font-semibold">{wlog.user_name}</span>{' '}
                              <span className="text-muted-foreground">
                                logged {formatDuration(wlog.minutes)} · {timeAgo(wlog.created_at)}
                              </span>
                            </p>
                            {wlog.comment && <p className="mt-0.5 text-sm">{wlog.comment}</p>}
                          </div>
                          {(wlog.user_id === user?.id || isAdmin(user?.role)) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => removeWorkLog(wlog.id)}
                              aria-label="Delete work log"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLogOpen(false)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
