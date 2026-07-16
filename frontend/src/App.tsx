import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/context/auth-provider';
import { ThemeProvider } from '@/context/theme-provider';
import { ProjectsProvider } from '@/hooks/use-projects';
import { AppShell } from '@/components/app/app-shell';
import LoginScreen from '@/screens/login';

const Dashboard = lazy(() => import('@/screens/dashboard'));
const Board = lazy(() => import('@/screens/board'));
const Backlog = lazy(() => import('@/screens/backlog'));
const Sprints = lazy(() => import('@/screens/sprints'));
const Reports = lazy(() => import('@/screens/reports'));
const Profile = lazy(() => import('@/screens/profile'));
const Settings = lazy(() => import('@/screens/settings'));
const AdminOverview = lazy(() => import('@/screens/admin-overview'));
const AdminUsers = lazy(() => import('@/screens/admin-users'));
const AdminProjects = lazy(() => import('@/screens/admin-projects'));
const AuditLog = lazy(() => import('@/screens/audit-log'));

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Gate for authenticated areas. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Gate for admin-only areas — the server enforces this too. */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ProtectedLayout() {
  return (
    <RequireAuth>
      <ProjectsProvider>
        <AppShell>
          <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/board" element={<Board />} />
              <Route path="/backlog" element={<Backlog />} />
              <Route path="/sprints" element={<Sprints />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={<RequireAdmin><AdminOverview /></RequireAdmin>} />
              <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
              <Route path="/admin/projects" element={<RequireAdmin><AdminProjects /></RequireAdmin>} />
              <Route path="/admin/audit-log" element={<RequireAdmin><AuditLog /></RequireAdmin>} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </AppShell>
      </ProjectsProvider>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="*" element={<ProtectedLayout />} />
          </Routes>
          <Toaster richColors closeButton position="bottom-right" />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
