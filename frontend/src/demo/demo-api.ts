// The demo build's replacement for the network. lib/api.ts's request() calls
// this instead of fetch when __ATLAS_DEMO__ is set; nothing else in the app
// knows it is running on sample data.
import { ApiError } from '@/lib/api';
import fixtures from './fixtures.json';
import { createDemoStore, DemoNotFound } from './demo-store';

const store = createDemoStore(fixtures);

export async function demoRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const method = (options.method ?? 'GET').toUpperCase();
  try {
    if (method === 'GET') return store.read(path);
    const body = typeof options.body === 'string' ? (JSON.parse(options.body) as Record<string, unknown>) : {};
    return store.write(method, path, body);
  } catch (e) {
    if (e instanceof DemoNotFound) throw new ApiError('This part of Atlas has no sample data in the demo.', 404);
    throw e;
  }
}
