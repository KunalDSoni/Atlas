// ===== REAL-TIME EVENT STREAM (SSE) =====
// GET /api/stream?token=<session token>
//
// Server-Sent Events push live updates to the browser. EventSource cannot send
// custom headers, so this endpoint authenticates via a `token` query param
// (a valid session token) rather than the x-auth-token header. Each client is
// forwarded: notification events addressed to them, and issue events for
// projects they can see (all projects, in this app's model).

const express = require('express');
const { getDb, queryOne } = require('../database');
const { subscribe } = require('../utils/events');

const router = express.Router();

router.get('/stream', async (req, res) => {
  // Auth via query token (EventSource can't set headers). Fall back to a header
  // if a normal client connects.
  const token = req.query.token || req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  let userId;
  try {
    const db = await getDb();
    const session = await queryOne(db, "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')", [token]);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    const user = await queryOne(db, 'SELECT id FROM users WHERE id = ? AND is_active = 1', [session.user_id]);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    userId = user.id;
  } catch (e) {
    return res.status(500).json({ error: 'Stream unavailable' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: ready\ndata: {}\n\n`);

  const send = (event) => {
    // Notification events are private to their recipient; everything else is
    // broadcast (project-scoped issue changes are visible to all members here).
    if (event.type === 'notification' && event.userId !== userId) return;
    try { res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); } catch (e) { /* client gone */ }
  };
  const unsubscribe = subscribe(send);

  // Heartbeat so proxies keep the connection open.
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* noop */ } }, 25000);

  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

module.exports = router;
