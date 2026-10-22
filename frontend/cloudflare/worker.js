// Cloudflare Worker entry (wrangler.jsonc). Static files come from the build/
// assets with the SPA fallback; only /api and /demo reach this code first.
import { proxyApi, serveDemo } from './edge.js';

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return proxyApi(request, env);
    if (pathname === '/demo' || pathname.startsWith('/demo/')) {
      return serveDemo(request, env) ?? env.ASSETS.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
