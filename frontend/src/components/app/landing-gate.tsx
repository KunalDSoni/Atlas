import { Suspense, lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/auth-provider';

const Landing = lazy(() => import('@/screens/landing'));

function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * `/` serves marketing to strangers and nothing to members.
 * A signed-in user is sent straight to their dashboard, so the landing page
 * never flashes behind them.
 */
export function LandingGate() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <Suspense fallback={<Spinner />}>
      <Landing />
    </Suspense>
  );
}
