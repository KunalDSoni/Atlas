import { LANDING_COPY } from '@/lib/landing-content';

export function SiteFooter() {
  return (
    <footer className="border-t border-border-light bg-surface px-6 py-11">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 text-sm text-muted-foreground">
        <span>{LANDING_COPY.footer.copyright}</span>
        <nav className="ml-auto flex flex-wrap gap-6" aria-label="Footer">
          {LANDING_COPY.footer.links.map((l) => (
            <a key={l.label} href={l.href} className="hover:text-foreground">{l.label}</a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
