import { useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { LANDING_COPY } from '@/lib/landing-content';

/** `demoSlot` is the demo CTA, injected so the nav has no auth dependency. */
export function SiteNav({ demoSlot }: { demoSlot: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border-light bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-7 px-6">
        <a href="#top" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded bg-primary text-sm font-bold text-primary-foreground">A</span>
          {LANDING_COPY.nav.brand}
        </a>

        <nav className="hidden gap-6 md:flex" aria-label="Sections">
          {LANDING_COPY.nav.links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-muted-foreground hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {!__ATLAS_SITE__ && (
            <a href="/login" className="hidden rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface md:inline-block">
              {LANDING_COPY.nav.signIn}
            </a>
          )}
          {demoSlot}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-md border border-border md:hidden"
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-1 border-t border-border-light px-6 py-3 md:hidden">
          {LANDING_COPY.nav.links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2 text-sm font-medium text-muted-foreground">
              {l.label}
            </a>
          ))}
          {!__ATLAS_SITE__ && (
            <a href="/login" className="block py-2 text-sm font-medium text-muted-foreground">
              {LANDING_COPY.nav.signIn}
            </a>
          )}
        </div>
      )}
    </header>
  );
}
