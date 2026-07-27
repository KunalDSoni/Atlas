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
import { ProjectScope } from '@/components/app/project-scope';
import { LegacyProjectRedirect } from '@/components/app/legacy-redirect';
import { PortalShell } from '@/components/app/portal-shell';
import { PROJECT_SCREENS } from '@/lib/urls';
import LoginScreen from '@/screens/login';

const Dashboard = lazy(() => import('@/screens/dashboard'));
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
const ProductOutcomes = lazy(() => import('@/screens/product-outcomes'));
const ProductCustomers = lazy(() => import('@/screens/product-customers'));
const Portal = lazy(() => import('@/screens/portal'));
const PortalFeature = lazy(() => import('@/screens/portal-feature'));
const PortalMine = lazy(() => import('@/screens/portal-mine'));
const HelpCenter = lazy(() => import('@/screens/help-center'));
const HelpRequests = lazy(() => import('@/screens/help-requests'));

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
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wiki" element={<WikiHome />} />
              <Route path="/wiki/space/:spaceId" element={<WikiSpace />} />
              <Route path="/wiki/page/:pageId" element={<WikiPage />} />
              <Route path="/product/insights" element={<ProductInsights />} />
              <Route path="/product/features" element={<ProductFeatures />} />
              <Route path="/product/prioritize" element={<ProductPrioritize />} />
              <Route path="/product/roadmap" element={<ProductRoadmap />} />
              <Route path="/product/objectives" element={<ProductObjectives />} />
              <Route path="/product/outcomes" element={<ProductOutcomes />} />
              <Route path="/product/customers" element={<ProductCustomers />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={<RequireAdmin><AdminOverview /></RequireAdmin>} />
              <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
              <Route path="/admin/projects" element={<RequireAdmin><AdminProjects /></RequireAdmin>} />
              <Route path="/admin/audit-log" element={<RequireAdmin><AuditLog /></RequireAdmin>} />
              {/* Pre-scheme paths. Static, so they outrank :projectKey. */}
              {PROJECT_SCREENS.map((screen) => (
                <Route
                  key={screen}
                  path={`/${screen}`}
                  element={<LegacyProjectRedirect screen={screen} />}
                />
              ))}
              <Route path="/servicedesk/settings" element={<LegacyProjectRedirect screen="servicedesk/settings" />} />
              <Route path="/servicedesk/report" element={<LegacyProjectRedirect screen="servicedesk/report" />} />
              {/*
                Declared after every static path. React Router ranks static
                segments above dynamic ones, so /dashboard and /wiki/... are
                never swallowed by :projectKey.
              */}
              <Route path="/:projectKey/*" element={<ProjectScope />} />
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
            <Route path="/portal" element={<PortalShell />}>
              <Route index element={<Suspense fallback={<FullPageSpinner />}><Portal /></Suspense>} />
              <Route path="features/:featureId" element={<Suspense fallback={<FullPageSpinner />}><PortalFeature /></Suspense>} />
              <Route path="mine" element={<Suspense fallback={<FullPageSpinner />}><PortalMine /></Suspense>} />
              <Route path="*" element={<Navigate to="/portal" replace />} />
            </Route>
            <Route path="*" element={<ProtectedLayout />} />
          </Routes>
          <Toaster richColors closeButton position="bottom-right" />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
