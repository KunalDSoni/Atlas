/**
 * The issue itself, with no chrome around it.
 *
 * Rendered identically by the drawer over a board and by the full page at
 * /atlas/ATLAS-3 — `variant` only decides how wide the columns get. Two
 * renderings of one resource is the whole point of the URL scheme; a second
 * copy of this markup would drift within a week.
 */
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MentionText } from '@/components/app/mention-text';
import { StatusPill, TypeIcon, UserAvatar } from '../primitives';
import { LabelsEditor } from '../labels-editor';
import { CustomFieldsEditor } from '../custom-fields-editor';
import { LinkedIssues } from '../linked-issues';
import { EditIssueDialog } from '../edit-issue-dialog';
import { IssueFields } from './issue-fields';
import { IssueTabs } from './issue-tabs';
import type { IssueDetail } from './use-issue-detail';

export function IssueDetailBody({
  detail,
  variant = 'sheet',
}: {
  detail: IssueDetail;
  variant?: 'sheet' | 'page';
}) {
  const { issue, children, candidates, canEdit, subtaskTitle, setSubtaskTitle, addSubtask,
    addingSubtask, mentioningPages, setIssue, patch, load, editOpen, setEditOpen,
    onOpenIssue, onChanged } = detail;
  const navigate = useNavigate();
  if (!issue) return null;

  return (
    <>
      <div className={cn(
        'grid gap-6',
        variant === 'sheet' ? 'p-6 md:grid-cols-[1fr_200px]' : 'lg:grid-cols-[1fr_240px]',
      )}>
              <div className="min-w-0 space-y-5">
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Description
                  </h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {issue.description ? <MentionText text={issue.description} /> : <span className="text-faint">No description.</span>}
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
                            onClick={() => onOpenIssue?.(c.issue_key)}
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
                                onClick={() => onOpenIssue?.(c.issue_key)}
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

                {issue.custom_fields && issue.custom_fields.length > 0 && (
                  <CustomFieldsEditor
                    issueId={issue.id}
                    fields={issue.custom_fields}
                    canEdit={canEdit}
                    onSaved={(fieldId, value) =>
                      setIssue((prev) => prev && ({
                        ...prev,
                        custom_fields: (prev.custom_fields ?? []).map((f) =>
                          (f.field_id ?? f.id) === fieldId ? { ...f, value } : f),
                      }))
                    }
                  />
                )}

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

                {mentioningPages.length > 0 && (
                  <section>
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <FileText className="size-3.5" /> Mentioned on pages
                    </h3>
                    <ul className="space-y-1">
                      {mentioningPages.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => navigate(`/wiki/page/${p.id}`)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                          >
                            <span className="truncate">{p.title}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.space_key}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <IssueTabs detail={detail} />
              </div>

              <IssueFields detail={detail} />
      </div>

            <EditIssueDialog
              issue={issue}
              open={editOpen}
              onOpenChange={setEditOpen}
              onSaved={() => {
                onChanged?.();
                void load();
              }}
            />
    </>
  );
}
