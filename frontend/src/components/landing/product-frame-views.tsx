// Stylised representations of three Atlas screens, built from the same
// semantic tokens as the real app. Non-interactive by design — this is a
// picture of the product, not the product.

const CARDS = {
  todo: [
    { key: 'ATL-241', title: 'Rate-limit the demo login route', points: 3 },
    { key: 'ATL-244', title: 'Swimlanes and grouping on the board', points: 5 },
  ],
  progress: [{ key: 'ATL-238', title: 'Landing page and one-click demo entry', points: 8 }],
  review: [{ key: 'ATL-233', title: 'Issue stopwatch across midnight', points: 2 }],
  done: [
    { key: 'ATL-230', title: 'Credit rollup minutes to the author', points: 2 },
    { key: 'ATL-229', title: 'Blocked status and transitions', points: 3 },
  ],
};

function Column({ name, cards }: { name: string; cards: { key: string; title: string; points: number }[] }) {
  return (
    <div className="rounded-lg bg-surface p-2.5">
      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {name} <span className="tabular-nums">{cards.length}</span>
      </p>
      <div className="space-y-1.5">
        {cards.map((c) => (
          <div key={c.key} className="rounded border border-border bg-card p-2">
            <p className="mb-2 text-xs leading-snug">{c.title}</p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-faint">{c.key}</span>
              <span className="rounded-full bg-surface px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{c.points}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardView() {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <Column name="To do" cards={CARDS.todo} />
      <Column name="In progress" cards={CARDS.progress} />
      <Column name="In review" cards={CARDS.review} />
      <Column name="Done" cards={CARDS.done} />
    </div>
  );
}

const THEMES = [
  { name: 'Enterprise readiness', start: 1, span: 2 },
  { name: 'Board customisation', start: 1, span: 1 },
  { name: 'Insight intelligence', start: 2, span: 2 },
  { name: 'Automation builder', start: 3, span: 2 },
  { name: 'Mobile parity', start: 1, span: 3 },
];

export function RoadmapView() {
  return (
    <div>
      <div className="mb-2 grid grid-cols-[9rem_repeat(4,1fr)] gap-2 border-b border-border-light pb-2">
        <span />
        {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
          <span key={q} className="text-[11px] font-semibold uppercase tracking-wider text-faint">{q}</span>
        ))}
      </div>
      <div className="space-y-2">
        {THEMES.map((t) => (
          <div key={t.name} className="grid grid-cols-[9rem_repeat(4,1fr)] items-center gap-2">
            <span className="truncate text-xs font-medium">{t.name}</span>
            <div className="col-span-4 grid grid-cols-4 gap-2">
              <div
                className="flex h-6 items-center rounded bg-primary px-2 text-[11px] font-semibold text-primary-foreground"
                style={{ gridColumn: `${t.start} / span ${t.span}` }}
              >
                <span className="truncate">{t.name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SIGNALS = [
  { quote: 'We need SSO before we can roll this out to the whole org.', company: 'Northwind', weight: 92 },
  { quote: 'Exporting the sprint report to CSV would save us hours.', company: 'Kite & Co', weight: 64 },
  { quote: 'Swimlanes by assignee — the board gets noisy at 40 cards.', company: 'Ardent', weight: 41 },
];

export function InsightsView() {
  return (
    <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
      <div className="space-y-2">
        {SIGNALS.map((s) => (
          <div key={s.company} className="rounded-lg border border-border bg-card p-2.5">
            <p className="text-xs leading-snug">“{s.quote}”</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-info-muted px-2 py-0.5 text-[10px] font-semibold text-info">{s.company}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-primary" style={{ width: `${s.weight}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {[
          { n: '142', l: 'Insights this quarter' },
          { n: '27', l: 'Companies represented' },
          { n: '18', l: 'Promoted to features' },
        ].map((s) => (
          <div key={s.l} className="rounded-lg bg-surface p-2.5">
            <p className="text-xl font-semibold tabular-nums">{s.n}</p>
            <p className="text-[11px] text-faint">{s.l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
