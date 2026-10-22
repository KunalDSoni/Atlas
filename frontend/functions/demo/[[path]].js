// Cloudflare Pages Function: serves the demo's index.html for /demo deep links.
// See cloudflare/edge.js.
import { serveDemo } from '../../cloudflare/edge.js';

export function onRequest({ request, next, env }) {
  return serveDemo(request, env) ?? next();
}
