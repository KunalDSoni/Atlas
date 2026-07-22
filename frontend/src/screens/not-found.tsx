import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/hooks/use-projects';
import { projectUrl } from '@/lib/urls';

function Shell({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * A wrong link should say it is wrong. Silently redirecting to whatever project
 * the visitor happens to remember is how two people end up insisting they are
 * looking at the same page.
 */
export function ProjectNotFound({ requestedKey }: { requestedKey: string }) {
  const { projects } = useProjects();
  const fallback = projects[0];
  return (
    <Shell
      title="Project not found"
      detail={`There is no project with the key "${requestedKey}", or you do not have access to it.`}
    >
      {fallback && (
        <Button asChild>
          <Link to={projectUrl(fallback.key)}>Go to {fallback.name}</Link>
        </Button>
      )}
    </Shell>
  );
}

export function IssueNotFound({ issueKey }: { issueKey: string }) {
  const { currentProject } = useProjects();
  return (
    <Shell
      title="Issue not found"
      detail={`${issueKey} does not exist, or it has been deleted.`}
    >
      {currentProject && (
        <Button asChild variant="outline">
          <Link to={projectUrl(currentProject.key)}>Back to the board</Link>
        </Button>
      )}
    </Shell>
  );
}
