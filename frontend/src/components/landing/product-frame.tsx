import { useEffect, useRef, useState } from 'react';
import { LANDING_COPY } from '@/lib/landing-content';
import { DEMO_NAVIGATE, DEMO_READY } from '@/demo/messages';

const TABS = LANDING_COPY.frame.tabs;

/**
 * Not a picture of Atlas — Atlas. The frame is the /demo/ build: the real app
 * answering from recorded sample data, so nothing a visitor does is saved or
 * sent anywhere. Tabs navigate the framed app by message rather than reloading
 * it, which would throw away whatever the visitor just changed.
 */
export function ProductFrame() {
  const [active, setActive] = useState<string>(TABS[0].key);
  const frame = useRef<HTMLIFrameElement>(null);
  const path = useRef<string>(TABS[0].path);
  const tab = TABS.find((t) => t.key === active)!;

  function show(to: string) {
    frame.current?.contentWindow?.postMessage({ type: DEMO_NAVIGATE, path: to }, window.location.origin);
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type !== DEMO_READY) return;
      // A tab clicked while the frame was still loading, or the demo restarted.
      if (path.current !== TABS[0].path) show(path.current);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function select(key: string) {
    const next = TABS.find((t) => t.key === key)!;
    setActive(key);
    path.current = next.path;
    show(next.path);
  }

  return (
    <section id="product" className="px-6 pb-16 pt-12">
      {/*
        Wider than the page's 6xl measure on purpose: the framed app lays out by
        its own width, and the board only shows all five columns from 1280px.
        At 6xl it rendered two.
      */}
      <div className="mx-auto max-w-[90rem]">
        <div role="tablist" aria-label="Product views" className="mb-4 flex justify-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls="frame-panel"
              onClick={() => select(t.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                active === t.key
                  ? 'border border-border bg-card text-foreground shadow-sm'
                  : 'border border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="flex h-10 items-center gap-2 border-b border-border-light bg-surface px-4">
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="ml-2 rounded-full border border-border bg-background px-3 py-0.5 text-[11px] text-faint">
              {tab.url}
            </span>
          </div>

          <div id="frame-panel" role="tabpanel" aria-labelledby={`tab-${active}`}>
            <iframe
              ref={frame}
              src={`/demo${TABS[0].path}`}
              title="A live Atlas workspace running on sample data"
              className="block h-[34rem] w-full border-0 bg-background md:h-[40rem]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
