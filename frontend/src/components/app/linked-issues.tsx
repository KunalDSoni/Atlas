import { useCallback, useEffect, useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { LINK_TYPE_LABEL, LINK_TYPES } from '@/lib/domain';
import type { Issue, IssueLink, LinkType } from '@/lib/types';
import { StatusPill, TypeIcon } from './primitives';

/**
 * Linked issues for an issue. A link row is returned for both directions, so each row
 * is rendered from the perspective of the issue we're viewing: if we are the source,
 * the "other" issue is the target, and vice versa.
 */
export function LinkedIssues({
  issueId,
  projectId,
  canEdit,
  onOpenIssue,
}: {
  issueId: string;
  projectId: string;
  canEdit: boolean;
  /** By KEY — the caller turns it into a URL. */
  onOpenIssue?: (issueKey: string) => void;
}) {
  const [links, setLinks] = useState<IssueLink[]>([]);
  const [candidates, setCandidates] = useState<Issue[]>([]);
  const [adding, setAdding] = useState(false);
  const [linkType, setLinkType] = useState<LinkType>('relates_to');

  const load = useCallback(async () => {
    try {
      setLinks(await api.links.list(issueId));
    } catch {
      setLinks([]);
    }
  }, [issueId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!adding) return;
    api.issues
      .list(projectId)
      .then((all) => setCandidates(all.filter((i) => i.id !== issueId)))
      .catch(() => setCandidates([]));
  }, [adding, projectId, issueId]);

  async function addLink(targetId: string) {
    try {
      await api.links.create(issueId, targetId, linkType);
      setAdding(false);
      await load();
    } catch (e) {
      toast.error('Could not link issue', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeLink(linkId: string) {
    const previous = links;
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    try {
      await api.links.remove(linkId);
    } catch (e) {
      setLinks(previous);
      toast.error('Could not remove link', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <div className="space-y-2">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No linked issues.</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => {
            const outgoing = l.source_issue_id === issueId;
            const other = outgoing
              ? { id: l.target_issue_id, key: l.target_key, title: l.target_title, status: l.target_status, type: l.target_type }
              : { id: l.source_issue_id, key: l.source_key, title: l.source_title, status: l.source_status, type: l.source_type };

            return (
              <li key={l.id} className="flex items-center gap-2 rounded-md border border-border-light px-2 py-1.5">
                <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {LINK_TYPE_LABEL[l.link_type as LinkType]?.[outgoing ? 'out' : 'in'] ?? l.link_type}
                </span>
                <TypeIcon type={other.type} />
                <button
                  onClick={() => onOpenIssue?.(other.key)}
                  className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                >
                  <span className="font-mono text-xs text-muted-foreground">{other.key}</span>{' '}
                  {other.title}
                </button>
                <StatusPill status={other.status} className="hidden shrink-0 sm:inline-flex" />
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground"
                    aria-label={`Remove link to ${other.key}`}
                    onClick={() => removeLink(l.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <Select value={linkType} onValueChange={(v) => setLinkType(v as LinkType)}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Link type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINK_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {LINK_TYPE_LABEL[t].out}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover open={adding} onOpenChange={setAdding}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Plus className="size-3.5" /> Link issue
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
              <Command>
                <CommandInput placeholder="Search issues…" className="h-9" />
                <CommandList>
                  <CommandEmpty>No issues found.</CommandEmpty>
                  <CommandGroup>
                    {candidates.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.issue_key} ${c.title}`}
                        onSelect={() => addLink(c.id)}
                        className="gap-2"
                      >
                        <TypeIcon type={c.type} />
                        <span className="font-mono text-xs text-muted-foreground">{c.issue_key}</span>
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Link2 className="size-3.5 text-faint" />
        </div>
      )}
    </div>
  );
}
