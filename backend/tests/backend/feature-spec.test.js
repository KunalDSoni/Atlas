/**
 * FEATURE SPEC DRAFTING — Epic 50
 *
 * Assembly is pure and model-free: a deployment with no ANTHROPIC_API_KEY still
 * gets a spec worth editing. The model only layers prose on top, and a model
 * failure must still leave a usable page.
 */
const { buildSpecBody } = require('../../utils/spec-draft');

describe('spec assembly', () => {
  const feature = { name: 'Bulk CSV export', description: 'Export issues in bulk.' };

  test('includes the feature, its objectives, evidence and demand', () => {
    const html = buildSpecBody({
      feature,
      objectives: [{ name: 'Reduce churn' }],
      evidence: [{ quote: 'exporting by hand every Monday', importance: 3, company_name: 'Acme Corp' }],
      demandBreakdown: [{ company_name: 'Acme Corp', contribution: 750000, estimated: false }],
    });

    expect(html).toContain('Bulk CSV export');
    expect(html).toContain('Export issues in bulk.');
    expect(html).toContain('Reduce churn');
    expect(html).toContain('exporting by hand every Monday');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('$750k');
  });

  test('escapes evidence so a quote cannot inject markup', () => {
    // Quotes are customer-authored text arriving through insights, and the wiki
    // renders HTML. This is the injection path if anything is.
    const html = buildSpecBody({
      feature,
      objectives: [],
      evidence: [{ quote: '<img src=x onerror=alert(1)>', importance: 1, company_name: null }],
      demandBreakdown: [],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('escapes a company name too', () => {
    const html = buildSpecBody({
      feature,
      objectives: [],
      evidence: [],
      demandBreakdown: [{ company_name: '<script>x</script>', contribution: 100, estimated: false }],
    });
    expect(html).not.toContain('<script>');
  });

  test('escapes the feature name and description', () => {
    const html = buildSpecBody({
      feature: { name: '<b>Bold</b>', description: '<i>Italic</i>' },
      objectives: [], evidence: [], demandBreakdown: [],
    });
    expect(html).not.toContain('<b>Bold</b>');
    expect(html).not.toContain('<i>Italic</i>');
  });

  test('a feature with no evidence still produces a usable skeleton', () => {
    const html = buildSpecBody({ feature, objectives: [], evidence: [], demandBreakdown: [] });
    expect(html).toContain('Bulk CSV export');
    expect(html).toContain('No evidence linked yet');
    expect(html).toContain('<h2>Problem</h2>');
    expect(html).toContain('<h2>Proposed solution</h2>');
    expect(html).toContain('<h2>Open questions</h2>');
  });

  test('marks an estimated demand row so it is not read as measured revenue', () => {
    const html = buildSpecBody({
      feature, objectives: [], evidence: [],
      demandBreakdown: [{ company_name: 'Initech', contribution: 36000, estimated: true }],
    });
    expect(html).toContain('estimated');
  });

  test('tolerates missing optional arguments entirely', () => {
    const html = buildSpecBody({ feature });
    expect(html).toContain('Bulk CSV export');
    expect(html).toContain('No evidence linked yet');
  });
});

describe('spec endpoint', () => {
  const request = require('supertest');
  const { createTestApp, adminHeaders, loginAs } = require('./setup');
  let app, headers, clientHeaders, featureId, spaceId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    clientHeaders = await loginAs('dana@customer.example.com', 'password123');
    const features = await request(app).get('/api/product/features').set(headers);
    featureId = features.body[0].id;
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    spaceId = spaces.body[0].id;
  });

  test('creates a wiki page and links it from the feature', async () => {
    const res = await request(app).post(`/api/product/features/${featureId}/spec`).set(headers)
      .send({ space_id: spaceId });
    expect(res.status).toBe(201);
    expect(res.body.page_id).toBeTruthy();
    expect(res.body.created).toBe(true);

    const page = await request(app).get(`/api/wiki/pages/${res.body.page_id}`).set(headers);
    expect(page.status).toBe(200);
    expect(page.body.body).toContain('<h2>Evidence</h2>');
    expect(page.body.title).toContain('Spec:');

    const feature = await request(app).get(`/api/product/features/${featureId}`).set(headers);
    expect(feature.body.spec_page_id).toBe(res.body.page_id);
  });

  test('a second call returns the existing page rather than duplicating it', async () => {
    const again = await request(app).post(`/api/product/features/${featureId}/spec`).set(headers)
      .send({ space_id: spaceId });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);

    const feature = await request(app).get(`/api/product/features/${featureId}`).set(headers);
    expect(again.body.page_id).toBe(feature.body.spec_page_id);
  });

  test('requires a space', async () => {
    const features = await request(app).get('/api/product/features').set(headers);
    const other = features.body.find((f) => f.id !== featureId && !f.spec_page_id);
    const res = await request(app).post(`/api/product/features/${other.id}/spec`).set(headers).send({});
    expect(res.status).toBe(400);
  });

  test('a missing feature is a 404', async () => {
    const res = await request(app).post('/api/product/features/no-such-feature/spec').set(headers)
      .send({ space_id: spaceId });
    expect(res.status).toBe(404);
  });

  test('a client cannot draft a spec', async () => {
    const res = await request(app).post(`/api/product/features/${featureId}/spec`).set(clientHeaders)
      .send({ space_id: spaceId });
    expect(res.status).toBe(403);
  });
});
