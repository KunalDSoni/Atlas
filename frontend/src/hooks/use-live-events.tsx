import { useEffect, useRef } from 'react';
import { getToken } from '@/lib/api';

// One shared SSE connection for the whole app. Components subscribe to event
// types ('issue', 'notification') and get called when the server pushes them.

type LiveEvent = { type: string; action?: string; projectId?: string; issueId?: string; userId?: string; actorId?: string };
type Handler = (e: LiveEvent) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;
let refCount = 0;

function open() {
  if (source) return;
  const token = getToken();
  if (!token) return;
  source = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  const forward = (type: string) => (ev: MessageEvent) => {
    let data: LiveEvent = { type };
    try { data = { ...JSON.parse(ev.data), type }; } catch { /* keep default */ }
    handlers.forEach((h) => h(data));
  };
  // Named events emitted by the server.
  ['issue', 'notification'].forEach((t) => source!.addEventListener(t, forward(t)));
  source.onerror = () => { /* EventSource auto-reconnects; nothing to do */ };
}

function close() {
  if (source) { source.close(); source = null; }
}

/**
 * Subscribe to live server events for the lifetime of the component. `handler`
 * is kept in a ref so re-renders don't churn the subscription.
 */
export function useLiveEvents(handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const wrapped: Handler = (e) => ref.current(e);
    handlers.add(wrapped);
    refCount += 1;
    open();
    return () => {
      handlers.delete(wrapped);
      refCount -= 1;
      if (refCount <= 0) close();
    };
  }, []);
}
