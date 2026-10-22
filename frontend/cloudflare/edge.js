// Request handling shared by both Cloudflare targets: the Worker in worker.js
// (Workers & Pages -> Create -> Worker) and the Pages Functions in functions/
// (Create -> Pages). Cloudflare hosts only the static build; the Express API and
// its MySQL/SQLite database still run on a Node host such as Render or the
// Docker image, set as BACKEND_URL (e.g. https://your-atlas-backend.example.com).

// Forwards an /api/* request to the backend, so the SPA keeps calling
// same-origin /api paths exactly as it does when Express serves it.
export function proxyApi(request, env) {
  if (!env.BACKEND_URL) {
    return Response.json(
      { error: 'Atlas API is not configured: set BACKEND_URL on the Cloudflare project.' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.BACKEND_URL);

  // Method, headers (x-auth-token included) and body carry over as-is; the
  // live-events EventSource on /api/stream streams straight through.
  const proxied = new Request(target, request);
  proxied.headers.set('X-Forwarded-Host', url.host);
  proxied.headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) proxied.headers.set('X-Forwarded-For', clientIp);

  return fetch(proxied, { redirect: 'manual' });
}

// The sample-data demo is a second SPA built into build/demo with its own
// index.html, but the platform's SPA fallback only knows the root one, so deep
// links like /demo/board would boot the real app. Mirrors the Express route in
// backend/server.js: files are served as-is (returns null), every other /demo
// path gets the demo's index.html.
export function serveDemo(request, env) {
  const { pathname } = new URL(request.url);
  if (/\.[a-z0-9]+$/i.test(pathname)) return null;
  return env.ASSETS.fetch(new URL('/demo/', request.url));
}
