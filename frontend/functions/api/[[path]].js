// Cloudflare Pages Function: forwards every /api/* request to the Express
// backend. Configure BACKEND_URL in the Pages project under
// Settings -> Variables and Secrets. See cloudflare/edge.js.
import { proxyApi } from '../../cloudflare/edge.js';

export function onRequest({ request, env }) {
  return proxyApi(request, env);
}
