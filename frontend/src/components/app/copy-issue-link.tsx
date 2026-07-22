import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { absoluteUrl, issueUrl } from '@/lib/urls';

/** The point of the whole scheme: a link you can paste into Slack. */
export function CopyIssueLink({ issueKey }: { issueKey: string }) {
  async function copy() {
    const url = absoluteUrl(issueUrl(issueKey));
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', { description: url });
    } catch {
      // Clipboard access is denied outside a secure context — show the URL so
      // it can still be copied by hand rather than failing silently.
      toast.error('Could not copy', { description: url });
    }
  }

  return (
    <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={copy} aria-label="Copy link">
      <Link2 className="size-3.5" /> Copy link
    </Button>
  );
}
