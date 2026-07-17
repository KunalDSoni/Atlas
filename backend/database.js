// ===== ATLAS — Database Layer =====
// Supports: SQLite (dev) and MySQL (production)
// Controlled by DB_DRIVER in .env

const path = require('path');
const fs = require('fs');
const config = require('./config');
const { hashPasswordSync } = require('./utils/password');

const DB_PATH = config.db.sqlitePath;
let db;

// ===== SCHEMA (shared across drivers) =====
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin','board_admin','client','user')),
    avatar_color TEXT DEFAULT '#6366f1',
    avatar_url TEXT,
    phone TEXT,
    department TEXT,
    job_title TEXT,
    bio TEXT,
    timezone TEXT DEFAULT 'UTC',
    is_active INTEGER DEFAULT 1,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
    theme TEXT DEFAULT 'dark' CHECK(theme IN ('dark','light','system')),
    language TEXT DEFAULT 'en',
    email_notifications INTEGER DEFAULT 1,
    push_notifications INTEGER DEFAULT 1,
    notify_assigned INTEGER DEFAULT 1,
    notify_mentions INTEGER DEFAULT 1,
    notify_comments INTEGER DEFAULT 1,
    notify_status_changes INTEGER DEFAULT 1,
    notify_sprint_updates INTEGER DEFAULT 0,
    compact_view INTEGER DEFAULT 0,
    default_project_id TEXT,
    items_per_page INTEGER DEFAULT 25,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT UNIQUE NOT NULL,
    description TEXT,
    wip_limits TEXT DEFAULT '{}',
    lead_id TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role_in_project TEXT DEFAULT 'member' CHECK(role_in_project IN ('lead','member','viewer')),
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sprints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    goal TEXT,
    status TEXT DEFAULT 'planning' CHECK(status IN ('planning','active','completed')),
    start_date TEXT,
    end_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    sprint_id TEXT REFERENCES sprints(id),
    issue_key TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'task' CHECK(type IN ('story','task','bug','epic','subtask')),
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('highest','high','medium','low','lowest')),
    assignee_id TEXT REFERENCES users(id),
    reporter_id TEXT REFERENCES users(id),
    parent_id TEXT REFERENCES issues(id),
    story_points INTEGER,
    labels TEXT DEFAULT '[]',
    due_date TEXT,
    start_date TEXT,
    original_estimate TEXT,
    time_spent TEXT,
    epic_color TEXT DEFAULT 'purple' CHECK(epic_color IN ('purple','blue','teal','green','yellow','orange','red','pink')),
    fix_version_id TEXT REFERENCES versions(id),
    component_id TEXT REFERENCES components(id),
    board_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS issue_watchers (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(issue_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS issue_links (
    id TEXT PRIMARY KEY,
    source_issue_id TEXT NOT NULL REFERENCES issues(id),
    target_issue_id TEXT NOT NULL REFERENCES issues(id),
    link_type TEXT NOT NULL DEFAULT 'relates_to' CHECK(link_type IN ('blocks','is_blocked_by','relates_to','duplicates','is_duplicated_by','clones','is_cloned_by')),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // ===== CONFLUENCE TABLES =====
  `CREATE TABLE IF NOT EXISTS wiki_spaces (
    id TEXT PRIMARY KEY,
    space_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '📄',
    color TEXT DEFAULT '#0c66e4',
    owner_id TEXT REFERENCES users(id),
    is_personal INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    page_type TEXT DEFAULT 'page',
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES wiki_spaces(id),
    parent_id TEXT REFERENCES wiki_pages(id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    body TEXT DEFAULT '',
    body_format TEXT DEFAULT 'html' CHECK(body_format IN ('html','markdown')),
    status TEXT DEFAULT 'current' CHECK(status IN ('current','draft','archived','trashed')),
    position INTEGER DEFAULT 0,
    author_id TEXT NOT NULL REFERENCES users(id),
    last_editor_id TEXT REFERENCES users(id),
    version INTEGER DEFAULT 1,
    view_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_versions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES wiki_pages(id),
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    editor_id TEXT NOT NULL REFERENCES users(id),
    change_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_comments (
    quote TEXT,
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES wiki_pages(id),
    parent_id TEXT REFERENCES wiki_page_comments(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    resolved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_labels (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES wiki_pages(id),
    label TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(page_id, label)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_stars (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    page_id TEXT REFERENCES wiki_pages(id),
    space_id TEXT REFERENCES wiki_spaces(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, page_id),
    UNIQUE(user_id, space_id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_likes (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES wiki_pages(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(page_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_templates (
    id TEXT PRIMARY KEY,
    space_id TEXT REFERENCES wiki_spaces(id),
    name TEXT NOT NULL,
    description TEXT,
    body TEXT DEFAULT '',
    icon TEXT DEFAULT '📝',
    is_global INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // ===== AUDIT LOG TABLE =====
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    user_name TEXT,
    action TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'system',
    entity_type TEXT,
    entity_id TEXT,
    entity_name TEXT,
    details TEXT,
    ip_address TEXT,
    method TEXT,
    path TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS saved_filters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    actor_id TEXT REFERENCES users(id),
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    issue_id TEXT,
    wiki_page_id TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_watchers (
    page_id TEXT NOT NULL REFERENCES wiki_pages(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (page_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    minutes INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS project_statuses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT DEFAULT 'in_progress' CHECK(category IN ('todo','in_progress','done')),
    position INTEGER DEFAULT 0,
    UNIQUE(project_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_restrictions (
    page_id TEXT NOT NULL REFERENCES wiki_pages(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    can_edit INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (page_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('issue_created','status_changed','all_subtasks_done')),
    conditions TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'unreleased' CHECK(status IN ('unreleased','released')),
    release_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS components (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`
];

// ===== MySQL SCHEMA =====
// Hand-written MySQL dialect (the SQLite TEXT-everywhere approach is invalid in
// MySQL: TEXT columns can't have DEFAULTs and can't be PRIMARY/UNIQUE keys
// without a prefix length). All UUID id/FK columns -> VARCHAR(36); enum-ish
// columns keep their CHECK constraints (enforced on MySQL 8.0.16+). utf8mb4 so
// emoji icons/content store correctly. `key` is backticked (reserved word).
const MYSQL_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK(role IN ('admin','board_admin','client','user')),
    avatar_color VARCHAR(20) DEFAULT '#6366f1',
    avatar_url VARCHAR(512),
    phone VARCHAR(50),
    department VARCHAR(120),
    job_title VARCHAR(120),
    bio TEXT,
    timezone VARCHAR(64) DEFAULT 'UTC',
    is_active TINYINT DEFAULT 1,
    last_login DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) UNIQUE NOT NULL,
    theme VARCHAR(10) DEFAULT 'dark' CHECK(theme IN ('dark','light','system')),
    language VARCHAR(10) DEFAULT 'en',
    email_notifications TINYINT DEFAULT 1,
    push_notifications TINYINT DEFAULT 1,
    notify_assigned TINYINT DEFAULT 1,
    notify_mentions TINYINT DEFAULT 1,
    notify_comments TINYINT DEFAULT 1,
    notify_status_changes TINYINT DEFAULT 1,
    notify_sprint_updates TINYINT DEFAULT 0,
    compact_view TINYINT DEFAULT 0,
    default_project_id VARCHAR(36),
    items_per_page INT DEFAULT 25,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    \`key\` VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    wip_limits VARCHAR(2000),
    lead_id VARCHAR(36),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS project_members (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    role_in_project VARCHAR(20) DEFAULT 'member' CHECK(role_in_project IN ('lead','member','viewer')),
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sprints (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    goal TEXT,
    status VARCHAR(20) DEFAULT 'planning' CHECK(status IN ('planning','active','completed')),
    start_date DATETIME NULL,
    end_date DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS issues (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    sprint_id VARCHAR(36),
    issue_key VARCHAR(50) NOT NULL,
    issue_number INT NOT NULL,
    title VARCHAR(512) NOT NULL,
    description TEXT,
    type VARCHAR(20) DEFAULT 'task' CHECK(type IN ('story','task','bug','epic','subtask')),
    status VARCHAR(20) DEFAULT 'todo',
    priority VARCHAR(20) DEFAULT 'medium' CHECK(priority IN ('highest','high','medium','low','lowest')),
    assignee_id VARCHAR(36),
    reporter_id VARCHAR(36),
    parent_id VARCHAR(36),
    story_points INT,
    labels VARCHAR(2000) DEFAULT '[]',
    due_date DATETIME NULL,
    start_date DATETIME NULL,
    original_estimate VARCHAR(50),
    time_spent VARCHAR(50),
    epic_color VARCHAR(20) DEFAULT 'purple' CHECK(epic_color IN ('purple','blue','teal','green','yellow','orange','red','pink')),
    fix_version_id VARCHAR(36),
    component_id VARCHAR(36),
    board_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(36) PRIMARY KEY,
    issue_id VARCHAR(36) NOT NULL,
    author_id VARCHAR(36) NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id VARCHAR(36) PRIMARY KEY,
    issue_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(255) NOT NULL,
    field VARCHAR(120),
    old_value TEXT,
    new_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS issue_watchers (
    id VARCHAR(36) PRIMARY KEY,
    issue_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(issue_id, user_id)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS issue_links (
    id VARCHAR(36) PRIMARY KEY,
    source_issue_id VARCHAR(36) NOT NULL,
    target_issue_id VARCHAR(36) NOT NULL,
    link_type VARCHAR(30) NOT NULL DEFAULT 'relates_to' CHECK(link_type IN ('blocks','is_blocked_by','relates_to','duplicates','is_duplicated_by','clones','is_cloned_by')),
    created_by VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id VARCHAR(36) PRIMARY KEY,
    issue_id VARCHAR(36) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    size INT NOT NULL,
    uploaded_by VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  // ===== CONFLUENCE TABLES =====
  `CREATE TABLE IF NOT EXISTS wiki_spaces (
    id VARCHAR(36) PRIMARY KEY,
    space_key VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(20) DEFAULT '📄',
    color VARCHAR(20) DEFAULT '#0c66e4',
    owner_id VARCHAR(36),
    is_personal TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    page_type VARCHAR(20) DEFAULT 'page',
    id VARCHAR(36) PRIMARY KEY,
    space_id VARCHAR(36) NOT NULL,
    parent_id VARCHAR(36),
    title VARCHAR(512) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    body LONGTEXT,
    body_format VARCHAR(10) DEFAULT 'html' CHECK(body_format IN ('html','markdown')),
    status VARCHAR(20) DEFAULT 'current' CHECK(status IN ('current','draft','archived','trashed')),
    position INT DEFAULT 0,
    author_id VARCHAR(36) NOT NULL,
    last_editor_id VARCHAR(36),
    version INT DEFAULT 1,
    view_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_page_versions (
    id VARCHAR(36) PRIMARY KEY,
    page_id VARCHAR(36) NOT NULL,
    version INT NOT NULL,
    title VARCHAR(512) NOT NULL,
    body LONGTEXT,
    editor_id VARCHAR(36) NOT NULL,
    change_message VARCHAR(512),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_page_comments (
    quote TEXT,
    id VARCHAR(36) PRIMARY KEY,
    page_id VARCHAR(36) NOT NULL,
    parent_id VARCHAR(36),
    author_id VARCHAR(36) NOT NULL,
    body TEXT NOT NULL,
    resolved TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_labels (
    id VARCHAR(36) PRIMARY KEY,
    page_id VARCHAR(36) NOT NULL,
    label VARCHAR(120) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, label)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_stars (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    page_id VARCHAR(36),
    space_id VARCHAR(36),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, page_id),
    UNIQUE(user_id, space_id)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_page_likes (
    id VARCHAR(36) PRIMARY KEY,
    page_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, user_id)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_templates (
    id VARCHAR(36) PRIMARY KEY,
    space_id VARCHAR(36),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    body LONGTEXT,
    icon VARCHAR(20) DEFAULT '📝',
    is_global TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  // ===== AUDIT LOG TABLE =====
  `CREATE TABLE IF NOT EXISTS audit_log (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    user_name VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'system',
    entity_type VARCHAR(50),
    entity_id VARCHAR(36),
    entity_name VARCHAR(255),
    details TEXT,
    ip_address VARCHAR(64),
    method VARCHAR(10),
    path VARCHAR(512),
    status_code INT,
    duration_ms INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS saved_filters (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    params TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(36),
    type VARCHAR(50) NOT NULL,
    message VARCHAR(512) NOT NULL,
    link VARCHAR(512),
    issue_id VARCHAR(36),
    wiki_page_id VARCHAR(36),
    is_read TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_page_watchers (
    page_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (page_id, user_id)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS work_logs (
    id VARCHAR(36) PRIMARY KEY,
    issue_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    minutes INT NOT NULL,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS project_statuses (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    \`key\` VARCHAR(50) NOT NULL,
    label VARCHAR(255) NOT NULL,
    category VARCHAR(20) DEFAULT 'in_progress' CHECK(category IN ('todo','in_progress','done')),
    position INT DEFAULT 0,
    UNIQUE(project_id, \`key\`)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wiki_page_restrictions (
    page_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    can_edit TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (page_id, user_id)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS automation_rules (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(40) NOT NULL,
    conditions TEXT NOT NULL,
    actions TEXT NOT NULL,
    enabled TINYINT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS versions (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'unreleased' CHECK(status IN ('unreleased','released')),
    release_date DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS components (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`
];

// ===== SQLite Init =====
async function initSqlite() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  SCHEMA_SQL.forEach(sql => db.run(sql));

  // CREATE TABLE IF NOT EXISTS won't add columns to an existing data.db — patch in place.
  // ALTER skips CHECK: existing DBs are covered by API validation in backend/routes/issues.js
  try { db.run("ALTER TABLE issues ADD COLUMN epic_color TEXT DEFAULT 'purple'"); } catch (e) { /* column already exists */ }
  try { db.run("ALTER TABLE issues ADD COLUMN fix_version_id TEXT"); } catch (e) { /* column already exists */ }
  try { db.run("ALTER TABLE issues ADD COLUMN component_id TEXT"); } catch (e) { /* column already exists */ }
  try { db.run("ALTER TABLE issues ADD COLUMN start_date TEXT"); } catch (e) { /* column already exists */ }
  try { db.run("ALTER TABLE projects ADD COLUMN wip_limits TEXT DEFAULT '{}'"); } catch (e) { /* column already exists */ }
  try { db.run("ALTER TABLE wiki_page_comments ADD COLUMN quote TEXT"); } catch (e) { /* column already exists */ }
  try { db.run("ALTER TABLE wiki_pages ADD COLUMN page_type TEXT DEFAULT 'page'"); } catch (e) { /* column already exists */ }

  saveDb();

  // Seed or create admin
  const users = db.exec("SELECT COUNT(*) as c FROM users");
  if (users[0].values[0][0] === 0) {
    if (config.seedDemoData) {
      seedDemoData();
    } else {
      seedAdminOnly();
    }
  }

  return db;
}

// ===== MySQL Init =====
async function initMysql() {
  const mysql = require('mysql2/promise');
  const { url, host, port, user, password, database } = config.db.mysql;

  // Ensure the target database exists, then connect to it.
  // dateStrings: return DATETIME as 'YYYY-MM-DD HH:MM:SS' strings (not JS Date),
  // matching SQLite's TEXT dates so route code that does string ops on dates
  // (e.g. updated_at.split('T')) works identically on both drivers.
  if (url) {
    const pool = mysql.createPool({ uri: url, charset: 'utf8mb4', dateStrings: true, multipleStatements: false });
    await initMysqlSchema(pool);
    db = createMysqlWrapper(pool);
    return db;
  }

  // Best-effort: create the database if missing. This is skipped silently when
  // the configured user lacks the global CREATE privilege (e.g. a scoped user
  // against a pre-provisioned DB, as in docker-compose) — the schema step below
  // still runs against the existing database.
  try {
    const bootstrap = await mysql.createConnection({ host, port, user, password, charset: 'utf8mb4' });
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await bootstrap.end();
  } catch (e) {
    console.warn(`  ⚠ Could not auto-create database "${database}" (${e.code || e.message}). Assuming it already exists.`);
  }

  const pool = mysql.createPool({ host, port, user, password, database, charset: 'utf8mb4', dateStrings: true, multipleStatements: false });
  await initMysqlSchema(pool);
  db = createMysqlWrapper(pool);
  return db;
}

async function initMysqlSchema(pool) {
  for (const sql of MYSQL_SCHEMA_SQL) {
    await pool.query(sql);
  }

  const [epicCol] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'issues' AND column_name = 'epic_color'"
  );
  if (epicCol.length === 0) {
    // ALTER skips CHECK: existing DBs are covered by API validation in backend/routes/issues.js
    await pool.query("ALTER TABLE issues ADD COLUMN epic_color VARCHAR(20) DEFAULT 'purple'");
  }

  for (const col of ['fix_version_id', 'component_id', 'start_date']) {
    const [hit] = await pool.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'issues' AND column_name = ?", [col]
    );
    if (hit.length === 0) {
      await pool.query(col === 'start_date'
        ? 'ALTER TABLE issues ADD COLUMN start_date DATETIME NULL'
        : `ALTER TABLE issues ADD COLUMN ${col} VARCHAR(36)`);
    }
  }

  const [quoteCol] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'wiki_page_comments' AND column_name = 'quote'"
  );
  if (quoteCol.length === 0) {
    await pool.query('ALTER TABLE wiki_page_comments ADD COLUMN quote TEXT');
  }

  const [ptCol] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'wiki_pages' AND column_name = 'page_type'"
  );
  if (ptCol.length === 0) {
    await pool.query("ALTER TABLE wiki_pages ADD COLUMN page_type VARCHAR(20) DEFAULT 'page'");
  }

  const [wipCol] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'wip_limits'"
  );
  if (wipCol.length === 0) {
    await pool.query('ALTER TABLE projects ADD COLUMN wip_limits VARCHAR(2000)');
  }

  const [rows] = await pool.query('SELECT COUNT(*) as c FROM users');
  if (parseInt(rows[0].c, 10) === 0) {
    if (config.seedDemoData) {
      await seedDemoDataMysql(pool);
    } else {
      await seedAdminOnlyMysql(pool);
    }
  }
}

// ===== MySQL Wrapper (makes mysql2 look like sql.js to routes) =====
// Routes only touch the db through queryAll/queryOne/run helpers, so the
// wrapper just needs to carry the pool + a driver flag.
function createMysqlWrapper(pool) {
  return {
    _pool: pool,
    _isMysql: true,
    exec: async (sql) => {
      const [rows, fields] = await pool.query(sql);
      return [{
        columns: (fields || []).map(f => f.name),
        values: Array.isArray(rows) ? rows.map(r => Object.values(r)) : [],
      }];
    },
    run: async (sql, params = []) => {
      await pool.query(translateForMysql(sql), params);
    },
  };
}

// ===== Seed: Admin Only (for real data) =====
function seedAdminOnly() {
  const { v4: uuid } = require('uuid');
  const adminId = uuid();

  db.run("INSERT INTO users (id, name, email, password, role, avatar_color, department, job_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [adminId, config.admin.name, config.admin.email, hashPasswordSync(config.admin.password), 'admin', '#0c66e4', 'Engineering', 'Administrator']);

  db.run("INSERT INTO user_settings (id, user_id) VALUES (?, ?)", [uuid(), adminId]);

  console.log(`\n  ✓ Admin account created:`);
  console.log(`    Email:    ${config.admin.email}`);
  console.log(`    Password: ${config.admin.password}`);
  console.log(`    → Login and create your projects, sprints, and issues from the UI\n`);

  saveDb();
}

async function seedAdminOnlyMysql(pool) {
  const { v4: uuid } = require('uuid');
  const adminId = uuid();

  await pool.query(
    "INSERT INTO users (id, name, email, password, role, avatar_color, department, job_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [adminId, config.admin.name, config.admin.email, hashPasswordSync(config.admin.password), 'admin', '#0c66e4', 'Engineering', 'Administrator']
  );
  await pool.query("INSERT INTO user_settings (id, user_id) VALUES (?, ?)", [uuid(), adminId]);

  console.log(`\n  ✓ Admin account created:`);
  console.log(`    Email:    ${config.admin.email}`);
  console.log(`    Password: ${config.admin.password}\n`);
}

// ===== Seed: Demo Data (existing dummy data) =====
function seedDemoData() {
  const { v4: uuid } = require('uuid');

  // Seed users with different roles
  const userIds = [uuid(), uuid(), uuid(), uuid(), uuid()];
  const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'];
  const names = ['Kunal Soni', 'Sarah Chen', 'Alex Rivera', 'Priya Patel', 'James Wilson'];
  const emails = ['kunal@example.com', 'sarah@example.com', 'alex@example.com', 'priya@example.com', 'james@example.com'];
  const roles = ['admin', 'board_admin', 'user', 'client', 'user'];

  const depts = ['Engineering', 'Engineering', 'Engineering', 'Product', 'Engineering'];
  const titles = ['CTO', 'Senior Engineer', 'Full Stack Dev', 'Product Manager', 'Junior Dev'];
  const phones = ['+1-555-0101', '+1-555-0102', '+1-555-0103', '+1-555-0104', '+1-555-0105'];
  const bios = [
    'Leading the tech team. Passionate about scalable systems.',
    'Backend specialist with 8+ years experience in distributed systems.',
    'Full-stack developer who loves React and Node.js.',
    'Product-focused professional bridging business and technology.',
    'Junior developer eager to learn and grow.'
  ];
  const tzs = ['Asia/Dubai', 'America/Los_Angeles', 'America/New_York', 'Asia/Kolkata', 'Europe/London'];

  // Demo accounts share the documented "password123" credential — stored hashed.
  const demoPassword = hashPasswordSync('password123');

  names.forEach((name, i) => {
    db.run("INSERT INTO users (id, name, email, password, role, avatar_color, phone, department, job_title, bio, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [userIds[i], name, emails[i], demoPassword, roles[i], colors[i], phones[i], depts[i], titles[i], bios[i], tzs[i]]);
    db.run("INSERT INTO user_settings (id, user_id) VALUES (?, ?)", [uuid(), userIds[i]]);
  });

  // Seed projects
  const projId1 = uuid();
  const projId2 = uuid();
  db.run("INSERT INTO projects (id, name, key, description, lead_id) VALUES (?, ?, ?, ?, ?)",
    [projId1, 'Atlas Platform', 'ATL', 'Main product platform', userIds[0]]);
  db.run("INSERT INTO projects (id, name, key, description, lead_id) VALUES (?, ?, ?, ?, ?)",
    [projId2, 'Mobile App', 'MOB', 'iOS and Android mobile application', userIds[1]]);

  // Seed project memberships
  [0, 1, 2, 3].forEach(i => {
    const prole = i === 0 ? 'lead' : 'member';
    db.run("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)",
      [uuid(), projId1, userIds[i], prole]);
  });
  [1, 2, 4].forEach(i => {
    const prole = i === 1 ? 'lead' : 'member';
    db.run("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)",
      [uuid(), projId2, userIds[i], prole]);
  });

  // Seed sprints
  const sprintId = uuid();
  db.run("INSERT INTO sprints (id, project_id, name, goal, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [sprintId, projId1, 'Sprint 12', 'Complete auth module and API refactor', 'active', '2026-04-06', '2026-04-20']);
  const sprintId2 = uuid();
  db.run("INSERT INTO sprints (id, project_id, name, goal, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [sprintId2, projId2, 'Sprint 5', 'Push notification system', 'active', '2026-04-06', '2026-04-20']);

  // Seed issues for Atlas Platform
  const issueData = [
    { title: 'Implement OAuth2 login flow', type: 'story', status: 'in_progress', priority: 'high', points: 8, assignee: 0 },
    { title: 'Fix memory leak in WebSocket handler', type: 'bug', status: 'in_review', priority: 'highest', points: 5, assignee: 1 },
    { title: 'Add rate limiting to public API', type: 'task', status: 'todo', priority: 'high', points: 3, assignee: 2 },
    { title: 'Design new dashboard layout', type: 'story', status: 'done', priority: 'medium', points: 5, assignee: 1 },
    { title: 'Update API documentation', type: 'task', status: 'todo', priority: 'low', points: 2, assignee: 0 },
    { title: 'Database migration for user roles', type: 'task', status: 'in_progress', priority: 'high', points: 5, assignee: 2 },
    { title: 'Refactor notification service', type: 'story', status: 'todo', priority: 'medium', points: 8, assignee: null },
    { title: 'Add E2E tests for checkout flow', type: 'task', status: 'todo', priority: 'medium', points: 5, assignee: 1 },
    { title: 'Performance audit on search queries', type: 'task', status: 'in_progress', priority: 'high', points: 3, assignee: 0 },
    { title: 'Fix CORS issues in staging', type: 'bug', status: 'done', priority: 'high', points: 2, assignee: 2 },
  ];

  const atlIssueIds = [];
  issueData.forEach((issue, i) => {
    const iid = uuid();
    atlIssueIds.push(iid);
    db.run(`INSERT INTO issues (id, project_id, sprint_id, issue_key, issue_number, title, type, status, priority, story_points, assignee_id, reporter_id, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [iid, projId1, sprintId, `ATL-${i + 1}`, i + 1, issue.title, issue.type, issue.status, issue.priority, issue.points,
       issue.assignee !== null ? userIds[issue.assignee] : null, userIds[0], i]);
  });

  // Demo subtasks: ATL-1 (OAuth2 story, in the active sprint) and ATL-7 (notification
  // refactor). Subtasks carry no sprint_id — they follow their parent implicitly.
  const atlSubtasks = [
    { parent: 0, title: 'Add PKCE support to the authorization flow', status: 'done', assignee: 0 },
    { parent: 0, title: 'Refresh-token rotation and revocation', status: 'in_progress', assignee: 1 },
    { parent: 0, title: 'Provider buttons on the sign-in screen', status: 'todo', assignee: null },
    { parent: 6, title: 'Extract notification templates into their own module', status: 'todo', assignee: 2 },
  ];
  atlSubtasks.forEach((s, i) => {
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, assignee_id, reporter_id, parent_id, board_order)
      VALUES (?, ?, ?, ?, ?, 'subtask', ?, 'medium', ?, ?, ?, ?)`,
      [uuid(), projId1, `ATL-${11 + i}`, 11 + i, s.title, s.status,
       s.assignee !== null ? userIds[s.assignee] : null, userIds[0], atlIssueIds[s.parent], i]);
  });

  // Seed issues for Mobile App
  const mobIssues = [
    { title: 'Set up push notification service', type: 'story', status: 'in_progress', priority: 'high', points: 8, assignee: 1 },
    { title: 'Fix crash on Android 14', type: 'bug', status: 'todo', priority: 'highest', points: 3, assignee: 2 },
    { title: 'Implement deep linking', type: 'task', status: 'todo', priority: 'medium', points: 5, assignee: 4 },
  ];

  mobIssues.forEach((issue, i) => {
    db.run(`INSERT INTO issues (id, project_id, sprint_id, issue_key, issue_number, title, type, status, priority, story_points, assignee_id, reporter_id, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), projId2, sprintId2, `MOB-${i + 1}`, i + 1, issue.title, issue.type, issue.status, issue.priority, issue.points,
       issue.assignee !== null ? userIds[issue.assignee] : null, userIds[1], i]);
  });

  // ===== DOGFOOD: Atlas tracks its own Jira/Confluence parity roadmap =====
  const projId3 = uuid();
  db.run("INSERT INTO projects (id, name, key, description, lead_id) VALUES (?, ?, ?, ?, ?)",
    [projId3, 'Atlas Development', 'ATLAS', 'Atlas building Atlas — the Jira/Confluence parity roadmap, tracked as epics', userIds[0]]);
  [0, 1, 2].forEach(i => {
    db.run("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)",
      [uuid(), projId3, userIds[i], i === 0 ? 'lead' : 'member']);
  });

  const roadmapEpics = [
    { title: 'Epic support', status: 'done', color: 'purple',
      desc: 'Add epic as a first-class issue type: hierarchy via parent_id, Epics screen with progress rollups, epic badges on board and backlog, epic picker in the issue detail sheet.' },
    { title: 'Subtasks', status: 'done', color: 'blue',
      desc: 'Child issues under stories, tasks, and bugs using the same parent_id column, with progress rollup on the parent issue.' },
    { title: 'Global search & filters', status: 'done', color: 'teal',
      desc: 'Quick search across issues and wiki pages, JQL-lite filter bar (assignee, type, label, status), and saved filters.' },
    { title: 'Notifications & @mentions', status: 'done', color: 'yellow',
      desc: 'In-app notification inbox, @mentions in comments, wiki page watching — wiring up the existing notification settings toggles.' },
    { title: 'Time tracking', status: 'done', color: 'orange',
      desc: 'Original estimates, work logs, and remaining-time display on issues, building on the original_estimate and time_spent columns.' },
    { title: 'Releases & components', status: 'done', color: 'red',
      desc: 'Fix versions and components on issues, plus a release hub screen with per-version progress.' },
    { title: 'Roadmap / timeline', status: 'done', color: 'pink',
      desc: 'Gantt-style timeline view of epics and sprints across time.' },
    { title: 'Board power-ups', status: 'done', color: 'green',
      desc: 'Swimlanes (by assignee/epic), per-column WIP limits, and multi-select bulk edit on the board.' },
    { title: 'Custom workflows', status: 'done', color: 'purple',
      desc: 'Configurable statuses and board columns per project instead of the fixed four-status workflow.' },
    { title: 'Automation rules', status: 'done', color: 'blue',
      desc: 'Trigger → condition → action rules, e.g. "when all subtasks done, move parent to done".' },
    { title: 'Wiki: collaboration', status: 'done', color: 'teal',
      desc: 'Inline comments on wiki page text and page-level restrictions/permissions.' },
    { title: 'Wiki: publishing', status: 'done', color: 'orange',
      desc: 'Page export (PDF/Markdown), macros (table of contents, status badges, issue embeds), and blog posts per space.' },
  ];

  const atlasEpicIds = [];
  // Staggered month-long windows from 2026-07-01 so the Roadmap timeline has shape.
  const epicWindow = (i) => {
    const start = new Date(Date.UTC(2026, 6, 1) + i * 21 * 86400000);
    const due = new Date(start.getTime() + 30 * 86400000);
    return [start.toISOString().slice(0, 10), due.toISOString().slice(0, 10)];
  };
  roadmapEpics.forEach((epic, i) => {
    const eid = uuid();
    atlasEpicIds.push(eid);
    const [startDate, dueDate] = epicWindow(i);
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type, status, priority, reporter_id, epic_color, start_date, due_date, board_order)
      VALUES (?, ?, ?, ?, ?, ?, 'epic', ?, 'high', ?, ?, ?, ?, ?)`,
      [eid, projId3, `ATLAS-${i + 1}`, i + 1, epic.title, epic.desc, epic.status, userIds[0], epic.color, startDate, dueDate, i]);
  });

  // Epic 2 (Subtasks) shipped — its actual work, tracked as done children.
  const subtasksEpicChildren = [
    { title: 'Generalize hierarchy validation to subtask parents', type: 'task' },
    { title: 'Parent join fields and subtask rollup counts in the issues API', type: 'task' },
    { title: 'Subtasks section with quick-add in the issue detail sheet', type: 'story' },
    { title: 'Subtask progress chips on board cards and backlog rows', type: 'story' },
    { title: 'Backend test suite for subtask hierarchy rules', type: 'task' },
  ];
  subtasksEpicChildren.forEach((c, i) => {
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, assignee_id, reporter_id, parent_id, board_order)
      VALUES (?, ?, ?, ?, ?, ?, 'done', 'high', ?, ?, ?, ?)`,
      [uuid(), projId3, `ATLAS-${13 + i}`, 13 + i, c.title, c.type, userIds[0], userIds[0], atlasEpicIds[1], i]);
  });

  // Wave epics (3-12): each shipped epic gets done children describing its real work.
  // `epic` is the 0-based index into atlasEpicIds; numbering continues after ATLAS-17.
  const waveChildren = [
    { epic: 2, items: [
      { title: 'Global /api/search across issues and wiki pages', type: 'task' },
      { title: 'Command palette server search with cross-project jump', type: 'story' },
      { title: 'Backlog filter bar: type, assignee, label + saved filters', type: 'story' },
    ] },
    { epic: 3, items: [
      { title: 'Notifications table, API, and header bell inbox', type: 'story' },
      { title: 'Assignment, watcher-comment, and @mention triggers', type: 'task' },
      { title: 'Wiki page watching with update notifications', type: 'task' },
    ] },
    { epic: 4, items: [
      { title: 'Work logs table and API with time_spent rollup', type: 'task' },
      { title: 'Time tracking panel: estimate, log work, remaining bar', type: 'story' },
    ] },
    { epic: 5, items: [
      { title: 'Versions and components tables with issue rollups', type: 'task' },
      { title: 'Releases hub screen with per-version progress', type: 'story' },
      { title: 'Fix version and component pickers on issues', type: 'task' },
    ] },
    { epic: 6, items: [
      { title: 'Epic start/due date windows on issues', type: 'task' },
      { title: 'Roadmap screen: month grid, epic and sprint bars, today line', type: 'story' },
    ] },
    { epic: 7, items: [
      { title: 'Swimlanes by assignee and epic', type: 'story' },
      { title: 'Per-column WIP limits with over-limit warning', type: 'task' },
      { title: 'Multi-select bulk edit bar: status, assignee, delete', type: 'story' },
    ] },
    { epic: 8, items: [
      { title: 'Per-project status table with categories and positions', type: 'task' },
      { title: 'Workflow editor: add, rename category, reorder, delete with migration', type: 'story' },
      { title: 'Board, backlog, and issue sheet render dynamic statuses', type: 'story' },
    ] },
    { epic: 9, items: [
      { title: 'Automation rules table and trigger engine', type: 'task' },
      { title: 'Rule builder screen: trigger, condition, action', type: 'story' },
      { title: 'All-subtasks-done trigger wired to issue lifecycle', type: 'task' },
    ] },
    { epic: 10, items: [
      { title: 'Comment-on-selection quotes in wiki comments', type: 'story' },
      { title: 'Page restrictions: per-user view/edit with API enforcement', type: 'story' },
    ] },
    { epic: 11, items: [
      { title: 'Markdown and HTML export with print-to-PDF', type: 'task' },
      { title: 'Wiki macros: table of contents and issue-key chips', type: 'story' },
      { title: 'Blog posts per space, kept out of the page tree', type: 'story' },
    ] },
  ];
  let atlasIssueNumber = 18;
  waveChildren.forEach((w) => {
    w.items.forEach((c, i) => {
      db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, assignee_id, reporter_id, parent_id, board_order)
        VALUES (?, ?, ?, ?, ?, ?, 'done', 'high', ?, ?, ?, ?)`,
        [uuid(), projId3, `ATLAS-${atlasIssueNumber}`, atlasIssueNumber, c.title, c.type, userIds[0], userIds[0], atlasEpicIds[w.epic], i]);
      atlasIssueNumber += 1;
    });
  });

  // ===== CONFLUENCE SEED DATA =====
  const spaceEng = uuid();
  const spaceProd = uuid();
  db.run("INSERT INTO wiki_spaces (id, space_key, name, description, icon, color, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [spaceEng, 'ENG', 'Engineering', 'Engineering team documentation, architecture decisions, and runbooks', '⚙️', '#0c66e4', userIds[0]]);
  db.run("INSERT INTO wiki_spaces (id, space_key, name, description, icon, color, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [spaceProd, 'PROD', 'Product', 'Product requirements, specs, and roadmap documentation', '🚀', '#6554c0', userIds[3]]);

  // Templates
  const tmplIds = [uuid(), uuid(), uuid(), uuid()];
  [
    [tmplIds[0], null, 'Blank Page', 'Start from scratch', '', '📄', 1],
    [tmplIds[1], null, 'Meeting Notes', 'Capture meeting discussions and action items', '<h2>📅 Meeting Details</h2><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;width:120px">Date</td><td style="padding:8px;border:1px solid #ddd">[Date]</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Attendees</td><td style="padding:8px;border:1px solid #ddd">[List attendees]</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Facilitator</td><td style="padding:8px;border:1px solid #ddd">[Name]</td></tr></table><h2>📋 Agenda</h2><ol><li>Topic 1</li><li>Topic 2</li><li>Topic 3</li></ol><h2>📝 Notes</h2><p>Key discussion points...</p><h2>✅ Action Items</h2><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left">Action</th><th style="padding:8px;border:1px solid #ddd;text-align:left;width:120px">Owner</th><th style="padding:8px;border:1px solid #ddd;text-align:left;width:120px">Due Date</th></tr><tr><td style="padding:8px;border:1px solid #ddd">Action item 1</td><td style="padding:8px;border:1px solid #ddd">@name</td><td style="padding:8px;border:1px solid #ddd">[Date]</td></tr></table><h2>🔜 Next Meeting</h2><p>[Date and time of next meeting]</p>', '📅', 1],
    [tmplIds[2], null, 'Decision Record', 'Document an architecture or technical decision', '<h1>Decision Record</h1><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;width:120px">Status</td><td style="padding:8px;border:1px solid #ddd"><span style="background:#e3fcef;color:#006644;padding:2px 8px;border-radius:3px;font-weight:600">PROPOSED</span></td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Decision</td><td style="padding:8px;border:1px solid #ddd">[Brief description]</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Date</td><td style="padding:8px;border:1px solid #ddd">[Date]</td></tr></table><h2>Context</h2><p>What is the issue that we are seeing that is motivating this decision?</p><h2>Options Considered</h2><h3>Option A: [Name]</h3><p><strong>Pros:</strong></p><ul><li>Pro 1</li></ul><p><strong>Cons:</strong></p><ul><li>Con 1</li></ul><h3>Option B: [Name]</h3><p><strong>Pros:</strong></p><ul><li>Pro 1</li></ul><p><strong>Cons:</strong></p><ul><li>Con 1</li></ul><h2>Decision</h2><p>We will go with Option [X] because...</p><h2>Consequences</h2><p>What becomes easier or more difficult as a result of this decision?</p>', '⚖️', 1],
    [tmplIds[3], null, 'Retrospective', 'Sprint retrospective template', '<h1>Sprint Retrospective</h1><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;width:120px">Sprint</td><td style="padding:8px;border:1px solid #ddd">[Sprint name]</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Date</td><td style="padding:8px;border:1px solid #ddd">[Date]</td></tr></table><h2>😊 What Went Well</h2><ul><li>Item 1</li><li>Item 2</li></ul><h2>😐 What Could Be Improved</h2><ul><li>Item 1</li><li>Item 2</li></ul><h2>🤔 Questions / Puzzles</h2><ul><li>Question 1</li></ul><h2>🎯 Action Items</h2><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left">Action</th><th style="padding:8px;border:1px solid #ddd;text-align:left;width:120px">Owner</th><th style="padding:8px;border:1px solid #ddd;text-align:left;width:120px">Priority</th></tr><tr><td style="padding:8px;border:1px solid #ddd">Action 1</td><td style="padding:8px;border:1px solid #ddd">@name</td><td style="padding:8px;border:1px solid #ddd">High</td></tr></table>', '🔄', 1],
  ].forEach(t => {
    db.run("INSERT INTO wiki_templates (id, space_id, name, description, body, icon, is_global) VALUES (?, ?, ?, ?, ?, ?, ?)", t);
  });

  // Pages for Engineering space
  const pageIds = { arch: uuid(), setup: uuid(), api: uuid(), runbook: uuid(), onboard: uuid() };
  const engPages = [
    [pageIds.arch, spaceEng, null, 'Architecture Overview', 'architecture-overview',
      '<h1>Architecture Overview</h1><p>Atlas is built as a modern full-stack application with a clear separation of concerns.</p><h2>System Architecture</h2><p>The system follows a classic three-tier architecture: presentation layer (React SPA), application layer (Node.js + Express), and data layer (SQLite / MySQL).</p><h2>Key Components</h2><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:10px;border:1px solid #ddd;text-align:left">Component</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Technology</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Purpose</th></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Frontend</strong></td><td style="padding:10px;border:1px solid #ddd">React 18 + TypeScript + Vite</td><td style="padding:10px;border:1px solid #ddd">Single-page application built with Tailwind CSS and shadcn/ui</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Backend</strong></td><td style="padding:10px;border:1px solid #ddd">Express 5</td><td style="padding:10px;border:1px solid #ddd">REST API with modular route files</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Database</strong></td><td style="padding:10px;border:1px solid #ddd">sql.js / MySQL</td><td style="padding:10px;border:1px solid #ddd">Data persistence with migration support</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Auth</strong></td><td style="padding:10px;border:1px solid #ddd">Session tokens</td><td style="padding:10px;border:1px solid #ddd">x-auth-token session auth, scrypt-hashed passwords, RBAC</td></tr></table><h2>Data Flow</h2><p>All API requests flow through the auth middleware which validates session tokens and attaches user context. Route modules handle business logic and database operations through shared helper functions.</p><div style="background:#deebff;padding:16px;border-radius:4px;border-left:4px solid #0c66e4;margin:16px 0"><strong>ℹ️ Note:</strong> The frontend uses Babel standalone for JSX transformation, which means no build step is required during development.</div>',
      'html', 'current', 0, userIds[0], userIds[0], 1, 12],
    [pageIds.setup, spaceEng, null, 'Development Setup', 'development-setup',
      '<h1>Development Setup</h1><p>Get your local development environment running in minutes.</p><h2>Prerequisites</h2><ul><li>Node.js 18+ installed</li><li>Git</li><li>A code editor (VS Code recommended)</li></ul><h2>Quick Start</h2><div style="background:#f4f5f7;padding:16px;border-radius:4px;font-family:monospace;font-size:13px;margin:12px 0"><code>git clone https://github.com/KunalDSoni/Atlas.git<br>cd Atlas/backend<br>npm install<br>node server.js</code></div><p>Open <a href="http://localhost:3001">http://localhost:3001</a> in your browser.</p><h2>Environment Configuration</h2><p>Copy <code>.env.example</code> to <code>.env</code> and configure:</p><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left">Variable</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Default</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Description</th></tr><tr><td style="padding:8px;border:1px solid #ddd"><code>SEED_DEMO_DATA</code></td><td style="padding:8px;border:1px solid #ddd">true</td><td style="padding:8px;border:1px solid #ddd">Populate demo data on fresh DB</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><code>DB_DRIVER</code></td><td style="padding:8px;border:1px solid #ddd">sqlite</td><td style="padding:8px;border:1px solid #ddd">sqlite or mysql</td></tr></table><div style="background:#fffae6;padding:16px;border-radius:4px;border-left:4px solid #ff991f;margin:16px 0"><strong>⚠️ Warning:</strong> Delete <code>data.db</code> and restart if you change the schema — <code>CREATE TABLE IF NOT EXISTS</code> won\'t add new columns.</div>',
      'html', 'current', 1, userIds[0], userIds[1], 2, 8],
    [pageIds.api, spaceEng, pageIds.arch, 'API Reference', 'api-reference',
      '<h1>API Reference</h1><p>Complete REST API documentation for the Atlas backend.</p><h2>Authentication</h2><p>All API requests (except login) authenticate with the session token returned by <code>/api/auth/login</code>:</p><div style="background:#f4f5f7;padding:16px;border-radius:4px;font-family:monospace;font-size:13px;margin:12px 0"><code>x-auth-token: [session token]</code></div><div style="background:#ffebe6;padding:16px;border-radius:4px;border-left:4px solid #de350b;margin:16px 0"><strong>Note:</strong> identity is taken from the session token only. <code>x-user-id</code> and <code>x-user-role</code> are ignored — sending them grants no access.</div><h2>Endpoints</h2><h3>Auth</h3><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left;width:100px">Method</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Path</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Description</th></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#e3fcef;color:#006644;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">POST</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/auth/login</code></td><td style="padding:8px;border:1px solid #ddd">Login with email/password</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#deebff;color:#0747a6;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">GET</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/auth/me</code></td><td style="padding:8px;border:1px solid #ddd">Get current user</td></tr></table><h3>Issues</h3><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left;width:100px">Method</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Path</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Description</th></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#deebff;color:#0747a6;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">GET</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/projects/:id/issues</code></td><td style="padding:8px;border:1px solid #ddd">List project issues</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#e3fcef;color:#006644;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">POST</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/projects/:id/issues</code></td><td style="padding:8px;border:1px solid #ddd">Create issue</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#fffae6;color:#974f0c;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">PUT</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/issues/:id</code></td><td style="padding:8px;border:1px solid #ddd">Update issue</td></tr></table>',
      'html', 'current', 0, userIds[1], userIds[1], 1, 15],
    [pageIds.runbook, spaceEng, null, 'Incident Runbook', 'incident-runbook',
      '<h1>Incident Runbook</h1><div style="background:#ffebe6;padding:16px;border-radius:4px;border-left:4px solid #de350b;margin:16px 0"><strong>🚨 Critical:</strong> Follow these steps during any production incident. Do not skip steps.</div><h2>Severity Levels</h2><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:10px;border:1px solid #ddd;text-align:left">Level</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Impact</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Response Time</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Example</th></tr><tr><td style="padding:10px;border:1px solid #ddd"><span style="background:#de350b;color:white;padding:2px 8px;border-radius:3px;font-weight:700">SEV-1</span></td><td style="padding:10px;border:1px solid #ddd">Complete outage</td><td style="padding:10px;border:1px solid #ddd">15 minutes</td><td style="padding:10px;border:1px solid #ddd">Site down, data loss</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><span style="background:#ff5630;color:white;padding:2px 8px;border-radius:3px;font-weight:700">SEV-2</span></td><td style="padding:10px;border:1px solid #ddd">Major degradation</td><td style="padding:10px;border:1px solid #ddd">30 minutes</td><td style="padding:10px;border:1px solid #ddd">Login broken, slow responses</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><span style="background:#ff991f;color:white;padding:2px 8px;border-radius:3px;font-weight:700">SEV-3</span></td><td style="padding:10px;border:1px solid #ddd">Minor impact</td><td style="padding:10px;border:1px solid #ddd">2 hours</td><td style="padding:10px;border:1px solid #ddd">UI bug, non-critical feature</td></tr></table><h2>Step-by-Step Response</h2><ol><li><strong>Acknowledge:</strong> Claim the incident in the team channel</li><li><strong>Assess:</strong> Determine severity and affected systems</li><li><strong>Communicate:</strong> Post status update within 10 minutes</li><li><strong>Mitigate:</strong> Apply immediate fix or rollback</li><li><strong>Resolve:</strong> Confirm services are restored</li><li><strong>Postmortem:</strong> Write blameless postmortem within 48 hours</li></ol>',
      'html', 'current', 2, userIds[0], userIds[0], 1, 6],
    [pageIds.onboard, spaceEng, null, 'Onboarding Guide', 'onboarding-guide',
      '<h1>New Developer Onboarding</h1><p>Welcome to the Atlas team! This guide will help you get up to speed.</p><h2>Week 1: Setup & Orientation</h2><ul><li>☐ Get access to GitHub, Slack, and email</li><li>☐ Clone the repo and set up local dev environment (<a href="#">Dev Setup</a>)</li><li>☐ Read the Architecture Overview</li><li>☐ Meet with your buddy/mentor</li><li>☐ Complete first "good first issue" ticket</li></ul><h2>Week 2: Deep Dive</h2><ul><li>☐ Read the API Reference</li><li>☐ Attend a sprint planning session</li><li>☐ Shadow a code review</li><li>☐ Complete your first PR</li></ul><h2>Week 3-4: Contributing</h2><ul><li>☐ Pick up a medium-complexity ticket</li><li>☐ Participate in retrospective</li><li>☐ Set up your on-call access</li><li>☐ Read the Incident Runbook</li></ul><h2>Key Contacts</h2><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left">Role</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Person</th></tr><tr><td style="padding:8px;border:1px solid #ddd">Tech Lead</td><td style="padding:8px;border:1px solid #ddd">Kunal Soni</td></tr><tr><td style="padding:8px;border:1px solid #ddd">Backend Lead</td><td style="padding:8px;border:1px solid #ddd">Sarah Chen</td></tr><tr><td style="padding:8px;border:1px solid #ddd">PM</td><td style="padding:8px;border:1px solid #ddd">Priya Patel</td></tr></table>',
      'html', 'current', 3, userIds[0], userIds[0], 1, 20],
  ];
  engPages.forEach(p => {
    db.run("INSERT INTO wiki_pages (id, space_id, parent_id, title, slug, body, body_format, status, position, author_id, last_editor_id, version, view_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", p);
    // Save initial version
    db.run("INSERT INTO wiki_page_versions (id, page_id, version, title, body, editor_id, change_message) VALUES (?, ?, 1, ?, ?, ?, 'Initial version')",
      [uuid(), p[0], p[3], p[5], p[9]]);
  });

  // Some labels
  db.run("INSERT INTO wiki_labels (id, page_id, label) VALUES (?, ?, ?)", [uuid(), pageIds.arch, 'architecture']);
  db.run("INSERT INTO wiki_labels (id, page_id, label) VALUES (?, ?, ?)", [uuid(), pageIds.arch, 'overview']);
  db.run("INSERT INTO wiki_labels (id, page_id, label) VALUES (?, ?, ?)", [uuid(), pageIds.api, 'api']);
  db.run("INSERT INTO wiki_labels (id, page_id, label) VALUES (?, ?, ?)", [uuid(), pageIds.api, 'reference']);
  db.run("INSERT INTO wiki_labels (id, page_id, label) VALUES (?, ?, ?)", [uuid(), pageIds.runbook, 'runbook']);
  db.run("INSERT INTO wiki_labels (id, page_id, label) VALUES (?, ?, ?)", [uuid(), pageIds.runbook, 'incident']);
  db.run("INSERT INTO wiki_labels (id, page_id, label) VALUES (?, ?, ?)", [uuid(), pageIds.onboard, 'onboarding']);

  // Product space pages
  const prodPageIds = { roadmap: uuid(), prd: uuid() };
  db.run("INSERT INTO wiki_pages (id, space_id, parent_id, title, slug, body, body_format, status, position, author_id, last_editor_id, version, view_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [prodPageIds.roadmap, spaceProd, null, 'Product Roadmap Q2 2026', 'product-roadmap-q2-2026',
      '<h1>Product Roadmap — Q2 2026</h1><h2>Vision</h2><p>Make Atlas the go-to project management tool for fast-moving engineering teams.</p><h2>Themes</h2><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:10px;border:1px solid #ddd;text-align:left">Theme</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Priority</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Target</th></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Confluence Integration</strong></td><td style="padding:10px;border:1px solid #ddd"><span style="background:#de350b;color:white;padding:2px 8px;border-radius:3px">P0</span></td><td style="padding:10px;border:1px solid #ddd">April 2026</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Advanced Reporting</strong></td><td style="padding:10px;border:1px solid #ddd"><span style="background:#ff5630;color:white;padding:2px 8px;border-radius:3px">P1</span></td><td style="padding:10px;border:1px solid #ddd">April 2026</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Workflow Automation</strong></td><td style="padding:10px;border:1px solid #ddd"><span style="background:#ff991f;color:white;padding:2px 8px;border-radius:3px">P2</span></td><td style="padding:10px;border:1px solid #ddd">May 2026</td></tr></table>',
      'html', 'current', 0, userIds[3], userIds[3], 1, 25]);
  db.run("INSERT INTO wiki_page_versions (id, page_id, version, title, body, editor_id, change_message) VALUES (?, ?, 1, ?, ?, ?, 'Initial version')",
    [uuid(), prodPageIds.roadmap, 'Product Roadmap Q2 2026', '', userIds[3]]);

  db.run("INSERT INTO wiki_pages (id, space_id, parent_id, title, slug, body, body_format, status, position, author_id, last_editor_id, version, view_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [prodPageIds.prd, spaceProd, null, 'Atlas PRD — Core Features', 'atlas-prd-core-features',
      '<h1>Atlas PRD — Core Features</h1><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;width:120px">Author</td><td style="padding:8px;border:1px solid #ddd">Priya Patel</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Status</td><td style="padding:8px;border:1px solid #ddd"><span style="background:#e3fcef;color:#006644;padding:2px 8px;border-radius:3px;font-weight:600">APPROVED</span></td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Last Updated</td><td style="padding:8px;border:1px solid #ddd">April 8, 2026</td></tr></table><h2>Problem Statement</h2><p>Engineering teams need a lightweight, self-hosted alternative to Jira that they can customize and deploy instantly.</p><h2>User Stories</h2><ul><li>As a developer, I want to create and drag issues on a kanban board so I can track my work visually.</li><li>As a PM, I want to see dashboards and reports so I can make data-driven decisions.</li><li>As a team lead, I want role-based access so I can control who can modify what.</li></ul>',
      'html', 'current', 1, userIds[3], userIds[3], 1, 18]);
  db.run("INSERT INTO wiki_page_versions (id, page_id, version, title, body, editor_id, change_message) VALUES (?, ?, 1, ?, ?, ?, 'Initial version')",
    [uuid(), prodPageIds.prd, 'Atlas PRD — Core Features', '', userIds[3]]);

  saveDb();
  console.log('\n  ✓ Demo data seeded (5 users, 3 projects, 25 issues incl. 12 roadmap epics, 2 wiki spaces, 7 pages)\n');
}

async function seedDemoDataMysql(pool) {
  // MySQL demo seed is minimal — production users add real data via the UI,
  // or migrate an existing SQLite DB with scripts/export-to-mysql.js.
  const { v4: uuid } = require('uuid');
  const adminId = uuid();
  await pool.query(
    "INSERT INTO users (id, name, email, password, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)",
    [adminId, config.admin.name, config.admin.email, hashPasswordSync(config.admin.password), 'admin', '#0c66e4']
  );
  await pool.query("INSERT INTO user_settings (id, user_id) VALUES (?, ?)", [uuid(), adminId]);
  console.log('\n  ✓ Admin account created for MySQL\n');
}

// ===== Save (SQLite only) =====
function saveDb() {
  if (db && !db._isMysql) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Translate SQLite-specific syntax in route SQL to MySQL equivalents.
// Lets route code use the SQLite dialect and run correctly on MySQL too.
// Note: mysql2 uses `?` placeholders (same as sql.js), so those are left alone.
function translateForMysql(sql) {
  return sql
    // datetime('now', '+N days')  →  (NOW() + INTERVAL N DAY)
    .replace(/datetime\(\s*'now'\s*,\s*'\+(\d+)\s*days?'\s*\)/gi, '(NOW() + INTERVAL $1 DAY)')
    // datetime('now')  →  NOW()
    .replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()')
    // julianday(a) - julianday(b)  →  (TIMESTAMPDIFF(SECOND, b, a) / 86400)
    .replace(/julianday\(([^)]+)\)\s*-\s*julianday\(([^)]+)\)/gi,
             '(TIMESTAMPDIFF(SECOND, $2, $1) / 86400)')
    // `key` is a MySQL reserved word — backtick the standalone column token
    // (won't match issue_key / space_key thanks to the \w lookarounds).
    .replace(/(?<![\w.`])key(?![\w`])/gi, '`key`');
}

// ===== Query Helpers =====
// All helpers are async so route code can `await` them uniformly.
// SQLite path (sql.js) is truly synchronous internally — the async
// wrapper is just there to give pg and sqlite the same call shape.
async function queryAll(database, sql, params = []) {
  if (database._isMysql) {
    const [rows] = await database._pool.query(translateForMysql(sql), params);
    return rows;
  }
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

async function queryOne(database, sql, params = []) {
  if (database._isMysql) {
    const [rows] = await database._pool.query(translateForMysql(sql), params);
    return rows[0] || null;
  }
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

async function run(database, sql, params = []) {
  if (database._isMysql) {
    await database._pool.query(translateForMysql(sql), params);
    return;
  }
  database.run(sql, params);
  saveDb();
}

// ===== Main Init =====
async function getDb() {
  if (db) return db;

  if (config.db.driver === 'mysql') {
    return initMysql();
  } else {
    return initSqlite();
  }
}

async function initDb() {
  return getDb();
}

module.exports = { getDb, saveDb, initDb, queryAll, queryOne, run, translateForMysql, MYSQL_SCHEMA_SQL };
