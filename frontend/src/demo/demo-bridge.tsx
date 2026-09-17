import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO_NAVIGATE, DEMO_READY } from './messages';

/**
 * Mounted only in the demo build. Lets the landing page's tabs drive the framed
 * demo, and keeps visitors inside /demo when they click a link the router does
 * not own — wiki HTML and issue mentions are plain anchors with root paths.
 */
export function DemoBridge() {
  const navigate = useNavigate();
  const nav = useRef(navigate);
  nav.current = navigate;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: unknown; path?: unknown } | null;
      if (msg?.type === DEMO_NAVIGATE && typeof msg.path === 'string' && msg.path.startsWith('/')) {
        nav.current(msg.path);
      }
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || (a.target && a.target !== '_self')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === '/demo' || url.pathname.startsWith('/demo/') || url.pathname.startsWith('/api/')) return;
      e.preventDefault();
      nav.current(url.pathname + url.search + url.hash);
    }

    window.addEventListener('message', onMessage);
    document.addEventListener('click', onClick);
    if (window.parent !== window) window.parent.postMessage({ type: DEMO_READY }, window.location.origin);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('click', onClick);
    };
  }, []);

  return null;
}
