/**
 * Migration runner against a REAL MySQL server.
 *
 * The rest of the suite runs on sql.js, so backend/migrations.js's MySQL branch
 * — the mysqlAdapter, the MySQL form of every migration, and the ER_DUP_KEYNAME
 * path — ships untested by default. A MySQL-only migration bug does not fail a
 * test; it crashes production on boot.
 *
 * Skipped unless MYSQL_TEST_HOST is set, so local `npm test` is unaffected.
 * CI provides a MySQL service (see .github/workflows/ci-cd.yml). To run locally:
 *
 *   docker run -d --name atlas-mysql-test -e MYSQL_ROOT_PASSWORD=testpw \
 *     -e MYSQL_DATABASE=atlas_test -p 3399:3306 mysql:8.4
 *   MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_PORT=3399 MYSQL_TEST_PASSWORD=testpw \
 *     npx jest tests/backend/mysql-migrations.test.js --runInBand --forceExit
 */
const { MIGRATIONS, runMigrations, mysqlAdapter } = require('../../migrations');

const HOST = process.env.MYSQL_TEST_HOST;
const PORT = parseInt(process.env.MYSQL_TEST_PORT, 10) || 3306;
const USER = process.env.MYSQL_TEST_USER || 'root';
const PASSWORD = process.env.MYSQL_TEST_PASSWORD || '';
const DATABASE = process.env.MYSQL_TEST_DATABASE || 'atlas_migration_test';

// describe.skip when no server is configured — a green run on a machine with no
// MySQL would otherwise read as "the MySQL path passed".
const describeMysql = HOST ? describe : describe.skip;

let pool;
let adapter;

describeMysql('migration runner against real MySQL', () => {
  beforeAll(async () => {
    const mysql = require('mysql2/promise');
    const bootstrap = await mysql.createConnection({
      host: HOST, port: PORT, user: USER, password: PASSWORD, charset: 'utf8mb4',
    });
    // Fresh schema per run so "applies from nothing" is actually tested.
    await bootstrap.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
    await bootstrap.query(`CREATE DATABASE \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await bootstrap.end();

    pool = mysql.createPool({
      host: HOST, port: PORT, user: USER, password: PASSWORD, database: DATABASE,
      charset: 'utf8mb4', dateStrings: true, multipleStatements: false,
    });
    adapter = mysqlAdapter(pool);

    // The migrations ALTER tables the baseline schema creates, so build the
    // baseline first — exactly as initMysqlSchema does before migrating.
    const { MYSQL_SCHEMA_SQL } = require('../../database');
    for (const sql of MYSQL_SCHEMA_SQL) await pool.query(sql);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('applies every migration from an empty ledger', async () => {
    const applied = await runMigrations(adapter);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.id));

    const [rows] = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
  }, 60_000);

  test('re-running is a no-op', async () => {
    const applied = await runMigrations(adapter);
    expect(applied).toEqual([]);
  }, 30_000);

  test('a ledger-less upgrade re-stamps without duplicating columns or indexes', async () => {
    // The real upgrade path: an existing deployment already has the columns and
    // indexes but no schema_migrations table content. Every step must be safe to
    // re-run — this is what exercises addColumn's introspection and the
    // ER_DUP_KEYNAME catch on CREATE INDEX.
    await pool.query('DELETE FROM schema_migrations');
    const applied = await runMigrations(adapter);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.id));

    const [cols] = await pool.query(
      "SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'issues' AND column_name = 'epic_color'");
    expect(Number(cols[0].c)).toBe(1);

    const [idx] = await pool.query("SHOW INDEX FROM issues WHERE Key_name = 'idx_issues_parent'");
    expect(idx.length).toBeGreaterThan(0);
  }, 60_000);

  test('every migrated column and table exists in MySQL', async () => {
    const hasColumn = async (table, column) => {
      const [r] = await pool.query(
        'SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
        [table, column]);
      return Number(r[0].c) > 0;
    };
    expect(await hasColumn('issues', 'epic_color')).toBe(true);
    expect(await hasColumn('issues', 'fix_version_id')).toBe(true);
    expect(await hasColumn('issues', 'component_id')).toBe(true);
    expect(await hasColumn('issues', 'start_date')).toBe(true);
    expect(await hasColumn('projects', 'wip_limits')).toBe(true);
    expect(await hasColumn('wiki_page_comments', 'quote')).toBe(true);
    expect(await hasColumn('wiki_pages', 'page_type')).toBe(true);

    const [t] = await pool.query("SHOW TABLES LIKE 'wiki_page_issues'");
    expect(t.length).toBe(1);
  }, 30_000);

  test('service desk columns and tables exist in MySQL', async () => {
    const hasColumn = async (table, column) => {
      const [r] = await pool.query(
        'SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
        [table, column]);
      return Number(r[0].c) > 0;
    };
    expect(await hasColumn('issues', 'request_type_id')).toBe(true);
    expect(await hasColumn('issues', 'sd_fields')).toBe(true);
    expect(await hasColumn('projects', 'is_service_desk')).toBe(true);
    expect(await hasColumn('comments', 'visibility')).toBe(true);
    expect(await hasColumn('project_statuses', 'waiting_for_customer')).toBe(true);

    const [t] = await pool.query("SHOW TABLES LIKE 'sd_request_types'");
    expect(t.length).toBe(1);
  }, 30_000);

  // The MySQL-only trap that makes this whole suite worth having.
  //
  // `ALTER TABLE ... MODIFY COLUMN` does not drop an inline CHECK: the
  // constraint survives under its auto-generated name and keeps rejecting the
  // new value. Every other test here builds its schema from MYSQL_SCHEMA_SQL,
  // which already carries the extended CHECK, so none of them can catch it.
  // This one starts from the OLD constraint on purpose.
  test("migration 011 lets an EXISTING MySQL database accept type='request'", async () => {
    const legacy = `${DATABASE}_legacy_check`;
    const mysql = require('mysql2/promise');
    const bootstrap = await mysql.createConnection({
      host: HOST, port: PORT, user: USER, password: PASSWORD, charset: 'utf8mb4',
    });
    await bootstrap.query(`DROP DATABASE IF EXISTS \`${legacy}\``);
    await bootstrap.query(`CREATE DATABASE \`${legacy}\` CHARACTER SET utf8mb4`);
    await bootstrap.end();

    const legacyPool = mysql.createPool({
      host: HOST, port: PORT, user: USER, password: PASSWORD, database: legacy,
      charset: 'utf8mb4', dateStrings: true,
    });

    try {
      // The pre-011 issues table: the type CHECK without 'request'.
      await legacyPool.query(`CREATE TABLE issues (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL,
        issue_key VARCHAR(50) NOT NULL,
        issue_number INT NOT NULL,
        title VARCHAR(512) NOT NULL,
        type VARCHAR(20) DEFAULT 'task' CHECK(type IN ('story','task','bug','epic','subtask')),
        status VARCHAR(20) DEFAULT 'todo'
      ) DEFAULT CHARSET=utf8mb4`);
      await legacyPool.query(`CREATE TABLE projects (
        id VARCHAR(36) PRIMARY KEY, name VARCHAR(255), \`key\` VARCHAR(50)
      ) DEFAULT CHARSET=utf8mb4`);
      await legacyPool.query(`CREATE TABLE comments (
        id VARCHAR(36) PRIMARY KEY, issue_id VARCHAR(36), author_id VARCHAR(36), body TEXT
      ) DEFAULT CHARSET=utf8mb4`);
      await legacyPool.query(`CREATE TABLE project_statuses (
        id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36), \`key\` VARCHAR(50),
        label VARCHAR(255), category VARCHAR(20), position INT
      ) DEFAULT CHARSET=utf8mb4`);

      // Rejected before the migration.
      await expect(legacyPool.query(
        "INSERT INTO issues (id,project_id,issue_key,issue_number,title,type) VALUES ('a','p','K-1',1,'t','request')",
      )).rejects.toThrow();

      // Only 011 is outstanding; the rest are irrelevant to this table.
      const legacyAdapter = mysqlAdapter(legacyPool);
      await legacyAdapter.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(120) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) DEFAULT CHARSET=utf8mb4`);
      for (const m of MIGRATIONS) {
        if (m.id !== '011_service_desk_core') {
          await legacyAdapter.exec('INSERT INTO schema_migrations (id) VALUES (?)', [m.id]);
        }
      }
      await runMigrations(legacyAdapter);

      // Accepted after it.
      await legacyPool.query(
        "INSERT INTO issues (id,project_id,issue_key,issue_number,title,type) VALUES ('b','p','K-2',2,'t','request')");
      const [rows] = await legacyPool.query("SELECT type FROM issues WHERE id='b'");
      expect(rows[0].type).toBe('request');

      // And the constraint still rejects nonsense — it was replaced, not removed.
      await expect(legacyPool.query(
        "INSERT INTO issues (id,project_id,issue_key,issue_number,title,type) VALUES ('c','p','K-3',3,'t','banana')",
      )).rejects.toThrow();
    } finally {
      await legacyPool.end();
    }
  }, 60_000);
});
