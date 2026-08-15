/**
 * PRODUCT BOARD AND PORTAL MENTION FAN-OUT
 *
 * The product board is not project-scoped, so there is no membership rule here —
 * only the same edit-diff and self-mention rules every other surface follows.
 *
 * The portal is the exception worth testing: it is customer-facing, so a
 * client's idea must not be able to notify staff.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');
const { getDb, queryAll, run } = require('../../database');
const { formatMention } = require('../../utils/mentions');

let app, adminH, clientH, db, users;

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
  clientH = await loginAs('dana@customer.example.com', 'password123');

  const rows = await queryAll(db, 'SELECT id, name, email FROM users');
  users = Object.fromEntries(rows.map((u) => [u.email.split('@')[0], u]));
});

beforeEach(async () => { await run(db, 'DELETE FROM notifications', []); });

function mention(key) {
  return formatMention({ id: users[key].id, name: users[key].name });
}

async function mentionsFor(key) {
  return queryAll(db,
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'mention'", [users[key].id]);
}

describe('features', () => {
  test('a mention in a new feature description notifies', async () => {
    await request(app).post('/api/product/features').set(adminH)
      .send({ name: 'Saved views', description: `${mention('sarah')} can you own this?` });

    const got = await mentionsFor('sarah');
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('mention');
    expect(got[0].message).toContain('the feature "Saved views"');
  });

  test('editing the description notifies only the newly added person', async () => {
    const created = await request(app).post('/api/product/features').set(adminH)
      .send({ name: 'Bulk edit', description: `${mention('sarah')} first pass` });
    await run(db, 'DELETE FROM notifications', []);

    await request(app).put(`/api/product/features/${created.body.id}`).set(adminH)
      .send({ description: `${mention('sarah')} and ${mention('alex')} second pass` });

    expect(await mentionsFor('sarah')).toHaveLength(0);
    expect(await mentionsFor('alex')).toHaveLength(1);
  });

  test('changing a field other than the description notifies nobody', async () => {
    const created = await request(app).post('/api/product/features').set(adminH)
      .send({ name: 'Dark mode', description: `${mention('sarah')} owns this` });
    await run(db, 'DELETE FROM notifications', []);

    await request(app).put(`/api/product/features/${created.body.id}`).set(adminH)
      .send({ status: 'planned' });

    expect(await mentionsFor('sarah')).toHaveLength(0);
  });
});

describe('objectives', () => {
  test('a mention in an objective description notifies', async () => {
    await request(app).post('/api/product/objectives').set(adminH)
      .send({ name: 'Grow activation', description: `${mention('alex')} to define the metric` });

    const got = await mentionsFor('alex');
    expect(got).toHaveLength(1);
    expect(got[0].message).toContain('the objective "Grow activation"');
  });
});

describe('outcome reviews', () => {
  test('a mention in review notes notifies', async () => {
    const feature = await request(app).post('/api/product/features').set(adminH)
      .send({ name: 'Quick filters' });

    await request(app).put(`/api/product/features/${feature.body.id}/outcome`).set(adminH)
      .send({ notes: `${mention('sarah')} the numbers came in low`, verdict: 'missed' });

    const got = await mentionsFor('sarah');
    expect(got).toHaveLength(1);
    expect(got[0].message).toContain('the outcome review for "Quick filters"');
  });
});

describe('insights', () => {
  test('a mention in insight content notifies', async () => {
    await request(app).post('/api/product/insights').set(adminH)
      .send({ title: 'Export is slow', content: `${mention('alex')} heard this twice today` });

    expect(await mentionsFor('alex')).toHaveLength(1);
  });
});

describe('the portal boundary', () => {
  test('a staff idea can mention a colleague', async () => {
    await request(app).post('/api/portal/ideas').set(adminH)
      .send({ title: 'Keyboard shortcuts', content: `${mention('sarah')} thoughts?` });

    expect(await mentionsFor('sarah')).toHaveLength(1);
  });

  test("a customer's idea cannot notify staff", async () => {
    // The picker is closed to clients, so this is the hand-typed case: a
    // customer must not be able to ping staff by naming them.
    const res = await request(app).post('/api/portal/ideas').set(clientH)
      .send({ title: 'Please add SSO', content: 'cc @Sarah Chen we need this' });

    expect(res.status).toBe(201);
    expect(await mentionsFor('sarah')).toHaveLength(0);
  });
});
