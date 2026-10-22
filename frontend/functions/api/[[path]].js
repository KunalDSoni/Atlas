// Cloudflare Pages Function: forwards every /api/* request to the Express
// backend, so the SPA keeps calling same-origin /api paths exactly as it does
// when Express serves it. Cloudflare Pages hosts only the static build — the
// API (and its MySQL/SQLite database) still runs on a Node host such as Render
// or the Docker image.
//
// Configure in the Pages project: Settings -> Variables and Secrets ->
//   BACKEND_URL = https://your-atlas-backend.example.com   (no trailing path)
export async function onRequest({ request, env }) {
  if (!env.BACKEND_URL) {
    return Response.json(
      { error: 'Atlas API is not configured: set BACKEND_URL on the Cloudflare Pages project.' },
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
