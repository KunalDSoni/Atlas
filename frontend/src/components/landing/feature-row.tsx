import { FeatureVisual, type VisualKind } from './feature-visuals';

export interface FeatureRowProps {
  visual: VisualKind;
  eyebrow: string;
  title: string;
  body: string;
  tags: string[];
  flip?: boolean;
}

export function FeatureRow({ visual, eyebrow, title, body, tags, flip = false }: FeatureRowProps) {
  return (
    <div className="grid items-center gap-12 md:grid-cols-2">
      <div className={flip ? 'md:order-2' : undefined}>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
        <h3 className="mt-3 text-balance text-2xl font-semibold tracking-tight md:text-3xl">{title}</h3>
        <p className="mt-3 text-muted-foreground">{body}</p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t} className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">{t}</li>
          ))}
        </ul>
      </div>
      <div className={`rounded-xl border border-border bg-surface p-4 ${flip ? 'md:order-1' : ''}`}>
        <FeatureVisual kind={visual} />
      </div>
    </div>
  );
}
