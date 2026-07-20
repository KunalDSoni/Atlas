// ===== ATLAS — Schema Migrations =====
// A deliberately small migration runner. It exists because `CREATE TABLE IF NOT
// EXISTS` cannot evolve a table that already exists, and the previous fix — a
// wall of `try { ALTER } catch {}` — swallowed real errors and left no record of
// what had run.
//
// The rules:
//   1. Migrations are an ordered, append-only list. Never edit or reorder an id
//      that has shipped; add a new migration instead.
//   2. Applied ids are recorded in `schema_migrations`, so each runs once.
//   3. Steps stay idempotent anyway (`addColumn` introspects first). Deployments
//      that predate this file already have the early columns but no ledger, so
//      the first run re-stamps them without trying to re-add anything.
//
// Each migration carries both a sqlite and a mysql form, since Atlas ships on
// sql.js in dev and MySQL in production.

const MIGRATIONS = [
  {
    id: '001_issues_epic_color',
    description: 'Epic badge colour on issues',
    steps: [{
      addColumn: {
        table: 'issues',
        column: 'epic_color',
        // ALTER cannot carry the CHECK constraint the CREATE TABLE has; the
        // allowed set is enforced by API validation in routes/issues.js.
        sqlite: "ALTER TABLE issues ADD COLUMN epic_color TEXT DEFAULT 'purple'",
        mysql: "ALTER TABLE issues ADD COLUMN epic_color VARCHAR(20) DEFAULT 'purple'",
      },
    }],
  },
  {
    id: '002_issues_release_fields',
    description: 'Fix version + component links on issues',
    steps: [
      {
        addColumn: {
          table: 'issues',
          column: 'fix_version_id',
          sqlite: 'ALTER TABLE issues ADD COLUMN fix_version_id TEXT',
          mysql: 'ALTER TABLE issues ADD COLUMN fix_version_id VARCHAR(36)',
        },
      },
      {
        addColumn: {
          table: 'issues',
          column: 'component_id',
          sqlite: 'ALTER TABLE issues ADD COLUMN component_id TEXT',
          mysql: 'ALTER TABLE issues ADD COLUMN component_id VARCHAR(36)',
        },
      },
    ],
  },
  {
    id: '003_issues_start_date',
    description: 'Start date on issues (timeline view)',
    steps: [{
      addColumn: {
        table: 'issues',
        column: 'start_date',
        sqlite: 'ALTER TABLE issues ADD COLUMN start_date TEXT',
        mysql: 'ALTER TABLE issues ADD COLUMN start_date DATETIME NULL',
      },
    }],
  },
  {
    id: '004_projects_wip_limits',
    description: 'Per-column WIP limits on projects',
    steps: [{
      addColumn: {
        table: 'projects',
        column: 'wip_limits',
        sqlite: "ALTER TABLE projects ADD COLUMN wip_limits TEXT DEFAULT '{}'",
        mysql: 'ALTER TABLE projects ADD COLUMN wip_limits VARCHAR(2000)',
      },
    }],
  },
  {
    id: '005_wiki_comment_quote',
    description: 'Quoted excerpt on wiki page comments',
    steps: [{
      addColumn: {
        table: 'wiki_page_comments',
        column: 'quote',
        sqlite: 'ALTER TABLE wiki_page_comments ADD COLUMN quote TEXT',
        mysql: 'ALTER TABLE wiki_page_comments ADD COLUMN quote TEXT',
      },
    }],
  },
  {
    id: '006_wiki_page_type',
    description: 'Page vs. template distinction on wiki pages',
    steps: [{
      addColumn: {
        table: 'wiki_pages',
        column: 'page_type',
        sqlite: "ALTER TABLE wiki_pages ADD COLUMN page_type TEXT DEFAULT 'page'",
        mysql: "ALTER TABLE wiki_pages ADD COLUMN page_type VARCHAR(20) DEFAULT 'page'",
      },
    }],
  },
  {
    id: '007_issue_lookup_indexes',
    description: 'Indexes for the batched issue-enrichment lookups',
    steps: [
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id)',
          mysql: 'CREATE INDEX idx_issues_parent ON issues(parent_id)',
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id)',
          mysql: 'CREATE INDEX idx_comments_issue ON comments(issue_id)',
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_attachments_issue ON attachments(issue_id)',
          mysql: 'CREATE INDEX idx_attachments_issue ON attachments(issue_id)',
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_watchers_issue ON issue_watchers(issue_id)',
          mysql: 'CREATE INDEX idx_watchers_issue ON issue_watchers(issue_id)',
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_field_values_issue ON issue_field_values(issue_id)',
          mysql: 'CREATE INDEX idx_field_values_issue ON issue_field_values(issue_id)',
        },
      },
    ],
  },
  {
    id: '008_wiki_page_issues',
    description: 'Join table linking wiki pages to the issues they mention',
    steps: [
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS wiki_page_issues (
            page_id TEXT NOT NULL REFERENCES wiki_pages(id),
            issue_id TEXT NOT NULL REFERENCES issues(id),
            PRIMARY KEY (page_id, issue_id)
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS wiki_page_issues (
            page_id VARCHAR(36) NOT NULL,
            issue_id VARCHAR(36) NOT NULL,
            PRIMARY KEY (page_id, issue_id)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_page_issues_issue ON wiki_page_issues(issue_id)',
          mysql: 'CREATE INDEX idx_page_issues_issue ON wiki_page_issues(issue_id)',
        },
      },
    ],
  },
  {
    id: '009_wiki_page_approvals',
    description: 'Page approval state + an append-only approval log',
    steps: [
      // Approval is pinned to the version that was approved: editing a page
      // after approval must not leave it reading as "verified" for content
      // nobody signed off on.
      {
        addColumn: {
          table: 'wiki_pages',
          column: 'approved_version',
          sqlite: 'ALTER TABLE wiki_pages ADD COLUMN approved_version INTEGER',
          mysql: 'ALTER TABLE wiki_pages ADD COLUMN approved_version INT NULL',
        },
      },
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS wiki_page_approvals (
            id TEXT PRIMARY KEY,
            page_id TEXT NOT NULL REFERENCES wiki_pages(id),
            version INTEGER NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id),
            action TEXT NOT NULL CHECK(action IN ('approved','revoked')),
            note TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS wiki_page_approvals (
            id VARCHAR(36) PRIMARY KEY,
            page_id VARCHAR(36) NOT NULL,
            version INT NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            action VARCHAR(20) NOT NULL,
            note TEXT,
            -- Millisecond precision: an audit log ordered by a second-granularity
            -- timestamp ties on same-second events and falls back to a random
            -- UUID, so the displayed order is arbitrary. Writers pass an explicit
            -- ms timestamp; see routes/wiki.js.
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_page_approvals_page ON wiki_page_approvals(page_id)',
          mysql: 'CREATE INDEX idx_page_approvals_page ON wiki_page_approvals(page_id)',
        },
      },
    ],
  },
];

const LEDGER_SQL = {
  sqlite: `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`,
  mysql: `CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(120) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARSET=utf8mb4`,
};

// ===== Adapters =====
// The runner talks to a database through three calls, so the same code drives
// sql.js (synchronous, in-process) and a mysql2 pool (async).

function sqliteAdapter(db) {
  return {
    driver: 'sqlite',
    async exec(sql, params = []) { db.run(sql, params); },
    async all(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    async hasColumn(table, column) {
      const rows = await this.all(`PRAGMA table_info(${table})`);
      return rows.some(r => r.name === column);
    },
  };
}

function mysqlAdapter(pool) {
  return {
    driver: 'mysql',
    async exec(sql, params = []) { await pool.query(sql, params); },
    async all(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    async hasColumn(table, column) {
      const rows = await this.all(
        `SELECT COLUMN_NAME FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, column]);
      return rows.length > 0;
    },
  };
}

// ===== Runner =====

async function applyStep(adapter, step) {
  if (step.addColumn) {
    const { table, column } = step.addColumn;
    if (await adapter.hasColumn(table, column)) return;
    await adapter.exec(step.addColumn[adapter.driver]);
    return;
  }
  // Raw SQL steps must tolerate re-running. SQLite gets IF NOT EXISTS; MySQL has
  // no such form for CREATE INDEX, so a duplicate there is expected and ignored.
  try {
    await adapter.exec(step.sql[adapter.driver]);
  } catch (e) {
    if (adapter.driver === 'mysql' && e.code === 'ER_DUP_KEYNAME') return;
    throw e;
  }
}

/**
 * Applies every migration not yet recorded in `schema_migrations`.
 * Returns the ids applied by this call — empty when the schema was already current.
 */
async function runMigrations(adapter) {
  await adapter.exec(LEDGER_SQL[adapter.driver]);

  const done = new Set((await adapter.all('SELECT id FROM schema_migrations')).map(r => r.id));
  const applied = [];

  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    for (const step of migration.steps) {
      await applyStep(adapter, step);
    }
    await adapter.exec('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    applied.push(migration.id);
  }

  return applied;
}

module.exports = { MIGRATIONS, runMigrations, sqliteAdapter, mysqlAdapter };
