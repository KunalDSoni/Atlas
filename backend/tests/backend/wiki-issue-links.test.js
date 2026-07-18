const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb, queryAll } = require('../../database');

let headers, db, spaceId, issueA, issueB;

async function linkRows(pageId) {
  return queryAll(db, 'SELECT issue_id FROM wiki_page_issues WHERE page_id = ?', [pageId]);
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();

  const spaces = await request(getApp()).get('/api/wiki/spaces').set(headers);
  spaceId = spaces.body[0].id;

  const projects = await request(getApp()).get('/api/projects').set(headers);
  const projectId = projects.body[0].id;
  const mk = async (title) => (await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title, type: 'task' })).body;
  issueA = await mk('Linked issue A');
  issueB = await mk('Linked issue B');
});

describe('page save populates issue links', () => {
  test('creates a row for each resolvable key in the body', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Link test', body: `<p>See ${issueA.issue_key} and ${issueB.issue_key}</p>` });
    expect(page.status).toBe(201);

    const rows = await linkRows(page.body.id);
    expect(rows.map(r => r.issue_id).sort()).toEqual([issueA.id, issueB.id].sort());
  });

  test('keys that resolve to no issue create no rows', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Junk keys', body: '<p>COVID-19 and ISO-8601 and ATLAS-99999</p>' });
    expect(await linkRows(page.body.id)).toEqual([]);
  });

  test('re-saving replaces the set rather than accumulating', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Replace test', body: `<p>${issueA.issue_key}</p>` });
    expect((await linkRows(page.body.id)).map(r => r.issue_id)).toEqual([issueA.id]);

    await request(getApp())
      .put(`/api/wiki/pages/${page.body.id}`).set(headers)
      .send({ body: `<p>${issueB.issue_key}</p>` });

    const rows = await linkRows(page.body.id);
    expect(rows.map(r => r.issue_id)).toEqual([issueB.id]);
  });

  test('removing every key clears the rows', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Clear test', body: `<p>${issueA.issue_key}</p>` });
    await request(getApp())
      .put(`/api/wiki/pages/${page.body.id}`).set(headers)
      .send({ body: '<p>nothing here now</p>' });
    expect(await linkRows(page.body.id)).toEqual([]);
  });

  test('a title-only update leaves links untouched', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Title only', body: `<p>${issueA.issue_key}</p>` });
    await request(getApp())
      .put(`/api/wiki/pages/${page.body.id}`).set(headers)
      .send({ title: 'Renamed, body untouched' });
    expect((await linkRows(page.body.id)).map(r => r.issue_id)).toEqual([issueA.id]);
  });

  test('the same key twice creates one row, not two', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Dupe test', body: `<p>${issueA.issue_key} and again ${issueA.issue_key}</p>` });
    expect(await linkRows(page.body.id)).toHaveLength(1);
  });
});
