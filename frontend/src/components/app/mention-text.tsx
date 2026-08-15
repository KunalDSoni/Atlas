// Renders stored plain text with its mentions as badges.
//
// The badge shows the mentioned person's *current* name, resolved from the
// stored id, so renaming someone updates every mention they have ever received.
// The name inside the token is only a fallback for the moment before the
// directory loads.
//
// An id that does not resolve renders as plain text and never as a badge. That
// is what stops a hand-typed @[Admin](user:someone-else) from looking
// authoritative: a badge always shows whoever the id really is, or nothing.

import { isInactive, useUserDirectory } from '@/hooks/use-user-directory';
import { expandLegacyMentions, tokenizeMentions } from '@/lib/mentions';
import { cn } from '@/lib/utils';

export function MentionText({ text, className }: { text: string | null | undefined; className?: string }) {
  const directory = useUserDirectory();
  if (!text) return null;

  const segments = expandLegacyMentions(tokenizeMentions(text), directory.nameIndex);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.value}</span>;

        const user = directory.byId.get(seg.id);
        // Until the directory arrives, trust the stored name rather than
        // flashing prose where a badge is about to appear.
        if (!user && directory.loaded) return <span key={i}>@{seg.name}</span>;

        const inactive = user ? isInactive(user) : false;
        return (
          <span
            key={i}
            className={cn('mention', inactive && 'mention-inactive', className)}
            data-user-id={seg.id}
            title={inactive ? `${user!.name} (deactivated)` : user?.email}
          >
            @{user?.name ?? seg.name}
          </span>
        );
      })}
    </>
  );
}
