import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Plus, Rocket, Tag, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { canManageSprints } from '@/lib/domain';
import type { ProjectComponent, Version } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { formatDate } from '@/lib/format';
import { releaseUrl } from '@/lib/urls';
import { cn } from '@/lib/utils';

export default function ReleasesScreen() {
  const { user } = useAuth();
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const [versions, setVersions] = useState<Version[]>([]);
  const [components, setComponents] = useState<ProjectComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'version' | 'component'>('version');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const canManage = canManageSprints(user?.role);

  const load = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const [v, c] = await Promise.all([
        api.versions.list(currentProjectId),
        api.components.list(currentProjectId),
      ]);
      setVersions(v);
      setComponents(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load releases');
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(kind: 'version' | 'component') {
    setCreateKind(kind);
    setName('');
    setDescription('');
    setCreateOpen(true);
  }

  async function create() {
    if (!currentProjectId || !name.trim()) return;
    try {
      if (createKind === 'version') {
        await api.versions.create(currentProjectId, { name: name.trim(), description: description.trim() || undefined });
      } else {
        await api.components.create(currentProjectId, { name: name.trim(), description: description.trim() || undefined });
      }
      setCreateOpen(false);
      toast.success(`${createKind === 'version' ? 'Version' : 'Component'} created`);
      void load();
    } catch (e) {
      toast.error('Create failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function toggleRelease(v: Version) {
    try {
      await api.versions.update(v.id, {
        status: v.status === 'released' ? 'unreleased' : 'released',
        release_date: v.status === 'released' ? null : new Date().toISOString().slice(0, 10),
      });
      void load();
    } catch (e) {
      toast.error('Update failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeVersion(id: string) {
    try {
      await api.versions.remove(id);
      toast.success('Version deleted');
      void load();
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeComponent(id: string) {
    try {
      await api.components.remove(id);
      toast.success('Component deleted');
      void load();
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Releases" />
        <RowsSkeleton />
      </>
    );
  }
  if (!currentProjectId) {
    return (
      <>
        <PageHeader title="Releases" />
        <EmptyState icon={Package} title="No project selected" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Releases" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Releases"
        description={`Fix versions and components for ${currentProject?.name ?? 'this project'}`}
        actions={
          canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => openCreate('component')}>
                <Tag className="size-4" /> New component
              </Button>
              <Button size="sm" onClick={() => openCreate('version')}>
                <Plus className="size-4" /> New version
              </Button>
            </>
          )
        }
      />

      {versions.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No versions yet"
          description="Create a fix version to start planning a release."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {versions.map((v) => {
              const pct = v.issue_count === 0 ? 0 : Math.round((v.done_count / v.issue_count) * 100);
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <Package className={cn('size-4 shrink-0', v.status === 'released' ? 'text-success' : 'text-muted-foreground')} />
                  <Link
                    to={releaseUrl(currentProject?.key ?? '', v.slug)}
                    data-release-slug={v.slug}
                    className="min-w-0 flex-1 rounded-sm transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="block truncate text-sm font-medium">{v.name}</span>
                    {v.description && <span className="block truncate text-xs text-muted-foreground">{v.description}</span>}
                  </Link>
                  <span className="hidden w-44 shrink-0 items-center gap-2 sm:flex">
                    <Progress value={pct} className="h-1.5" />
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                      {v.done_count}/{v.issue_count}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                      v.status === 'released' ? 'bg-success-muted text-success' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {v.status}
                  </span>
                  <span className="hidden w-24 text-right text-xs text-muted-foreground md:block">
                    {formatDate(v.release_date)}
                  </span>
                  {canManage && (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleRelease(v)}
                        aria-label={v.status === 'released' ? 'Mark unreleased' : 'Release'}
                        title={v.status === 'released' ? 'Mark unreleased' : 'Release'}
                      >
                        {v.status === 'released' ? <Undo2 className="size-4" /> : <Rocket className="size-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeVersion(v.id)}
                        aria-label="Delete version"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Components
      </h2>
      {components.length === 0 ? (
        <EmptyState icon={Tag} title="No components" description="Components group issues by area of the codebase or product." />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border-light">
            {components.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <Tag className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  {c.description && <span className="block truncate text-xs text-muted-foreground">{c.description}</span>}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{c.issue_count} issues</span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeComponent(c.id)}
                    aria-label="Delete component"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{createKind === 'version' ? 'New version' : 'New component'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={createKind === 'version' ? 'e.g. v2.1.0' : 'e.g. Backend'}
              aria-label="Name"
              autoFocus
            />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              aria-label="Description"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={!name.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
