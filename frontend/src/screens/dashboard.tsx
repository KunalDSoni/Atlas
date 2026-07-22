import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Plus, RotateCcw, Save, Settings2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { useAuth } from '@/context/auth-provider';
import { canCreateProjects } from '@/lib/domain';
import { projectUrl } from '@/lib/urls';
import type { DashboardGadget, DashboardGadgetKey, Issue, ProjectStats, Sprint } from '@/lib/types';
import { CardsSkeleton, EmptyState, ErrorState, PageHeader } from '@/components/app/primitives';
import { CreateProjectDialog } from '@/components/app/create-project-dialog';
import {
  DashboardGadgetCard, DEFAULT_DASHBOARD_LAYOUT, GADGET_CATALOG,
} from '@/components/dashboard/dashboard-gadgets';

function copyLayout(gadgets: DashboardGadget[]): DashboardGadget[] {
  return gadgets.map((gadget) => ({ ...gadget }));
}

function AddGadgetDialog({
  open,
  onOpenChange,
  used,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  used: Set<DashboardGadgetKey>;
  onAdd: (key: DashboardGadgetKey) => void;
}) {
  const available = (Object.entries(GADGET_CATALOG) as [DashboardGadgetKey, (typeof GADGET_CATALOG)[DashboardGadgetKey]][])
    .filter(([key]) => !used.has(key));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a gadget</DialogTitle>
          <DialogDescription>Choose another view of this project's work.</DialogDescription>
        </DialogHeader>
        {available.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map(([key, definition]) => {
              const Icon = definition.icon;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`Add ${definition.title} gadget`}
                  onClick={() => {
                    onAdd(key);
                    onOpenChange(false);
                  }}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-muted text-accent-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{definition.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {definition.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Every gadget is already on this dashboard.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardScreen() {
  const {
    currentProject, currentProjectId, loading: projectsLoading,
    reload: reloadProjects, setCurrentProjectId,
  } = useProjects();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [layout, setLayout] = useState<DashboardGadget[]>(copyLayout(DEFAULT_DASHBOARD_LAYOUT));
  const [draftLayout, setDraftLayout] = useState<DashboardGadget[]>(copyLayout(DEFAULT_DASHBOARD_LAYOUT));
  const [customizing, setCustomizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProjectId) return;
    let cancelled = false;
    setCustomizing(false);
    setAddOpen(false);

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [dashboardLayout, projectStats, projectIssues, projectSprints] = await Promise.all([
          api.dashboard.layout(currentProjectId),
          api.projects.stats(currentProjectId),
          api.issues.list(currentProjectId),
          api.sprints.list(currentProjectId),
        ]);
        if (cancelled) return;
        setLayout(copyLayout(dashboardLayout.gadgets));
        setDraftLayout(copyLayout(dashboardLayout.gadgets));
        setStats(projectStats);
        setIssues(projectIssues);
        setSprints(projectSprints);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [currentProjectId]);

  function beginCustomizing() {
    setDraftLayout(copyLayout(layout));
    setCustomizing(true);
  }

  function cancelCustomizing() {
    setDraftLayout(copyLayout(layout));
    setCustomizing(false);
    setAddOpen(false);
  }

  function moveGadget(index: number, direction: -1 | 1) {
    setDraftLayout((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = copyLayout(current);
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addGadget(key: DashboardGadgetKey) {
    if (draftLayout.some((gadget) => gadget.key === key)) return;
    setDraftLayout((current) => [
      ...current,
      { key, span: GADGET_CATALOG[key].defaultSpan },
    ]);
  }

  async function saveLayout() {
    if (!currentProjectId) return;
    setSaving(true);
    try {
      const saved = await api.dashboard.saveLayout(currentProjectId, draftLayout);
      setLayout(copyLayout(saved.gadgets));
      setDraftLayout(copyLayout(saved.gadgets));
      setCustomizing(false);
      toast.success('Dashboard layout saved');
    } catch (caught) {
      toast.error('Could not save dashboard', {
        description: caught instanceof Error ? caught.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <CardsSkeleton count={6} />
      </>
    );
  }

  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          icon={LayoutDashboard}
          title="No project selected"
          description={canCreateProjects(user?.role)
            ? 'Create a project to get started.'
            : 'Ask an administrator to add you to a project.'}
          action={canCreateProjects(user?.role) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create project
            </Button>
          )}
        />
        <CreateProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async (project) => {
            await reloadProjects();
            setCurrentProjectId(project.id);
          }}
        />
      </>
    );
  }

  if (error || !stats || !currentProject) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState message={error || 'Dashboard data is unavailable'} />
      </>
    );
  }

  const visibleLayout = customizing ? draftLayout : layout;
  const used = new Set(draftLayout.map((gadget) => gadget.key));
  const allGadgetsUsed = used.size === Object.keys(GADGET_CATALOG).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${currentProject.name} · ${currentProject.key}`}
        actions={customizing ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={allGadgetsUsed}
              onClick={() => setAddOpen(true)}
            >
              <Plus /> Add gadget
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraftLayout(copyLayout(DEFAULT_DASHBOARD_LAYOUT))}
            >
              <RotateCcw /> Reset
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelCustomizing}>
              <X /> Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void saveLayout()}>
              <Save /> {saving ? 'Saving…' : 'Save layout'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={beginCustomizing}>
              <Settings2 /> Customize
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={projectUrl(currentProject.key, 'board')}>Open board</Link>
            </Button>
          </>
        )}
      />

      {visibleLayout.length ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-label="Dashboard gadgets">
          {visibleLayout.map((gadget, index) => (
            <div key={gadget.key} className={gadget.span === 2 ? 'lg:col-span-2' : 'lg:col-span-1'}>
              <DashboardGadgetCard
                gadget={gadget}
                index={index}
                total={visibleLayout.length}
                editing={customizing}
                stats={stats}
                issues={issues}
                sprints={sprints}
                projectKey={currentProject.key}
                onMove={(direction) => moveGadget(index, direction)}
                onRemove={() => setDraftLayout((current) => current.filter((item) => item.key !== gadget.key))}
                onToggleSpan={() => setDraftLayout((current) => current.map((item) => (
                  item.key === gadget.key ? { ...item, span: item.span === 1 ? 2 : 1 } : item
                )))}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={LayoutDashboard}
          title="Your dashboard is empty"
          description={customizing
            ? 'Add the views that help you run this project.'
            : 'Customize this dashboard to add a gadget.'}
          action={customizing ? (
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus /> Add gadget</Button>
          ) : (
            <Button size="sm" onClick={beginCustomizing}><Settings2 /> Customize</Button>
          )}
        />
      )}

      <AddGadgetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        used={used}
        onAdd={addGadget}
      />
    </>
  );
}
