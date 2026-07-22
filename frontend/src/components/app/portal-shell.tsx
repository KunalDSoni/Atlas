import { Lightbulb, LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-provider';
import { cn } from '@/lib/utils';

export function PortalShell() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const signInTarget = `/login?next=${encodeURIComponent(location.pathname)}`;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/portal" className="mr-auto flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Lightbulb className="size-4" />
            </span>
            <span>Atlas Ideas</span>
          </Link>

          <nav aria-label="Ideas portal" className="flex items-center gap-1">
            <PortalNavLink to="/portal" end>Roadmap</PortalNavLink>
            {user && <PortalNavLink to="/portal/mine">My ideas</PortalNavLink>}
          </nav>

          <div className="flex items-center gap-2">
            {!loading && user ? (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link to={user.role === 'client' ? '/help' : '/dashboard'}>
                    {user.role === 'client' ? 'Help center' : 'Back to Atlas'}
                  </Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Sign out"
                  onClick={async () => {
                    await logout();
                    navigate('/portal');
                  }}
                >
                  <LogOut className="size-4" />
                </Button>
              </>
            ) : !loading ? (
              <Button asChild size="sm"><Link to={signInTarget}>Sign in</Link></Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

function PortalNavLink({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(
        'rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </NavLink>
  );
}
