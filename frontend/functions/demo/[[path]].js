// The sample-data demo is a second SPA built into build/demo with its own
// index.html. Pages' built-in SPA fallback only knows the root index.html, so
// deep links like /demo/board would boot the real app. Mirror the Express
// route in backend/server.js: files are served as-is, every other /demo path
// gets the demo's index.html.
export async function onRequest({ request, next, env }) {
  const { pathname } = new URL(request.url);
  if (/\.[a-z0-9]+$/i.test(pathname)) return next();
  return env.ASSETS.fetch(new URL('/demo/', request.url));
}
