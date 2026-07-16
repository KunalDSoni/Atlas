#!/usr/bin/env node
// ===== ONE-OFF MIGRATION: hash any plaintext passwords in place =====
//
//   node scripts/hash-passwords.js          # report what would change
//   node scripts/hash-passwords.js --apply  # rewrite them
//
// Atlas historically stored passwords as plaintext. Logging in now re-hashes a user's
// password automatically, but that only covers accounts that actually log in — run this
// to convert every account at once. Existing passwords keep working afterwards.

const { getDb, queryAll, run, initDb } = require('../database');
const { hashPasswordSync, isHashed } = require('../utils/password');

async function main() {
  const apply = process.argv.includes('--apply');

  await initDb();
  const db = await getDb();
  const users = await queryAll(db, 'SELECT id, email, password FROM users');

  const plaintext = users.filter(u => !isHashed(u.password));

  console.log(`\n  Users total:      ${users.length}`);
  console.log(`  Already hashed:   ${users.length - plaintext.length}`);
  console.log(`  Plaintext to fix: ${plaintext.length}\n`);

  if (plaintext.length === 0) {
    console.log('  Nothing to do — all credentials are hashed.\n');
    return;
  }

  for (const u of plaintext) console.log(`    ${apply ? 'hashing' : 'would hash'}  ${u.email}`);

  if (!apply) {
    console.log('\n  Dry run. Re-run with --apply to write these changes.\n');
    return;
  }

  for (const u of plaintext) {
    await run(db, 'UPDATE users SET password = ? WHERE id = ?', [hashPasswordSync(u.password), u.id]);
  }
  console.log(`\n  ✓ Hashed ${plaintext.length} password(s).\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
