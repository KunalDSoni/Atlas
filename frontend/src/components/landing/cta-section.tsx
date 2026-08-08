import { LANDING_COPY } from '@/lib/landing-content';
import { DemoButton } from './demo-button';

export function CtaSection() {
  return (
    <section className="bg-primary px-6 py-20 text-center text-primary-foreground">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">{LANDING_COPY.cta.headline}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg opacity-90">{LANDING_COPY.cta.body}</p>
        <div className="mt-7 flex justify-center">
          <DemoButton variant="inverse" />
        </div>
      </div>
    </section>
  );
}
