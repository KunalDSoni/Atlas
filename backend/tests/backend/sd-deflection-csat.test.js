/**
 * KB DEFLECTION + CSAT (ATLAS-44/45)
 *
 * Deflection puts wiki content in front of a CUSTOMER, which makes it the one
 * feature in this wave that can leak the internal wiki. The suggestion tests
 * below are written boundary-first for that reason: what a customer must NOT be
 * offered matters more than what they are.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');

let app, agent, client, projectId, typeId, spaceId, articleId;

async function raise(summary, type = typeId) {
  const res = await request(app).post('/api/help/requests').set(client)
    .send({ request_type_id: type, summary, fields: {} });
  expect(res.status).toBe(201);
  return res.body.key;
}

beforeAll(async () => {
  app = await createTestApp();
  agent = await adminHeaders();
  client = await loginAs('dana@customer.example.com', 'password123');

  const projects = await request(app).get('/api/projects').set(agent);
  projectId = projects.body.find((p) => p.key === 'HD').id;

  const type = await request(app).post(`/api/projects/${projectId}/request-types`).set(agent)
    .send({ name: 'Printer trouble', fields: [] });
  typeId = type.body.id;

  // A dedicated space with one published article for this request type.
  const space = await request(app).post('/api/wiki/spaces').set(agent)
    .send({ space_key: 'HELP', name: 'Help articles' });
  spaceId = space.body.id;
  const page = await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(agent)
    .send({ title: 'Printer will not print', body: 'Turn it off and on again.' });
  articleId = page.body.id;
});

describe('curating articles for a request type', () => {
  test('a board admin attaches an article and it lists back', async () => {
    const res = await request(app).post(`/api/request-types/${typeId}/articles`).set(agent)
      .send({ page_id: articleId });
    expect(res.status).toBe(201);

    const list = await request(app).get(`/api/request-types/${typeId}/articles`).set(agent);
    expect(list.body.map((a) => a.page_id)).toContain(articleId);
    expect(list.body[0].title).toBe('Printer will not print');
  });

  test('an ordinary user cannot curate', async () => {
    const user = await loginAs('priya@example.com', 'password123');
    const res = await request(app).post(`/api/request-types/${typeId}/articles`).set(user)
      .send({ page_id: articleId });
    expect(res.status).toBe(403);
  });

  test('an article can be detached', async () => {
    const page = await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(agent)
      .send({ title: 'Temporary article', body: 'x' });
    await request(app).post(`/api/request-types/${typeId}/articles`).set(agent)
      .send({ page_id: page.body.id });
    const del = await request(app).delete(`/api/request-types/${typeId}/articles/${page.body.id}`).set(agent);
    expect(del.status).toBe(200);

    const list = await request(app).get(`/api/request-types/${typeId}/articles`).set(agent);
    expect(list.body.map((a) => a.page_id)).not.toContain(page.body.id);
  });
});

describe('suggestions — the customer boundary', () => {
  test('a customer is offered the curated article', async () => {
    const res = await request(app).get(`/api/help/suggestions?type=${typeId}&q=printer`).set(client);
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.id)).toContain(articleId);
  });

  test('suggestions carry no wiki internals — only what a link needs', async () => {
    const res = await request(app).get(`/api/help/suggestions?type=${typeId}&q=printer`).set(client);
    const keys = Object.keys(res.body[0]).sort();
    expect(keys).toEqual(['excerpt', 'id', 'slug', 'title']);
  });

  test('a request type with no curated articles suggests NOTHING, not the whole wiki', async () => {
    // The fallback search is bounded by the spaces an admin curated INTO. With
    // no curation there is no bounded space, and defaulting to "search
    // everything" would hand customers the internal engineering wiki.
    const bare = await request(app).post(`/api/projects/${projectId}/request-types`).set(agent)
      .send({ name: 'Uncurated', fields: [] });
    const res = await request(app).get(`/api/help/suggestions?type=${bare.body.id}&q=architecture`).set(client);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('the fallback search never leaves the curated spaces', async () => {
    // "Architecture Overview" is a seeded page in the ENG space. It matches the
    // query, but ENG is not a space this request type draws from.
    const res = await request(app).get(`/api/help/suggestions?type=${typeId}&q=architecture`).set(client);
    expect(res.body.every((s) => s.title !== 'Architecture Overview')).toBe(true);
  });

  test('an uncurated page in a curated space IS reachable by search', async () => {
    await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(agent)
      .send({ title: 'Scanner jams', body: 'Open the tray.' });
    const res = await request(app).get(`/api/help/suggestions?type=${typeId}&q=scanner`).set(client);
    expect(res.body.map((s) => s.title)).toContain('Scanner jams');
  });

  test('a restricted page is never suggested', async () => {
    const secret = await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(agent)
      .send({ title: 'Printer admin passwords', body: 'secret' });
    await request(app).put(`/api/wiki/pages/${secret.body.id}/restrictions`).set(agent)
      .send({ restrictions: [{ user_id: agent['x-user-id'], can_edit: 1 }] });

    const res = await request(app).get(`/api/help/suggestions?type=${typeId}&q=printer`).set(client);
    expect(res.body.every((s) => s.title !== 'Printer admin passwords')).toBe(true);
  });

  test('a draft or archived page is never suggested', async () => {
    const draft = await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(agent)
      .send({ title: 'Printer draft notes', body: 'wip' });
    expect(draft.status).toBe(201);
    // Status is set on update, not create.
    await request(app).put(`/api/wiki/pages/${draft.body.id}`).set(agent).send({ status: 'draft' });
    const res = await request(app).get(`/api/help/suggestions?type=${typeId}&q=printer`).set(client);
    expect(res.body.every((s) => s.title !== 'Printer draft notes')).toBe(true);
  });

  test('at most three suggestions come back', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(agent)
        .send({ title: `Printer topic ${i}`, body: 'printer printer' });
    }
    const res = await request(app).get(`/api/help/suggestions?type=${typeId}&q=printer`).set(client);
    expect(res.body.length).toBeLessThanOrEqual(3);
  });

  test('an empty query suggests the curated articles rather than erroring', async () => {
    const res = await request(app).get(`/api/help/suggestions?type=${typeId}`).set(client);
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.id)).toContain(articleId);
  });
});

describe('deflection hits', () => {
  test('opening a suggestion logs a hit', async () => {
    const res = await request(app).post('/api/help/article-hits').set(client)
      .send({ page_id: articleId, request_type_id: typeId });
    expect(res.status).toBe(201);
  });

  test('"this solved my problem" logs a helped hit', async () => {
    const res = await request(app).post('/api/help/article-hits').set(client)
      .send({ page_id: articleId, request_type_id: typeId, helped: true });
    expect(res.status).toBe(201);

    const report = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(agent);
    expect(report.body.deflection.helped).toBeGreaterThan(0);
  });

  test('a hit on a page that is not suggestible is refused', async () => {
    // Otherwise the endpoint is an oracle: post ids until one returns 201 and
    // you have enumerated the wiki.
    const eng = await request(app).get('/api/wiki/spaces').set(agent);
    const engSpace = eng.body.find((s) => s.space_key === 'ENG');
    const pages = await request(app).get(`/api/wiki/spaces/${engSpace.id}/pages`).set(agent);
    const internal = pages.body[0];

    const res = await request(app).post('/api/help/article-hits').set(client)
      .send({ page_id: internal.id, request_type_id: typeId });
    expect(res.status).toBe(404);
  });
});

describe('CSAT', () => {
  let resolvedKey;

  beforeAll(async () => {
    resolvedKey = await raise('Rate me please');
    await request(app).post(`/api/help/requests/${resolvedKey}/resolve`).set(client);
  });

  test('the reporter rates a resolved request', async () => {
    const res = await request(app).post(`/api/help/requests/${resolvedKey}/satisfaction`).set(client)
      .send({ rating: 5, comment: 'Fast and friendly' });
    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(5);
  });

  test('the rating is editable while the request stays resolved', async () => {
    const res = await request(app).post(`/api/help/requests/${resolvedKey}/satisfaction`).set(client)
      .send({ rating: 3 });
    expect(res.status).toBe(201);

    const detail = await request(app).get(`/api/help/requests/${resolvedKey}`).set(client);
    expect(detail.body.satisfaction.rating).toBe(3);
  });

  test('one rating per request — rating twice updates, never duplicates', async () => {
    const before = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(agent);
    await request(app).post(`/api/help/requests/${resolvedKey}/satisfaction`).set(client).send({ rating: 3 });
    const after = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(agent);
    // Rating again must move no totals — the UNIQUE on issue_id makes a second
    // row impossible, so this proves the update path, not an insert.
    expect(after.body.csat.count).toBe(before.body.csat.count);
  });

  test('a rating outside 1-5 is refused', async () => {
    for (const rating of [0, 6, 'five', null]) {
      const res = await request(app).post(`/api/help/requests/${resolvedKey}/satisfaction`).set(client)
        .send({ rating });
      expect(res.status).toBe(400);
    }
  });

  test('an unresolved request cannot be rated', async () => {
    const open = await raise('Still open');
    const res = await request(app).post(`/api/help/requests/${open}/satisfaction`).set(client)
      .send({ rating: 5 });
    expect(res.status).toBe(400);
  });

  test('only the reporter may rate — another customer gets 404, not 403', async () => {
    const other = await loginAs('kunal@example.com', 'password123');
    const res = await request(app).post(`/api/help/requests/${resolvedKey}/satisfaction`).set(other)
      .send({ rating: 1 });
    expect(res.status).toBe(404);
  });
});

describe('the service desk report', () => {
  test('it is agent-only', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(client);
    expect(res.status).toBe(403);
  });

  test('it reports volume by request type', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(agent);
    expect(res.status).toBe(200);
    const printer = res.body.volume_by_type.find((v) => v.name === 'Printer trouble');
    expect(printer.count).toBeGreaterThan(0);
  });

  test('it reports CSAT average and distribution', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(agent);
    // This suite left exactly one 3-star rating; the seed contributes others,
    // so assert on the rating this suite owns rather than a total it does not.
    expect(res.body.csat.distribution['3']).toBe(1);
    expect(res.body.csat.average).toBeGreaterThan(0);
    expect(res.body.csat.average).toBeLessThanOrEqual(5);
    expect(res.body.csat.count).toBe(
      Object.values(res.body.csat.distribution).reduce((a, n) => a + n, 0));
  });

  test('deflection rate is helped hits over helped hits plus requests raised', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(agent);
    const { helped, requests_raised, rate } = res.body.deflection;
    expect(rate).toBeCloseTo(helped / (helped + requests_raised), 5);
  });

  test('every panel is labelled since tracking began — no fabricated backfill', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/servicedesk-report`).set(agent);
    expect(res.body.since_tracking_began).toBe(true);
  });
});
