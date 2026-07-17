/**
 * PRODUCT WAVE TESTS — Epics 13-18 (Productboard parity)
 * companies/customers, insights + links, features + scores, prioritization,
 * push-to-delivery, votes, objectives + rollups, portal projection,
 * JQL-lite search, and done-category epic rollups.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');
const { parseJql, isJqlLike } = require('../../utils/jql');

let app, headers, clientHeaders, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  clientHeaders = await userHeaders(); // priya@example.com — role 'client'
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
});

// ===== Epic 15: Companies & customers =====
describe('companies & customers', () => {
  test('seeded companies come back ordered by tier with counts', async () => {
    const res = await request(app).get('/api/product/companies').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].tier).toBe('strategic'); // strategic sorts first
    expect(res.body[0]).toHaveProperty('customer_count');
  });

  test('create/update/delete company', async () => {
    const created = await request(app).post('/api/product/companies').set(headers)
      .send({ name: 'Initech', tier: 'growth', arr: 42000 });
    expect(created.status).toBe(201);
    expect(created.body.tier).toBe('growth');

    const updated = await request(app).put(`/api/product/companies/${created.body.id}`).set(headers)
      .send({ tier: 'strategic' });
    expect(updated.body.tier).toBe('strategic');

    const del = await request(app).delete(`/api/product/companies/${created.body.id}`).set(headers);
    expect(del.status).toBe(200);
  });

  test('rejects invalid tier and missing name', async () => {
    expect((await request(app).post('/api/product/companies').set(headers).send({ name: 'X', tier: 'bogus' })).status).toBe(400);
    expect((await request(app).post('/api/product/companies').set(headers).send({})).status).toBe(400);
  });

  test('customer links to a company', async () => {
    const companies = await request(app).get('/api/product/companies').set(headers);
    const res = await request(app).post('/api/product/customers').set(headers)
      .send({ name: 'New Contact', email: 'nc@example.com', company_id: companies.body[0].id });
    expect(res.status).toBe(201);
    expect(res.body.company_name).toBe(companies.body[0].name);
  });
});

// ===== Epic 13: Insights =====
describe('insights', () => {
  test('lists seeded insights and filters by processed', async () => {
    const all = await request(app).get('/api/product/insights').set(headers);
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThan(0);

    const inbox = await request(app).get('/api/product/insights?processed=0').set(headers);
    expect(inbox.body.every((i) => i.processed === 0)).toBe(true);
  });

  test('create insight then link to a feature marks it processed', async () => {
    const features = await request(app).get('/api/product/features').set(headers);
    const featureId = features.body[0].id;

    const ins = await request(app).post('/api/product/insights').set(headers)
      .send({ title: 'Needs bulk export', content: 'Wants to export everything', source: 'support' });
    expect(ins.status).toBe(201);
    expect(ins.body.processed).toBe(0);

    const link = await request(app).post(`/api/product/insights/${ins.body.id}/links`).set(headers)
      .send({ feature_id: featureId, importance: 3, quote: 'export everything' });
    expect(link.status).toBe(201);

    const after = await request(app).get(`/api/product/insights/${ins.body.id}`).set(headers);
    expect(after.body.processed).toBe(1);
    expect(after.body.features.some((f) => f.id === featureId)).toBe(true);
  });

  test('duplicate link is rejected', async () => {
    const features = await request(app).get('/api/product/features').set(headers);
    const ins = await request(app).post('/api/product/insights').set(headers).send({ title: 'Dup test' });
    await request(app).post(`/api/product/insights/${ins.body.id}/links`).set(headers).send({ feature_id: features.body[0].id });
    const dup = await request(app).post(`/api/product/insights/${ins.body.id}/links`).set(headers).send({ feature_id: features.body[0].id });
    expect(dup.status).toBe(400);
  });
});

// ===== Epic 14: Features & prioritization scores =====
describe('features & scores', () => {
  test('user_impact is tier-weighted over linked insights', async () => {
    // A fresh feature with two insights: one strategic (×3) importance 3 = 9,
    // one standard (×1) importance 2 = 2  →  user_impact 11.
    const companies = await request(app).get('/api/product/companies').set(headers);
    const strategic = companies.body.find((c) => c.tier === 'strategic');

    const strategicCust = await request(app).post('/api/product/customers').set(headers)
      .send({ name: 'Impact A', company_id: strategic.id });
    const noCompanyCust = await request(app).post('/api/product/customers').set(headers)
      .send({ name: 'Impact B' });

    const feat = await request(app).post('/api/product/features').set(headers).send({ name: 'Impact math feature' });
    const insA = await request(app).post('/api/product/insights').set(headers).send({ title: 'A', customer_id: strategicCust.body.id });
    const insB = await request(app).post('/api/product/insights').set(headers).send({ title: 'B', customer_id: noCompanyCust.body.id });
    await request(app).post(`/api/product/insights/${insA.body.id}/links`).set(headers).send({ feature_id: feat.body.id, importance: 3 });
    await request(app).post(`/api/product/insights/${insB.body.id}/links`).set(headers).send({ feature_id: feat.body.id, importance: 2 });

    const got = await request(app).get(`/api/product/features/${feat.body.id}`).set(headers);
    expect(got.body.user_impact).toBe(11);
  });

  test('RICE is computed from reach/impact/confidence/effort', async () => {
    const feat = await request(app).post('/api/product/features').set(headers)
      .send({ name: 'RICE feature', reach: 100, impact: 3, confidence: 50, effort: 5 });
    // 100 * 3 * 0.5 / 5 = 30
    const got = await request(app).get(`/api/product/features/${feat.body.id}`).set(headers);
    expect(got.body.rice).toBe(30);
  });

  test('filters by status and timeframe', async () => {
    const planned = await request(app).get('/api/product/features?status=planned').set(headers);
    expect(planned.body.every((f) => f.status === 'planned')).toBe(true);
    const now = await request(app).get('/api/product/features?timeframe=now').set(headers);
    expect(now.body.every((f) => f.timeframe === 'now')).toBe(true);
  });

  test('vote toggles on and off', async () => {
    const feat = await request(app).post('/api/product/features').set(headers).send({ name: 'Votable' });
    const on = await request(app).post(`/api/product/features/${feat.body.id}/vote`).set(headers);
    expect(on.body).toEqual({ voted: true, vote_count: 1 });
    const off = await request(app).post(`/api/product/features/${feat.body.id}/vote`).set(headers);
    expect(off.body).toEqual({ voted: false, vote_count: 0 });
  });
});

// ===== Epic 17: push-to-delivery =====
describe('push to delivery', () => {
  test('creates a linked issue in the project and advances feature status', async () => {
    const feat = await request(app).post('/api/product/features').set(headers)
      .send({ name: 'Deliver me', status: 'planned', project_id: projectId, description: 'ship it' });
    const pushed = await request(app).post(`/api/product/features/${feat.body.id}/push`).set(headers)
      .send({ project_id: projectId, type: 'epic' });
    expect(pushed.status).toBe(201);
    expect(pushed.body.delivery_total).toBe(1);
    expect(pushed.body.status).toBe('in_progress');

    const detail = await request(app).get(`/api/product/features/${feat.body.id}`).set(headers);
    expect(detail.body.issues[0].issue_key).toMatch(/^ATL-/);
    expect(detail.body.issues[0].type).toBe('epic');
  });

  test('rejects invalid push type', async () => {
    const feat = await request(app).post('/api/product/features').set(headers).send({ name: 'Bad push', project_id: projectId });
    const res = await request(app).post(`/api/product/features/${feat.body.id}/push`).set(headers).send({ type: 'subtask' });
    expect(res.status).toBe(400);
  });
});

// ===== Epic 16: objectives =====
describe('objectives', () => {
  test('rollup counts launched features', async () => {
    const obj = await request(app).post('/api/product/objectives').set(headers).send({ name: 'Ship fast' });
    const launched = await request(app).post('/api/product/features').set(headers).send({ name: 'Done thing', status: 'launched' });
    const idea = await request(app).post('/api/product/features').set(headers).send({ name: 'Idea thing', status: 'idea' });
    await request(app).post(`/api/product/objectives/${obj.body.id}/features`).set(headers).send({ feature_id: launched.body.id });
    await request(app).post(`/api/product/objectives/${obj.body.id}/features`).set(headers).send({ feature_id: idea.body.id });

    const got = await request(app).get(`/api/product/objectives/${obj.body.id}`).set(headers);
    expect(got.body.feature_count).toBe(2);
    expect(got.body.launched_count).toBe(1);
    expect(got.body.features.length).toBe(2);
  });
});

// ===== Epic 18: portal =====
describe('idea portal', () => {
  test('only exposes features with a portal_status and no internal fields', async () => {
    const res = await request(app).get('/api/portal/features').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const f of res.body) {
      expect(f.portal_status).toBeTruthy();
      expect(f).not.toHaveProperty('effort');
      expect(f).not.toHaveProperty('user_impact');
      expect(f).not.toHaveProperty('owner_id');
      expect(typeof f.has_voted).toBe('boolean');
    }
  });

  test('a client-role user can view the portal and vote', async () => {
    const res = await request(app).get('/api/portal/features').set(clientHeaders);
    expect(res.status).toBe(200);
    // Pick a feature the client hasn't voted on so the toggle turns the vote on.
    const target = res.body.find((f) => !f.has_voted) || res.body[0];
    const vote = await request(app).post(`/api/product/features/${target.id}/vote`).set(clientHeaders);
    expect(vote.body.voted).toBe(!target.has_voted);
  });

  test('submitting an idea creates a portal-sourced insight', async () => {
    const before = await request(app).get('/api/product/insights?source=portal').set(headers);
    const res = await request(app).post('/api/portal/ideas').set(clientHeaders).send({ title: 'Please add webhooks', content: 'for CI' });
    expect(res.status).toBe(201);
    const after = await request(app).get('/api/product/insights?source=portal').set(headers);
    expect(after.body.length).toBe(before.body.length + 1);
    expect(after.body.some((i) => i.title === 'Please add webhooks')).toBe(true);
  });
});

// ===== Epic 18 polish: JQL-lite =====
describe('JQL-lite parser', () => {
  test('detects operators', () => {
    expect(isJqlLike('status = done')).toBe(true);
    expect(isJqlLike('login bug')).toBe(false);
  });

  test('parses multiple clauses with AND', () => {
    const r = parseJql('status = done AND type = bug', 'u1');
    expect(r.error).toBeUndefined();
    expect(r.where).toContain('LOWER(i.status)');
    expect(r.where).toContain('AND');
    expect(r.params).toEqual(['done', 'bug']);
  });

  test('assignee = me resolves to the current user', () => {
    const r = parseJql('assignee = me', 'user-123');
    expect(r.params).toEqual(['user-123']);
  });

  test('unassigned and != are supported', () => {
    expect(parseJql('assignee = unassigned', 'u1').where).toContain('IS NULL');
    expect(parseJql('priority != low', 'u1').where).toContain('!=');
  });

  test('unknown field is a hard error', () => {
    expect(parseJql('banana = 5', 'u1').error).toMatch(/Unknown field/);
  });

  test('search endpoint runs a JQL query', async () => {
    const res = await request(app).get('/api/search?q=' + encodeURIComponent('type = epic')).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.jql).toBe(true);
    expect(res.body.issues.every((i) => i.type === 'epic')).toBe(true);
  });

  test('malformed JQL returns 400', async () => {
    const res = await request(app).get('/api/search?q=' + encodeURIComponent('bogusfield = x')).set(headers);
    expect(res.status).toBe(400);
  });
});

// ===== Epic 18 polish: done-category epic rollups =====
describe('done-category epic rollups', () => {
  test('a child in a custom done-category status counts as done', async () => {
    // Create an epic + child, add a custom 'shipped' status in the done category,
    // move the child there, and confirm the rollup counts it.
    const epic = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Rollup epic', type: 'epic' });
    const child = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Rollup child', type: 'story', parent_id: epic.body.id, story_points: 5 });

    const status = await request(app).post(`/api/projects/${projectId}/statuses`).set(headers)
      .send({ label: 'Shipped', category: 'done' });
    expect(status.status).toBe(201);

    await request(app).put(`/api/issues/${child.body.id}/move`).set(headers)
      .send({ status: status.body.key });

    const epics = await request(app).get(`/api/projects/${projectId}/epics`).set(headers);
    const mine = epics.body.find((e) => e.id === epic.body.id);
    expect(mine.done_count).toBe(1);
    expect(mine.done_points).toBe(5);
  });
});
