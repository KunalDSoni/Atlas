import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Bell, CalendarRange, ChevronsUpDown, Columns3, FileClock, Gauge, LayoutDashboard, ListTodo, LogOut, Menu, Package,
  Rocket, Search, Settings as SettingsIcon, Shield, User as UserIcon, Users, BookOpen, Zap,
  Inbox, Lightbulb, Target, Map as MapIcon, Building2, MessagesSquare, Plus,
  Headphones, SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useProjects } from '@/hooks/use-projects';
import { canCreateProjects, isAdmin } from '@/lib/domain';
import type { AppNotification } from '@/lib/types';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useFocusMode } from '@/context/focus-mode';
import { CreateProjectDialog } from './create-project-dialog';
import { UserAvatar } from './primitives';
import { CommandPalette } from './command-palette';
import { useLiveEvents } from '@/hooks/use-live-events';

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
  { to: '/roadmap', label: 'Roadmap', icon: CalendarRange },
  { to: '/sprints', label: 'Sprints', icon: Rocket },
  { to: '/releases', label: 'Releases', icon: Package },
  { to: '/reports', label: 'Reports', icon: Gauge },
  { to: '/automation', label: 'Automation', icon: Zap },
];

const PRODUCT_NAV: NavItem[] = [
  { to: '/product/insights', label: 'Insights', icon: Inbox },
  { to: '/product/features', label: 'Features', icon: Lightbulb },
  { to: '/product/prioritize', label: 'Prioritize', icon: Target },
  { to: '/product/roadmap', label: 'Product roadmap', icon: MapIcon },
  { to: '/product/objectives', label: 'Objectives', icon: Target },
  { to: '/product/customers', label: 'Customers', icon: Building2 },
  { to: '/portal', label: 'Ideas portal', icon: MessagesSquare },
];

const WIKI_NAV: NavItem[] = [{ to: '/wiki', label: 'Wiki', icon: BookOpen }];

// Only rendered when the current project is a service desk — a board project
// has no queues to show, and an empty section is worse than no section.
const SERVICE_DESK_NAV: NavItem[] = [
  { to: '/servicedesk', label: 'Queues', icon: Headphones },
  { to: '/servicedesk/settings', label: 'Configuration', icon: SlidersHorizontal },
];

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
            end={to === '/admin' || to === '/wiki' || to === '/servicedesk'}
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
  const { projects, currentProject, setCurrentProjectId, loading, reload } = useProjects();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  // Never hide the switcher on an empty project list. A fresh deployment has
  // zero projects, and every project screen short-circuits to "No project
  // selected" — so hiding it here left the app with no way in at all.
  if (loading) return <div className="mx-3 h-9 animate-pulse rounded-md bg-muted" />;

  return (
    <div className="px-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-between px-2 py-2 hover:bg-muted"
            aria-label="Switch project"
          >
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
          {projects.length === 0 && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No projects yet
            </DropdownMenuItem>
          )}
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => setCurrentProjectId(p.id)} className="gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded bg-primary/10 text-[10px] font-bold text-primary">
                {p.key.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === currentProject?.id && <span className="text-xs text-primary">current</span>}
            </DropdownMenuItem>
          ))}
          {canCreateProjects(user?.role) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreateOpen(true)} className="gap-2">
                <Plus className="size-4" />
                Create project
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (project) => {
          await reload();
          setCurrentProjectId(project.id);
        }}
      />
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const { currentProject } = useProjects();

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
        {currentProject?.is_service_desk ? (
          <>
            <Separator className="my-2" />
            <NavSection title="Service desk" items={SERVICE_DESK_NAV} onNavigate={onNavigate} />
          </>
        ) : null}
        <Separator className="my-2" />
        <NavSection title="Product" items={PRODUCT_NAV} onNavigate={onNavigate} />
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

function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refreshCount = useCallback(() => {
    api.notifications.unreadCount().then((r) => setUnread(r.count)).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 60_000);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Live: bump the unread count the instant the server pushes a notification.
  useLiveEvents((e) => {
    if (e.type === 'notification') {
      refreshCount();
      if (open) api.notifications.list().then(setItems).catch(() => undefined);
    }
  });

  useEffect(() => {
    if (!open) return;
    api.notifications.list().then(setItems).catch(() => setItems([]));
  }, [open]);

  async function openNotification(n: AppNotification) {
    if (!n.is_read) {
      await api.notifications.markRead(n.id).catch(() => undefined);
      refreshCount();
    }
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    await api.notifications.markAllRead().catch(() => undefined);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setUnread(0);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-4 text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button onClick={markAll} className="text-xs text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <Separator />
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setOpen(false);
                    void openNotification(n);
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60',
                    !n.is_read && 'bg-primary/5',
                  )}
                >
                  <UserAvatar name={n.actor_name ?? '?'} color={n.actor_color} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block leading-snug">{n.message}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.is_read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Deliberately NOT a Radix DropdownMenu. Every popper-positioned menu in this
  // app currently renders off-screen (measured: the wrapper is transformed to
  // exactly -2x the menu's own height), which made this menu — and Settings
  // with it — unreachable. Anchoring to the header ourselves is deterministic
  // and cannot be mispositioned. See KNOWN-ISSUES.md for the popper bug.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const itemClass =
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground';

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <UserAvatar name={user.name} color={user.avatar_color} className="size-7" />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Separator className="my-1" />
          <button type="button" role="menuitem" className={itemClass} onClick={() => go('/profile')}>
            <UserIcon className="size-4" /> Profile
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={() => go('/settings')}>
            <SettingsIcon className="size-4" /> Settings
          </button>

          {/* Admin also lives in the sidebar, but below Project + Product it
              falls under the fold on shorter viewports. Same ADMIN_NAV list,
              so the two cannot drift. */}
          {isAdmin(user.role) && (
            <>
              <Separator className="my-1" />
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Administration</p>
              {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
                <button key={to} type="button" role="menuitem" className={itemClass} onClick={() => go(to)}>
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </>
          )}

          <Separator className="my-1" />
          <button
            type="button"
            role="menuitem"
            className={cn(itemClass, 'text-destructive hover:text-destructive')}
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login');
            }}
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Focus mode collapses the nav so a screen can use the full window; the
  // mobile sheet trigger in the header still reaches every destination.
  const { focused } = useFocusMode();

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar',
          focused ? 'lg:hidden' : 'lg:block',
        )}
      >
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(focused ? '' : 'lg:hidden')}
                aria-label="Open navigation"
              >
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
          <NotificationBell />
          <UserMenu />
        </header>

        <main className={cn('min-w-0 flex-1', focused ? 'p-3 sm:p-4' : 'p-4 sm:p-6')}>{children}</main>
        <CommandPalette />
      </div>
    </div>
  );
}
