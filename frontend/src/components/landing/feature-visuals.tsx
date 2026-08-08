// One purpose-built visual per feature row. Each is a small, honest sketch of
// the screen the copy is describing — not a placeholder box.

export type VisualKind = 'board' | 'insights' | 'report' | 'queue' | 'api';

function Sprint() {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-semibold">Sprint 14</h4>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">6 days left</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { c: 'To do', items: ['Rate-limit demo route', 'Swimlanes'] },
          { c: 'In progress', items: ['Landing page'] },
          { c: 'Done', items: ['Worklog author', 'Blocked status'] },
        ].map((col) => (
          <div key={col.c} className="rounded-lg bg-background p-2">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">{col.c}</p>
            {col.items.map((t) => (
              <div key={t} className="mb-1 rounded border border-border bg-card p-1.5 text-[11px] leading-tight">{t}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Requests() {
  return (
    <div className="space-y-2">
      {[
        { q: 'We need SSO before rollout.', c: 'Northwind', w: 92 },
        { q: 'CSV export would save us hours.', c: 'Kite & Co', w: 64 },
        { q: 'Swimlanes by assignee.', c: 'Ardent', w: 41 },
      ].map((r) => (
        <div key={r.c} className="rounded-lg border border-border bg-card p-2.5">
          <p className="text-xs">“{r.q}”</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="rounded-full bg-info-muted px-2 py-0.5 text-[10px] font-semibold text-info">{r.c}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-primary" style={{ width: `${r.w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Report() {
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {[
          { n: '38', l: 'Committed' },
          { n: '31', l: 'Completed' },
          { n: '4.2d', l: 'Cycle time' },
          { n: '94%', l: 'SLA met' },
        ].map((s) => (
          <div key={s.l} className="rounded-lg bg-background p-2.5">
            <p className="text-lg font-semibold tabular-nums">{s.n}</p>
            <p className="text-[10px] text-faint">{s.l}</p>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 300 100" className="w-full" role="img" aria-label="Burndown chart falling from 38 points to 7 across the sprint">
        <line x1="0" y1="99" x2="300" y2="99" stroke="currentColor" strokeWidth="1" className="text-border" />
        <path d="M2 14 L298 96" strokeDasharray="4 4" strokeWidth="1.5" fill="none" stroke="currentColor" className="text-faint" />
        <path d="M2 14 L52 20 L102 44 L152 40 L202 62 L252 70 L298 88" strokeWidth="2.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" className="text-primary" />
      </svg>
    </div>
  );
}

function Queue() {
  return (
    <div className="space-y-2">
      {[
        { t: 'Cannot upload attachments over 5 MB', s: '1h 04m left', tone: 'destructive' },
        { t: 'Request access to the Northwind space', s: '6h 20m left', tone: 'warning' },
        { t: 'How do I re-open a closed sprint?', s: 'Deflected', tone: 'success' },
      ].map((r) => (
        <div key={r.t} className="rounded-lg border border-border bg-card p-2.5">
          <p className="text-xs">{r.t}</p>
          <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            r.tone === 'destructive' ? 'bg-destructive-muted text-destructive'
            : r.tone === 'warning' ? 'bg-warning-muted text-warning'
            : 'bg-success-muted text-success'
          }`}>
            {r.s}
          </span>
        </div>
      ))}
    </div>
  );
}

function Api() {
  return (
    <pre className="overflow-x-auto text-xs leading-relaxed text-muted-foreground">
      <code>{`POST /api/webhooks
{
  "event": "issue.transitioned",
  "issue": "ATL-238",
  "from":  "In progress",
  "to":    "Done",
  "actor": "alex@example.com"
}`}</code>
    </pre>
  );
}

export function FeatureVisual({ kind }: { kind: VisualKind }) {
  if (kind === 'board') return <Sprint />;
  if (kind === 'insights') return <Requests />;
  if (kind === 'report') return <Report />;
  if (kind === 'queue') return <Queue />;
  return <Api />;
}
