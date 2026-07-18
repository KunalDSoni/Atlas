/**
 * pageAccessBatch must agree with pageAccess across every access case, because
 * pageAccess is being rewritten to delegate to it. These are the live rules
 * gating wiki page reads and edits.
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, loginAs } = require('./setup');
const { getDb, run } = require('../../database');
const { pageAccess, pageAccessBatch } = require('../../routes/wiki');

let db, adminH, spaceId, adminId, priyaId;

async function makePage(title, headers) {
  const res = await request(getApp())
    .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
    .send({ title, body: '<p>body</p>' });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
  adminId = adminH['x-user-id'];
  const priyaH = await loginAs('priya@example.com', 'password123');
  priyaId = priyaH['x-user-id'];
  const spaces = await request(getApp()).get('/api/wiki/spaces').set(adminH);
  spaceId = spaces.body[0].id;
});

describe('pageAccessBatch matches pageAccess', () => {
  test('unrestricted page: everyone views and edits', async () => {
    const id = await makePage('Unrestricted', adminH);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: false });
  });

  test('restricted page: unlisted user is denied', async () => {
    const id = await makePage('Restricted', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, adminId]);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: false, edit: false, restricted: true });
  });

  test('restricted page: the author always retains access', async () => {
    const id = await makePage('Author access', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, priyaId]);
    const single = await pageAccess(db, id, adminId, 'user');
    const batch = (await pageAccessBatch(db, [id], adminId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: true });
  });

  test('restricted page: an admin always retains access', async () => {
    const id = await makePage('Admin access', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, adminId]);
    const single = await pageAccess(db, id, priyaId, 'admin');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'admin')).get(id);
    expect(batch).toEqual(single);
    expect(single.view).toBe(true);
  });

  test('listed read-only user views but cannot edit when another row grants edit', async () => {
    const id = await makePage('Mixed rows', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, priyaId]);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 1)', [id, adminId]);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: false, restricted: true });
  });

  test('listed user edits when no row grants edit', async () => {
    const id = await makePage('No edit rows', adminH);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 0)', [id, priyaId]);
    const single = await pageAccess(db, id, priyaId, 'user');
    const batch = (await pageAccessBatch(db, [id], priyaId, 'user')).get(id);
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: true });
  });

  test('a missing page is permissive, matching the pre-refactor behaviour', async () => {
    const single = await pageAccess(db, 'does-not-exist', priyaId, 'user');
    const batch = (await pageAccessBatch(db, ['does-not-exist'], priyaId, 'user')).get('does-not-exist');
    expect(batch).toEqual(single);
    expect(single).toEqual({ view: true, edit: true, restricted: false });
  });

  test('an empty id list returns an empty map without querying', async () => {
    expect((await pageAccessBatch(db, [], priyaId, 'user')).size).toBe(0);
  });

  test('resolves many pages in a fixed number of queries', async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await makePage(`Batch page ${i}`, adminH));

    const original = db.prepare.bind(db);
    let n = 0;
    db.prepare = (...a) => { n += 1; return original(...a); };
    const map = await pageAccessBatch(db, ids, priyaId, 'user');
    db.prepare = original;

    expect(map.size).toBe(6);
    expect(n).toBeLessThanOrEqual(2); // one restrictions read, one authors read
  });
});
