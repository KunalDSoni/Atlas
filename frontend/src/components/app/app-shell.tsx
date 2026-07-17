import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  ChevronsUpDown, Columns3, FileClock, Gauge, LayoutDashboard, ListTodo, LogOut, Menu,
  Monitor, Moon, Rocket, Search, Settings as SettingsIcon, Shield, Sun, User as UserIcon, Users, BookOpen, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/auth-provider';
import { useTheme } from '@/context/theme-provider';
import { useProjects } from '@/hooks/use-projects';
import { useSettings } from '@/hooks/use-settings';
import { isAdmin } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { UserAvatar } from './primitives';
import { CommandPalette } from './command-palette';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PROJECT_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/board', label: 'Board', icon: Columns3 },
  { to: '/backlog', label: 'Backlog', icon: ListTodo },
  { to: '/epics', label: 'Epics', icon: Zap },
  { to: '/sprints', label: 'Sprints', icon: Rocket },
  { to: '/reports', label: 'Reports', icon: Gauge },
];

const WIKI_NAV: NavItem[] = [{ to: '/wiki', label: 'Wiki', icon: BookOpen }];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: Shield },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/projects', label: 'Projects', icon: Columns3 },
  { to: '/admin/audit-log', label: 'Audit log', icon: FileClock },
];

function NavSection({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <div className="px-3 py-2">
      <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</p>
      <nav className="space-y-0.5">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin' || to === '/wiki'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function ProjectSwitcher() {
  const { projects, currentProject, setCurrentProjectId, loading } = useProjects();

  if (loading) return <div className="mx-3 h-9 animate-pulse rounded-md bg-muted" />;
  if (!projects.length) return null;

  return (
    <div className="px-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-auto w-full justify-between px-2 py-2 hover:bg-muted">
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
                {currentProject?.key?.slice(0, 2) ?? '—'}
              </span>
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-semibold">{currentProject?.name ?? 'Select project'}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {currentProject ? `${currentProject.issue_count} issues` : 'No project'}
                </span>
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-faint" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => setCurrentProjectId(p.id)} className="gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded bg-primary/10 text-[10px] font-bold text-primary">
                {p.key.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === currentProject?.id && <span className="text-xs text-primary">current</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="grid size-7 place-items-center rounded bg-primary text-sm font-bold text-primary-foreground">
          A
        </div>
        <span className="text-[15px] font-semibold tracking-tight">Atlas</span>
      </div>

      <ProjectSwitcher />
      <Separator className="my-2" />

      <ScrollArea className="flex-1">
        <NavSection title="Project" items={PROJECT_NAV} onNavigate={onNavigate} />
        {isAdmin(user?.role) && (
          <>
            <Separator className="my-2" />
            <NavSection title="Administration" items={ADMIN_NAV} onNavigate={onNavigate} />
          </>
        )}
        <Separator className="my-2" />
        <NavSection title="Knowledge" items={WIKI_NAV} onNavigate={onNavigate} />
      </ScrollArea>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { patch } = useSettings();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  // Sign-in treats the account's saved theme as the source of truth, so a
  // localStorage-only change here would revert on the next load.
  const choose = (t: 'light' | 'dark' | 'system') => {
    setTheme(t);
    void patch({ theme: t });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => choose('light')} className="gap-2">
          <Sun className="size-4" /> Light {theme === 'light' && <span className="ml-auto text-xs text-primary">•</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose('dark')} className="gap-2">
          <Moon className="size-4" /> Dark {theme === 'dark' && <span className="ml-auto text-xs text-primary">•</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose('system')} className="gap-2">
          <Monitor className="size-4" /> System {theme === 'system' && <span className="ml-auto text-xs text-primary">•</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <UserAvatar name={user.name} color={user.avatar_color} className="size-7" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')} className="gap-2">
          <UserIcon className="size-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')} className="gap-2">
          <SettingsIcon className="size-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await logout();
            navigate('/login');
          }}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Announce ⌘K rather than hiding it behind a shortcut nobody discovers. */}
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="hidden items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:flex"
            aria-label="Open command palette"
          >
            <Search className="size-3.5" />
            <span>Search…</span>
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">⌘K</kbd>
          </button>

          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
        <CommandPalette />
      </div>
    </div>
  );
}
