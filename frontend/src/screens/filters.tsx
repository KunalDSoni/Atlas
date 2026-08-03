import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Loader2, Play, Plus, Save as SaveIcon, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import { useWorkflow } from '@/hooks/use-workflow';
import { issueUrl } from '@/lib/urls';
import { statusTone, TYPE_LABEL } from '@/lib/domain';
import type { SavedFilter, SearchIssueHit } from '@/lib/types';
import {
  EmptyState, ErrorState, PageHeader, PriorityIcon, RowsSkeleton, SprintBadge, StatusPill, TypeIcon,
} from '@/components/app/primitives';
import { cn } from '@/lib/utils';

const DEFAULT_JQL = 'category != done';
const FIELD_HELP = [
  'project', 'status', 'type', 'priority', 'assignee', 'reporter', 'label',
  'sla', 'first_response', 'resolution', 'request_type', 'category', 'waiting_for_customer',
];

function jqlFilters(filters: SavedFilter[]) {
  return filters.filter((filter) => filter.params_parsed.kind === 'jql');
}

function jqlOf(filter: SavedFilter) {
  return filter.params_parsed.kind === 'jql' ? filter.params_parsed.jql : '';
}

export default function FiltersScreen() {
  const { currentProject, currentProjectId, loading: projectsLoading } = useProjects();
  const workflow = useWorkflow(currentProjectId);
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [results, setResults] = useState<SearchIssueHit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const selected = useMemo(
    () => filters.find((filter) => filter.id === selectedId) ?? null,
    [filters, selectedId],
  );

  const runQuery = useCallback(async (query: string) => {
    if (!currentProjectId) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setQueryError('JQL query required');
      setResults(null);
      return;
    }
    setRunning(true);
    setQueryError(null);
    try {
      const response = await api.search.query(trimmed, currentProjectId, true);
      setResults(response.issues);
    } catch (error) {
      setResults(null);
      setQueryError(error instanceof Error ? error.message : 'Could not run this query');
    } finally {
      setRunning(false);
    }
  }, [currentProjectId]);

  const chooseFilter = useCallback((filter: SavedFilter, execute = true) => {
    const query = jqlOf(filter);
    setSelectedId(filter.id);
    setName(filter.name);
    setJql(query);
    setDirty(false);
    setFormError(null);
    setQueryError(null);
    setResults(null);
    if (execute) void runQuery(query);
  }, [runQuery]);

  const startNew = useCallback(() => {
    setSelectedId(null);
    setName('');
    setJql(DEFAULT_JQL);
    setResults(null);
    setQueryError(null);
    setFormError(null);
    setDirty(false);
  }, []);

  const loadFilters = useCallback(async () => {
    if (!currentProjectId) {
      setFilters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = jqlFilters(await api.filters.list(currentProjectId));
      setFilters(loaded);
      if (loaded.length > 0) chooseFilter(loaded[0]);
      else startNew();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load saved filters');
    } finally {
      setLoading(false);
    }
  }, [chooseFilter, currentProjectId, startNew]);

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  async function saveFilter() {
    if (!currentProjectId || !name.trim() || !jql.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const params = { kind: 'jql' as const, jql };
      const saved = selectedId
        ? await api.filters.update(selectedId, { name, params })
        : await api.filters.create(currentProjectId, name, params);
      setFilters((current) => {
        const exists = current.some((filter) => filter.id === saved.id);
        return exists
          ? current.map((filter) => filter.id === saved.id ? saved : filter)
          : [...current, saved];
      });
      chooseFilter(saved, false);
      toast.success(selectedId ? 'Filter updated' : 'Filter saved');
      await runQuery(jqlOf(saved));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save this filter');
    } finally {
      setSaving(false);
    }
  }

  async function deleteFilter() {
    if (!selected) return;
    try {
      await api.filters.remove(selected.id);
      const remaining = filters.filter((filter) => filter.id !== selected.id);
      setFilters(remaining);
      setDeleteOpen(false);
      toast.success('Filter deleted');
      if (remaining.length > 0) chooseFilter(remaining[0]);
      else startNew();
    } catch (error) {
      setDeleteOpen(false);
      toast.error('Could not delete filter', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  if (projectsLoading || (loading && currentProjectId)) {
    return (
      <>
        <PageHeader title="Filters" />
        <RowsSkeleton />
      </>
    );
  }
  if (!currentProjectId || !currentProject) {
    return (
      <>
        <PageHeader title="Filters" />
        <EmptyState icon={Bookmark} title="No project selected" />
      </>
    );
  }
  if (loadError) {
    return (
      <>
        <PageHeader title="Filters" />
        <ErrorState message={loadError} onRetry={loadFilters} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Filters"
        description={`Personal JQL views for ${currentProject.name}`}
        actions={
          <Button size="sm" variant="outline" onClick={startNew}>
            <Plus className="size-4" /> New filter
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit gap-3 py-4">
          <CardHeader className="gap-1 px-4">
            <CardTitle className="text-sm">Saved filters</CardTitle>
            <CardDescription className="text-xs">Only you can see these.</CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            {filters.length === 0 ? (
              <p className="px-2 py-5 text-center text-xs text-muted-foreground">
                Your JQL filters will appear here.
              </p>
            ) : (
              <div className="space-y-1" role="group" aria-label="Personal filters">
                {filters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    aria-current={filter.id === selectedId ? 'page' : undefined}
                    onClick={() => chooseFilter(filter)}
                    className={cn(
                      'w-full rounded-md px-3 py-2 text-left transition-colors',
                      filter.id === selectedId
                        ? 'bg-primary-muted text-accent-foreground'
                        : 'hover:bg-muted',
                    )}
                  >
                    <span className="block truncate text-sm font-medium">{filter.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {jqlOf(filter)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="gap-4 py-5">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{selected ? 'Edit filter' : 'New filter'}</CardTitle>
              <CardDescription>
                The current project is always applied, even when the query does not name it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              <div className="space-y-1.5">
                <Label htmlFor="filter-name">Name</Label>
                <Input
                  id="filter-name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => {
                    setName(event.target.value);
                    setDirty(true);
                    setFormError(null);
                  }}
                  placeholder="My active bugs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="filter-jql">JQL query</Label>
                <Textarea
                  id="filter-jql"
                  value={jql}
                  maxLength={2000}
                  rows={4}
                  onChange={(event) => {
                    setJql(event.target.value);
                    setDirty(true);
                    setQueryError(null);
                    setFormError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void runQuery(jql);
                    }
                  }}
                  aria-invalid={!!queryError}
                  aria-describedby="filter-jql-help filter-jql-error"
                  className="min-h-24 resize-y font-mono text-sm"
                  placeholder="type = bug AND category != done"
                />
                <div id="filter-jql-help" className="space-y-1 text-xs text-muted-foreground">
                  <p>Operators: =, !=, IN, NOT IN, IS EMPTY, AND, OR, NOT, and parentheses.</p>
                  <p className="break-words">Fields: {FIELD_HELP.join(', ')}.</p>
                  <p>Press Ctrl+Enter or ⌘Enter to run.</p>
                </div>
                {queryError && (
                  <p id="filter-jql-error" role="alert" className="text-sm text-destructive">
                    {queryError}
                  </p>
                )}
              </div>

              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => void runQuery(jql)} disabled={running || !jql.trim()}>
                  {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Run query
                </Button>
                <Button onClick={() => void saveFilter()} disabled={saving || !name.trim() || !jql.trim()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
                  {selected ? 'Save changes' : 'Save filter'}
                </Button>
                {selected && (
                  <Button
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" /> Delete
                  </Button>
                )}
                {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-4 py-5">
            <CardHeader className="px-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="size-4" /> Results
              </CardTitle>
              <CardDescription aria-live="polite">
                {results === null
                  ? 'Run the query to preview matching issues.'
                  : `${results.length} matching issue${results.length === 1 ? '' : 's'}${results.length === 50 ? ' (first 50)' : ''}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              {running ? (
                <RowsSkeleton count={4} />
              ) : results === null ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  Results stay project-scoped and are ordered by most recently updated.
                </div>
              ) : results.length === 0 ? (
                <EmptyState icon={Search} title="No matching issues" description="Try broadening the query." />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left">
                        <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">Key</th>
                        <th className="min-w-64 px-3 py-2 text-xs font-medium text-muted-foreground">Summary</th>
                        <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
                        <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">Sprint</th>
                        <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                        <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">Priority</th>
                        <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground">Assignee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((issue) => (
                        <tr key={issue.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                            <Link className="text-primary hover:underline" to={issueUrl(issue.issue_key)}>
                              {issue.issue_key}
                            </Link>
                          </td>
                          <td className="max-w-md px-3 py-2">
                            <Link className="block truncate font-medium hover:text-primary hover:underline" to={issueUrl(issue.issue_key)}>
                              {issue.title}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <TypeIcon type={issue.type} /> {TYPE_LABEL[issue.type]}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {issue.sprint_name && issue.type !== 'subtask' && issue.type !== 'epic'
                              ? <SprintBadge name={issue.sprint_name} />
                              : <span className="text-xs text-muted-foreground">Backlog</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <StatusPill
                              status={issue.status}
                              label={workflow.label(issue.status)}
                              tone={statusTone(issue.status, workflow.statuses)}
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className="inline-flex items-center gap-1.5 capitalize">
                              <PriorityIcon priority={issue.priority} /> {issue.priority}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                            {issue.assignee_name ?? 'Unassigned'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{selected?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the personal filter. It does not change or delete any matching issues.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void deleteFilter()}>
              Delete filter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
