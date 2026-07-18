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

describe('GET /api/issues/:id/pages', () => {
  test('lists pages mentioning the issue', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Mentions A', body: `<p>${issueA.issue_key} discussion</p>` });

    const res = await request(getApp()).get(`/api/issues/${issueA.id}/pages`).set(headers);
    expect(res.status).toBe(200);
    const hit = res.body.find(p => p.id === page.body.id);
    expect(hit).toBeDefined();
    expect(hit.title).toBe('Mentions A');
    expect(hit.space_name).toBeTruthy();
    expect(hit.space_key).toBeTruthy();
  });

  test('returns [] for an issue no page mentions', async () => {
    const projects = await request(getApp()).get('/api/projects').set(headers);
    const lonely = (await request(getApp())
      .post(`/api/projects/${projects.body[0].id}/issues`).set(headers)
      .send({ title: 'Unmentioned', type: 'task' })).body;
    const res = await request(getApp()).get(`/api/issues/${lonely.id}/pages`).set(headers);
    expect(res.body).toEqual([]);
  });

  test('a restricted page is hidden from a user who cannot view it', async () => {
    const { run } = require('../../database');
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Secret retro', body: `<p>${issueB.issue_key} postmortem</p>` });

    // Restrict to the admin author only.
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 1)',
      [page.body.id, headers['x-user-id']]);

    const { loginAs } = require('./setup');
    const otherH = await loginAs('priya@example.com', 'password123');
    const other = await request(getApp()).get(`/api/issues/${issueB.id}/pages`).set(otherH);
    expect(other.body.some(p => p.id === page.body.id)).toBe(false);

    // The author still sees it.
    const mine = await request(getApp()).get(`/api/issues/${issueB.id}/pages`).set(headers);
    expect(mine.body.some(p => p.id === page.body.id)).toBe(true);
  });

  test('query count stays flat as the number of mentioning pages grows', async () => {
    const projects = await request(getApp()).get('/api/projects').set(headers);
    const target = (await request(getApp())
      .post(`/api/projects/${projects.body[0].id}/issues`).set(headers)
      .send({ title: 'Widely mentioned', type: 'task' })).body;

    const measure = async () => {
      const original = db.prepare.bind(db);
      let n = 0;
      db.prepare = (...a) => { n += 1; return original(...a); };
      await request(getApp()).get(`/api/issues/${target.id}/pages`).set(headers);
      db.prepare = original;
      return n;
    };

    await request(getApp()).post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Mention 0', body: `<p>${target.issue_key}</p>` });
    const small = await measure();

    for (let i = 1; i <= 8; i++) {
      await request(getApp()).post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
        .send({ title: `Mention ${i}`, body: `<p>${target.issue_key}</p>` });
    }
    const large = await measure();

    expect(large - small).toBeLessThanOrEqual(1);
  });
});

describe('forward reads', () => {
  test('GET a page returns linked_issues with live issue state', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Forward read', body: `<p>Tracking ${issueA.issue_key}</p>` });

    const res = await request(getApp()).get(`/api/wiki/pages/${page.body.id}`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.linked_issues)).toBe(true);
    const hit = res.body.linked_issues.find(i => i.id === issueA.id);
    expect(hit).toMatchObject({
      id: issueA.id,
      issue_key: issueA.issue_key,
      title: 'Linked issue A',
      type: 'task',
    });
    expect(hit).toHaveProperty('status');
    expect(hit).toHaveProperty('priority');
    expect(hit).toHaveProperty('assignee_name');
  });

  test('a page with no keys returns an empty linked_issues array', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'No keys', body: '<p>plain prose</p>' });
    const res = await request(getApp()).get(`/api/wiki/pages/${page.body.id}`).set(headers);
    expect(res.body.linked_issues).toEqual([]);
  });

  test('POST /api/issues/resolve returns summaries for known keys only', async () => {
    const res = await request(getApp())
      .post('/api/issues/resolve').set(headers)
      .send({ keys: [issueA.issue_key, 'COVID-19', 'ATLAS-99999'] });
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].issue_key).toBe(issueA.issue_key);
  });

  test('resolve accepts an empty list', async () => {
    const res = await request(getApp()).post('/api/issues/resolve').set(headers).send({ keys: [] });
    expect(res.status).toBe(200);
    expect(res.body.issues).toEqual([]);
  });

  test('resolve rejects more than 100 keys', async () => {
    const keys = Array.from({ length: 101 }, (_, i) => `ATLAS-${i}`);
    const res = await request(getApp()).post('/api/issues/resolve').set(headers).send({ keys });
    expect(res.status).toBe(400);
  });

  test('resolve rejects a non-array keys field', async () => {
    const res = await request(getApp()).post('/api/issues/resolve').set(headers).send({ keys: 'ATLAS-1' });
    expect(res.status).toBe(400);
  });

  test('JQL search rows include assignee_name', async () => {
    const res = await request(getApp())
      .get(`/api/search?q=${encodeURIComponent('type = task')}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.jql).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues[0]).toHaveProperty('assignee_name');
  });
});

describe('lifecycle', () => {
  test('deleting an issue removes its link rows', async () => {
    const projects = await request(getApp()).get('/api/projects').set(headers);
    const doomed = (await request(getApp())
      .post(`/api/projects/${projects.body[0].id}/issues`).set(headers)
      .send({ title: 'Doomed', type: 'task' })).body;

    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Mentions doomed', body: `<p>${doomed.issue_key}</p>` });
    expect(await linkRows(page.body.id)).toHaveLength(1);

    await request(getApp()).delete(`/api/issues/${doomed.id}`).set(headers);
    expect(await linkRows(page.body.id)).toEqual([]);
  });

  test('deleting a page removes its link rows', async () => {
    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Doomed page', body: `<p>${issueA.issue_key}</p>` });
    const pageId = page.body.id;
    expect(await linkRows(pageId)).toHaveLength(1);

    await request(getApp()).delete(`/api/wiki/pages/${pageId}`).set(headers);
    expect(await linkRows(pageId)).toEqual([]);
  });

  test('backfill is idempotent and rebuilds links for existing pages', async () => {
    const { backfillPageIssueLinks } = require('../../utils/issue-keys');
    const { run } = require('../../database');

    const page = await request(getApp())
      .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Backfill target', body: `<p>${issueA.issue_key}</p>` });

    // Simulate a deployment that predates the feature: rows never written.
    await run(db, 'DELETE FROM wiki_page_issues');
    expect(await linkRows(page.body.id)).toEqual([]);

    const count = await backfillPageIssueLinks(db);
    expect(count).toBeGreaterThan(0);
    expect((await linkRows(page.body.id)).map(r => r.issue_id)).toEqual([issueA.id]);

    // Running it again changes nothing.
    await backfillPageIssueLinks(db);
    expect(await linkRows(page.body.id)).toHaveLength(1);
  });
});
