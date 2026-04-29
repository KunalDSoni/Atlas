// ===== ATLAS — Database Layer =====
// Supports: SQLite (dev) and PostgreSQL (production)
// Controlled by DB_DRIVER in .env

const path = require('path');
const fs = require('fs');
const config = require('./config');

const DB_PATH = config.db.sqlitePath;
let db;

// ===== SCHEMA (shared across drivers) =====
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT DEFAULT 'password123',
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
    status TEXT DEFAULT 'todo' CHECK(status IN ('todo','in_progress','in_review','done')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('highest','high','medium','low','lowest')),
    assignee_id TEXT REFERENCES users(id),
    reporter_id TEXT REFERENCES users(id),
    parent_id TEXT REFERENCES issues(id),
    story_points INTEGER,
    labels TEXT DEFAULT '[]',
    due_date TEXT,
    original_estimate TEXT,
    time_spent TEXT,
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
  )`
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

// ===== PostgreSQL Init =====
async function initPostgres() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.db.postgresUrl });

  // Convert SQLite schema to Postgres-compatible.
  // Note: boolean-like INTEGER columns (is_active, notify_*, etc.) stay as
  // INTEGER in Postgres — route code uses `= 1` / `= 0` literals, which
  // work natively against integer columns but would fail against booleans.
  // Date-like TEXT columns are upgraded to TIMESTAMPTZ so route SQL like
  // `UPDATE users SET last_login = NOW()` doesn't hit a type mismatch.
  const dateColumns = ['last_login', 'expires_at', 'start_date', 'end_date',
                       'due_date', 'added_at', 'created_at', 'updated_at'];
  const pgSchema = SCHEMA_SQL.map(sql => {
    let out = sql
      .replace(/TEXT DEFAULT \(datetime\('now'\)\)/g, "TIMESTAMPTZ DEFAULT NOW()")
      .replace(/datetime\('now'\)/g, "NOW()")
      .replace(/datetime\('now', '\+(\d+) days'\)/g, "NOW() + INTERVAL '$1 days'");
    for (const col of dateColumns) {
      out = out.replace(new RegExp(`\\b${col}\\s+TEXT\\b`, 'g'), `${col} TIMESTAMPTZ`);
    }
    return out;
  });

  for (const sql of pgSchema) {
    await pool.query(sql);
  }

  // Check if users exist
  const { rows } = await pool.query("SELECT COUNT(*) as c FROM users");
  if (parseInt(rows[0].c) === 0) {
    if (config.seedDemoData) {
      await seedDemoDataPg(pool);
    } else {
      await seedAdminOnlyPg(pool);
    }
  }

  // Return a db-like wrapper so route files work with both drivers
  db = createPgWrapper(pool);
  return db;
}

// ===== Pg Wrapper (makes pg look like sql.js to routes) =====
function createPgWrapper(pool) {
  return {
    _pool: pool,
    _isPg: true,
    exec: async (sql) => {
      const res = await pool.query(sql);
      return [{ columns: res.fields.map(f => f.name), values: res.rows.map(r => Object.values(r)) }];
    },
    prepare: (sql) => {
      // Convert ? placeholders to $1, $2, ... for pg
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      return {
        _sql: pgSql,
        _params: [],
        _results: null,
        _cursor: 0,
        bind(params) { this._params = params; },
        async step() {
          if (!this._results) {
            const res = await pool.query(this._sql, this._params);
            this._results = res.rows;
            this._cursor = 0;
          }
          return this._cursor < this._results.length;
        },
        getAsObject() {
          return this._results[this._cursor++];
        },
        free() { this._results = null; }
      };
    },
    run: async (sql, params = []) => {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      await pool.query(pgSql, params);
    }
  };
}

// ===== Seed: Admin Only (for real data) =====
function seedAdminOnly() {
  const { v4: uuid } = require('uuid');
  const adminId = uuid();

  db.run("INSERT INTO users (id, name, email, password, role, avatar_color, department, job_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [adminId, config.admin.name, config.admin.email, config.admin.password, 'admin', '#0c66e4', 'Engineering', 'Administrator']);

  db.run("INSERT INTO user_settings (id, user_id) VALUES (?, ?)", [uuid(), adminId]);

  console.log(`\n  ✓ Admin account created:`);
  console.log(`    Email:    ${config.admin.email}`);
  console.log(`    Password: ${config.admin.password}`);
  console.log(`    → Login and create your projects, sprints, and issues from the UI\n`);

  saveDb();
}

async function seedAdminOnlyPg(pool) {
  const { v4: uuid } = require('uuid');
  const adminId = uuid();

  await pool.query(
    "INSERT INTO users (id, name, email, password, role, avatar_color, department, job_title) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [adminId, config.admin.name, config.admin.email, config.admin.password, 'admin', '#0c66e4', 'Engineering', 'Administrator']
  );
  await pool.query("INSERT INTO user_settings (id, user_id) VALUES ($1, $2)", [uuid(), adminId]);

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

  names.forEach((name, i) => {
    db.run("INSERT INTO users (id, name, email, role, avatar_color, phone, department, job_title, bio, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [userIds[i], name, emails[i], roles[i], colors[i], phones[i], depts[i], titles[i], bios[i], tzs[i]]);
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

  issueData.forEach((issue, i) => {
    db.run(`INSERT INTO issues (id, project_id, sprint_id, issue_key, issue_number, title, type, status, priority, story_points, assignee_id, reporter_id, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), projId1, sprintId, `ATL-${i + 1}`, i + 1, issue.title, issue.type, issue.status, issue.priority, issue.points,
       issue.assignee !== null ? userIds[issue.assignee] : null, userIds[0], i]);
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
      '<h1>Architecture Overview</h1><p>Atlas is built as a modern full-stack application with a clear separation of concerns.</p><h2>System Architecture</h2><p>The system follows a classic three-tier architecture: presentation layer (React SPA), application layer (Node.js + Express), and data layer (SQLite / PostgreSQL).</p><h2>Key Components</h2><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:10px;border:1px solid #ddd;text-align:left">Component</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Technology</th><th style="padding:10px;border:1px solid #ddd;text-align:left">Purpose</th></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Frontend</strong></td><td style="padding:10px;border:1px solid #ddd">React 18 + Babel</td><td style="padding:10px;border:1px solid #ddd">Single-page application served from one HTML file</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Backend</strong></td><td style="padding:10px;border:1px solid #ddd">Express 5</td><td style="padding:10px;border:1px solid #ddd">REST API with modular route files</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Database</strong></td><td style="padding:10px;border:1px solid #ddd">sql.js / PostgreSQL</td><td style="padding:10px;border:1px solid #ddd">Data persistence with migration support</td></tr><tr><td style="padding:10px;border:1px solid #ddd"><strong>Auth</strong></td><td style="padding:10px;border:1px solid #ddd">Session tokens</td><td style="padding:10px;border:1px solid #ddd">Header-based authentication with RBAC</td></tr></table><h2>Data Flow</h2><p>All API requests flow through the auth middleware which validates session tokens and attaches user context. Route modules handle business logic and database operations through shared helper functions.</p><div style="background:#deebff;padding:16px;border-radius:4px;border-left:4px solid #0c66e4;margin:16px 0"><strong>ℹ️ Note:</strong> The frontend uses Babel standalone for JSX transformation, which means no build step is required during development.</div>',
      'html', 'current', 0, userIds[0], userIds[0], 1, 12],
    [pageIds.setup, spaceEng, null, 'Development Setup', 'development-setup',
      '<h1>Development Setup</h1><p>Get your local development environment running in minutes.</p><h2>Prerequisites</h2><ul><li>Node.js 18+ installed</li><li>Git</li><li>A code editor (VS Code recommended)</li></ul><h2>Quick Start</h2><div style="background:#f4f5f7;padding:16px;border-radius:4px;font-family:monospace;font-size:13px;margin:12px 0"><code>git clone https://github.com/KunalDSoni/Atlas.git<br>cd Atlas/backend<br>npm install<br>node server.js</code></div><p>Open <a href="http://localhost:3001">http://localhost:3001</a> in your browser.</p><h2>Environment Configuration</h2><p>Copy <code>.env.example</code> to <code>.env</code> and configure:</p><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left">Variable</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Default</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Description</th></tr><tr><td style="padding:8px;border:1px solid #ddd"><code>SEED_DEMO_DATA</code></td><td style="padding:8px;border:1px solid #ddd">true</td><td style="padding:8px;border:1px solid #ddd">Populate demo data on fresh DB</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><code>DB_DRIVER</code></td><td style="padding:8px;border:1px solid #ddd">sqlite</td><td style="padding:8px;border:1px solid #ddd">sqlite or postgres</td></tr></table><div style="background:#fffae6;padding:16px;border-radius:4px;border-left:4px solid #ff991f;margin:16px 0"><strong>⚠️ Warning:</strong> Delete <code>data.db</code> and restart if you change the schema — <code>CREATE TABLE IF NOT EXISTS</code> won\'t add new columns.</div>',
      'html', 'current', 1, userIds[0], userIds[1], 2, 8],
    [pageIds.api, spaceEng, pageIds.arch, 'API Reference', 'api-reference',
      '<h1>API Reference</h1><p>Complete REST API documentation for the Atlas backend.</p><h2>Authentication</h2><p>All API requests (except login) require these headers:</p><div style="background:#f4f5f7;padding:16px;border-radius:4px;font-family:monospace;font-size:13px;margin:12px 0"><code>x-user-id: [user UUID]<br>x-user-role: [admin|board_admin|user|client]<br>x-auth-token: [session token]</code></div><h2>Endpoints</h2><h3>Auth</h3><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left;width:100px">Method</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Path</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Description</th></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#e3fcef;color:#006644;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">POST</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/auth/login</code></td><td style="padding:8px;border:1px solid #ddd">Login with email/password</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#deebff;color:#0747a6;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">GET</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/auth/me</code></td><td style="padding:8px;border:1px solid #ddd">Get current user</td></tr></table><h3>Issues</h3><table style="width:100%;border-collapse:collapse"><tr style="background:#f4f5f7"><th style="padding:8px;border:1px solid #ddd;text-align:left;width:100px">Method</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Path</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Description</th></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#deebff;color:#0747a6;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">GET</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/projects/:id/issues</code></td><td style="padding:8px;border:1px solid #ddd">List project issues</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#e3fcef;color:#006644;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">POST</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/projects/:id/issues</code></td><td style="padding:8px;border:1px solid #ddd">Create issue</td></tr><tr><td style="padding:8px;border:1px solid #ddd"><span style="background:#fffae6;color:#974f0c;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:700">PUT</span></td><td style="padding:8px;border:1px solid #ddd"><code>/api/issues/:id</code></td><td style="padding:8px;border:1px solid #ddd">Update issue</td></tr></table>',
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
  console.log('\n  ✓ Demo data seeded (5 users, 2 projects, 13 issues, 2 wiki spaces, 7 pages)\n');
}

async function seedDemoDataPg(pool) {
  // For now, Pg demo seed is minimal — users can add real data via UI
  const { v4: uuid } = require('uuid');
  const adminId = uuid();
  await pool.query(
    "INSERT INTO users (id, name, email, password, role, avatar_color) VALUES ($1, $2, $3, $4, $5, $6)",
    [adminId, config.admin.name, config.admin.email, config.admin.password, 'admin', '#0c66e4']
  );
  await pool.query("INSERT INTO user_settings (id, user_id) VALUES ($1, $2)", [uuid(), adminId]);
  console.log('\n  ✓ Admin account created for PostgreSQL\n');
}

// ===== Save (SQLite only) =====
function saveDb() {
  if (db && !db._isPg) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Translate SQLite-specific syntax in route SQL to Postgres equivalents.
// Lets route code use one dialect and get the right execution on either driver.
function translateForPg(sql) {
  let i = 0;
  return sql
    // datetime('now', '+N days')  →  NOW() + INTERVAL 'N days'
    .replace(/datetime\(\s*'now'\s*,\s*'\+(\d+)\s*days?'\s*\)/gi, "(NOW() + INTERVAL '$1 days')")
    // datetime('now')  →  NOW()
    .replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()')
    // julianday(x) - julianday(y)  →  EXTRACT(EPOCH FROM (x - y)) / 86400
    .replace(/julianday\(([^)]+)\)\s*-\s*julianday\(([^)]+)\)/gi,
             'EXTRACT(EPOCH FROM ($1::timestamp - $2::timestamp)) / 86400')
    // ? placeholders  →  $1, $2, ...
    .replace(/\?/g, () => `$${++i}`);
}

// ===== Query Helpers =====
// All helpers are async so route code can `await` them uniformly.
// SQLite path (sql.js) is truly synchronous internally — the async
// wrapper is just there to give pg and sqlite the same call shape.
async function queryAll(database, sql, params = []) {
  if (database._isPg) {
    const { rows } = await database._pool.query(translateForPg(sql), params);
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
  if (database._isPg) {
    const { rows } = await database._pool.query(translateForPg(sql), params);
    return rows[0] || null;
  }
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

async function run(database, sql, params = []) {
  if (database._isPg) {
    await database._pool.query(translateForPg(sql), params);
    return;
  }
  database.run(sql, params);
  saveDb();
}

// ===== Main Init =====
async function getDb() {
  if (db) return db;

  if (config.db.driver === 'postgres') {
    return initPostgres();
  } else {
    return initSqlite();
  }
}

async function initDb() {
  return getDb();
}

module.exports = { getDb, saveDb, initDb, queryAll, queryOne, run };
