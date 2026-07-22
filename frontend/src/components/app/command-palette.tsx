import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, Columns3, FileClock, Gauge, LayoutDashboard, ListFilter, ListTodo, Rocket,
  Settings as SettingsIcon, Shield, User as UserIcon, Users,
} from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { issueUrl } from '@/lib/urls';
import { isAdmin } from '@/lib/domain';
import type { Issue, SearchResults } from '@/lib/types';
import { TypeIcon } from './primitives';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/board', label: 'Board', icon: Columns3 },
  { to: '/backlog', label: 'Backlog', icon: ListTodo },
  { to: '/filters', label: 'Filters', icon: ListFilter },
  { to: '/sprints', label: 'Sprints', icon: Rocket },
  { to: '/reports', label: 'Reports', icon: Gauge },
  { to: '/wiki', label: 'Wiki', icon: BookOpen },
  { to: '/profile', label: 'Profile', icon: UserIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const ADMIN_NAV = [
  { to: '/admin', label: 'Admin overview', icon: Shield },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/audit-log', label: 'Audit log', icon: FileClock },
];

/** ⌘K / Ctrl+K: jump to a screen, project, issue, or wiki page. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [results, setResults] = useState<SearchResults>({ issues: [], pages: [] });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects, currentProjectId, setCurrentProjectId } = useProjects();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Load the current project's issues once the palette opens — cheap enough at this
  // scale, and it keeps the palette usable offline of a search endpoint.
  useEffect(() => {
    if (!open || !currentProjectId) return;
    api.issues.list(currentProjectId).then(setIssues).catch(() => setIssues([]));
  }, [open, currentProjectId]);

  // Global search is server-side (issues across every project + wiki pages).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults({ issues: [], pages: [] });
      return;
    }
    const t = setTimeout(() => {
      api.search.query(q).then(setResults).catch(() => setResults({ issues: [], pages: [] }));
    }, 250);
    return () => clearTimeout(t);
  }, [open, query]);

  function run(fn: () => void) {
    setOpen(false);
    setQuery('');
    fn();
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to anything">
      <CommandInput placeholder="Search issues, pages, or jump to…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Go to">
          {NAV.map((n) => (
            <CommandItem key={n.to} value={`go ${n.label}`} onSelect={() => run(() => navigate(n.to))} className="gap-2">
              <n.icon className="size-4" />
              {n.label}
            </CommandItem>
          ))}
          {isAdmin(user?.role) &&
            ADMIN_NAV.map((n) => (
              <CommandItem key={n.to} value={`go ${n.label}`} onSelect={() => run(() => navigate(n.to))} className="gap-2">
                <n.icon className="size-4" />
                {n.label}
              </CommandItem>
            ))}
        </CommandGroup>

        {query.trim().length < 2 && issues.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Issues">
              {issues.slice(0, 50).map((i) => (
                <CommandItem
                  key={i.id}
                  value={`${i.issue_key} ${i.title}`}
                  onSelect={() => run(() => navigate(issueUrl(i.issue_key)))}
                  className="gap-2"
                >
                  <TypeIcon type={i.type} />
                  <span className="font-mono text-xs text-muted-foreground">{i.issue_key}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {results.issues.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Issues (all projects)">
              {results.issues.map((i) => (
                <CommandItem
                  key={i.id}
                  value={`${i.issue_key} ${i.title}`}
                  onSelect={() => run(() => navigate(issueUrl(i.issue_key)))}
                  className="gap-2"
                >
                  <TypeIcon type={i.type} />
                  <span className="font-mono text-xs text-muted-foreground">{i.issue_key}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="text-xs text-muted-foreground">{i.project_key}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {results.pages.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Wiki pages">
              {results.pages.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`wiki ${p.title}`}
                  onSelect={() => run(() => navigate(`/wiki/page/${p.id}`))}
                  className="gap-2"
                >
                  <BookOpen className="size-4 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  {p.space_name && <span className="text-xs text-muted-foreground">{p.space_name}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {projects.length > 1 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch project">
              {projects
                .filter((p) => p.id !== currentProjectId)
                .map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`project ${p.name} ${p.key}`}
                    onSelect={() => run(() => setCurrentProjectId(p.id))}
                    className="gap-2"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/10 text-[10px] font-bold text-primary">
                      {p.key.slice(0, 2)}
                    </span>
                    {p.name}
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
