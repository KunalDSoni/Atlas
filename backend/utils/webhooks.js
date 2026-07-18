// ===== OUTBOUND WEBHOOKS =====
// Fire-and-forget delivery of project events to registered HTTPS endpoints.
// Each delivery is signed with HMAC-SHA256 over the raw JSON body using the
// webhook's own secret, sent as the `x-atlas-signature` header (sha256=<hex>).
// Never throws into the request path — callers do not await this.

const crypto = require('crypto');
const { queryAll, run } = require('../database');

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// Deliver `event` to every enabled webhook on `projectId` subscribed to it.
async function dispatch(db, projectId, event, data) {
  let hooks;
  try {
    hooks = await queryAll(db, 'SELECT * FROM webhooks WHERE project_id = ? AND enabled = 1', [projectId]);
  } catch (e) { return; }

  const payload = JSON.stringify({ event, project_id: projectId, delivered_at: new Date().toISOString(), data });

  for (const hook of hooks) {
    let events = [];
    try { events = JSON.parse(hook.events || '[]'); } catch (e) { events = []; }
    // Empty subscription list = all events.
    if (events.length && !events.includes(event)) continue;

    // Fire without blocking the caller. globalThis.fetch exists on Node 18+.
    (async () => {
      try {
        const resp = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Atlas-Webhooks/1.0',
            'x-atlas-event': event,
            'x-atlas-signature': sign(hook.secret, payload),
          },
          body: payload,
          signal: AbortSignal.timeout(8000),
        });
        try { await run(db, "UPDATE webhooks SET last_status = ?, last_delivered_at = datetime('now') WHERE id = ?", [resp.status, hook.id]); } catch (e) { /* best effort */ }
      } catch (e) {
        try { await run(db, "UPDATE webhooks SET last_status = 0, last_delivered_at = datetime('now') WHERE id = ?", [hook.id]); } catch (_) { /* best effort */ }
      }
    })();
  }
}

module.exports = { dispatch, sign };
