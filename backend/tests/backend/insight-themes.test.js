/**
 * INSIGHT THEMES — Epic 49
 *
 * A theme groups insights one level above feedback and one below a feature —
 * the level `pb_insights.processed` cannot express, being a boolean.
 *
 * Manual grouping is the product and works with no API key. routes/ai.js only
 * ever proposes; confirming a suggestion goes through the same POST /themes any
 * hand-made theme uses.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');

let app, headers, clientHeaders;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  clientHeaders = await loginAs('dana@customer.example.com', 'password123');
});

async function newInsight(title) {
  const res = await request(app).post('/api/product/insights').set(headers).send({ title });
  return res.body.id;
}

describe('theme CRUD', () => {
  test('creates a theme with initial members and counts them', async () => {
    const a = await newInsight('Export is manual');
    const b = await newInsight('Export takes all morning');

    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Bulk export', summary: 'Repeated asks for exporting in bulk', insight_ids: [a, b] });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Bulk export');

    const list = await request(app).get('/api/product/themes').set(headers);
    const mine = list.body.find((t) => t.id === created.body.id);
    expect(mine.insight_count).toBe(2);
  });

  test('detail returns the member insights', async () => {
    const a = await newInsight('Slow on mobile');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Mobile performance', insight_ids: [a] });

    const detail = await request(app).get(`/api/product/themes/${created.body.id}`).set(headers);
    expect(detail.status).toBe(200);
    expect(detail.body.insights).toHaveLength(1);
    expect(detail.body.insights[0].title).toBe('Slow on mobile');
  });

  test('adding the same insight twice does not duplicate it', async () => {
    const a = await newInsight('Duplicate me');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Dupes', insight_ids: [a] });

    const again = await request(app).post(`/api/product/themes/${created.body.id}/insights`).set(headers)
      .send({ insight_ids: [a] });
    expect(again.status).toBe(200);

    const detail = await request(app).get(`/api/product/themes/${created.body.id}`).set(headers);
    expect(detail.body.insights).toHaveLength(1);
  });

  test('an unknown insight id is skipped rather than failing the whole request', async () => {
    const a = await newInsight('Real one');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Partly real', insight_ids: [a, 'no-such-insight'] });
    expect(created.status).toBe(201);
    expect(created.body.insight_count).toBe(1);
  });

  test('removing a member leaves the insight alone', async () => {
    const a = await newInsight('Detachable');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Detach', insight_ids: [a] });

    const removed = await request(app)
      .delete(`/api/product/themes/${created.body.id}/insights/${a}`).set(headers);
    expect(removed.status).toBe(200);

    const detail = await request(app).get(`/api/product/themes/${created.body.id}`).set(headers);
    expect(detail.body.insights).toHaveLength(0);
    const insight = await request(app).get(`/api/product/insights/${a}`).set(headers);
    expect(insight.status).toBe(200);
  });

  test('deleting a theme keeps its insights', async () => {
    const a = await newInsight('Survivor');
    const created = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Doomed', insight_ids: [a] });

    await request(app).delete(`/api/product/themes/${created.body.id}`).set(headers);

    const insight = await request(app).get(`/api/product/insights/${a}`).set(headers);
    expect(insight.status).toBe(200);
  });

  test('renames through PUT', async () => {
    const created = await request(app).post('/api/product/themes').set(headers).send({ name: 'Before' });
    const updated = await request(app).put(`/api/product/themes/${created.body.id}`).set(headers)
      .send({ name: 'After' });
    expect(updated.body.name).toBe('After');
  });

  test('rejects a theme with no name', async () => {
    const res = await request(app).post('/api/product/themes').set(headers).send({ name: '  ' });
    expect(res.status).toBe(400);
  });

  test('a missing theme is a 404', async () => {
    const res = await request(app).get('/api/product/themes/no-such-theme').set(headers);
    expect(res.status).toBe(404);
  });

  test('a client cannot reach theme endpoints', async () => {
    const res = await request(app).get('/api/product/themes').set(clientHeaders);
    expect(res.status).toBe(403);
  });
});

describe('promotion to a feature', () => {
  async function projectId() {
    const projects = await request(app).get('/api/projects').set(headers);
    return projects.body[0].id;
  }

  test('creates a feature linked to every insight in the theme', async () => {
    const a = await newInsight('Wants SSO');
    const b = await newInsight('Blocked without SSO');
    const theme = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Single sign-on', summary: 'Enterprise auth', insight_ids: [a, b] });

    const promoted = await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers)
      .send({ project_id: await projectId() });

    expect(promoted.status).toBe(201);
    expect(promoted.body.name).toBe('Single sign-on');

    const feature = await request(app).get(`/api/product/features/${promoted.body.id}`).set(headers);
    expect(feature.status).toBe(200);
    expect(feature.body.insight_count).toBe(2);
    expect(feature.body.description).toBe('Enterprise auth');
  });

  test('the theme survives promotion — it records how the feature was arrived at', async () => {
    const a = await newInsight('Keeps the receipt');
    const theme = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Receipts', insight_ids: [a] });

    await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers)
      .send({ project_id: await projectId() });

    const still = await request(app).get(`/api/product/themes/${theme.body.id}`).set(headers);
    expect(still.status).toBe(200);
    expect(still.body.insights).toHaveLength(1);
  });

  test('promotion marks the member insights processed', async () => {
    const a = await newInsight('Triaged by promotion');
    const theme = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Triage me', insight_ids: [a] });

    await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers)
      .send({ project_id: await projectId() });

    const insight = await request(app).get(`/api/product/insights/${a}`).set(headers);
    expect(insight.body.processed).toBe(1);
  });

  test('promoting an empty theme is a 400 rather than an orphan feature', async () => {
    const theme = await request(app).post('/api/product/themes').set(headers).send({ name: 'Empty' });
    const res = await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers)
      .send({ project_id: await projectId() });
    expect(res.status).toBe(400);
  });

  test('requires a project', async () => {
    const a = await newInsight('Needs a home');
    const theme = await request(app).post('/api/product/themes').set(headers)
      .send({ name: 'Homeless', insight_ids: [a] });
    const res = await request(app).post(`/api/product/themes/${theme.body.id}/promote`).set(headers).send({});
    expect(res.status).toBe(400);
  });
});
