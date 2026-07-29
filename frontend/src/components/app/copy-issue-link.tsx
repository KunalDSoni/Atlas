import { absoluteUrl, issueUrl } from '@/lib/urls';
import { CopyLinkButton } from './copy-link-button';

export function CopyIssueLink({ issueKey }: { issueKey: string }) {
  return <CopyLinkButton url={absoluteUrl(issueUrl(issueKey))} />;
}
