const request = require('supertest');
const { createTestApp, getApp, adminHeaders, loginAs } = require('./setup');
const { getDb, run } = require('../../database');

let headers, otherHeaders, db, spaceId;

async function mkPage(title, body = '<p>content</p>') {
  const res = await request(getApp())
    .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
    .send({ title, body });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  otherHeaders = await loginAs('priya@example.com', 'password123');
  const spaces = await request(getApp()).get('/api/wiki/spaces').set(headers);
  spaceId = spaces.body[0].id;
});

describe('approving a page', () => {
  test('a fresh page is unapproved', async () => {
    const page = await mkPage('Unapproved page');
    const res = await request(getApp()).get(`/api/wiki/pages/${page.id}`).set(headers);
    expect(res.body.approval).toEqual({
      approved: false, version: null, stale: false,
      approved_by: null, approved_by_name: null, approved_at: null, note: null,
    });
  });

  test('approving records the approver, the version, and a note', async () => {
    const page = await mkPage('To approve');
    const res = await request(getApp())
      .post(`/api/wiki/pages/${page.id}/approve`).set(headers)
      .send({ note: 'Reviewed for accuracy' });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
    expect(res.body.version).toBe(page.version);
    expect(res.body.approved_by_name).toBeTruthy();
    expect(res.body.note).toBe('Reviewed for accuracy');
    expect(res.body.stale).toBe(false);

    const get = await request(getApp()).get(`/api/wiki/pages/${page.id}`).set(headers);
    expect(get.body.approval.approved).toBe(true);
    expect(get.body.approval.version).toBe(page.version);
  });

  test('editing an approved page marks the approval stale, not absent', async () => {
    const page = await mkPage('Edit after approval');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});

    await request(getApp()).put(`/api/wiki/pages/${page.id}`).set(headers)
      .send({ body: '<p>changed after sign-off</p>' });

    const get = await request(getApp()).get(`/api/wiki/pages/${page.id}`).set(headers);
    // The record of who approved what survives; it just no longer covers
    // the current version.
    expect(get.body.approval.approved).toBe(true);
    expect(get.body.approval.stale).toBe(true);
    expect(get.body.approval.version).toBe(page.version);
    expect(get.body.version).toBeGreaterThan(page.version);
  });

  test('re-approving after an edit clears staleness', async () => {
    const page = await mkPage('Re-approve');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    await request(getApp()).put(`/api/wiki/pages/${page.id}`).set(headers)
      .send({ body: '<p>v2</p>' });
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});

    const get = await request(getApp()).get(`/api/wiki/pages/${page.id}`).set(headers);
    expect(get.body.approval.stale).toBe(false);
    expect(get.body.approval.version).toBe(get.body.version);
  });

  test('a title-only edit does not stale the approval', async () => {
    // Renaming a page does not change what was reviewed.
    const page = await mkPage('Title edit only');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    await request(getApp()).put(`/api/wiki/pages/${page.id}`).set(headers)
      .send({ title: 'Renamed but same body' });

    const get = await request(getApp()).get(`/api/wiki/pages/${page.id}`).set(headers);
    expect(get.body.approval.stale).toBe(false);
  });
});

describe('revoking an approval', () => {
  test('revoking clears approved state', async () => {
    const page = await mkPage('To revoke');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    const res = await request(getApp())
      .delete(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(false);

    const get = await request(getApp()).get(`/api/wiki/pages/${page.id}`).set(headers);
    expect(get.body.approval.approved).toBe(false);
  });

  test('revoking an unapproved page is a no-op, not an error', async () => {
    const page = await mkPage('Never approved');
    const res = await request(getApp())
      .delete(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(false);
  });
});

describe('the approval log', () => {
  test('records every approve and revoke, newest first', async () => {
    const page = await mkPage('Logged page');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({ note: 'first' });
    await request(getApp()).delete(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({ note: 'again' });

    const res = await request(getApp()).get(`/api/wiki/pages/${page.id}/approvals`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    expect(res.body.map((r) => r.action)).toEqual(['approved', 'revoked', 'approved']);
    expect(res.body[0].note).toBe('again');
    expect(res.body[0].user_name).toBeTruthy();
  });

  test('the log survives a revoke — history is append-only', async () => {
    const page = await mkPage('History kept');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    await request(getApp()).delete(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    const res = await request(getApp()).get(`/api/wiki/pages/${page.id}/approvals`).set(headers);
    expect(res.body.length).toBe(2);
  });

  test('deleting a page removes its approval rows', async () => {
    const page = await mkPage('Doomed approved page');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    await request(getApp()).delete(`/api/wiki/pages/${page.id}`).set(headers);
    const rows = await require('../../database').queryAll(
      db, 'SELECT id FROM wiki_page_approvals WHERE page_id = ?', [page.id]);
    expect(rows).toEqual([]);
  });
});

describe('permissions', () => {
  test('a user who cannot edit a restricted page cannot approve it', async () => {
    const page = await mkPage('Restricted approval');
    // Restrict to the admin author with edit; priya is unlisted → no view/edit.
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 1)',
      [page.id, headers['x-user-id']]);

    const res = await request(getApp())
      .post(`/api/wiki/pages/${page.id}/approve`).set(otherHeaders).send({});
    expect(res.status).toBe(403);
  });

  test('approving a page that does not exist is 404', async () => {
    const res = await request(getApp())
      .post('/api/wiki/pages/no-such-page/approve').set(headers).send({});
    expect(res.status).toBe(404);
  });
});
