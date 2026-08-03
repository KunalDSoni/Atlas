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
  {
    id: '010_wiki_page_tasks',
    description: 'Checkbox state for wiki task lists, and the issue a task was converted into',
    steps: [
      // Task state is deliberately NOT stored in the page body. Ticking a box
      // would otherwise rewrite the body, bumping the version, spamming version
      // history, and staling the page's approval (migration 009) for what is
      // not an editorial change.
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS wiki_page_tasks (
            page_id TEXT NOT NULL REFERENCES wiki_pages(id),
            task_key TEXT NOT NULL,
            checked INTEGER DEFAULT 0,
            checked_by TEXT REFERENCES users(id),
            checked_at TEXT,
            issue_id TEXT REFERENCES issues(id),
            PRIMARY KEY (page_id, task_key)
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS wiki_page_tasks (
            page_id VARCHAR(36) NOT NULL,
            task_key VARCHAR(80) NOT NULL,
            checked TINYINT DEFAULT 0,
            checked_by VARCHAR(36) NULL,
            checked_at DATETIME(3) NULL,
            issue_id VARCHAR(36) NULL,
            PRIMARY KEY (page_id, task_key)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_page_tasks_issue ON wiki_page_tasks(issue_id)',
          mysql: 'CREATE INDEX idx_page_tasks_issue ON wiki_page_tasks(issue_id)',
        },
      },
    ],
  },
  {
    id: '011_service_desk_core',
    description: 'Service desk foundation: request types, request issue type, comment visibility',
    steps: [
      {
        addColumn: {
          table: 'projects', column: 'is_service_desk',
          sqlite: 'ALTER TABLE projects ADD COLUMN is_service_desk INTEGER DEFAULT 0',
          mysql: 'ALTER TABLE projects ADD COLUMN is_service_desk TINYINT DEFAULT 0',
        },
      },
      {
        addColumn: {
          table: 'comments', column: 'visibility',
          sqlite: "ALTER TABLE comments ADD COLUMN visibility TEXT DEFAULT 'public'",
          mysql: "ALTER TABLE comments ADD COLUMN visibility VARCHAR(10) DEFAULT 'public'",
        },
      },
      {
        addColumn: {
          table: 'project_statuses', column: 'waiting_for_customer',
          sqlite: 'ALTER TABLE project_statuses ADD COLUMN waiting_for_customer INTEGER DEFAULT 0',
          mysql: 'ALTER TABLE project_statuses ADD COLUMN waiting_for_customer TINYINT DEFAULT 0',
        },
      },
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_request_types (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            icon TEXT DEFAULT 'help-circle',
            fields TEXT NOT NULL DEFAULT '[]',
            position INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_request_types (
            id VARCHAR(36) PRIMARY KEY,
            project_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            icon VARCHAR(50) DEFAULT 'help-circle',
            fields TEXT NOT NULL,
            position INT DEFAULT 0,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        addColumn: {
          table: 'issues', column: 'request_type_id',
          sqlite: 'ALTER TABLE issues ADD COLUMN request_type_id TEXT REFERENCES sd_request_types(id)',
          mysql: 'ALTER TABLE issues ADD COLUMN request_type_id VARCHAR(36) NULL',
        },
      },
      {
        addColumn: {
          table: 'issues', column: 'sd_fields',
          sqlite: "ALTER TABLE issues ADD COLUMN sd_fields TEXT DEFAULT '{}'",
          mysql: 'ALTER TABLE issues ADD COLUMN sd_fields TEXT',
        },
      },
      // ---- The type CHECK rebuild.
      //
      // SQLite cannot alter a CHECK constraint in place, so `issues` is rebuilt.
      // The new table's DDL is DERIVED FROM THE EXISTING ONE rather than written
      // out here: the column set differs across deployments depending on which
      // migrations a database has seen, and a hardcoded shape silently drops
      // whichever columns it forgets. Deriving it means every column, default,
      // and constraint survives by construction, and `SELECT *` is a safe copy
      // because the two tables are identical but for the one CHECK.
      //
      // Foreign keys are not enforced here (database.js issues no
      // PRAGMA foreign_keys=ON and sql.js defaults it off) and child tables
      // reference `issues` by name, so the rename leaves them resolving to the
      // new table.
      {
        run: async (adapter) => {
          if (adapter.driver !== 'sqlite') return;

          const rows = await adapter.all(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='issues'");
          const ddl = rows[0] && rows[0].sql;
          // No table yet (fresh install builds it from database.js), or the
          // CHECK already permits 'request' — nothing to rebuild. This is also
          // what makes the step idempotent.
          if (!ddl || /'request'/.test(ddl)) return;

          const rebuilt = ddl
            .replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["'`[]?issues["'`\]]?/i,
              'CREATE TABLE issues_rebuild_011')
            .replace(/CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)\s*\)/i,
              (_m, list) => `CHECK(type IN (${list.trim()},'request'))`);

          if (!/issues_rebuild_011/.test(rebuilt) || !/'request'/.test(rebuilt)) {
            throw new Error('011: could not derive the rebuilt issues DDL from ' + ddl);
          }

          // Indexes live on the table and die with it, so replay their exact DDL.
          const indexes = await adapter.all(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='issues' AND sql IS NOT NULL");

          await adapter.exec('DROP TABLE IF EXISTS issues_rebuild_011');
          await adapter.exec(rebuilt);
          await adapter.exec('INSERT INTO issues_rebuild_011 SELECT * FROM issues');
          await adapter.exec('DROP TABLE issues');
          await adapter.exec('ALTER TABLE issues_rebuild_011 RENAME TO issues');
          for (const i of indexes) {
            await adapter.exec(i.sql);
          }
        },
      },
      // MySQL's equivalent of the rebuild above.
      //
      // `ALTER TABLE ... MODIFY COLUMN` does NOT drop an inline CHECK — the
      // constraint outlives the column definition under its auto-generated name
      // (issues_chk_1). An earlier draft used MODIFY and left existing MySQL
      // deployments rejecting every type='request' insert with ERROR 3819,
      // while every test still passed because fresh test schemas already carry
      // the extended CHECK. The constraint must be dropped by name and re-added.
      {
        run: async (adapter) => {
          if (adapter.driver !== 'mysql') return;

          const rows = await adapter.all(
            `SELECT cc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause
               FROM information_schema.CHECK_CONSTRAINTS cc
               JOIN information_schema.TABLE_CONSTRAINTS tc
                 ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
                AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
              WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
                AND tc.TABLE_NAME = 'issues'`);

          for (const row of rows) {
            const clause = String(row.clause || '');
            // The type CHECK, and only if it predates this migration.
            if (!/subtask/i.test(clause) || /request/i.test(clause)) continue;
            await adapter.exec(`ALTER TABLE issues DROP CHECK \`${row.name}\``);
            await adapter.exec(
              `ALTER TABLE issues ADD CONSTRAINT \`${row.name}\` ` +
              "CHECK (type IN ('story','task','bug','epic','subtask','request'))");
          }
        },
      },
    ],
  },
  {
    id: '012_sd_queues',
    description: 'Agent queues: a stored JQL query per project with its own columns and sort',
    steps: [
      // `column_keys`, not `columns`: the latter is a keyword in MySQL and would
      // need backticks that SQLite rejects, forcing every query touching this
      // table to be written twice. The name is the only thing that differs from
      // the design note.
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_queues (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            name TEXT NOT NULL,
            jql TEXT NOT NULL,
            column_keys TEXT NOT NULL DEFAULT '[]',
            order_by TEXT DEFAULT 'created_at',
            position INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_queues (
            id VARCHAR(36) PRIMARY KEY,
            project_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            jql TEXT NOT NULL,
            column_keys TEXT NOT NULL,
            order_by VARCHAR(40) DEFAULT 'created_at',
            position INT DEFAULT 0,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
    ],
  },
  {
    id: '013_sd_slas',
    description: 'SLA goals per request type, and the clocks derived on read',
    steps: [
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_sla_goals (
            id TEXT PRIMARY KEY,
            request_type_id TEXT NOT NULL REFERENCES sd_request_types(id),
            priority TEXT,
            metric TEXT NOT NULL CHECK(metric IN ('first_response','resolution')),
            target_minutes INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_sla_goals (
            id VARCHAR(36) PRIMARY KEY,
            request_type_id VARCHAR(36) NOT NULL,
            priority VARCHAR(20) NULL,
            metric VARCHAR(20) NOT NULL,
            target_minutes INT NOT NULL,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      // No scheduler writes these rows — every column is a timestamp, and state
      // is derived from them on read by utils/sla.js::slaState.
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_sla_clocks (
            id TEXT PRIMARY KEY,
            issue_id TEXT NOT NULL REFERENCES issues(id),
            metric TEXT NOT NULL,
            goal_id TEXT,
            target_minutes INTEGER NOT NULL,
            started_at TEXT DEFAULT (datetime('now')),
            stopped_at TEXT,
            paused_at TEXT,
            paused_total_minutes INTEGER DEFAULT 0,
            breached_at TEXT,
            UNIQUE(issue_id, metric)
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_sla_clocks (
            id VARCHAR(36) PRIMARY KEY,
            issue_id VARCHAR(36) NOT NULL,
            metric VARCHAR(20) NOT NULL,
            goal_id VARCHAR(36) NULL,
            target_minutes INT NOT NULL,
            started_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
            stopped_at DATETIME(3) NULL,
            paused_at DATETIME(3) NULL,
            paused_total_minutes INT DEFAULT 0,
            breached_at DATETIME(3) NULL,
            UNIQUE KEY uniq_issue_metric (issue_id, metric)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_sla_clocks_issue ON sd_sla_clocks(issue_id)',
          mysql: 'CREATE INDEX idx_sla_clocks_issue ON sd_sla_clocks(issue_id)',
        },
      },
    ],
  },
  {
    id: '014_sd_deflection_csat',
    description: 'Curated help articles, deflection hits, and one satisfaction rating per request',
    steps: [
      // Curation is what BOUNDS the customer-facing search: a request type's
      // articles decide which spaces its suggestions may draw from, so an
      // uncurated type offers nothing rather than the whole internal wiki.
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_type_articles (
            request_type_id TEXT NOT NULL REFERENCES sd_request_types(id),
            page_id TEXT NOT NULL REFERENCES wiki_pages(id),
            position INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (request_type_id, page_id)
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_type_articles (
            request_type_id VARCHAR(36) NOT NULL,
            page_id VARCHAR(36) NOT NULL,
            position INT DEFAULT 0,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (request_type_id, page_id)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_article_hits (
            id TEXT PRIMARY KEY,
            page_id TEXT NOT NULL,
            request_type_id TEXT,
            helped INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_article_hits (
            id VARCHAR(36) PRIMARY KEY,
            page_id VARCHAR(36) NOT NULL,
            request_type_id VARCHAR(36) NULL,
            helped TINYINT DEFAULT 0,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      // UNIQUE on issue_id is the "one rating per request" rule in the schema
      // rather than in a handler that could be bypassed by a second route.
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS sd_satisfaction (
            issue_id TEXT PRIMARY KEY REFERENCES issues(id),
            rating INTEGER NOT NULL,
            comment TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS sd_satisfaction (
            issue_id VARCHAR(36) PRIMARY KEY,
            rating INT NOT NULL,
            comment TEXT,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_article_hits_type ON sd_article_hits(request_type_id)',
          mysql: 'CREATE INDEX idx_article_hits_type ON sd_article_hits(request_type_id)',
        },
      },
    ],
  },
  {
    id: '015_insight_origins',
    description: 'Where an insight came from, and a snapshot of the captured text',
    steps: [
      {
        addColumn: {
          table: 'pb_insights', column: 'origin_kind',
          // ALTER cannot carry the CHECK the CREATE TABLE has; the allowed set
          // is enforced by ORIGIN_KINDS in utils/insight-origin.js.
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN origin_kind TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN origin_kind VARCHAR(20)',
        },
      },
      {
        addColumn: {
          table: 'pb_insights', column: 'origin_id',
          // Deliberately not a foreign key: it points at issues, comments or
          // wiki_pages depending on origin_kind, and a deleted source must
          // leave the insight and its excerpt intact.
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN origin_id TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN origin_id VARCHAR(36)',
        },
      },
      {
        addColumn: {
          table: 'pb_insights', column: 'origin_excerpt',
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN origin_excerpt TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN origin_excerpt TEXT',
        },
      },
      {
        addColumn: {
          table: 'pb_insights', column: 'dismissed_at',
          sqlite: 'ALTER TABLE pb_insights ADD COLUMN dismissed_at TEXT',
          mysql: 'ALTER TABLE pb_insights ADD COLUMN dismissed_at DATETIME(3) NULL',
        },
      },
    ],
  },
  {
    id: '016_insight_themes',
    description: 'Themes: a named grouping of insights between feedback and features',
    steps: [
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS pb_themes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            summary TEXT DEFAULT '',
            created_by TEXT REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS pb_themes (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            summary TEXT,
            created_by VARCHAR(36),
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS pb_insight_themes (
            id TEXT PRIMARY KEY,
            insight_id TEXT NOT NULL REFERENCES pb_insights(id),
            theme_id TEXT NOT NULL REFERENCES pb_themes(id),
            UNIQUE(insight_id, theme_id)
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS pb_insight_themes (
            id VARCHAR(36) PRIMARY KEY,
            insight_id VARCHAR(36) NOT NULL,
            theme_id VARCHAR(36) NOT NULL,
            UNIQUE KEY uniq_insight_theme (insight_id, theme_id)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
    ],
  },
  {
    id: '017_feature_spec_pages',
    description: 'Link a feature to its spec page in the wiki',
    steps: [{
      addColumn: {
        table: 'pb_features', column: 'spec_page_id',
        // Not a foreign key: a spec page can be deleted from the wiki without
        // the feature becoming unreadable, and the endpoint re-checks the page
        // still exists before treating the link as live.
        sqlite: 'ALTER TABLE pb_features ADD COLUMN spec_page_id TEXT',
        mysql: 'ALTER TABLE pb_features ADD COLUMN spec_page_id VARCHAR(36) NULL',
      },
    }],
  },
  {
    id: '018_sprint_release_slugs',
    description: 'Stable URL slugs for sprints and releases',
    steps: [
      {
        addColumn: {
          table: 'sprints', column: 'slug',
          sqlite: 'ALTER TABLE sprints ADD COLUMN slug TEXT',
          mysql: 'ALTER TABLE sprints ADD COLUMN slug VARCHAR(255) NULL',
        },
      },
      {
        addColumn: {
          table: 'versions', column: 'slug',
          sqlite: 'ALTER TABLE versions ADD COLUMN slug TEXT',
          mysql: 'ALTER TABLE versions ADD COLUMN slug VARCHAR(255) NULL',
        },
      },
      {
        run: async (adapter) => {
          if (!['sqlite', 'mysql'].includes(adapter.driver)) {
            throw new Error(`018: unsupported driver ${adapter.driver}`);
          }
          const { slugify, uniqueSlug } = require('./utils/slug');
          for (const table of ['sprints', 'versions']) {
            const rows = await adapter.all(
              `SELECT id, project_id, name, slug FROM ${table} ORDER BY created_at, id`);
            const seen = {};
            for (const row of rows) {
              seen[row.project_id] = seen[row.project_id] || [];
              if (row.slug) {
                seen[row.project_id].push(row.slug);
                continue;
              }
              const slug = uniqueSlug(slugify(row.name), seen[row.project_id]);
              seen[row.project_id].push(slug);
              await adapter.exec(`UPDATE ${table} SET slug = ? WHERE id = ?`, [slug, row.id]);
            }
          }
        },
      },
      {
        sql: {
          sqlite: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_project_slug ON sprints(project_id, slug)',
          mysql: 'CREATE UNIQUE INDEX idx_sprints_project_slug ON sprints(project_id, slug)',
        },
      },
      {
        sql: {
          sqlite: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_project_slug ON versions(project_id, slug)',
          mysql: 'CREATE UNIQUE INDEX idx_versions_project_slug ON versions(project_id, slug)',
        },
      },
    ],
  },
  {
    // The product-discovery design originally called this migration 018.
    // Permanent entity URLs landed first and use 018 for sprint/release slugs,
    // so outcome tracking takes the next append-only id instead of rewriting
    // migration history.
    id: '019_feature_outcomes',
    description: 'Feature success measures, launch reviews, and a durable launch timestamp',
    steps: [
      {
        addColumn: {
          table: 'pb_features', column: 'launched_at',
          sqlite: 'ALTER TABLE pb_features ADD COLUMN launched_at TEXT',
          mysql: 'ALTER TABLE pb_features ADD COLUMN launched_at DATETIME(3) NULL',
        },
      },
      {
        sql: {
          sqlite: `CREATE TABLE IF NOT EXISTS pb_feature_outcomes (
            feature_id TEXT PRIMARY KEY REFERENCES pb_features(id),
            metric TEXT,
            target TEXT,
            baseline TEXT,
            measured TEXT,
            verdict TEXT CHECK(verdict IS NULL OR verdict IN ('achieved','partial','missed','too_early')),
            reviewed_at TEXT,
            reviewed_by TEXT REFERENCES users(id),
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )`,
          mysql: `CREATE TABLE IF NOT EXISTS pb_feature_outcomes (
            feature_id VARCHAR(36) PRIMARY KEY,
            metric TEXT,
            target TEXT,
            baseline TEXT,
            measured TEXT,
            verdict VARCHAR(20) NULL,
            reviewed_at DATETIME(3) NULL,
            reviewed_by VARCHAR(36) NULL,
            notes TEXT,
            created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
          ) DEFAULT CHARSET=utf8mb4`,
        },
      },
      // Existing launched features predate launched_at. updated_at is the
      // closest honest timestamp Atlas has for them; all future transitions
      // write the exact first-launch time and never overwrite it on later edits.
      {
        sql: {
          sqlite: `UPDATE pb_features
                   SET launched_at = COALESCE(updated_at, created_at, datetime('now'))
                   WHERE status = 'launched' AND launched_at IS NULL`,
          mysql: `UPDATE pb_features
                  SET launched_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP(3))
                  WHERE status = 'launched' AND launched_at IS NULL`,
        },
      },
    ],
  },
  {
    // Portal v2 was numbered 019 in its design. Outcome tracking now owns 019,
    // so this follows it without changing append-only migration history.
    id: '020_portal_followers',
    description: 'Customer follows for public product features',
    steps: [{
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS pb_portal_followers (
          feature_id TEXT NOT NULL REFERENCES pb_features(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          created_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (feature_id, user_id)
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS pb_portal_followers (
          feature_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (feature_id, user_id)
        ) DEFAULT CHARSET=utf8mb4`,
      },
    }],
  },
  {
    // Designed as migration 018 before stable entity URLs and the product
    // loop-closing slices landed. Append-only history makes this 021 here.
    id: '021_sla_query_boundaries',
    description: 'Stored SLA due and at-risk boundaries for JQL v2',
    steps: [
      {
        addColumn: {
          table: 'sd_sla_clocks', column: 'due_at',
          sqlite: 'ALTER TABLE sd_sla_clocks ADD COLUMN due_at TEXT',
          mysql: 'ALTER TABLE sd_sla_clocks ADD COLUMN due_at DATETIME(3) NULL',
        },
      },
      {
        addColumn: {
          table: 'sd_sla_clocks', column: 'at_risk_at',
          sqlite: 'ALTER TABLE sd_sla_clocks ADD COLUMN at_risk_at TEXT',
          mysql: 'ALTER TABLE sd_sla_clocks ADD COLUMN at_risk_at DATETIME(3) NULL',
        },
      },
      {
        // Backfill with the same pure helper lifecycle writes use. SQL only
        // compares timestamps; it never reimplements SLA arithmetic per dialect.
        run: async (adapter) => {
          if (!['sqlite', 'mysql'].includes(adapter.driver)) {
            throw new Error(`021: unsupported driver ${adapter.driver}`);
          }
          const { slaBoundaries } = require('./utils/sla');
          const clocks = await adapter.all(
            `SELECT id, started_at, target_minutes, paused_total_minutes,
                    due_at, at_risk_at
               FROM sd_sla_clocks`);
          for (const clock of clocks) {
            const boundaries = slaBoundaries(clock);
            await adapter.exec(
              'UPDATE sd_sla_clocks SET due_at = ?, at_risk_at = ? WHERE id = ?',
              [boundaries.due_at, boundaries.at_risk_at, clock.id]);
          }
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_sla_clocks_due ON sd_sla_clocks(due_at)',
          mysql: 'CREATE INDEX idx_sla_clocks_due ON sd_sla_clocks(due_at)',
        },
      },
      {
        sql: {
          sqlite: 'CREATE INDEX IF NOT EXISTS idx_sla_clocks_at_risk ON sd_sla_clocks(at_risk_at)',
          mysql: 'CREATE INDEX idx_sla_clocks_at_risk ON sd_sla_clocks(at_risk_at)',
        },
      },
    ],
  },
  {
    id: '022_dashboard_layouts',
    description: 'Per-user, per-project dashboard gadget layouts',
    steps: [{
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS dashboard_layouts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          project_id TEXT NOT NULL REFERENCES projects(id),
          gadgets TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, project_id)
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS dashboard_layouts (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          project_id VARCHAR(36) NOT NULL,
          gadgets TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_dashboard_layout_user_project (user_id, project_id)
        ) DEFAULT CHARSET=utf8mb4`,
      },
    }],
  },
  {
    id: '023_wiki_page_numbers',
    description: 'Per-space sequence number for wiki pages (shareable SPACE-WIKI-n keys)',
    steps: [
      {
        addColumn: {
          table: 'wiki_pages', column: 'page_number',
          sqlite: 'ALTER TABLE wiki_pages ADD COLUMN page_number INTEGER',
          mysql: 'ALTER TABLE wiki_pages ADD COLUMN page_number INT NULL',
        },
      },
      {
        run: async (adapter) => {
          if (!['sqlite', 'mysql'].includes(adapter.driver)) {
            throw new Error(`023: unsupported driver ${adapter.driver}`);
          }
          const rows = await adapter.all(
            'SELECT id, space_id FROM wiki_pages ORDER BY space_id, created_at, id');
          const next = {};
          for (const row of rows) {
            next[row.space_id] = (next[row.space_id] || 0) + 1;
            await adapter.exec('UPDATE wiki_pages SET page_number = ? WHERE id = ?', [next[row.space_id], row.id]);
          }
        },
      },
      {
        sql: {
          sqlite: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_pages_space_number ON wiki_pages(space_id, page_number)',
          mysql: 'CREATE UNIQUE INDEX idx_wiki_pages_space_number ON wiki_pages(space_id, page_number)',
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
  // A step that needs to inspect the database before deciding what SQL to run
  // (e.g. rebuilding a table whose exact column set varies by migration history)
  // supplies a function instead of a SQL string. It receives the adapter and is
  // responsible for its own idempotency.
  if (step.run) {
    await step.run(adapter);
    return;
  }
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
