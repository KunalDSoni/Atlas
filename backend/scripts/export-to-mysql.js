#!/usr/bin/env node
// ===== Atlas — SQLite → MySQL exporter =====
//
// Reads an existing SQLite database (the sql.js file used in dev) and either:
//   (a) loads every row directly into a live MySQL database, or
//   (b) writes a portable .sql dump you can import with `mysql < dump.sql`.
//
// Usage:
//   node scripts/export-to-mysql.js                 # live load into MySQL (uses .env / MYSQL_* or DATABASE_URL)
//   node scripts/export-to-mysql.js --sqlite ./data.db
//   node scripts/export-to-mysql.js --out atlas-dump.sql   # write a .sql file instead of connecting
//   node scripts/export-to-mysql.js --truncate      # empty target tables before loading (live mode)
//
// The MySQL schema and the SQLite→MySQL SQL translation are imported from
// database.js so this stays in lockstep with the app's own schema.

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');                 // for escape() in dump mode
const config = require('../config');
const { MYSQL_SCHEMA_SQL } = require('../database');

// Date/time columns: SQLite stores these as TEXT (often '' when unset). MySQL
// DATETIME rejects empty strings, so we coerce '' → NULL for these.
const DATE_COLUMNS = new Set([
  'last_login', 'expires_at', 'start_date', 'end_date', 'due_date',
  'added_at', 'created_at', 'updated_at',
]);

function parseArgs(argv) {
  const args = { sqlite: config.db.sqlitePath, out: null, truncate: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sqlite') args.sqlite = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--truncate') args.truncate = true;
    else if (a === '--help' || a === '-h') { args.help = true; }
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

// Derive table names (in declaration order) from the shared schema.
function tableNames() {
  return MYSQL_SCHEMA_SQL.map(sql => {
    const m = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
    return m ? m[1] : null;
  }).filter(Boolean);
}

async function loadSqlite(sqlitePath) {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite file not found: ${sqlitePath}`);
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  return new SQL.Database(fs.readFileSync(sqlitePath));
}

// Returns { columns: [...], rows: [ {col: val} ] } for a table, or null if the
// table doesn't exist in the source database.
function readTable(sqliteDb, table) {
  let res;
  try {
    res = sqliteDb.exec(`SELECT * FROM ${table}`);
  } catch (e) {
    return null; // table absent in source
  }
  if (!res.length) return { columns: [], rows: [] };
  const { columns, values } = res[0];
  const rows = values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
  return { columns, rows };
}

function coerce(column, value) {
  if (value === undefined) return null;
  if (DATE_COLUMNS.has(column) && (value === '' || value === null)) return null;
  return value;
}

async function liveLoad(sqliteDb, args) {
  const { url, host, port, user, password, database } = config.db.mysql;
  const pool = url
    ? mysql.createPool({ uri: url, charset: 'utf8mb4' }).promise()
    : mysql.createPool({ host, port, user, password, database, charset: 'utf8mb4', multipleStatements: false }).promise();

  console.log(`→ Connecting to MySQL (${url ? url.replace(/:[^:@/]+@/, ':****@') : `${user}@${host}:${port}/${database}`})`);

  // Create schema
  for (const sql of MYSQL_SCHEMA_SQL) await pool.query(sql);

  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  let total = 0;
  for (const table of tableNames()) {
    const data = readTable(sqliteDb, table);
    if (!data) { console.log(`  · ${table}: (not in source, skipped)`); continue; }
    if (args.truncate) await pool.query(`DELETE FROM \`${table}\``);
    if (!data.rows.length) { console.log(`  · ${table}: 0 rows`); continue; }

    const cols = data.columns;
    const colList = cols.map(c => `\`${c}\``).join(', ');
    const placeholders = `(${cols.map(() => '?').join(', ')})`;

    // Batch inserts in chunks to keep packets small.
    const CHUNK = 200;
    for (let i = 0; i < data.rows.length; i += CHUNK) {
      const slice = data.rows.slice(i, i + CHUNK);
      const sql = `INSERT INTO \`${table}\` (${colList}) VALUES ${slice.map(() => placeholders).join(', ')}`;
      const params = [];
      for (const row of slice) for (const c of cols) params.push(coerce(c, row[c]));
      await pool.query(sql, params);
    }
    console.log(`  ✓ ${table}: ${data.rows.length} rows`);
    total += data.rows.length;
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  await pool.end();
  console.log(`\n✓ Done. Loaded ${total} rows into MySQL.`);
}

function dumpToFile(sqliteDb, outPath) {
  const lines = [];
  lines.push('-- Atlas SQLite → MySQL dump');
  lines.push(`-- Generated ${new Date().toISOString()}`);
  lines.push('SET NAMES utf8mb4;');
  lines.push('SET FOREIGN_KEY_CHECKS = 0;');
  lines.push('');

  for (const sql of MYSQL_SCHEMA_SQL) lines.push(sql.trim() + ';');
  lines.push('');

  let total = 0;
  for (const table of tableNames()) {
    const data = readTable(sqliteDb, table);
    if (!data || !data.rows.length) continue;
    const cols = data.columns;
    const colList = cols.map(c => mysql.escapeId(c)).join(', ');
    lines.push(`-- ${table} (${data.rows.length} rows)`);
    for (const row of data.rows) {
      const vals = cols.map(c => mysql.escape(coerce(c, row[c]))).join(', ');
      lines.push(`INSERT INTO ${mysql.escapeId(table)} (${colList}) VALUES (${vals});`);
    }
    lines.push('');
    total += data.rows.length;
  }

  lines.push('SET FOREIGN_KEY_CHECKS = 1;');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`✓ Wrote ${total} rows across ${tableNames().length} tables to ${outPath}`);
  console.log(`  Import with: mysql -u <user> -p <database> < ${outPath}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/export-to-mysql.js [--sqlite path] [--out file.sql] [--truncate]');
    return;
  }

  console.log(`→ Reading SQLite: ${path.resolve(args.sqlite)}`);
  const sqliteDb = await loadSqlite(args.sqlite);

  if (args.out) {
    dumpToFile(sqliteDb, path.resolve(args.out));
  } else {
    await liveLoad(sqliteDb, args);
  }
}

main().catch(err => {
  console.error('\n✗ Export failed:', err.message);
  process.exit(1);
});
