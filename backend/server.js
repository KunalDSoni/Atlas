// ===== ATLAS — Modular Backend Server =====
// Each module has its own route file in /routes
// Middleware lives in /middleware
// Database schema + seed data in database.js

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, getDb, queryOne } = require('./database');
const { authMiddleware } = require('./middleware/auth');
const { requestLogger } = require('./middleware/logger');
const { blockClients } = require('./middleware/servicedesk');
const { apiRateLimit } = require('./middleware/ratelimit');

// Route modules
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const profileRoutes = require('./routes/profile');
const settingsRoutes = require('./routes/settings');
const projectsRoutes = require('./routes/projects');
const sprintsRoutes = require('./routes/sprints');
const issuesRoutes = require('./routes/issues');
const commentsRoutes = require('./routes/comments');
const adminRoutes = require('./routes/admin');
const reportsRoutes = require('./routes/reports');
const wikiRoutes = require('./routes/wiki');
const attachmentsRoutes = require('./routes/attachments');
const activityRoutes = require('./routes/activity');
const watchersRoutes = require('./routes/watchers');
const linksRoutes = require('./routes/links');
const auditLogRoutes = require('./routes/auditlog');
const searchRoutes = require('./routes/search');
const notificationsRoutes = require('./routes/notifications');
const worklogsRoutes = require('./routes/worklogs');
const releasesRoutes = require('./routes/releases');
const workflowsRoutes = require('./routes/workflows');
const automationsRoutes = require('./routes/automations');
const productCompaniesRoutes = require('./routes/product-companies');
const productInsightsRoutes = require('./routes/product-insights');
const productThemesRoutes = require('./routes/product-themes');
const productFeaturesRoutes = require('./routes/product-features');
const productOutcomesRoutes = require('./routes/product-outcomes');
const productObjectivesRoutes = require('./routes/product-objectives');
const portalRoutes = require('./routes/portal');
const aiRoutes = require('./routes/ai');
const wikiAttachmentsRoutes = require('./routes/wiki-attachments');
const tokensRoutes = require('./routes/tokens');
const webhooksRoutes = require('./routes/webhooks');
const streamRoutes = require('./routes/stream');
const customFieldsRoutes = require('./routes/custom-fields');
const requestTypesRoutes = require('./routes/request-types');
const queuesRoutes = require('./routes/queues');
const slaRoutes = require('./routes/sla');
const deflectionRoutes = require('./routes/deflection');
const helpRoutes = require('./routes/help');

const app = express();
const PORT = process.env.PORT || 3001;

// Global middleware
// CORS: allow-list driven. Defaults to same-origin only (no cross-origin callers),
// since the SPA is served by this same server. Set CORS_ORIGINS to override.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-auth-token'],
}));

// Baseline security headers.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Body size cap — the default 100kb is generous for this API and unbounded JSON
// is a cheap DoS vector.
app.use(express.json({ limit: '1mb' }));
app.use(authMiddleware);
app.use(requestLogger);

// Health checks (no auth) — liveness and a DB-backed readiness probe.
const startedAt = Date.now();
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime_s: Math.round((Date.now() - startedAt) / 1000) });
});
app.get('/api/health/ready', async (req, res) => {
  try {
    const db = await getDb();
    await queryOne(db, 'SELECT 1 AS ok');
    res.json({ status: 'ready', db: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'not_ready', error: e.message });
  }
});

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

// ===== API ROUTES (by module) =====

// Auth Module — login, logout, me
// Coarse per-IP throttle across the API (stream + health exempt).
app.use('/api', apiRateLimit);

app.use('/api/auth', authRoutes);

// ===== The service desk boundary =====
// Order matters. A client-role user may reach their own profile/settings, the
// help center, and the deliberately narrow idea-portal routes. Everything
// registered AFTER blockClients is staff-only, enforced once here rather than
// by each internal route remembering to check.

// Profile Module — current user's profile
app.use('/api/profile', profileRoutes);

// Settings Module — current user's preferences
app.use('/api/settings', settingsRoutes);

// Service desk help center (customer-facing)
app.use('/api', helpRoutes);

// The idea portal is a second customer-facing boundary. Public reads are
// anonymous; its identity-dependent routes enforce requireAuth themselves.
app.use('/api', portalRoutes);

app.use('/api', blockClients);

// Users Module — CRUD for user management (admin)
app.use('/api/users', usersRoutes);

// Projects Module — CRUD for projects + members + stats
app.use('/api/projects', projectsRoutes);

// Sprints Module — CRUD for sprints
// Note: project-scoped routes are /api/projects/:id/sprints
// Direct sprint routes are /api/sprints/:id
app.use('/api', sprintsRoutes);

// Issues Module — CRUD for issues
// Note: project-scoped routes are /api/projects/:id/issues
// Direct issue routes are /api/issues/:id
app.use('/api', issuesRoutes);

// Comments Module — CRUD for comments
// Note: issue-scoped routes are /api/issues/:id/comments
// Direct comment routes are /api/comments/:id
app.use('/api', commentsRoutes);

// Admin Module — admin dashboard stats
app.use('/api/admin', adminRoutes);

// Audit Log Module — admin audit log viewer
app.use('/api/admin', auditLogRoutes);

// Reports Module — project reports, charts, CSV export
app.use('/api', reportsRoutes);

// Wiki (Confluence) Module — spaces, pages, comments, search
app.use('/api', wikiRoutes);

// Attachments Module — file upload/download for issues
app.use('/api', attachmentsRoutes);

// Activity Module — issue activity/history log
app.use('/api', activityRoutes);

// Watchers Module — issue watchers/followers
app.use('/api', watchersRoutes);

// Issue Links Module — linked issues
app.use('/api', linksRoutes);

// Global Search + Saved Filters Module
app.use('/api', searchRoutes);

// Notifications + Wiki Page Watching Module
app.use('/api', notificationsRoutes);

// Time Tracking Module
app.use('/api', worklogsRoutes);

// Releases + Components Module
app.use('/api', releasesRoutes);

// Custom Workflows Module
app.use('/api', workflowsRoutes);

// Automation Rules Module
app.use('/api', automationsRoutes);

// Product Module (Productboard parity) — companies/customers, insights,
// features + prioritization, objectives, and the customer-facing idea portal
app.use('/api', productCompaniesRoutes);
app.use('/api', productInsightsRoutes);
app.use('/api', productFeaturesRoutes);
app.use('/api', productOutcomesRoutes);
app.use('/api', productObjectivesRoutes);
app.use('/api', productThemesRoutes);

// AI assistant (Rovo-style): summarize, write, ask-your-wiki
app.use('/api', aiRoutes);

// Wiki page attachments + inline images
app.use('/api', wikiAttachmentsRoutes);

// Personal API tokens + outbound webhooks
app.use('/api', tokensRoutes);
app.use('/api', webhooksRoutes);

// Real-time event stream (SSE)
app.use('/api', streamRoutes);

// Per-project custom fields
app.use('/api', customFieldsRoutes);

// Service desk, agent side — request type forms and saved queues
app.use('/api', requestTypesRoutes);
app.use('/api', queuesRoutes);
app.use('/api', slaRoutes);
app.use('/api', deflectionRoutes);

// SPA fallback (Express 5 compatible)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
});

// Start server
async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`\nAPI Modules loaded:`);
    console.log(`  Auth      → /api/auth/login, /api/auth/logout, /api/auth/me`);
    console.log(`  Users     → /api/users (CRUD)`);
    console.log(`  Profile   → /api/profile, /api/profile/password, /api/profile/email`);
    console.log(`  Settings  → /api/settings`);
    console.log(`  Projects  → /api/projects (CRUD + members + stats)`);
    console.log(`  Sprints   → /api/projects/:id/sprints, /api/sprints/:id (CRUD)`);
    console.log(`  Issues    → /api/projects/:id/issues, /api/issues/:id (CRUD + move)`);
    console.log(`  Comments  → /api/issues/:id/comments, /api/comments/:id (CRUD)`);
    console.log(`  Admin       → /api/admin/stats`);
    console.log(`  Reports     → /api/projects/:id/reports/* (sprint, velocity, workload, burndown, CSV)`);
    console.log(`  Wiki        → /api/wiki/* (spaces, pages, comments, search, templates)`);
    console.log(`  Attachments → /api/issues/:id/attachments, /api/attachments/:id (upload, download, delete)`);
    console.log(`  Activity    → /api/issues/:id/activity (history log)`);
    console.log(`  Watchers    → /api/issues/:id/watchers (watch/unwatch)`);
    console.log(`  Links       → /api/issues/:id/links, /api/issue-links/:id (linked issues)`);
    console.log(`  Audit Log   → /api/admin/audit-log (query, stats — admin only)`);
    console.log(`  Logger      → Request logging middleware active`);
  });
}

start();
