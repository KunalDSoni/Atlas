/**
 * Migration runner — a versioned, ordered replacement for the hand-rolled
 * try/catch ALTERs that used to live in database.js.
 */
const { createTestApp } = require('./setup');
const { MIGRATIONS, runMigrations, sqliteAdapter } = require('../../migrations');
const { getDb, queryAll, queryOne } = require('../../database');

describe('Migration definitions', () => {
  test('every migration has a unique id and at least one step', () => {
    const ids = MIGRATIONS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MIGRATIONS) {
      expect(m.id).toMatch(/^\d{3}_[a-z0-9_]+$/);
      expect(m.steps.length).toBeGreaterThan(0);
    }
  });

  test('ids are declared in ascending order — the runner applies them in array order', () => {
    const ids = MIGRATIONS.map(m => m.id);
    expect(ids).toEqual([...ids].sort());
  });

  test('every step names both a sqlite and a mysql form', () => {
    for (const m of MIGRATIONS) {
      for (const step of m.steps) {
        if (step.run) {
          // A run step inspects the database before deciding what to execute,
          // so it cannot declare its SQL up front. The invariant still holds —
          // the function itself must branch on adapter.driver — but only its
          // shape can be checked here.
          expect(typeof step.run).toBe('function');
        } else if (step.addColumn) {
          expect(step.addColumn.table).toBeTruthy();
          expect(step.addColumn.column).toBeTruthy();
          expect(step.addColumn.sqlite).toBeTruthy();
          expect(step.addColumn.mysql).toBeTruthy();
        } else {
          expect(step.sql.sqlite).toBeTruthy();
          expect(step.sql.mysql).toBeTruthy();
        }
      }
    }
  });

  test('every run step branches on the driver rather than assuming one', () => {
    for (const m of MIGRATIONS) {
      for (const step of m.steps) {
        if (step.run) {
          expect(step.run.toString()).toMatch(/adapter\.driver/);
        }
      }
    }
  });
});

describe('Migration runner against a live SQLite database', () => {
  let db;

  beforeAll(async () => {
    await createTestApp();
    db = await getDb();
  });

  test('initDb records every migration in schema_migrations', async () => {
    const rows = await queryAll(db, 'SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map(r => r.id)).toEqual(MIGRATIONS.map(m => m.id));
  });

  test('each applied migration is stamped with a time', async () => {
    const row = await queryOne(db, 'SELECT applied_at FROM schema_migrations LIMIT 1');
    expect(row.applied_at).toBeTruthy();
  });

  test('the columns the migrations add are all present', async () => {
    const cols = async (table) =>
      (await queryAll(db, `PRAGMA table_info(${table})`)).map(c => c.name);

    const issueCols = await cols('issues');
    expect(issueCols).toEqual(expect.arrayContaining(
      ['epic_color', 'fix_version_id', 'component_id', 'start_date']));
    expect(await cols('projects')).toContain('wip_limits');
    expect(await cols('wiki_page_comments')).toContain('quote');
    expect(await cols('wiki_pages')).toContain('page_type');
  });

  test('creates the wiki_page_issues join table with both lookup paths indexed', async () => {
    const cols = (await queryAll(db, 'PRAGMA table_info(wiki_page_issues)')).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['page_id', 'issue_id']));

    // Composite PK covers page → issues; the explicit index covers issue → pages.
    const pk = (await queryAll(db, 'PRAGMA table_info(wiki_page_issues)'))
      .filter(c => Number(c.pk) > 0).map(c => c.name);
    expect(pk.sort()).toEqual(['issue_id', 'page_id']);

    const idx = await queryAll(db, 'PRAGMA index_list(wiki_page_issues)');
    expect(idx.some(i => i.name === 'idx_page_issues_issue')).toBe(true);
  });

  test('re-running is a no-op: no duplicate ledger rows, no errors', async () => {
    const before = await queryAll(db, 'SELECT id FROM schema_migrations');
    const applied = await runMigrations(sqliteAdapter(db));
    expect(applied).toEqual([]); // nothing pending the second time
    const after = await queryAll(db, 'SELECT id FROM schema_migrations');
    expect(after.length).toBe(before.length);
  });

  test('a column dropped from the ledger is not re-added blindly', async () => {
    // Existing deployments already have these columns but no ledger. Clearing the
    // ledger must not make the runner blow up on an ALTER for a column that exists.
    await require('../../database').run(db, 'DELETE FROM schema_migrations');
    const applied = await runMigrations(sqliteAdapter(db));
    expect(applied).toEqual(MIGRATIONS.map(m => m.id)); // re-stamped
    const cols = (await queryAll(db, 'PRAGMA table_info(issues)')).map(c => c.name);
    expect(cols.filter(c => c === 'epic_color').length).toBe(1); // added once, not twice
  });
});

describe('015_insight_origins', () => {
  test('adds the origin columns to pb_insights', async () => {
    const db = await getDb();
    const names = (await queryAll(db, 'PRAGMA table_info(pb_insights)')).map(c => c.name);
    expect(names).toContain('origin_kind');
    expect(names).toContain('origin_id');
    expect(names).toContain('origin_excerpt');
    expect(names).toContain('dismissed_at');
  });

  test('is recorded in the migration ledger', async () => {
    const db = await getDb();
    const row = await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['015_insight_origins']);
    expect(row).toBeTruthy();
  });

  test('existing insights survive with null origins rather than being rewritten', async () => {
    // The columns are additive: a pre-existing insight keeps its row and simply
    // has no origin, which the inbox renders as a manual capture.
    const db = await getDb();
    const seeded = await queryOne(db, 'SELECT id, title, origin_kind FROM pb_insights LIMIT 1');
    expect(seeded).toBeTruthy();
    expect(seeded.title).toBeTruthy();
    expect(seeded.origin_kind ?? null).toBeNull();
  });
});
