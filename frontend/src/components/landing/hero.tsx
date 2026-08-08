import type { ReactNode } from 'react';
import { LANDING_COPY } from '@/lib/landing-content';

export function Hero({ demoSlot }: { demoSlot: ReactNode }) {
  const { badge, badgeText, headline, sub, trust } = LANDING_COPY.hero;

  return (
    <section className="px-6 pt-20 text-center">
      <div className="mx-auto max-w-3xl">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-accent px-2 py-1 text-sm font-semibold text-accent-foreground">
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] uppercase tracking-wide text-primary-foreground">{badge}</span>
          {badgeText}
        </p>

        {/* The page's only h1. */}
        <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          {headline}
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{sub}</p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {demoSlot}
          <a href="/login" className="rounded-md border border-border px-6 py-3 font-semibold hover:bg-surface">
            {LANDING_COPY.nav.signIn}
          </a>
        </div>

        <p className="mt-9 text-xs font-medium uppercase tracking-widest text-faint">
          {trust.join(' · ')}
        </p>
      </div>
    </section>
  );
}
