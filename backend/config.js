// ===== ATLAS — Configuration =====
// Loads settings from .env file with sensible defaults

const path = require('path');

// Load .env file if it exists
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) { /* dotenv not installed, use process.env */ }

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3001,

  // Database
  db: {
    driver: process.env.DB_DRIVER || 'sqlite',
    sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, 'data.db'),
    postgresUrl: process.env.DATABASE_URL || null,
  },

  // Auth
  auth: {
    sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    sessionExpiryDays: parseInt(process.env.SESSION_EXPIRY_DAYS, 10) || 7,
  },

  // Seed
  seedDemoData: (process.env.SEED_DEMO_DATA || 'true').toLowerCase() === 'true',

  // Admin account (created when seedDemoData=false)
  admin: {
    name: process.env.ADMIN_NAME || 'Admin',
    email: process.env.ADMIN_EMAIL || 'admin@atlas.local',
    password: process.env.ADMIN_PASSWORD || 'changeme123',
  },

  // Helpers
  isDev: () => config.env === 'development',
  isProd: () => config.env === 'production',
};

module.exports = config;
