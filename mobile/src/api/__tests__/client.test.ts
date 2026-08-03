import { apiFetch, setAuthToken, ApiError } from '../client';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  setAuthToken(null);
});

test('sends x-auth-token header when a token is set', async () => {
  setAuthToken('abc123');
  const mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ hello: 'world' }),
  });
  global.fetch = mockFetch as any;

  const result = await apiFetch<{ hello: string }>('/projects');

  expect(result).toEqual({ hello: 'world' });
  const [, options] = mockFetch.mock.calls[0];
  expect(options.headers['x-auth-token']).toBe('abc123');
});

test('throws ApiError with status and body on non-ok response', async () => {
  const mockFetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Not authenticated' }),
  });
  global.fetch = mockFetch as any;

  await expect(apiFetch('/projects')).rejects.toMatchObject({
    status: 401,
    body: { error: 'Not authenticated' },
  });
});
