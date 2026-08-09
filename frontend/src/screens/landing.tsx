import { SiteNav } from '@/components/landing/site-nav';
import { Hero } from '@/components/landing/hero';
import { ProductFrame } from '@/components/landing/product-frame';
import { SplitSection } from '@/components/landing/split-section';
import { FeatureRow } from '@/components/landing/feature-row';
import { CapabilityIndex } from '@/components/landing/capability-index';
import { CtaSection } from '@/components/landing/cta-section';
import { SiteFooter } from '@/components/landing/site-footer';
import { DemoButton } from '@/components/landing/demo-button';
import { LANDING_COPY } from '@/lib/landing-content';

export default function Landing() {
  return (
    <div id="top" className="min-h-screen bg-background text-foreground">
      <SiteNav demoSlot={<DemoButton />} />
      <main>
        <Hero demoSlot={<DemoButton />} />
        <ProductFrame />
        <SplitSection />

        <section className="mx-auto max-w-6xl space-y-24 px-6 py-24">
          {LANDING_COPY.rows.map((row, i) => (
            <FeatureRow key={row.title} {...row} flip={i % 2 === 1} />
          ))}
        </section>

        <CapabilityIndex />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
