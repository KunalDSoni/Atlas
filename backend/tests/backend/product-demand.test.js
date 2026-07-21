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
