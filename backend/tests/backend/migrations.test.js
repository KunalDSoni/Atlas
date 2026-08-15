/**
 * Migration runner — a versioned, ordered replacement for the hand-rolled
 * try/catch ALTERs that used to live in database.js.
 */
const crypto = require('crypto');
const { createTestApp } = require('./setup');
const { MIGRATIONS, runMigrations, sqliteAdapter } = require('../../migrations');
const { getDb, queryAll, queryOne, run } = require('../../database');

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

  test('016 creates the theme tables', async () => {
    const db = await getDb();
    const tables = (await queryAll(db, "SELECT name FROM sqlite_master WHERE type='table'")).map((t) => t.name);
    expect(tables).toContain('pb_themes');
    expect(tables).toContain('pb_insight_themes');
  });

  test('016 is recorded in the migration ledger', async () => {
    const db = await getDb();
    const row = await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['016_insight_themes']);
    expect(row).toBeTruthy();
  });

  test('019 creates feature outcomes and the durable launch timestamp', async () => {
    const db = await getDb();
    const featureColumns = (await queryAll(db, 'PRAGMA table_info(pb_features)')).map((c) => c.name);
    const outcomeColumns = (await queryAll(db, 'PRAGMA table_info(pb_feature_outcomes)')).map((c) => c.name);
    expect(featureColumns).toContain('launched_at');
    expect(outcomeColumns).toEqual(expect.arrayContaining([
      'feature_id', 'metric', 'target', 'baseline', 'measured', 'verdict', 'reviewed_at', 'reviewed_by', 'notes',
    ]));
    expect(await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['019_feature_outcomes'])).toBeTruthy();
  });

  test('020 creates the portal followers table', async () => {
    const db = await getDb();
    const columns = (await queryAll(db, 'PRAGMA table_info(pb_portal_followers)')).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['feature_id', 'user_id', 'created_at']));
    expect(await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['020_portal_followers'])).toBeTruthy();
  });

  test('021 stores both SLA query boundaries', async () => {
    const db = await getDb();
    const columns = (await queryAll(db, 'PRAGMA table_info(sd_sla_clocks)')).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['due_at', 'at_risk_at']));
    expect(await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?',
      ['021_sla_query_boundaries'])).toBeTruthy();
  });

  test('022 creates personal dashboard layouts', async () => {
    const db = await getDb();
    const columns = (await queryAll(db, 'PRAGMA table_info(dashboard_layouts)')).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining([
      'id', 'user_id', 'project_id', 'gadgets', 'updated_at',
    ]));
    expect(await queryOne(db, 'SELECT id FROM schema_migrations WHERE id = ?',
      ['022_dashboard_layouts'])).toBeTruthy();
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

describe('023_wiki_page_numbers', () => {
  test('backfills page_number and enforces uniqueness per space', async () => {
    const db = await getDb();

    // Raw inserts (bypassing routes/wiki.js) leave page_number NULL, exactly like
    // rows that existed before this migration shipped.
    const spaceId = crypto.randomUUID();
    await run(db, "INSERT INTO wiki_spaces (id, space_key, name, owner_id) VALUES (?, ?, ?, ?)",
      [spaceId, `TST${Date.now()}`, 'Test Space', null]);

    const authorId = (await queryOne(db, 'SELECT id FROM users LIMIT 1')).id;
    // created_at is set explicitly, one second apart, because the migration orders
    // its backfill by (space_id, created_at, id) — two rows inserted in the same
    // wall-clock second would otherwise tie-break on random UUID string order
    // instead of insertion order, making this test flaky.
    const insertPage = async (title, createdAt) => {
      const id = crypto.randomUUID();
      await run(db,
        `INSERT INTO wiki_pages (id, space_id, title, slug, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, spaceId, title, title.toLowerCase(), authorId, createdAt]);
      return id;
    };
    const p1 = await insertPage('First', '2026-01-01 00:00:00');
    const p2 = await insertPage('Second', '2026-01-01 00:00:01');

    // Re-run the 023 migration by dropping it from the ledger — the same pattern
    // used above to prove a re-applied migration doesn't blow up on existing columns.
    await run(db, "DELETE FROM schema_migrations WHERE id = ?", ['023_wiki_page_numbers']);
    const applied = await runMigrations(sqliteAdapter(db));
    expect(applied).toEqual(['023_wiki_page_numbers']);

    const rows = await queryAll(db, 'SELECT id, page_number FROM wiki_pages WHERE space_id = ? ORDER BY page_number', [spaceId]);
    expect(rows.map(r => r.id)).toEqual([p1, p2]);
    expect(rows.map(r => r.page_number)).toEqual([1, 2]);
  });

  test('enforces uniqueness per space via a unique index', async () => {
    const db = await getDb();
    const idx = await queryAll(db, 'PRAGMA index_list(wiki_pages)');
    const uniqueIdx = idx.find(i => i.name === 'idx_wiki_pages_space_number');
    expect(uniqueIdx).toBeTruthy();
    expect(Number(uniqueIdx.unique)).toBe(1);
  });
});

describe('034_backfill_request_count', () => {
  test('seeds request_count from feedback linked before the counter existed', async () => {
    const db = await getDb();

    // A deployment as it stood before this shipped: feedback linked to a
    // feature over weeks, and request_count still sitting at its 0 default
    // because nothing ever wrote it.
    const featureId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    for (const id of [featureId, otherId]) {
      await run(db, 'INSERT INTO pb_features (id, name, request_count) VALUES (?, ?, 0)', [id, `Backfill ${id}`]);
    }

    const insightIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of insightIds) {
      await run(db, 'INSERT INTO pb_insights (id, title) VALUES (?, ?)', [id, `Feedback ${id}`]);
    }
    // Two against one feature, one against the other.
    for (const [i, insightId] of insightIds.entries()) {
      await run(db, 'INSERT INTO pb_insight_links (id, insight_id, feature_id) VALUES (?, ?, ?)',
        [crypto.randomUUID(), insightId, i < 2 ? featureId : otherId]);
    }

    await run(db, 'DELETE FROM schema_migrations WHERE id = ?', ['034_backfill_request_count']);
    const applied = await runMigrations(sqliteAdapter(db));
    expect(applied).toEqual(['034_backfill_request_count']);

    expect((await queryOne(db, 'SELECT request_count FROM pb_features WHERE id = ?', [featureId])).request_count).toBe(2);
    expect((await queryOne(db, 'SELECT request_count FROM pb_features WHERE id = ?', [otherId])).request_count).toBe(1);
  });

  test('leaves a feature with no linked feedback at zero', async () => {
    const db = await getDb();
    const id = crypto.randomUUID();
    await run(db, 'INSERT INTO pb_features (id, name, request_count) VALUES (?, ?, 0)', [id, 'No feedback yet']);

    await run(db, 'DELETE FROM schema_migrations WHERE id = ?', ['034_backfill_request_count']);
    await runMigrations(sqliteAdapter(db));

    expect((await queryOne(db, 'SELECT request_count FROM pb_features WHERE id = ?', [id])).request_count).toBe(0);
  });
});
