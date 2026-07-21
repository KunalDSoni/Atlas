/**
 * SERVICE DESK CORE — migration 011, request types, comment visibility.
 */
const initSqlJs = require('sql.js');
const { MIGRATIONS, runMigrations, sqliteAdapter } = require('../../migrations');

// The pre-011 shape of the tables the migration rewrites, verbatim from the
// schema as it stood before this wave. Building the old shape by hand is the
// only way to exercise the upgrade path: the normal test harness always builds
// a fresh database from the current schema, so it would get 'request' for free
// and prove nothing about existing deployments.
const LEGACY_SCHEMA = [
  `CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL)`,
  `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)`,
  // Carries the columns earlier migrations added (start_date, fix_version_id,
  // component_id) precisely so the rebuild is proven not to drop them.
  `CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    issue_key TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'task' CHECK(type IN ('story','task','bug','epic','subtask')),
    status TEXT DEFAULT 'todo',
    story_points INTEGER,
    labels TEXT DEFAULT '[]',
    start_date TEXT,
    epic_color TEXT DEFAULT 'purple',
    fix_version_id TEXT,
    component_id TEXT,
    parent_id TEXT REFERENCES issues(id),
    board_order INTEGER DEFAULT 0
  )`,
  `CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL
  )`,
  `CREATE TABLE project_statuses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT DEFAULT 'in_progress',
    position INTEGER DEFAULT 0
  )`,
];

async function legacyDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  LEGACY_SCHEMA.forEach((sql) => db.run(sql));
  db.run("INSERT INTO projects (id, name, key) VALUES ('p1', 'Legacy', 'LEG')");
  db.run("INSERT INTO users (id, name) VALUES ('u1', 'Agent')");
  ['story', 'task', 'bug', 'epic', 'subtask'].forEach((t, i) => {
    db.run(`INSERT INTO issues (id, project_id, issue_key, issue_number, title, description, type,
      story_points, labels, start_date, epic_color, fix_version_id, component_id, board_order)
      VALUES (?, 'p1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`i${i}`, `LEG-${i + 1}`, i + 1, `Legacy ${t}`, `Body of ${t}`, t,
      (i + 1) * 3, `["legacy-${t}"]`, '2026-01-0' + (i + 1), 'teal', `ver-${i}`, `comp-${i}`, i]);
  });
  db.run("INSERT INTO comments (id, issue_id, author_id, body) VALUES ('c1', 'i0', 'u1', 'legacy comment')");

  // A real database upgrading to 011 already has every earlier migration
  // applied. Recording them keeps this fixture focused on 011 instead of
  // requiring the full historical schema that 001-010 touch.
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);
  MIGRATIONS.filter((m) => m.id !== '011_service_desk_core').forEach((m) => {
    db.run('INSERT INTO schema_migrations (id) VALUES (?)', [m.id]);
  });
  return db;
}

function all(db, sql) {
  const stmt = db.prepare(sql);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

describe('migration 011_service_desk_core', () => {
  test('is registered', () => {
    expect(MIGRATIONS.some((m) => m.id === '011_service_desk_core')).toBe(true);
  });

  test('preserves every issue row and its comments through the rebuild', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));

    const issues = all(db, 'SELECT * FROM issues ORDER BY issue_number');
    expect(issues.length).toBe(5);
    expect(issues.map((i) => i.type)).toEqual(['story', 'task', 'bug', 'epic', 'subtask']);
    expect(issues[0].issue_key).toBe('LEG-1');

    // The child table still resolves to the rebuilt issues table.
    const joined = all(db, 'SELECT c.body FROM comments c JOIN issues i ON i.id = c.issue_id');
    expect(joined.length).toBe(1);
    expect(joined[0].body).toBe('legacy comment');
  });

  // The rebuild's failure mode is silent amnesia: a hardcoded new-table shape
  // drops whichever columns it forgets, taking their data with it. An earlier
  // draft of this migration did exactly that to fix_version_id and component_id.
  test('carries every pre-existing column and its data through the rebuild', async () => {
    const db = await legacyDb();
    const before = all(db, 'PRAGMA table_info(issues)').map((c) => c.name);
    await runMigrations(sqliteAdapter(db));
    const after = all(db, 'PRAGMA table_info(issues)').map((c) => c.name);

    for (const col of before) {
      expect(after).toContain(col);
    }

    const row = all(db, "SELECT * FROM issues WHERE id = 'i2'")[0];
    expect(row.description).toBe('Body of bug');
    expect(row.story_points).toBe(9);
    expect(row.labels).toBe('["legacy-bug"]');
    expect(row.start_date).toBe('2026-01-03');
    expect(row.epic_color).toBe('teal');
    expect(row.fix_version_id).toBe('ver-2');
    expect(row.component_id).toBe('comp-2');
  });

  test('preserves indexes that existed on the rebuilt table', async () => {
    const db = await legacyDb();
    db.run('CREATE INDEX idx_legacy_issue_status ON issues(status)');
    await runMigrations(sqliteAdapter(db));
    const idx = all(db, "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='issues'")
      .map((r) => r.name);
    expect(idx).toContain('idx_legacy_issue_status');
  });

  test("accepts type='request' after the rebuild", async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    expect(() => db.run(
      "INSERT INTO issues (id, project_id, issue_key, issue_number, title, type) VALUES ('r1', 'p1', 'LEG-99', 99, 'A request', 'request')",
    )).not.toThrow();
  });

  test('still rejects a bogus type after the rebuild', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    expect(() => db.run(
      "INSERT INTO issues (id, project_id, issue_key, issue_number, title, type) VALUES ('r2', 'p1', 'LEG-98', 98, 'Nope', 'banana')",
    )).toThrow();
  });

  test('adds the new columns and tables', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    const issueCols = all(db, 'PRAGMA table_info(issues)').map((c) => c.name);
    expect(issueCols).toContain('request_type_id');
    expect(issueCols).toContain('sd_fields');
    expect(all(db, 'PRAGMA table_info(projects)').map((c) => c.name)).toContain('is_service_desk');
    expect(all(db, 'PRAGMA table_info(comments)').map((c) => c.name)).toContain('visibility');
    expect(all(db, 'PRAGMA table_info(project_statuses)').map((c) => c.name)).toContain('waiting_for_customer');
    expect(all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='sd_request_types'").length).toBe(1);
  });

  test('existing comments default to public', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    expect(all(db, "SELECT visibility FROM comments WHERE id='c1'")[0].visibility).toBe('public');
  });

  test('is idempotent — running twice changes nothing', async () => {
    const db = await legacyDb();
    await runMigrations(sqliteAdapter(db));
    const applied = await runMigrations(sqliteAdapter(db));
    expect(applied).not.toContain('011_service_desk_core');
    expect(all(db, 'SELECT * FROM issues').length).toBe(5);
  });
});

const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');

describe('request types', () => {
  let app, headers, memberHeaders, projectId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    memberHeaders = await userHeaders();
    const projects = await request(app).get('/api/projects').set(headers);
    projectId = projects.body.find((p) => p.key === 'ATL').id;
  });

  test('creates a request type with a parsed fields array', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({
      name: 'Report a bug',
      description: 'Something is broken',
      icon: 'bug',
      fields: [{ key: 'steps', label: 'Steps to reproduce', type: 'textarea', required: true }],
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Report a bug');
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.fields[0].key).toBe('steps');
  });

  test('rejects a request type with no name', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({ name: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  test('rejects a field of an unknown type', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({
      name: 'Bad form',
      fields: [{ key: 'x', label: 'X', type: 'hologram' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  test('rejects a field with no key', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({
      name: 'Bad form 2',
      fields: [{ label: 'No key', type: 'text' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
  });

  test('a non-admin member cannot create a request type', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/request-types`).set(memberHeaders).send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  test('lists request types in position order', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/request-types`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body[0].fields)).toBe(true);
  });

  test('updates a request type', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({ name: 'Rename me' });
    const res = await request(app).put(`/api/request-types/${created.body.id}`).set(headers).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
  });

  test('deletes a request type that has no requests', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers).send({ name: 'Delete me' });
    const res = await request(app).delete(`/api/request-types/${created.body.id}`).set(headers);
    expect(res.status).toBe(200);
    const after = await request(app).get(`/api/request-types/${created.body.id}`).set(headers);
    expect(after.status).toBe(404);
  });

  test('404s on an unknown request type', async () => {
    const res = await request(app).put('/api/request-types/does-not-exist').set(headers).send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('comment visibility', () => {
  let app, headers, clientHeaders, issueId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    const projects = await request(app).get('/api/projects').set(headers);
    const projectId = projects.body.find((p) => p.key === 'ATL').id;
    const issue = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Visibility fixture', type: 'task' });
    issueId = issue.body.id;

    const created = await request(app).post('/api/users').set(headers)
      .send({ name: 'Casey Client', email: 'casey@example.com', role: 'client' });
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'casey@example.com', password: created.body.initial_password });
    clientHeaders = { 'x-auth-token': login.body.token, 'Content-Type': 'application/json' };
  });

  test('a comment defaults to public', async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(headers).send({ body: 'Hello' });
    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('public');
  });

  test('an agent can post an internal note', async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: 'Internal only', visibility: 'internal' });
    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('internal');
  });

  test('an agent sees both public and internal comments', async () => {
    const res = await request(app).get(`/api/issues/${issueId}/comments`).set(headers);
    const visibilities = res.body.map((c) => c.visibility);
    expect(visibilities).toContain('public');
    expect(visibilities).toContain('internal');
  });

  test('a client never sees an internal comment', async () => {
    const res = await request(app).get(`/api/issues/${issueId}/comments`).set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.every((c) => c.visibility === 'public')).toBe(true);
    expect(res.body.some((c) => c.body === 'Internal only')).toBe(false);
  });

  test("a client's attempt to post an internal note is rejected, not downgraded", async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(clientHeaders)
      .send({ body: 'Sneaky', visibility: 'internal' });
    expect(res.status).toBe(403);
  });

  test('an invalid visibility is rejected', async () => {
    const res = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: 'Bad', visibility: 'secret' });
    expect(res.status).toBe(400);
  });
});
