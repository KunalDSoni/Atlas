import { useCallback, useEffect, useState } from 'react';
import { Clock, FolderKanban, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { CustomFieldsManager } from '@/components/app/custom-fields-manager';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import type { Project } from '@/lib/types';
import { CreateProjectDialog } from '@/components/app/create-project-dialog';
import { ProjectWorkingHoursDialog } from '@/components/app/project-working-hours-dialog';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton, UserAvatar } from '@/components/app/primitives';
import { formatDate } from '@/lib/format';

export default function AdminProjectsScreen() {
  const { reload: reloadProjectsContext } = useProjects();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [fieldsProject, setFieldsProject] = useState<Project | null>(null);
  const [hoursProject, setHoursProject] = useState<Project | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.projects.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function afterChange() {
    await load();
    await reloadProjectsContext();
  }

  async function remove(p: Project) {
    try {
      await api.projects.remove(p.id);
      toast.success(`${p.name} deleted`);
      await afterChange();
    } catch (e) {
      toast.error('Could not delete project', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Projects" />
        <RowsSkeleton count={4} />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Projects" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${projects.length} project${projects.length === 1 ? '' : 's'}`}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Create project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Create project</Button>}
        />
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="hidden md:table-cell">Lead</TableHead>
                <TableHead className="text-right">Issues</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Members</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
                        {p.key.slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{p.key}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {p.lead_name ? (
                      <div className="flex items-center gap-2">
                        <UserAvatar name={p.lead_name} color={p.lead_color} className="size-5" />
                        <span className="truncate text-sm">{p.lead_name}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{p.issue_count}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums sm:table-cell">{p.member_count}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {formatDate(p.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Custom fields for ${p.name}`} title="Custom fields" onClick={() => setFieldsProject(p)}>
                      <SlidersHorizontal className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Working hours for ${p.name}`} title="Working hours" onClick={() => setHoursProject(p)}>
                      <Clock className="size-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Delete ${p.name}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes the project and all {p.issue_count} of its issues, sprints, and
                            comments. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => remove(p)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete project
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={afterChange} />
      <ProjectWorkingHoursDialog
        project={hoursProject}
        onOpenChange={(o) => !o && setHoursProject(null)}
        onSaved={afterChange}
      />
      <CustomFieldsManager
        projectId={fieldsProject?.id ?? null}
        projectName={fieldsProject?.name}
        open={!!fieldsProject}
        onOpenChange={(o) => !o && setFieldsProject(null)}
      />
    </>
  );
}
