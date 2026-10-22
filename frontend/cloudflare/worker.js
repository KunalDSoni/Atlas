// Cloudflare Worker entry (wrangler.jsonc). Static files come from the build/
// assets with the SPA fallback; only /api and /demo reach this code first.
import { proxyApi, serveDemo } from './edge.js';

// public/_headers covers files served straight from the assets, but Cloudflare
// does not promise to apply it to responses this Worker returns, so /demo sets
// the same headers itself. The demo may be framed by the same origin, like
// backend/utils/frame-options.js allows.
const DEMO_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

async function demo(request, env) {
  const asset = await (serveDemo(request, env) ?? env.ASSETS.fetch(request));
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(DEMO_HEADERS)) response.headers.set(name, value);
  if (asset.ok && new URL(request.url).pathname.startsWith('/demo/assets/')) {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  return response;
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return proxyApi(request, env);
    if (pathname === '/demo' || pathname.startsWith('/demo/')) return demo(request, env);
    return env.ASSETS.fetch(request);
  },
};
