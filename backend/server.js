// ===== ATLAS — Modular Backend Server =====
// Each module has its own route file in /routes
// Middleware lives in /middleware
// Database schema + seed data in database.js

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./database');
const { authMiddleware } = require('./middleware/auth');

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

const app = express();
const PORT = process.env.PORT || 3001;

// Global middleware
app.use(cors());
app.use(express.json());
app.use(authMiddleware);

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

// ===== API ROUTES (by module) =====

// Auth Module — login, logout, me
app.use('/api/auth', authRoutes);

// Users Module — CRUD for user management (admin)
app.use('/api/users', usersRoutes);

// Profile Module — current user's profile
app.use('/api/profile', profileRoutes);

// Settings Module — current user's preferences
app.use('/api/settings', settingsRoutes);

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

// Reports Module — project reports, charts, CSV export
app.use('/api', reportsRoutes);

// Wiki (Confluence) Module — spaces, pages, comments, search
app.use('/api', wikiRoutes);

// Wiki (Confluence) frontend
app.get('/wiki', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'wiki.html'));
});

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
    console.log(`  Admin     → /api/admin/stats`);
    console.log(`  Reports   → /api/projects/:id/reports/* (sprint, velocity, workload, burndown, CSV)`);
    console.log(`  Wiki      → /api/wiki/* (spaces, pages, comments, search, templates)`);
  });
}

start();
