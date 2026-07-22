import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/context/auth-provider';
import { ThemeProvider } from '@/context/theme-provider';
import { ProjectsProvider } from '@/hooks/use-projects';
import { SettingsProvider } from '@/hooks/use-settings';
import { FocusModeProvider } from '@/context/focus-mode';
import { AppShell } from '@/components/app/app-shell';
import LoginScreen from '@/screens/login';

const Dashboard = lazy(() => import('@/screens/dashboard'));
const Board = lazy(() => import('@/screens/board'));
const Backlog = lazy(() => import('@/screens/backlog'));
const Epics = lazy(() => import('@/screens/epics'));
const Sprints = lazy(() => import('@/screens/sprints'));
const Releases = lazy(() => import('@/screens/releases'));
const Roadmap = lazy(() => import('@/screens/roadmap'));
const Automation = lazy(() => import('@/screens/automation'));
const Reports = lazy(() => import('@/screens/reports'));
const Profile = lazy(() => import('@/screens/profile'));
const Settings = lazy(() => import('@/screens/settings'));
const AdminOverview = lazy(() => import('@/screens/admin-overview'));
const AdminUsers = lazy(() => import('@/screens/admin-users'));
const AdminProjects = lazy(() => import('@/screens/admin-projects'));
const AuditLog = lazy(() => import('@/screens/audit-log'));
const WikiHome = lazy(() => import('@/screens/wiki-home'));
const WikiSpace = lazy(() => import('@/screens/wiki-space'));
const WikiPage = lazy(() => import('@/screens/wiki-page'));
const ProductInsights = lazy(() => import('@/screens/product-insights'));
const ProductFeatures = lazy(() => import('@/screens/product-features'));
const ProductPrioritize = lazy(() => import('@/screens/product-prioritize'));
const ProductRoadmap = lazy(() => import('@/screens/product-roadmap'));
const ProductObjectives = lazy(() => import('@/screens/product-objectives'));
const ProductCustomers = lazy(() => import('@/screens/product-customers'));
const Portal = lazy(() => import('@/screens/portal'));
const HelpCenter = lazy(() => import('@/screens/help-center'));
const HelpRequests = lazy(() => import('@/screens/help-requests'));
const ServiceDeskQueues = lazy(() => import('@/screens/servicedesk-queues'));
const ServiceDeskSettings = lazy(() => import('@/screens/servicedesk-settings'));

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

/**
 * The help center, for service desk customers.
 *
 * Deliberately outside ProtectedLayout: a customer has no project, no board and
 * no sidebar, so rendering AppShell around this would be chrome pointing at
 * screens the server would 403 anyway.
 */
function HelpLayout() {
  return (
    <RequireAuth>
      <Suspense fallback={<FullPageSpinner />}>
        {/*
          Paths are relative: the parent route "/help/*" has already consumed
          "/help", so a descendant <Routes> matches only what remains.
        */}
        <Routes>
          <Route path="" element={<HelpCenter />} />
          <Route path="requests" element={<HelpRequests />} />
          <Route path="requests/:key" element={<HelpRequests />} />
          <Route path="*" element={<Navigate to="/help" replace />} />
        </Routes>
      </Suspense>
    </RequireAuth>
  );
}

function ProtectedLayout() {
  const { user } = useAuth();
  // The server refuses every internal endpoint for a client; without this the
  // customer would land on a dashboard of failed requests.
  if (user?.role === 'client') return <Navigate to="/help" replace />;
  return (
    <RequireAuth>
      <SettingsProvider>
      <ProjectsProvider>
        <FocusModeProvider>
        <AppShell>
          <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/board" element={<Board />} />
              <Route path="/backlog" element={<Backlog />} />
              <Route path="/epics" element={<Epics />} />
              <Route path="/sprints" element={<Sprints />} />
              <Route path="/releases" element={<Releases />} />
              <Route path="/roadmap" element={<Roadmap />} />
              <Route path="/automation" element={<Automation />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/wiki" element={<WikiHome />} />
              <Route path="/wiki/space/:spaceId" element={<WikiSpace />} />
              <Route path="/wiki/page/:pageId" element={<WikiPage />} />
              <Route path="/product/insights" element={<ProductInsights />} />
              <Route path="/product/features" element={<ProductFeatures />} />
              <Route path="/product/prioritize" element={<ProductPrioritize />} />
              <Route path="/product/roadmap" element={<ProductRoadmap />} />
              <Route path="/product/objectives" element={<ProductObjectives />} />
              <Route path="/product/customers" element={<ProductCustomers />} />
              <Route path="/servicedesk" element={<ServiceDeskQueues />} />
              <Route path="/servicedesk/settings" element={<ServiceDeskSettings />} />
              <Route path="/portal" element={<Portal />} />
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
        </FocusModeProvider>
      </ProjectsProvider>
      </SettingsProvider>
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
            <Route path="/help/*" element={<HelpLayout />} />
            <Route path="*" element={<ProtectedLayout />} />
          </Routes>
          <Toaster richColors closeButton position="bottom-right" />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
