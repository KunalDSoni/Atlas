/**
 * AGENT QUEUES (ATLAS-42)
 *
 * A queue is a stored JQL string evaluated through utils/jql/. These tests
 * pin the two things that could quietly rot: the stored query must be VALIDATED
 * at write time (a queue that cannot parse is a broken sidebar entry nobody
 * notices until an agent clicks it), and the sidebar counts must agree with the
 * rows the queue actually returns.
 */
const request = require('supertest');
const initSqlJs = require('sql.js');
const { createTestApp, adminHeaders, loginAs } = require('./setup');
const { MIGRATIONS, runMigrations, sqliteAdapter } = require('../../migrations');

let app, headers, userHdrs, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  userHdrs = await loginAs('priya@example.com', 'password123');
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'HD').id;
});

describe('queue CRUD', () => {
  test('a board admin creates a queue and it comes back in the project list', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/queues`).set(headers).send({
      name: 'Unassigned',
      jql: 'assignee = unassigned',
      columns: ['key', 'summary', 'status'],
      order_by: 'created_at',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Unassigned');
    expect(res.body.columns).toEqual(['key', 'summary', 'status']);

    const list = await request(app).get(`/api/projects/${projectId}/queues`).set(headers);
    expect(list.status).toBe(200);
    expect(list.body.map((q) => q.name)).toContain('Unassigned');
  });

  test('a queue whose JQL cannot parse is refused, not stored', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/queues`).set(headers).send({
      name: 'Broken', jql: 'wombat = purple',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown field/i);

    const list = await request(app).get(`/api/projects/${projectId}/queues`).set(headers);
    expect(list.body.map((q) => q.name)).not.toContain('Broken');
  });

  test('an unknown order_by column is refused — it would reach the ORDER BY clause', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/queues`).set(headers).send({
      name: 'Injected', jql: 'type = request', order_by: 'created_at; DROP TABLE issues',
    });
    expect(res.status).toBe(400);
  });

  test('an ordinary user cannot create a queue', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/queues`).set(userHdrs).send({
      name: 'Nope', jql: 'type = request',
    });
    expect(res.status).toBe(403);
  });

  test('a queue can be renamed and requeried', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/queues`).set(headers)
      .send({ name: 'Draft', jql: 'type = request' });
    const res = await request(app).put(`/api/queues/${created.body.id}`).set(headers)
      .send({ name: 'Open requests', jql: 'type = request AND status = todo' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Open requests');
    expect(res.body.jql).toBe('type = request AND status = todo');
  });

  test('an invalid JQL update leaves the stored query untouched', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/queues`).set(headers)
      .send({ name: 'Stable', jql: 'type = request' });
    const res = await request(app).put(`/api/queues/${created.body.id}`).set(headers)
      .send({ jql: 'nonsense' });
    expect(res.status).toBe(400);

    const after = await request(app).get(`/api/queues/${created.body.id}`).set(headers);
    expect(after.body.jql).toBe('type = request');
  });

  test('a deleted queue is gone', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/queues`).set(headers)
      .send({ name: 'Temporary', jql: 'type = request' });
    const del = await request(app).delete(`/api/queues/${created.body.id}`).set(headers);
    expect(del.status).toBe(200);
    const after = await request(app).get(`/api/queues/${created.body.id}`).set(headers);
    expect(after.status).toBe(404);
  });
});

describe('queue evaluation', () => {
  let openQueue, mineQueue;

  beforeAll(async () => {
    const open = await request(app).post(`/api/projects/${projectId}/queues`).set(headers)
      .send({ name: 'All open', jql: 'type = request AND status != done', order_by: 'priority' });
    openQueue = open.body.id;
    const mine = await request(app).post(`/api/projects/${projectId}/queues`).set(headers)
      .send({ name: 'Assigned to me', jql: 'assignee = me' });
    mineQueue = mine.body.id;

    // `= me` is only meaningfully tested against a request that IS assigned to
    // somebody; the seeded help desk leaves them all unassigned.
    const issues = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
    await request(app).put(`/api/issues/${issues.body[0].id}`).set(headers)
      .send({ assignee_id: headers['x-user-id'] });
  });

  test('the queue returns exactly the issues its JQL selects', async () => {
    const res = await request(app).get(`/api/queues/${openQueue}/issues`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      expect(row.type).toBe('request');
      expect(row.status).not.toBe('done');
    }
  });

  test('a queue never reaches outside its own project', async () => {
    const everything = await request(app).post(`/api/projects/${projectId}/queues`).set(headers)
      .send({ name: 'Everything', jql: 'priority = medium' });
    const res = await request(app).get(`/api/queues/${everything.body.id}/issues`).set(headers);
    // The seeded ATL/PROD projects are full of medium-priority issues; none may
    // appear in a Help Desk queue.
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) expect(row.issue_key.startsWith('HD-')).toBe(true);
  });

  test('the sidebar count agrees with the rows the queue returns', async () => {
    const list = await request(app).get(`/api/projects/${projectId}/queues`).set(headers);
    const sidebar = list.body.find((q) => q.id === openQueue);
    const rows = await request(app).get(`/api/queues/${openQueue}/issues`).set(headers);
    expect(rows.body.length).toBeGreaterThan(0);
    expect(sidebar.count).toBe(rows.body.length);
  });

  test('`= me` resolves to the caller, so two agents see different counts', async () => {
    const asAdmin = await request(app).get(`/api/queues/${mineQueue}/issues`).set(headers);
    const asUser = await request(app).get(`/api/queues/${mineQueue}/issues`).set(userHdrs);
    const keys = (r) => r.body.map((i) => i.issue_key).sort();
    expect(keys(asAdmin)).not.toEqual(keys(asUser));
  });

  test('order_by=priority sorts by severity, not alphabetically', async () => {
    const res = await request(app).get(`/api/queues/${openQueue}/issues`).set(headers);
    const RANK = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 };
    const ranks = res.body.map((r) => RANK[r.priority]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test('limit pages the rows and exposes the total', async () => {
    const first = await request(app).get(`/api/queues/${openQueue}/issues?limit=1&offset=0`).set(headers);
    expect(first.body.length).toBe(1);
    const total = Number(first.headers['x-total-count']);
    expect(total).toBeGreaterThan(1);

    const second = await request(app).get(`/api/queues/${openQueue}/issues?limit=1&offset=1`).set(headers);
    expect(second.body[0].id).not.toBe(first.body[0].id);
  });

  test('rows carry SLA state, so the queue can show a badge without a second call', async () => {
    // A goal on a fresh type, then a request raised through it.
    const type = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers)
      .send({ name: 'Queue SLA type', fields: [] });
    await request(app).post(`/api/request-types/${type.body.id}/sla-goals`).set(headers)
      .send({ metric: 'first_response', target_minutes: 60 });

    const client = await loginAs('dana@customer.example.com', 'password123');
    const raised = await request(app).post('/api/help/requests').set(client)
      .send({ request_type_id: type.body.id, summary: 'Badge me', fields: {} });
    expect(raised.status).toBe(201);

    const res = await request(app).get(`/api/queues/${openQueue}/issues`).set(headers);
    const row = res.body.find((r) => r.issue_key === raised.body.key);
    expect(row.sla.first_response.status).toBe('ok');
    expect(row.sla.first_response.target_minutes).toBe(60);
  });

  test('a row with no SLA goals carries an empty object, not null', async () => {
    const bare = await request(app).post(`/api/projects/${projectId}/request-types`).set(headers)
      .send({ name: 'Untimed', fields: [] });
    const client = await loginAs('dana@customer.example.com', 'password123');
    const raised = await request(app).post('/api/help/requests').set(client)
      .send({ request_type_id: bare.body.id, summary: 'No goals here', fields: {} });

    const res = await request(app).get(`/api/queues/${openQueue}/issues`).set(headers);
    const ungoverned = res.body.find((r) => r.issue_key === raised.body.key);
    expect(ungoverned.sla).toEqual({});
  });

  test('rows carry the request type, so a queue column can show it', async () => {
    const res = await request(app).get(`/api/queues/${openQueue}/issues`).set(headers);
    expect(res.body.some((r) => r.request_type_name)).toBe(true);
  });

  test('a queue stored before a JQL field was removed lists but reports no count', async () => {
    // Simulated by writing an unparseable query straight to the table — the API
    // refuses to create one, which is the point: only history can produce it.
    const { getDb, run } = require('../../database');
    const db = await getDb();
    await run(db,
      "INSERT INTO sd_queues (id, project_id, name, jql, column_keys, order_by) VALUES ('legacy-q', ?, 'Legacy', 'wombat = purple', '[\"key\"]', 'created_at')",
      [projectId]);

    const list = await request(app).get(`/api/projects/${projectId}/queues`).set(headers);
    const legacy = list.body.find((q) => q.id === 'legacy-q');
    expect(legacy).toBeDefined();
    expect(legacy.count).toBeNull();
    expect(legacy.invalid).toMatch(/unknown field/i);

    // Its sibling queues still count correctly rather than the whole call failing.
    expect(list.body.find((q) => q.id === openQueue).count).toBeGreaterThan(0);
  });
});

describe('migration 012/013 on a database that predates them', () => {
  const UNDER_TEST = ['012_sd_queues', '013_sd_slas'];

  // The deployment path, not the fresh-install path. A fresh database gets
  // these tables from database.js and would prove nothing about upgrading.
  async function preSliceTwoDb() {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, key TEXT)");
    db.run("CREATE TABLE issues (id TEXT PRIMARY KEY, project_id TEXT, issue_key TEXT, type TEXT CHECK(type IN ('story','task','bug','epic','subtask','request')))");
    db.run("CREATE TABLE sd_request_types (id TEXT PRIMARY KEY, project_id TEXT, name TEXT)");
    db.run(`CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`);
    // Stamp every migration EXCEPT the two under test, so this fixture stays
    // about 012/013 no matter what later waves append. Stamping "everything
    // below 012" instead would drag in whatever 014+ becomes, against a
    // deliberately minimal schema that has none of the tables those touch.
    for (const m of MIGRATIONS) {
      if (UNDER_TEST.includes(m.id)) continue;
      db.run('INSERT INTO schema_migrations (id) VALUES (?)', [m.id]);
    }
    return db;
  }

  test('adds the queue and SLA tables without touching what is already there', async () => {
    const db = await preSliceTwoDb();
    db.run("INSERT INTO projects (id, name, key) VALUES ('p1', 'Legacy desk', 'LEG')");

    const applied = await runMigrations(sqliteAdapter(db));
    expect(applied).toEqual(UNDER_TEST);

    const tables = [];
    const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
    while (stmt.step()) tables.push(stmt.getAsObject().name);
    stmt.free();
    expect(tables).toEqual(expect.arrayContaining(['sd_queues', 'sd_sla_goals', 'sd_sla_clocks']));

    // The pre-existing rows survive.
    const check = db.prepare('SELECT COUNT(*) AS c FROM projects');
    check.step();
    expect(check.getAsObject().c).toBe(1);
    check.free();
  });

  test('running the upgrade twice is a no-op', async () => {
    const db = await preSliceTwoDb();
    await runMigrations(sqliteAdapter(db));
    const second = await runMigrations(sqliteAdapter(db));
    expect(second).toEqual([]);
  });
});
