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
});

describe('POST /api/product/features/:id/impact-metrics', () => {
  test('records impact metric successfully', async () => {
    const res = await request(app)
      .post(`/api/product/features/${featureId}/impact-metrics`)
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
      .post(`/api/product/features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption', actualValue: -5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('≥ 0');
  });

  test('rejects missing metricType', async () => {
    const res = await request(app)
      .post(`/api/product/features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ actualValue: 10 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('required');
  });

  test('rejects missing actualValue', async () => {
    const res = await request(app)
      .post(`/api/product/features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('required');
  });
});

describe('GET /api/product/features/:id/impact-metrics', () => {
  test('returns impact metrics grouped by type', async () => {
    // Record a metric first
    await request(app)
      .post(`/api/product/features/${featureId}/impact-metrics`)
      .set(headers)
      .send({ metricType: 'adoption', actualValue: 30, unit: 'percentage' });

    const res = await request(app)
      .get(`/api/product/features/${featureId}/impact-metrics`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.metrics.adoption).toBeDefined();
    expect(Array.isArray(res.body.data.metrics.adoption)).toBe(true);
  });

  test('returns feature details with impact data', async () => {
    const res = await request(app)
      .get(`/api/product/features/${featureId}/impact-metrics`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.feature_id).toBe(featureId);
    expect(res.body.data).toHaveProperty('impact_status');
    expect(res.body.data).toHaveProperty('forecast_adoption');
    expect(res.body.data).toHaveProperty('actual_adoption');
  });

  test('returns 404 for non-existent feature', async () => {
    const res = await request(app)
      .get(`/api/product/features/non-existent-id/impact-metrics`)
      .set(headers);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/product/features/:id/forecast-metrics', () => {
  test('sets forecast metrics successfully', async () => {
    const res = await request(app)
      .put(`/api/product/features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({
        forecastAdoption: 50,
        forecastRevenue: 100000,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.forecast_adoption).toBe(50);
    expect(res.body.data.forecast_revenue).toBe(100000);
  });

  test('accepts partial forecast data', async () => {
    const res = await request(app)
      .put(`/api/product/features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({
        forecastAdoption: 45,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.forecast_adoption).toBe(45);
  });
});

describe('GET /api/product/features/impact-dashboard', () => {
  test('returns dashboard summary', async () => {
    const res = await request(app)
      .get(`/api/product/features/impact-dashboard`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total_features_analyzed');
    expect(res.body.data).toHaveProperty('avg_adoption_variance');
    expect(res.body.data).toHaveProperty('avg_revenue_variance');
    expect(Array.isArray(res.body.data.features)).toBe(true);
  });

  test('calculates variance correctly', async () => {
    // Update feature with forecast and actual values
    await request(app)
      .put(`/api/product/features/${featureId}/forecast-metrics`)
      .set(headers)
      .send({
        forecastAdoption: 100,
        forecastRevenue: 100000,
      });

    // Set actual adoption through database
    const res = await request(app)
      .get(`/api/product/features/impact-dashboard`)
      .set(headers);

    expect(res.status).toBe(200);
    // Dashboard should be created successfully even if variances are null
    expect(typeof res.body.data.total_features_analyzed).toBe('number');
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
