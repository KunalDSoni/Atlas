const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data.db');
let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key TEXT UNIQUE NOT NULL,
      description TEXT,
      lead_id TEXT REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role_in_project TEXT DEFAULT 'member' CHECK(role_in_project IN ('lead','member','viewer')),
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sprints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      goal TEXT,
      status TEXT DEFAULT 'planning' CHECK(status IN ('planning','active','completed')),
      start_date TEXT,
      end_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS issues (
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
      board_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id),
      author_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  saveDb();
  seedData();
  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function seedData() {
  const users = db.exec("SELECT COUNT(*) as c FROM users");
  if (users[0].values[0][0] > 0) return;

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
    // Create default settings for each user
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
  // Project 1: Atlas Platform — everyone except James
  [0, 1, 2, 3].forEach(i => {
    const prole = i === 0 ? 'lead' : 'member';
    db.run("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)",
      [uuid(), projId1, userIds[i], prole]);
  });

  // Project 2: Mobile App — Sarah (lead), Alex, James
  [1, 2, 4].forEach(i => {
    const prole = i === 1 ? 'lead' : 'member';
    db.run("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)",
      [uuid(), projId2, userIds[i], prole]);
  });

  // Seed sprint for project 1
  const sprintId = uuid();
  db.run("INSERT INTO sprints (id, project_id, name, goal, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [sprintId, projId1, 'Sprint 12', 'Complete auth module and API refactor', 'active', '2026-04-06', '2026-04-20']);

  // Seed sprint for project 2
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
    const id = uuid();
    db.run(`INSERT INTO issues (id, project_id, sprint_id, issue_key, issue_number, title, type, status, priority, story_points, assignee_id, reporter_id, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projId1, sprintId, `ATL-${i + 1}`, i + 1, issue.title, issue.type, issue.status, issue.priority, issue.points,
       issue.assignee !== null ? userIds[issue.assignee] : null, userIds[0], i]);
  });

  // Seed issues for Mobile App
  const mobIssues = [
    { title: 'Set up push notification service', type: 'story', status: 'in_progress', priority: 'high', points: 8, assignee: 1 },
    { title: 'Fix crash on Android 14', type: 'bug', status: 'todo', priority: 'highest', points: 3, assignee: 2 },
    { title: 'Implement deep linking', type: 'task', status: 'todo', priority: 'medium', points: 5, assignee: 4 },
  ];

  mobIssues.forEach((issue, i) => {
    const id = uuid();
    db.run(`INSERT INTO issues (id, project_id, sprint_id, issue_key, issue_number, title, type, status, priority, story_points, assignee_id, reporter_id, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projId2, sprintId2, `MOB-${i + 1}`, i + 1, issue.title, issue.type, issue.status, issue.priority, issue.points,
       issue.assignee !== null ? userIds[issue.assignee] : null, userIds[1], i]);
  });

  saveDb();
}

// Helper functions for route modules
function queryAll(database, sql, params = []) {
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function queryOne(database, sql, params = []) {
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function run(database, sql, params = []) {
  database.run(sql, params);
  saveDb();
}

async function initDb() {
  return getDb();
}

module.exports = { getDb, saveDb, initDb, queryAll, queryOne, run };
