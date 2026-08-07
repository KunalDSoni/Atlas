/**
 * FEATURE IMPACT ENDPOINTS TESTS
 * Tests: impact metrics recording, retrieval with variance, forecasts, dashboard
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const FeatureImpactMetrics = require('../../models/feature-impact-metrics');

let app, headers, projectId, featureId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();

  // Get a project and create a test feature
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;

  // Create a feature
  const feat = await request(app)
    .post('/api/product/features')
    .set(headers)
    .send({
      name: 'Dark Mode',
      description: 'Add dark theme to the UI',
      project_id: projectId,
      status: 'launched',
    });
  featureId = feat.body.id;

  // Set impact_status for testing. Note the path: the feature update route is
  // /product/features/:id — the impact endpoints live under /product-features.
  const statusRes = await request(app)
    .put(`/api/product/features/${featureId}`)
    .set(headers)
    .send({ impact_status: 'launched' });
  expect(statusRes.status).toBe(200);
  expect(statusRes.body.impact_status).toBe('launched');
});

describe('POST /api/product-features/:id/impact-metrics', () => {
  test('records impact metric successfully', async () => {
    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({
        metricType: 'adoption',
        actualValue: 25.5,
        unit: 'percentage',
        dataSource: 'manual',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.actual_value).toBe(25.5);
    expect(res.body.data.metric_type).toBe('adoption');
  });

  test('rejects negative actual value', async () => {
    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption', actualValue: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('≥ 0');
  });

  test('rejects missing metricType', async () => {
    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ actualValue: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  test('rejects missing actualValue', async () => {
    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  // The spec says measurements >30 days old "become read-only (audit trail
  // only)" — recorded but frozen, not refused. Backfilling a launch month once
  // analytics settle is a normal thing to do.
  test('accepts measurements >30 days old but marks them non-editable', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({
        metricType: 'adoption',
        actualValue: 15,
        unit: 'percentage',
        measurementDate: thirtyOneDaysAgo,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.measurement_date).toBe(thirtyOneDaysAgo);
    expect(res.body.data.editable).toBe(false);
    await expect(FeatureImpactMetrics.canEdit(res.body.data.id)).resolves.toBe(false);
  });

  test('rejects a measurement_date in the future', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption', actualValue: 15, measurementDate: tomorrow });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/i);
  });

  test('rejects an unknown metricType', async () => {
    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'vibes', actualValue: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid metricType/i);
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .send({ metricType: 'adoption', actualValue: 10 });

    expect(res.status).toBe(401);
  });

  test('returns 404 for a non-existent feature', async () => {
    const res = await request(app)
      .post('/api/product-features/no-such-feature/impact-metrics')
      .set(headers)
      .send({ metricType: 'adoption', actualValue: 10 });

    expect(res.status).toBe(404);
  });

  test('accepts measurement from 29 days ago', async () => {
    const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({
        metricType: 'adoption',
        actualValue: 20,
        unit: 'percentage',
        measurementDate: twentyNineDaysAgo,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.measurement_date).toBe(twentyNineDaysAgo);
    expect(res.body.data.editable).toBe(true);
  });

  test('snapshots the live forecast onto the metric row', async () => {
    await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({ forecastAdoption: 200 });

    const res = await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption', actualValue: 250, unit: 'percentage' });

    expect(res.status).toBe(200);
    expect(res.body.data.forecast_value).toBe(200);

    // A later forecast revision must not rewrite an already-recorded variance.
    await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({ forecastAdoption: 999 });

    const reread = await request(app)
      .get(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers);
    const row = reread.body.data.metrics.adoption.find(m => m.id === res.body.data.id);
    expect(row.forecast_value).toBe(200);
    // (250 - 200) / 200 * 100 = 25
    expect(row.variance).toBeCloseTo(25, 5);
  });

  test('rolls the newest measurement up onto the feature row', async () => {
    await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'revenue', actualValue: 4321, unit: 'dollars' });

    const res = await request(app)
      .get(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers);

    // Without this rollup the impact dashboard can never see the feature.
    expect(res.body.data.actual_revenue).toBe(4321);
  });
});

describe('GET /api/product-features/:id/impact-metrics', () => {
  test('returns impact metrics grouped by type', async () => {
    // Record a metric first
    await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption', actualValue: 30, unit: 'percentage' });

    const res = await request(app)
      .get(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.metrics.adoption).toBeDefined();
    expect(Array.isArray(res.body.data.metrics.adoption)).toBe(true);
  });

  test('returns feature details with impact data', async () => {
    const res = await request(app)
      .get(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.feature_id).toBe(featureId);
    expect(res.body.data).toHaveProperty('impact_status');
    expect(res.body.data).toHaveProperty('forecast_adoption');
    expect(res.body.data).toHaveProperty('actual_adoption');
  });

  test('returns 404 for non-existent feature', async () => {
    const res = await request(app)
      .get(`/api/product-features/non-existent-id/impact-metrics`)
      .set(headers);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/product-features/:id/forecast-metrics', () => {
  test('sets forecast metrics successfully', async () => {
    const res = await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({
        forecastAdoption: 50,
        forecastRevenue: 100000,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.forecast_adoption).toBe(50);
    expect(res.body.data.forecast_revenue).toBe(100000);
  });

  test('leaves the omitted forecast untouched rather than clearing it', async () => {
    await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({ forecastAdoption: 50, forecastRevenue: 100000 });

    const res = await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({ forecastAdoption: 45 });

    expect(res.status).toBe(200);
    expect(res.body.data.forecast_adoption).toBe(45);
    expect(res.body.data.forecast_revenue).toBe(100000);
  });

  test('clears a forecast on an explicit null', async () => {
    const res = await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({ forecastRevenue: null });

    expect(res.status).toBe(200);
    expect(res.body.data.forecast_revenue).toBeNull();
  });

  test('rejects a negative forecast', async () => {
    const res = await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({ forecastAdoption: -10 });

    expect(res.status).toBe(400);
  });

  test('returns 404 for a non-existent feature', async () => {
    const res = await request(app)
      .put('/api/product-features/no-such-feature/forecast-metrics')
      .set(headers)
      .send({ forecastAdoption: 10 });

    expect(res.status).toBe(404);
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .send({ forecastAdoption: 10 });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/product-features/impact-dashboard', () => {
  test('returns dashboard summary', async () => {
    const res = await request(app)
      .get(`/api/product-features/impact-dashboard`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total_features_analyzed');
    expect(res.body.data).toHaveProperty('avg_adoption_variance');
    expect(res.body.data).toHaveProperty('avg_revenue_variance');
    expect(Array.isArray(res.body.data.features)).toBe(true);
  });

  test('includes a measured feature and averages its variance', async () => {
    await request(app)
      .put(`/api/product-features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({ forecastAdoption: 100, forecastRevenue: 100000 });

    await request(app)
      .post(`/api/product-features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption', actualValue: 120, unit: 'percentage' });

    const res = await request(app)
      .get(`/api/product-features/impact-dashboard`)
      .set(headers);

    expect(res.status).toBe(200);
    // The rollup has to make the feature visible here — this is exactly what a
    // metrics-table-only write silently failed to do.
    const row = res.body.data.features.find(f => f.id === featureId);
    expect(row).toBeDefined();
    expect(row.actual_adoption).toBe(120);
    expect(res.body.data.total_features_analyzed).toBeGreaterThan(0);
    expect(typeof res.body.data.avg_adoption_variance).toBe('number');
  });
});

describe('Variance Calculation', () => {
  test('calculates variance correctly', () => {
    const variance = FeatureImpactMetrics.calculateVariance(100, 120);
    expect(variance).toBe(20); // 20% higher than forecast
  });

  test('calculates negative variance', () => {
    const variance = FeatureImpactMetrics.calculateVariance(100, 80);
    expect(variance).toBe(-20); // 20% lower than forecast
  });

  test('returns null for zero forecast', () => {
    const variance = FeatureImpactMetrics.calculateVariance(0, 50);
    expect(variance).toBeNull();
  });

  test('returns null for null forecast', () => {
    const variance = FeatureImpactMetrics.calculateVariance(null, 50);
    expect(variance).toBeNull();
  });
});
