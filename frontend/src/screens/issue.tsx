import { useParams } from 'react-router-dom';
import { isIssueKey } from '@/lib/urls';
import { IssueNotFound } from '@/screens/not-found';

export default function IssuePage() {
  const { issueKey = '' } = useParams<{ issueKey: string }>();
  if (!isIssueKey(issueKey)) return <IssueNotFound issueKey={issueKey} />;
  return <div className="p-6 font-mono">{issueKey.toUpperCase()}</div>;
}
