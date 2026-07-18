// ===== IN-PROCESS EVENT BUS =====
// A tiny pub/sub used to push live updates to connected SSE clients
// (routes/stream.js). Deliberately dependency-free — no socket.io. Publishers
// (issues, notifications) call publish(); the SSE route subscribes and forwards
// relevant events to each client.

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per connected client; don't warn

const CHANNEL = 'atlas';

/** Broadcast an event. Shape: { type, projectId?, userId?, ...payload }. */
function publish(event) {
  try { bus.emit(CHANNEL, event); } catch (e) { /* never throw into the request path */ }
}

/** Subscribe to all events. Returns an unsubscribe function. */
function subscribe(handler) {
  bus.on(CHANNEL, handler);
  return () => bus.off(CHANNEL, handler);
}

module.exports = { publish, subscribe };
