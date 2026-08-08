import { useState } from 'react';
import { LANDING_COPY } from '@/lib/landing-content';
import { BoardView, RoadmapView, InsightsView } from './product-frame-views';

export function ProductFrame() {
  const [active, setActive] = useState('board');
  const tab = LANDING_COPY.frame.tabs.find((t) => t.key === active)!;

  return (
    <section id="product" className="px-6 pb-16 pt-12">
      <div className="mx-auto max-w-6xl">
        <div role="tablist" aria-label="Product views" className="mb-4 flex justify-center gap-1">
          {LANDING_COPY.frame.tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls="frame-panel"
              onClick={() => setActive(t.key)}
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

          <div id="frame-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="min-h-[26rem] p-4">
            {active === 'board' && <BoardView />}
            {active === 'roadmap' && <RoadmapView />}
            {active === 'insights' && <InsightsView />}
          </div>
        </div>
      </div>
    </section>
  );
}
