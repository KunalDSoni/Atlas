import { LANDING_COPY } from '@/lib/landing-content';

/** Opens the sample-data demo full page. No account, no sign-in. */
export function DemoButton({ variant = 'primary' }: { variant?: 'primary' | 'inverse' }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 font-semibold';
  const tone = variant === 'inverse'
    ? 'bg-primary-foreground text-primary hover:opacity-90'
    : 'bg-primary text-primary-foreground hover:bg-primary-hover';

  return (
    <a href="/demo/" className={`${base} ${tone}`}>
      {LANDING_COPY.nav.demo}
    </a>
  );
}
