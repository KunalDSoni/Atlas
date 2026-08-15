#!/usr/bin/env node
// One-time removal of tracked time that no real session supports.
//
// Two generations of the same mistake are in the data. A timer nobody paused
// stayed open, accrued against `now` on every read, and was committed whole
// when the issue reached a done status — a stopwatch forgotten on a Friday
// afternoon could land in work_logs as three weeks of work. The rule that
// replaced it credited a flat twelve hours instead, which is a smaller
// invention but still an invention.
//
// Both are removed here: an abandoned segment credits nothing, because nobody
// knows how long the session really was. The people affected can log what they
// actually worked from the issue itself.
//
// DRY RUN BY DEFAULT — prints what it would change and writes nothing:
//
//   node backend/scripts/repair-timer-overcounts.js
//   node backend/scripts/repair-timer-overcounts.js --apply
//
// Safe to re-run. See findTimerOvercounts in utils/timers.js for the rule.

const { initDb, getDb } = require('../database');
const { findTimerOvercounts } = require('../utils/timers');

const hours = (minutes) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;

(async () => {
  const apply = process.argv.includes('--apply');
  await initDb();
  const db = await getDb();

  // Always inspect first, so --apply can print the before/after it acted on.
  const preview = await findTimerOvercounts(db);
  if (preview.segments.length === 0) {
    console.log('✓ Every timer work log matches what its segments credit. Nothing to repair.');
    process.exit(0);
  }

  console.log(`${preview.segments.length} segment(s) crediting time no session supports:\n`);
  for (const seg of preview.segments) {
    console.log(
      `  ${String(seg.issue_key).padEnd(12)} ${String(seg.user_name || 'Unknown').padEnd(20)} ` +
      `${seg.started_at} → ${seg.ended_at}  ` +
      `${hours(seg.minutes).padStart(12)} → ${hours(seg.credited_minutes)}`
    );
  }
  console.log('\nWork logs affected:\n');
  for (const pair of preview.pairs) {
    console.log(
      `  ${String(pair.issueKey).padEnd(12)} ${String(pair.userName).padEnd(20)} ` +
      `${hours(pair.logged_minutes).padStart(12)} → ${hours(pair.credited_after)}`
    );
  }
  console.log(`\nTracked time recorded against these people: ${hours(preview.minutes_before)} → ` +
    `${hours(preview.minutes_after)} (${hours(preview.minutes_before - preview.minutes_after)} removed)`);
  console.log(`Affects ${preview.pairs.length} issue/user pair(s).`);

  if (!apply) {
    console.log('\nDry run — nothing was written. Re-run with --apply to make these changes.');
    process.exit(0);
  }

  const result = await findTimerOvercounts(db, { apply: true });
  for (const pair of result.pairs) {
    console.log(`  rewrote ${pair.issueKey} → ${hours(pair.repaired_minutes)} tracked`);
  }
  console.log(`\n✓ Repaired ${result.segments.length} segment(s) across ${result.pairs.length} issue/user pair(s).`);
  process.exit(0);
})().catch((e) => {
  console.error('Repair failed:', e.message);
  process.exit(1);
});
