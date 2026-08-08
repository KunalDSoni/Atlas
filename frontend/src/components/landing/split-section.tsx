import { Check } from 'lucide-react';
import { LANDING_COPY } from '@/lib/landing-content';

function Half({ chip, title, body, points, tone }: {
  chip: string; title: string; body: string; points: string[]; tone: 'accent' | 'success';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-7">
      <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
        tone === 'accent' ? 'bg-accent text-accent-foreground' : 'bg-success-muted text-success'
      }`}>
        {chip}
      </span>
      <h3 className="mt-4 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-muted-foreground">{body}</p>
      <ul className="mt-5 space-y-2.5">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SplitSection() {
  const s = LANDING_COPY.split;
  return (
    <section id="delivery" className="border-y border-border-light bg-surface px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{s.eyebrow}</p>
        <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight md:text-4xl">{s.headline}</h2>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{s.sub}</p>

        <div className="mt-11 grid gap-5 md:grid-cols-2">
          <Half {...s.delivery} points={s.delivery.points} tone="accent" />
          <div id="discovery">
            <Half {...s.discovery} points={s.discovery.points} tone="success" />
          </div>
        </div>
      </div>
    </section>
  );
}
