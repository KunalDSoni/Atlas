import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, setToken, clearToken, ApiError } from '@/lib/api';

// These assert the wire format of the feature-merge calls, not their UI.
//
// They exist because all four merge calls shipped broken in three independent
// ways at once, and nothing caught it: the path was `/api/product-features/`
// where the server serves `/api/product/features/`, the body used snake_case
// where the server reads camelCase, and the calls bypassed the api client so
// they carried no `x-auth-token`. Each alone is a silent 404/400/401. Asserting
// the request itself is the only layer that sees all three.

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function mockFetch(response: unknown, { ok = true, status = 200 } = {}) {
  const spy = vi.fn(async () => ({
    ok,
    status,
    text: async () => JSON.stringify(response),
  }) as unknown as Response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const lastCall = (spy: ReturnType<typeof mockFetch>): FetchArgs =>
  spy.mock.calls[spy.mock.calls.length - 1] as unknown as FetchArgs;

const bodyOf = (spy: ReturnType<typeof mockFetch>) =>
  JSON.parse(String(lastCall(spy)[1]?.body));

const headersOf = (spy: ReturnType<typeof mockFetch>) =>
  (lastCall(spy)[1]?.headers ?? {}) as Record<string, string>;

beforeEach(() => setToken('test-token'));
afterEach(() => {
  clearToken();
  vi.unstubAllGlobals();
});

describe('feature merge API client', () => {
  it('reads candidates from the path the server actually serves', async () => {
    const spy = mockFetch({ data: [] });
    await api.product.mergeCandidates('feat-1');

    // The server registers this under /product/features/, NOT /product-features/.
    expect(lastCall(spy)[0]).toBe('/api/product/features/feat-1/merge-candidates');
  });

  it('sends the session token on every merge call', async () => {
    const spy = mockFetch({ data: [] });
    await api.product.mergeCandidates('feat-1');

    expect(headersOf(spy)['x-auth-token']).toBe('test-token');
  });

  it('posts childFeatureIds in the camelCase shape the server reads', async () => {
    const spy = mockFetch({ data: { id: 'feat-1' }, merged_count: 2 });
    await api.product.mergeFeatures('feat-1', ['child-a', 'child-b'], 'same request');

    expect(lastCall(spy)[0]).toBe('/api/product/features/feat-1/merge');
    expect(lastCall(spy)[1]?.method).toBe('POST');
    // snake_case here reaches the server as undefined and is rejected as
    // "childFeatureIds must be non-empty array".
    expect(bodyOf(spy)).toEqual({ childFeatureIds: ['child-a', 'child-b'], reason: 'same request' });
  });

  it('posts childFeatureId when undoing', async () => {
    const spy = mockFetch({ data: { id: 'child-a' } });
    await api.product.unmergeFeature('feat-1', 'child-a');

    expect(lastCall(spy)[0]).toBe('/api/product/features/feat-1/unmerge');
    expect(bodyOf(spy)).toEqual({ childFeatureId: 'child-a' });
  });

  it('reads merge history from the served path', async () => {
    const spy = mockFetch({ data: [] });
    await api.product.mergeHistory('feat-1');

    expect(lastCall(spy)[0]).toBe('/api/product/features/feat-1/merge-history');
  });

  it('unwraps the { data } envelope so callers never see it', async () => {
    mockFetch({ data: [{ feature: { id: 'dupe' }, similarity: 0.9 }] });

    await expect(api.product.mergeCandidates('feat-1'))
      .resolves.toEqual([{ feature: { id: 'dupe' }, similarity: 0.9 }]);
  });

  it('rejects a refused merge instead of resolving', async () => {
    // The whole point: fetch() does not throw on 4xx. The old code awaited it
    // and then toasted "Features merged successfully" over a 400.
    mockFetch(
      { error: true, message: 'Cannot merge: would create cycle', code: 'CYCLE_DETECTED' },
      { ok: false, status: 400 },
    );

    await expect(api.product.mergeFeatures('feat-1', ['child-a']))
      .rejects.toThrow('Cannot merge: would create cycle');
  });

  it('surfaces the message from the { error: true, message } error shape', async () => {
    // Reading `error` blindly renders this shape as the string "true".
    mockFetch(
      { error: true, message: 'Merge too old to undo (>24h)', code: 'MERGE_TOO_OLD' },
      { ok: false, status: 400 },
    );

    await expect(api.product.unmergeFeature('feat-1', 'child-a'))
      .rejects.toThrow(new ApiError('Merge too old to undo (>24h)', 400));
  });

  it('still reads the plain { error: string } shape the rest of the API uses', async () => {
    mockFetch({ error: 'metricType and actualValue required' }, { ok: false, status: 400 });

    await expect(api.product.recordImpactMetric('feat-1', { metricType: 'adoption', actualValue: 1 }))
      .rejects.toThrow('metricType and actualValue required');
  });
});
