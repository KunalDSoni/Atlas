/**
 * PRODUCT OUTCOME TRACKING — Epic 51
 *
 * Launch is no longer the end of the product loop: a feature carries the
 * success measure it was launched against, post-launch feedback is derived
 * from stored insights, and overdue reviews are visible without a scheduler.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');

let app, headers, clientHeaders;

async function createFeature(name, status = 'idea') {
  return request(app).post('/api/product/features').set(headers).send({ name, status });
}

function sqlTimestamp(date) {
  return date.toISOString().replace('T', ' ').slice(0, 23);
}

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  clientHeaders = await loginAs('dana@customer.example.com', 'password123');
});

describe('outcome schema and launch lifecycle', () => {
  test('fresh databases include the outcome table and a durable launch timestamp', async () => {
    const { getDb, queryAll } = require('../../database');
    const db = await getDb();
    const featureColumns = (await queryAll(db, 'PRAGMA table_info(pb_features)')).map((c) => c.name);
    const outcomeColumns = (await queryAll(db, 'PRAGMA table_info(pb_feature_outcomes)')).map((c) => c.name);

    expect(featureColumns).toContain('launched_at');
    expect(outcomeColumns).toEqual(expect.arrayContaining([
      'feature_id', 'metric', 'target', 'baseline', 'measured', 'verdict',
      'reviewed_at', 'reviewed_by', 'notes',
    ]));
  });

  test('entering launched records the date and asks for a metric without blocking launch', async () => {
    const created = await createFeature('Measure this launch', 'planned');
    const launched = await request(app).put(`/api/product/features/${created.body.id}`).set(headers)
      .send({ status: 'launched' });

    expect(launched.status).toBe(200);
    expect(launched.body.status).toBe('launched');
    expect(launched.body.launched_at).toBeTruthy();
    expect(launched.body.needs_outcome_metric).toBe(true);

    const firstLaunch = launched.body.launched_at;
    await request(app).put(`/api/product/features/${created.body.id}`).set(headers)
      .send({ description: 'An edit after launch' });
    const detail = await request(app).get(`/api/product/features/${created.body.id}`).set(headers);
    expect(detail.body.launched_at).toBe(firstLaunch);
  });

  test('creating a feature already launched records the date too', async () => {
    const created = await createFeature('Already launched', 'launched');
    expect(created.status).toBe(201);
    expect(created.body.launched_at).toBeTruthy();
    expect(created.body.needs_outcome_metric).toBe(true);
  });
});

describe('success measures and launch reviews', () => {
  let featureId;

  beforeAll(async () => {
    const feature = await createFeature('Outcome CRUD', 'launched');
    featureId = feature.body.id;
  });

  test('saving a success measure does not pretend the launch was reviewed', async () => {
    const saved = await request(app).put(`/api/product/features/${featureId}/outcome`).set(headers)
      .send({
        metric: 'Weekly active teams',
        baseline: '120 teams',
        target: '180 teams within 60 days',
      });

    expect(saved.status).toBe(200);
    expect(saved.body.metric).toBe('Weekly active teams');
    expect(saved.body.target).toBe('180 teams within 60 days');
    expect(saved.body.reviewed_at).toBeNull();
    expect(saved.body.reviewed_by).toBeNull();

    const feature = await request(app).get(`/api/product/features/${featureId}`).set(headers);
    expect(feature.body.outcome.metric).toBe('Weekly active teams');
    expect(feature.body.needs_outcome_metric).toBe(false);
  });

  test('a verdict records who reviewed the launch and when', async () => {
    const saved = await request(app).put(`/api/product/features/${featureId}/outcome`).set(headers)
      .send({ measured: '166 teams after 60 days', verdict: 'partial', notes: 'Adoption is still climbing.' });

    expect(saved.status).toBe(200);
    expect(saved.body.verdict).toBe('partial');
    expect(saved.body.measured).toBe('166 teams after 60 days');
    expect(saved.body.reviewed_at).toBeTruthy();
    expect(saved.body.reviewed_by).toBeTruthy();
    expect(saved.body.reviewed_by_name).toBeTruthy();
  });

  test('rejects an unknown verdict without changing the outcome', async () => {
    const bad = await request(app).put(`/api/product/features/${featureId}/outcome`).set(headers)
      .send({ verdict: 'mostly_good' });
    expect(bad.status).toBe(400);

    const feature = await request(app).get(`/api/product/features/${featureId}`).set(headers);
    expect(feature.body.outcome.verdict).toBe('partial');
  });

  test('deleting a feature removes its outcome row', async () => {
    const feature = await createFeature('Disposable outcome', 'launched');
    await request(app).put(`/api/product/features/${feature.body.id}/outcome`).set(headers)
      .send({ metric: 'Deletion test' });
    await request(app).delete(`/api/product/features/${feature.body.id}`).set(headers);

    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    expect(await queryOne(db, 'SELECT feature_id FROM pb_feature_outcomes WHERE feature_id = ?', [feature.body.id])).toBeNull();
  });
});

describe('launch review queue and post-launch signals', () => {
  test('lists only feedback created after launch and flags overdue reviews', async () => {
    const feature = await createFeature('Post-launch signal', 'launched');
    const before = await request(app).post('/api/product/insights').set(headers)
      .send({ title: 'Feedback from before launch' });
    const after = await request(app).post('/api/product/insights').set(headers)
      .send({ title: 'Feedback after launch' });

    await request(app).post(`/api/product/insights/${before.body.id}/links`).set(headers)
      .send({ feature_id: feature.body.id, importance: 1 });
    await request(app).post(`/api/product/insights/${after.body.id}/links`).set(headers)
      .send({ feature_id: feature.body.id, importance: 3, quote: 'still seeing this after launch' });

    const { getDb, run } = require('../../database');
    const db = await getDb();
    const launchedAt = new Date(Date.now() - 60 * 86400000);
    await run(db, 'UPDATE pb_features SET launched_at = ? WHERE id = ?', [sqlTimestamp(launchedAt), feature.body.id]);
    await run(db, 'UPDATE pb_insights SET created_at = ? WHERE id = ?',
      [sqlTimestamp(new Date(launchedAt.getTime() - 86400000)), before.body.id]);
    await run(db, 'UPDATE pb_insights SET created_at = ? WHERE id = ?',
      [sqlTimestamp(new Date(launchedAt.getTime() + 86400000)), after.body.id]);

    const list = await request(app).get('/api/product/outcomes?review_after_days=30').set(headers);
    expect(list.status).toBe(200);
    expect(list.body.review_after_days).toBe(30);
    const row = list.body.features.find((f) => f.id === feature.body.id);
    expect(row).toBeTruthy();
    expect(row.post_launch_insight_count).toBe(1);
    expect(row.post_launch_insights.map((i) => i.title)).toEqual(['Feedback after launch']);
    expect(row.review_due).toBe(true);

    const widerWindow = await request(app).get('/api/product/outcomes?review_after_days=90').set(headers);
    expect(widerWindow.body.features.find((f) => f.id === feature.body.id).review_due).toBe(false);
  });

  test('non-launched features never enter the review queue', async () => {
    const idea = await createFeature('Not launched', 'idea');
    const list = await request(app).get('/api/product/outcomes').set(headers);
    expect(list.body.features.some((f) => f.id === idea.body.id)).toBe(false);
  });

  test('rejects invalid review windows', async () => {
    expect((await request(app).get('/api/product/outcomes?review_after_days=0').set(headers)).status).toBe(400);
    expect((await request(app).get('/api/product/outcomes?review_after_days=abc').set(headers)).status).toBe(400);
  });

  test('customer accounts cannot read or write internal outcome data', async () => {
    expect((await request(app).get('/api/product/outcomes').set(clientHeaders)).status).toBe(403);
    const feature = await createFeature('Private outcome', 'launched');
    expect((await request(app).put(`/api/product/features/${feature.body.id}/outcome`).set(clientHeaders)
      .send({ metric: 'Secret internal metric' })).status).toBe(403);
  });
});
