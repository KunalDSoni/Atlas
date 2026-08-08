import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CAPABILITY_PILLARS, CAPABILITY_TOTAL, LANDING_COPY } from '@/lib/landing-content';

/** Splits a label around the query so the match can be marked. */
function highlight(label: string, query: string) {
  if (!query) return label;
  const at = label.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="rounded-sm bg-warning-muted text-foreground">{label.slice(at, at + query.length)}</mark>
      {label.slice(at + query.length)}
    </>
  );
}

export function CapabilityIndex() {
  const [query, setQuery] = useState('');
  const c = LANDING_COPY.capabilities;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CAPABILITY_PILLARS;
    return CAPABILITY_PILLARS
      .map((p) => ({ ...p, items: p.items.filter((i) => i.toLowerCase().includes(q)) }))
      .filter((p) => p.items.length > 0);
  }, [query]);

  const matches = shown.reduce((n, p) => n + p.items.length, 0);

  return (
    <section id="capabilities" className="border-y border-border-light bg-surface px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">{c.eyebrow}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              <span className="tabular-nums">{CAPABILITY_TOTAL}</span> {c.headlineSuffix}
            </h2>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">{c.sub}</p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-faint" aria-hidden="true" />
            <label htmlFor="capability-search" className="sr-only">{c.placeholder}</label>
            <input
              id="capability-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c.placeholder}
              className="h-11 w-full rounded-md border border-border bg-background pl-10 pr-3 text-sm"
            />
          </div>
        </div>

        <p aria-live="polite" className="sr-only">
          {matches} of {CAPABILITY_TOTAL} capabilities shown
        </p>

        {shown.length === 0 ? (
          <p className="py-8 text-muted-foreground">{c.empty}</p>
        ) : (
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((p) => (
              <section key={p.name}>
                <h3 className="mb-2 flex justify-between border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
                  {p.name}
                  <span className="tabular-nums text-faint">{p.items.length}</span>
                </h3>
                <ul>
                  {p.items.map((i) => (
                    <li key={i} className="py-0.5 text-sm text-muted-foreground">{highlight(i, query.trim())}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
