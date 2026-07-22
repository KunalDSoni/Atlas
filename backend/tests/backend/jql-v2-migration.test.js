const initSqlJs = require('sql.js');
const { MIGRATIONS, runMigrations, sqliteAdapter } = require('../../migrations');

async function legacyDatabase() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE sd_sla_clocks (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    target_minutes INTEGER NOT NULL,
    started_at TEXT,
    stopped_at TEXT,
    paused_at TEXT,
    paused_total_minutes INTEGER DEFAULT 0,
    breached_at TEXT
  )`);
  db.run("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now'))) ");
  for (const migration of MIGRATIONS) {
    if (migration.id !== '021_sla_query_boundaries') {
      db.run('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    }
  }
  return db;
}

function rows(db, sql) {
  const statement = db.prepare(sql);
  const result = [];
  while (statement.step()) result.push(statement.getAsObject());
  statement.free();
  return result;
}

describe('migration 021 on existing SLA clocks', () => {
  test('adds, backfills and indexes both portable boundaries', async () => {
    const db = await legacyDatabase();
    db.run(`INSERT INTO sd_sla_clocks
      (id, issue_id, metric, target_minutes, started_at, paused_total_minutes)
      VALUES ('c1', 'i1', 'resolution', 60, '2026-07-20 09:00:00', 30)`);
    db.run(`INSERT INTO sd_sla_clocks
      (id, issue_id, metric, target_minutes, started_at)
      VALUES ('bad', 'i2', 'resolution', 0, '2026-07-20 09:00:00')`);

    await expect(runMigrations(sqliteAdapter(db))).resolves.toEqual(['021_sla_query_boundaries']);

    const columns = rows(db, 'PRAGMA table_info(sd_sla_clocks)').map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(['due_at', 'at_risk_at']));
    expect(rows(db, "SELECT due_at, at_risk_at FROM sd_sla_clocks WHERE id = 'c1'")[0])
      .toEqual({ due_at: '2026-07-20 10:30:00', at_risk_at: '2026-07-20 10:18:00' });
    expect(rows(db, "SELECT due_at, at_risk_at FROM sd_sla_clocks WHERE id = 'bad'")[0])
      .toEqual({ due_at: null, at_risk_at: null });

    const indexes = rows(db, 'PRAGMA index_list(sd_sla_clocks)').map((index) => index.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_sla_clocks_due', 'idx_sla_clocks_at_risk']));
    await expect(runMigrations(sqliteAdapter(db))).resolves.toEqual([]);
  });
});
