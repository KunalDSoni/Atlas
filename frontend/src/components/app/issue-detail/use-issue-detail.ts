/**
 * Everything an issue detail view needs: the batched load, the mutations, and
 * the transient state the editors write to.
 *
 * It lives apart from any chrome because the drawer and the full page at
 * /atlas/ATLAS-3 are the same resource — one route, two shells. Anything that
 * knew about a Sheet would have to be duplicated for the page.
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useWorkflow } from '@/hooks/use-workflow';
import { canCreateIssues } from '@/lib/domain';
import type { ActivityEntry, Attachment, Comment, EpicSummary, Issue, MentioningPage, ProjectComponent, Sprint, User, Version, WorkLog } from '@/lib/types';

export function useIssueDetail(
  issueId: string | null,
  { onChanged, onClosed, onOpenIssue }: {
    onChanged?: () => void;
    onClosed?: () => void;
    /** Navigate to another issue by KEY — the caller turns that into a URL. */
    onOpenIssue?: (issueKey: string) => void;
  } = {},
) {
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
  const [mentioningPages, setMentioningPages] = useState<MentioningPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [worklogs, setWorklogs] = useState<WorkLog[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [components, setComponents] = useState<ProjectComponent[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logHours, setLogHours] = useState('');
  const [logComment, setLogComment] = useState('');
  const [estimateHours, setEstimateHours] = useState('');
  const [loggingWork, setLoggingWork] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const canEdit = canCreateIssues(user?.role);
  const workflow = useWorkflow(issue?.project_id);

  const load = useCallback(async () => {
    if (!issueId) return;
    setLoading(true);
    try {
      const detail = await api.issues.get(issueId);
      setIssue(detail);
      setEstimateHours(detail.original_estimate ? String(Math.round((detail.original_estimate / 60) * 10) / 10) : '');
      const [c, a, act, w, u, sp, ep, ch, all, wl, vs, comps, pgs] = await Promise.all([
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
        api.versions.list(detail.project_id).catch(() => []),
        api.components.list(detail.project_id).catch(() => []),
        api.issues.pages(issueId).catch(() => []),
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
      setVersions(vs);
      setComponents(comps);
      setMentioningPages(pgs);
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
      onClosed?.();
      onChanged?.();
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  // Capturing a request as a product insight. Only offered on service desk
  // requests: this is the moment a customer's own words become evidence, and
  // the server snapshots the text so it survives the request being edited or
  // resolved. Clients never reach this component, but the role guard on the
  // control below costs one condition and states the intent.
  async function captureAsInsight() {
    if (!issue) return;
    setCapturing(true);
    try {
      await api.product.captureInsight({ origin_kind: 'request', origin_id: issue.id });
      toast.success('Captured as an insight', { description: 'Find it in the Product → Insights inbox.' });
    } catch (e) {
      toast.error('Capture failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setCapturing(false);
    }
  }

  const watching = watchers.some((w) => w.id === user?.id);

  return { issue, comments, attachments, activity, watchers, members, sprints, epics, children, candidates, mentioningPages, loading, capturing, commentBody, posting, subtaskTitle, addingSubtask, worklogs, versions, components, logOpen, logHours, logComment, estimateHours, loggingWork, editOpen, setIssue, setComments, setAttachments, setActivity, setWatchers, setMembers, setSprints, setEpics, setChildren, setCandidates, setMentioningPages, setLoading, setCapturing, setCommentBody, setPosting, setSubtaskTitle, setAddingSubtask, setWorklogs, setVersions, setComponents, setLogOpen, setLogHours, setLogComment, setEstimateHours, setLoggingWork, setEditOpen, canEdit, workflow, watching, user, load, patch, addComment, addSubtask, logWork, removeWorkLog, saveEstimate, toggleWatch, uploadFiles, removeIssue, captureAsInsight, onChanged, onOpenIssue };
}

export type IssueDetail = ReturnType<typeof useIssueDetail>;
