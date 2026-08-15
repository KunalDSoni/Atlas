/**
 * MENTION NOTIFICATION FAN-OUT TESTS
 *
 * Covers every path that turns a mention in stored text into a notification:
 * issue creation, issue description edits, and comments. The important cases
 * are the ones the previous name-matching implementation got wrong — an email
 * address read as a mention, an edit re-notifying everyone, and a description
 * mention emitting a type string that bypassed the user's own opt-out.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, queryAll, queryOne, run } = require('../../database');
const { formatMention } = require('../../utils/mentions');

let app, adminH, db, projectId, users;

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(adminH);
  projectId = projects.body.find((p) => p.key === 'ATL').id;

  const rows = await queryAll(db, 'SELECT id, name, email, role FROM users');
  users = Object.fromEntries(rows.map((u) => [u.email.split('@')[0], u]));
});

/** Mention token for a seeded user, e.g. mention('sarah'). */
function mention(key) {
  return formatMention({ id: users[key].id, name: users[key].name });
}

async function mentionsFor(key) {
  return queryAll(db,
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'mention' ORDER BY created_at",
    [users[key].id]);
}

async function createIssue(body) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(adminH)
    .send({ type: 'task', priority: 'medium', title: 'Mention host', ...body });
  return res.body;
}

async function clearNotifications() {
  await run(db, 'DELETE FROM notifications', []);
}

beforeEach(clearNotifications);

describe('issue creation', () => {
  test('notifies a user mentioned in the description of a brand-new issue', async () => {
    await createIssue({ description: `Kicking off — ${mention('sarah')} can you scope this?` });
    const got = await mentionsFor('sarah');
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('mention');
    expect(got[0].message).toContain('mentioned you');
  });

  test('an issue created with no mentions notifies nobody', async () => {
    await createIssue({ description: 'Nothing to see here' });
    expect(await mentionsFor('sarah')).toHaveLength(0);
  });
});

describe('issue description edits', () => {
  test('uses the mention type so the notify_mentions preference applies', async () => {
    const issue = await createIssue({ description: 'Initial' });
    await request(app).put(`/api/issues/${issue.id}`).set(adminH)
      .send({ description: `Now ${mention('sarah')} please look` });

    const got = await mentionsFor('sarah');
    expect(got).toHaveLength(1);
    // 'mentioned' is not in email.js TYPE_TOGGLE, so it silently bypassed the
    // recipient's notify_mentions setting. Only 'mention' is honoured.
    expect(got[0].type).toBe('mention');
  });

  test('editing around an existing mention does not notify again', async () => {
    const issue = await createIssue({ description: `cc ${mention('sarah')}` });
    expect(await mentionsFor('sarah')).toHaveLength(1);

    await request(app).put(`/api/issues/${issue.id}`).set(adminH)
      .send({ description: `cc ${mention('sarah')} — fixed a typo` });

    expect(await mentionsFor('sarah')).toHaveLength(1);
  });

  test('adding a second mention notifies only the new person', async () => {
    const issue = await createIssue({ description: `cc ${mention('sarah')}` });
    await clearNotifications();

    await request(app).put(`/api/issues/${issue.id}`).set(adminH)
      .send({ description: `cc ${mention('sarah')} and ${mention('alex')}` });

    expect(await mentionsFor('sarah')).toHaveLength(0);
    expect(await mentionsFor('alex')).toHaveLength(1);
  });
});

describe('comments', () => {
  test('notifies a mentioned user', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: `${mention('alex')} thoughts?` });

    const got = await mentionsFor('alex');
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('mention');
  });

  test('a mention outranks the watcher notification for the same person', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/watchers`).set(adminH)
      .send({ user_id: users.alex.id });
    await clearNotifications();

    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: `${mention('alex')} please review` });

    const all = await queryAll(db,
      'SELECT type FROM notifications WHERE user_id = ?', [users.alex.id]);
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('mention');
  });
});

describe('who never gets notified', () => {
  test('mentioning yourself is silent', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: `note to self ${mention('kunal')}` });
    expect(await mentionsFor('kunal')).toHaveLength(0);
  });

  test('a deactivated user is not notified', async () => {
    await run(db, 'UPDATE users SET is_active = 0 WHERE id = ?', [users.james.id]);
    try {
      const issue = await createIssue({ description: `${mention('james')} ping` });
      expect(await mentionsFor('james')).toHaveLength(0);
    } finally {
      await run(db, 'UPDATE users SET is_active = 1 WHERE id = ?', [users.james.id]);
    }
  });

  test('an email address is not a mention', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: 'mail me at sarah@example.com any time' });
    expect(await mentionsFor('sarah')).toHaveLength(0);
  });

  test('a client mentioned in an internal note is not notified', async () => {
    // Dana is a client: she cannot see internal notes, so notifying her would
    // reveal one exists and link her to something she cannot open.
    expect(users.dana.role).toBe('client');
    const issue = await createIssue({ description: 'x' });

    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: `${mention('dana')} FYI`, visibility: 'internal' });

    expect(await mentionsFor('dana')).toHaveLength(0);
  });

  test('the same client mentioned in a public reply is notified', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: `${mention('dana')} we have an update`, visibility: 'public' });

    expect(await mentionsFor('dana')).toHaveLength(1);
  });
});

describe('legacy plain-text mentions', () => {
  test('an unambiguous full name still notifies', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: 'cc @Sarah Chen for visibility' });
    expect(await mentionsFor('sarah')).toHaveLength(1);
  });

  test('a name matching two active users notifies neither', async () => {
    const twinId = 'twin-sarah-id';
    await run(db,
      `INSERT INTO users (id, name, email, password, role, avatar_color, is_active)
       VALUES (?, 'Sarah Chen', 'sarah.twin@example.com', 'x', 'user', '#000', 1)`,
      [twinId]);
    try {
      const issue = await createIssue({ description: 'x' });
      await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
        .send({ body: 'cc @Sarah Chen please' });

      expect(await mentionsFor('sarah')).toHaveLength(0);
      const twin = await queryAll(db,
        "SELECT * FROM notifications WHERE user_id = ? AND type = 'mention'", [twinId]);
      expect(twin).toHaveLength(0);
    } finally {
      await run(db, 'DELETE FROM users WHERE id = ?', [twinId]);
    }
  });

  test('a token wins over a legacy name for the same text', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: `${mention('sarah')} and @Sarah Chen` });
    expect(await mentionsFor('sarah')).toHaveLength(1);
  });
});

describe('notification message text', () => {
  test('the stored message shows a readable name, never raw token syntax', async () => {
    const issue = await createIssue({ description: 'x' });
    await request(app).post(`/api/issues/${issue.id}/comments`).set(adminH)
      .send({ body: `${mention('alex')} take a look` });

    const got = await mentionsFor('alex');
    expect(got[0].message).not.toContain('](user:');
    expect(got[0].message).not.toContain('@[');
  });
});
