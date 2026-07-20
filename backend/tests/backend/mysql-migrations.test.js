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
});
