import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { HeadingEntry } from './rich-text';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  to?: string;
  icon?: string;
}

/** Space › ancestors › page trail. The last crumb is the current location. */
export function WikiBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-faint" />}
            {c.to && !last ? (
              <Link to={c.to} className="max-w-[16rem] truncate rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">
                {c.icon ? `${c.icon} ` : ''}{c.label}
              </Link>
            ) : (
              <span className={cn('max-w-[20rem] truncate px-1 py-0.5', last && 'font-medium text-foreground')}>
                {c.icon ? `${c.icon} ` : ''}{c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Sticky "On this page" outline built from the rendered headings, with the
 *  section nearest the top highlighted as you scroll. */
export function OnThisPage({ headings }: { headings: HeadingEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="sticky top-6 hidden max-h-[calc(100vh-6rem)] overflow-y-auto xl:block">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">On this page</p>
      <ul className="space-y-0.5 border-l border-border">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveId(h.id);
              }}
              className={cn(
                '-ml-px block border-l-2 py-0.5 text-sm transition-colors',
                h.level === 3 ? 'pl-5' : 'pl-3',
                activeId === h.id
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
