/**
 * Test Setup — Creates a fresh Express app with in-memory SQLite for each test suite.
 */
const request = require('supertest');
const path = require('path');

let app;

async function createTestApp() {
  // Force test environment
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO_DATA = 'true';
  process.env.DB_DRIVER = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';

  // Clear ALL backend modules from require cache to get fresh DB
  const backendDir = path.resolve(__dirname, '..', '..');
  Object.keys(require.cache).forEach(key => {
    if (key.startsWith(backendDir) && !key.includes('node_modules') && !key.includes('tests')) {
      delete require.cache[key];
    }
  });

  // Re-require after cache clear — fresh database + fresh routes
  const { initDb } = require('../../database');
  await initDb();

  const express = require('express');
  const cors = require('cors');
  const { authMiddleware } = require('../../middleware/auth');
  const { requestLogger } = require('../../middleware/logger');

  const testApp = express();
  testApp.use(cors());
  testApp.use(express.json());
  testApp.use(authMiddleware);
  testApp.use(requestLogger);

  testApp.use('/api/auth', require('../../routes/auth'));
  testApp.use('/api/users', require('../../routes/users'));
  testApp.use('/api/profile', require('../../routes/profile'));
  testApp.use('/api/settings', require('../../routes/settings'));
  testApp.use('/api/projects', require('../../routes/projects'));
  testApp.use('/api', require('../../routes/sprints'));
  testApp.use('/api', require('../../routes/issues'));
  testApp.use('/api', require('../../routes/comments'));
  testApp.use('/api/admin', require('../../routes/admin'));
  testApp.use('/api/admin', require('../../routes/auditlog'));
  testApp.use('/api', require('../../routes/reports'));
  testApp.use('/api', require('../../routes/wiki'));
  testApp.use('/api', require('../../routes/activity'));
  testApp.use('/api', require('../../routes/watchers'));
  testApp.use('/api', require('../../routes/links'));

  app = testApp;
  return testApp;
}

async function loginAs(email = 'kunal@example.com', password = 'password123') {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return {
    'x-auth-token': res.body.token,
    'x-user-id': res.body.id,
    'x-user-role': res.body.role,
    'Content-Type': 'application/json',
  };
}

async function adminHeaders() { return loginAs('kunal@example.com', 'password123'); }
async function userHeaders() { return loginAs('priya@example.com', 'password123'); }
function getApp() { return app; }

module.exports = { createTestApp, getApp, loginAs, adminHeaders, userHeaders };
