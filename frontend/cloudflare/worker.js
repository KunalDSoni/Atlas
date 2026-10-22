// Cloudflare Worker entry for the public website (wrangler.jsonc). Static files
// come from dist/site — the landing page plus the /demo/ sample-data demo, built
// by `npm run build:site`. There is no app or API behind it. Only /demo reaches
// this code first.

// The demo is a second SPA in dist/site/demo with its own index.html, but the
// assets' SPA fallback only knows the root one, so deep links like /demo/board
// would load the landing page. Files are served as-is; every other /demo path
// gets the demo's index.html, as the Express route in backend/server.js does.
async function demoAsset(request, env) {
  const { pathname } = new URL(request.url);
  if (!/\.[a-z0-9]+$/i.test(pathname)) return env.ASSETS.fetch(new URL('/demo/', request.url));

  // A missing file comes back as the SPA fallback page. Answer 404 instead, so
  // a stale chunk requested after a redeploy is not cached as HTML.
  const asset = await env.ASSETS.fetch(request);
  const isFallback = asset.headers.get('Content-Type')?.startsWith('text/html') && !pathname.endsWith('.html');
  return isFallback ? new Response('Not found', { status: 404 }) : asset;
}

// public/_headers covers files served straight from the assets, but Cloudflare
// does not promise to apply it to responses this Worker returns, so /demo sets
// the same headers itself. The landing page frames the demo, which needs
// SAMEORIGIN, as backend/utils/frame-options.js allows.
const DEMO_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

async function demo(request, env) {
  const asset = await demoAsset(request, env);
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(DEMO_HEADERS)) response.headers.set(name, value);
  // Content-hashed build output never changes under the same name.
  if (asset.ok && new URL(request.url).pathname.startsWith('/demo/assets/')) {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  return response;
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/demo' || pathname.startsWith('/demo/')) return demo(request, env);
    return env.ASSETS.fetch(request);
  },
};
