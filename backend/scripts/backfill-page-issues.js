#!/usr/bin/env node
// One-time backfill of wiki_page_issues for deployments that predate the
// wiki ↔ issue integration. Safe to re-run.
//
//   node backend/scripts/backfill-page-issues.js

const { initDb, getDb } = require('../database');
const { backfillPageIssueLinks } = require('../utils/issue-keys');

(async () => {
  await initDb();
  const db = await getDb();
  const count = await backfillPageIssueLinks(db);
  console.log(`✓ Indexed issue links for ${count} wiki pages`);
  process.exit(0);
})().catch((e) => {
  console.error('Backfill failed:', e.message);
  process.exit(1);
});
