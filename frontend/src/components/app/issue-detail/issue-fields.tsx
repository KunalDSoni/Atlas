/** The field rail: everything about an issue that is a value, not prose. */

const UNASSIGNED = '__unassigned__';
const NO_SPRINT = '__backlog__';
const NO_EPIC = '__no_epic__';
const NO_VERSION = '__no_version__';
const NO_COMPONENT = '__no_component__';

import { Clock, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { EPIC_COLORS, PRIORITIES, PRIORITY_LABEL, epicColor, isAdmin } from '@/lib/domain';
import { formatDuration, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PriorityIcon, UserAvatar } from '../primitives';
import type { IssueStatus, Priority } from '@/lib/types';
import type { IssueDetail } from './use-issue-detail';

export function IssueFields({ detail }: { detail: IssueDetail }) {
  const { issue, members, sprints, epics, worklogs, versions, components, logOpen, logHours, logComment, estimateHours, loggingWork, setLogOpen, setLogHours, setLogComment, setEstimateHours, canEdit, workflow, user, patch, logWork, removeWorkLog, saveEstimate } = detail;
  if (!issue) return null;

  return (
<>
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
                      {workflow.statuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
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

                {issue.type !== 'epic' && versions.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Fix version</Label>
                    <Select
                      value={issue.fix_version_id ?? NO_VERSION}
                      onValueChange={(v) => patch({ fix_version_id: v === NO_VERSION ? null : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_VERSION}>None</SelectItem>
                        {versions.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {issue.type !== 'epic' && components.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Component</Label>
                    <Select
                      value={issue.component_id ?? NO_COMPONENT}
                      onValueChange={(v) => patch({ component_id: v === NO_COMPONENT ? null : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_COMPONENT}>None</SelectItem>
                        {components.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
  );
}
