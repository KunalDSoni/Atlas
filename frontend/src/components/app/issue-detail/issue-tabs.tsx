/** Comments, files and activity for one issue. */
import { Loader2, Paperclip, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes, timeAgo } from '@/lib/format';
import { renderMentions } from '@/lib/mention-renderer';
import { useMentions } from '@/hooks/use-mentions';
import { UserAvatar } from '../primitives';
import type { IssueDetail } from './use-issue-detail';

export function IssueTabs({ detail }: { detail: IssueDetail }) {
  const { issue, comments, attachments, activity, commentBody, posting, setCommentBody, addComment, uploadFiles, user } = detail;
  // Hooks run before the early return: an issue that has not loaded yet must
  // not change how many hooks this component calls.
  const mentions = useMentions({
    projectId: issue?.project_id,
    value: commentBody,
    onChange: setCommentBody,
  });
  if (!issue || !user) return null;

  return (
                <Tabs defaultValue="comments">
                  <TabsList>
                    <TabsTrigger value="comments">Comments ({comments.length})</TabsTrigger>
                    <TabsTrigger value="attachments">Files ({attachments.length})</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                  </TabsList>

                  <TabsContent value="comments" className="space-y-3 pt-3">
                    <div className="flex gap-2">
                      <Textarea
                        ref={mentions.ref}
                        value={commentBody}
                        {...mentions.inputProps}
                        placeholder="Add a comment…"
                        rows={2}
                        className="flex-1 resize-none"
                      />
                      {mentions.dropdown}
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
                              <p className="mt-0.5 whitespace-pre-wrap text-sm">{renderMentions(c.body)}</p>
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
  );
}
