#!/usr/bin/env node
// One-time repair of timer segments that recorded an impossible session length,
// for deployments that predate the abandonment cap.
//
// A timer nobody paused stayed open, accruing against `now` on every read, and
// was closed and committed whole when the issue eventually reached a done
// status — so a stopwatch forgotten on a Friday afternoon could land in
// work_logs as three weeks of tracked work. The live rules cap that now, but
// only while the segment is still open; anything already closed keeps its
// inflated span until this pass rewrites it.
//
// DRY RUN BY DEFAULT — prints what it would change and writes nothing:
//
//   node backend/scripts/repair-timer-overcounts.js
//   node backend/scripts/repair-timer-overcounts.js --apply
//
// Safe to re-run. See findTimerOvercounts in utils/timers.js for the rule.

const { initDb, getDb } = require('../database');
const { findTimerOvercounts, ABANDONED_AFTER_MINUTES } = require('../utils/timers');

const hours = (minutes) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;

(async () => {
  const apply = process.argv.includes('--apply');
  await initDb();
  const db = await getDb();

  // Always inspect first, so --apply can print the before/after it acted on.
  const preview = await findTimerOvercounts(db);
  if (preview.segments.length === 0) {
    console.log('✓ No timer segment exceeds the plausible-session threshold. Nothing to repair.');
    process.exit(0);
  }

  console.log(`${preview.segments.length} segment(s) longer than ${hours(ABANDONED_AFTER_MINUTES)}:\n`);
  for (const seg of preview.segments) {
    console.log(
      `  ${String(seg.issue_key).padEnd(12)} ${String(seg.user_name || 'Unknown').padEnd(20)} ` +
      `${seg.started_at} → ${seg.ended_at}  ` +
      `${hours(seg.minutes).padStart(12)} → ${hours(seg.capped_minutes)}`
    );
  }
  console.log(`\nTracked time across these segments: ${hours(preview.minutes_before)} → ` +
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
