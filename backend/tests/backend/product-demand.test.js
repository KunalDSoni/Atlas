/**
 * REVENUE-WEIGHTED DEMAND — Epic 48
 *
 * Pure arithmetic first, then the query helper and the API surface.
 *
 * The thing under test is deliberately NOT a replacement for `user_impact`
 * (routes/product-features.js:32), which weights the same evidence by tier on a
 * 3/2/1 scale and is the features screen's default sort. Demand is a second
 * figure in real currency; where the two disagree, the disagreement is the
 * finding.
 */
const { tierMedians, computeDemand, median } = require('../../utils/demand');

describe('median', () => {
  test('odd count takes the middle value', () => {
    expect(median([300, 100, 200])).toBe(200);
  });

  test('even count averages the middle two', () => {
    expect(median([100, 200, 300, 500])).toBe(250);
  });

  test('empty is zero rather than NaN', () => {
    expect(median([])).toBe(0);
  });
});

describe('tier medians', () => {
  test('median per tier, from companies that actually carry a figure', () => {
    const medians = tierMedians([
      { tier: 'strategic', arr: 1000000 },
      { tier: 'strategic', arr: 3000000 },
      { tier: 'growth', arr: 120000 },
      { tier: 'standard', arr: null },
    ]);
    expect(medians.strategic).toBe(2000000);
    expect(medians.growth).toBe(120000);
    expect(medians.standard).toBe(0);
  });

  test('zero and negative ARR are treated as absent, not as data', () => {
    const medians = tierMedians([
      { tier: 'growth', arr: 0 },
      { tier: 'growth', arr: -5 },
      { tier: 'growth', arr: 90000 },
    ]);
    expect(medians.growth).toBe(90000);
  });
});

describe('demand', () => {
  const medians = { strategic: 2000000, growth: 120000, standard: 10000 };

  test('sums arr x importance and ranks the breakdown by contribution', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c1', company_name: 'Northwind', tier: 'strategic', arr: 2400000, importance: 3 },
      { feature_id: 'f1', company_id: 'c2', company_name: 'Initech', tier: 'growth', arr: 100000, importance: 1 },
    ], medians);

    expect(out.demand).toBe(2400000 * 3 + 100000);
    expect(out.breakdown).toHaveLength(2);
    expect(out.breakdown[0].company_name).toBe('Northwind');
    expect(out.breakdown[0].estimated).toBe(false);
  });

  test('null ARR falls back to the tier median and is marked estimated', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c3', company_name: 'Acme', tier: 'growth', arr: null, importance: 2 },
    ], medians);

    expect(out.demand).toBe(120000 * 2);
    expect(out.breakdown[0].estimated).toBe(true);
    // The measured figure is null, so nothing downstream can mistake the
    // fallback for real revenue.
    expect(out.breakdown[0].arr).toBeNull();
  });

  test('a tier with no ARR data anywhere contributes zero, not NaN', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c4', company_name: 'Ghost', tier: 'standard', arr: null, importance: 3 },
    ], { strategic: 0, growth: 0, standard: 0 });

    expect(out.demand).toBe(0);
    expect(Number.isNaN(out.demand)).toBe(false);
  });

  test('insights with no company are counted separately, never folded in', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: null, company_name: null, tier: null, arr: null, importance: 3 },
    ], medians);

    expect(out.demand).toBe(0);
    expect(out.unattributed).toBe(1);
    expect(out.breakdown).toHaveLength(0);
  });

  test('several insights from one company accumulate into one breakdown row', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c1', company_name: 'Northwind', tier: 'strategic', arr: 1000000, importance: 1 },
      { feature_id: 'f1', company_id: 'c1', company_name: 'Northwind', tier: 'strategic', arr: 1000000, importance: 2 },
    ], medians);

    expect(out.breakdown).toHaveLength(1);
    expect(out.breakdown[0].insight_count).toBe(2);
    expect(out.demand).toBe(3000000);
  });

  test('missing importance defaults to 1 rather than zeroing the row', () => {
    const out = computeDemand([
      { feature_id: 'f1', company_id: 'c1', company_name: 'Northwind', tier: 'strategic', arr: 500000, importance: null },
    ], medians);
    expect(out.demand).toBe(500000);
  });

  test('no evidence at all is a zero, with an empty breakdown', () => {
    const out = computeDemand([], medians);
    expect(out.demand).toBe(0);
    expect(out.breakdown).toEqual([]);
    expect(out.unattributed).toBe(0);
  });
});

describe('demand on the features API', () => {
  const request = require('supertest');
  const { createTestApp, adminHeaders } = require('./setup');
  let app, headers;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
  });

  test('every feature carries demand alongside an untouched user_impact', async () => {
    const res = await request(app).get('/api/product/features').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const f of res.body) {
      expect(f).toHaveProperty('demand');
      expect(f).toHaveProperty('user_impact');
      expect(typeof f.demand).toBe('number');
      expect(Number.isNaN(f.demand)).toBe(false);
    }
  });

  test('the single-feature route carries the breakdown', async () => {
    const list = await request(app).get('/api/product/features').set(headers);
    const target = list.body.find((f) => (f.insight_count || 0) > 0) || list.body[0];

    const res = await request(app).get(`/api/product/features/${target.id}`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.demand_breakdown)).toBe(true);
    expect(typeof res.body.demand_unattributed).toBe('number');
  });

  test('demand reflects the ARR behind the evidence, not just its tier', async () => {
    // Two companies on the SAME tier with very different ARR must produce
    // different demand — that difference is the entire reason this epic exists,
    // since user_impact would score them identically.
    const big = await request(app).post('/api/product/companies').set(headers)
      .send({ name: 'Bigco', tier: 'growth', arr: 4000000 });
    const small = await request(app).post('/api/product/companies').set(headers)
      .send({ name: 'Smallco', tier: 'growth', arr: 40000 });

    const bigCust = await request(app).post('/api/product/customers').set(headers)
      .send({ name: 'Big Buyer', email: 'buyer@bigco.example', company_id: big.body.id });
    const smallCust = await request(app).post('/api/product/customers').set(headers)
      .send({ name: 'Small Buyer', email: 'buyer@smallco.example', company_id: small.body.id });

    const projects = await request(app).get('/api/projects').set(headers);
    const projectId = projects.body[0].id;
    const featBig = await request(app).post('/api/product/features').set(headers)
      .send({ name: 'Wanted by Bigco', project_id: projectId });
    const featSmall = await request(app).post('/api/product/features').set(headers)
      .send({ name: 'Wanted by Smallco', project_id: projectId });

    const insBig = await request(app).post('/api/product/insights').set(headers)
      .send({ title: 'Bigco asked', customer_id: bigCust.body.id });
    const insSmall = await request(app).post('/api/product/insights').set(headers)
      .send({ title: 'Smallco asked', customer_id: smallCust.body.id });

    await request(app).post(`/api/product/insights/${insBig.body.id}/links`).set(headers)
      .send({ feature_id: featBig.body.id, importance: 2 });
    await request(app).post(`/api/product/insights/${insSmall.body.id}/links`).set(headers)
      .send({ feature_id: featSmall.body.id, importance: 2 });

    const bigOut = await request(app).get(`/api/product/features/${featBig.body.id}`).set(headers);
    const smallOut = await request(app).get(`/api/product/features/${featSmall.body.id}`).set(headers);

    expect(bigOut.body.demand).toBe(4000000 * 2);
    expect(smallOut.body.demand).toBe(40000 * 2);
    // Same tier, same importance — so the tier-weighted score cannot tell them
    // apart, and demand can.
    expect(bigOut.body.user_impact).toBe(smallOut.body.user_impact);
    expect(bigOut.body.demand).toBeGreaterThan(smallOut.body.demand);

    expect(bigOut.body.demand_breakdown[0].company_name).toBe('Bigco');
    expect(bigOut.body.demand_breakdown[0].estimated).toBe(false);
  });
});
