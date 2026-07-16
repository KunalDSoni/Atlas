// Lightweight SVG/HTML chart primitives.
//
// Rules encoded here so callers can't get them wrong:
//  - categorical colour is assigned by series identity in fixed order, never by rank
//  - marks are thin, with a 2px surface gap between adjacent fills
//  - values/labels wear text tokens, never the series colour
//  - every chart ships a legend (>= 2 series) and a table view for screen readers

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

export const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

/** Fixed-order colour for a series index. Folds anything past the ramp into a neutral. */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index] ?? 'var(--muted-foreground)';
}

export interface Datum {
  label: string;
  value: number;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Screen-reader + "show data" fallback. Identity is never colour-alone. */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          {columns.map((c, i) => (
            <th key={c} className={cn('py-1.5 text-xs font-semibold text-muted-foreground', i === 0 ? 'text-left' : 'text-right')}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-border-light last:border-0">
            {r.map((cell, ci) => (
              <td key={ci} className={cn('py-1.5', ci === 0 ? 'text-left' : 'text-right tabular-nums')}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Horizontal bars — the default for ranked magnitude with text labels.
 * Labels sit outside the mark in text ink; the value is direct-labelled.
 */
export function HBarChart({
  data,
  colorIndex = 0,
  formatValue = (n: number) => String(n),
}: {
  data: Datum[];
  colorIndex?: number;
  formatValue?: (n: number) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  if (!data.length) return <p className="py-8 text-center text-sm text-muted-foreground">No data.</p>;

  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div
          key={d.label}
          className="group grid grid-cols-[minmax(0,7rem)_1fr_2.5rem] items-center gap-3"
          onMouseEnter={() => setHover(d.label)}
          onMouseLeave={() => setHover(null)}
          title={`${d.label}: ${formatValue(d.value)}`}
        >
          <span className="truncate text-xs text-muted-foreground">{d.label}</span>
          <div className="h-2.5 overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full rounded-sm transition-[width,opacity] duration-300"
              style={{
                width: `${(d.value / max) * 100}%`,
                background: seriesColor(colorIndex),
                opacity: hover && hover !== d.label ? 0.45 : 1,
              }}
            />
          </div>
          <span className="text-right text-xs tabular-nums text-foreground">{formatValue(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Stacked horizontal bar — composition within a whole. 2px gap between segments. */
export function StackedBar({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
}) {
  const safeTotal = Math.max(1, total);
  return (
    <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-sm bg-muted">
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-sm last:rounded-r-sm"
            style={{ width: `${(s.value / safeTotal) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
    </div>
  );
}

/**
 * Grouped vertical columns for change-over-time (e.g. committed vs completed per sprint).
 * Single y-scale only — never a second axis.
 */
export function GroupedColumns({
  groups,
  series,
  formatValue = (n: number) => String(n),
}: {
  groups: { label: string; values: number[] }[];
  series: string[];
  formatValue?: (n: number) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...groups.flatMap((g) => g.values));

  if (!groups.length) return <p className="py-8 text-center text-sm text-muted-foreground">No data.</p>;

  return (
    <div>
      <Legend items={series.map((s, i) => ({ label: s, color: seriesColor(i) }))} />
      {/* Columns are a fixed width so a single group reads as a column, not a slab. */}
      <div className="flex items-end gap-5 overflow-x-auto pb-1" style={{ height: 168 }}>
        {groups.map((g, gi) => (
          <div
            key={`${id}-${g.label}`}
            className="flex h-full w-20 shrink-0 flex-col justify-end gap-1.5"
            onMouseEnter={() => setHover(gi)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="flex flex-1 items-end justify-center gap-1">
              {g.values.map((v, si) => (
                <div
                  key={si}
                  className="relative flex h-full w-6 items-end"
                  title={`${series[si]}: ${formatValue(v)}`}
                >
                  <div
                    className="w-full rounded-t transition-[height,opacity] duration-300"
                    style={{
                      height: `${Math.max((v / max) * 100, v > 0 ? 2 : 0)}%`,
                      background: seriesColor(si),
                      opacity: hover !== null && hover !== gi ? 0.45 : 1,
                    }}
                  />
                  {/* Direct label — selective, only on hover of this group. */}
                  {hover === gi && (
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-foreground">
                      {v}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="truncate text-center text-[11px] text-muted-foreground" title={g.label}>
              {g.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Two-series line chart for change-over-time (burndown: ideal vs actual).
 * Single y-scale — never a second axis. 2px strokes, recessive grid, hover crosshair.
 */
export function LineChart({
  points,
  series,
  formatValue = (n: number) => String(n),
}: {
  points: { label: string; values: (number | null)[] }[];
  series: string[];
  formatValue?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 180;
  const PAD = { top: 8, right: 8, bottom: 22, left: 32 };

  if (points.length < 2) return <p className="py-8 text-center text-sm text-muted-foreground">Not enough data.</p>;

  const all = points.flatMap((p) => p.values).filter((v): v is number => v != null);
  const max = Math.max(1, ...all);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const path = (si: number) =>
    points
      .map((p, i) => {
        const v = p.values[si];
        if (v == null) return null;
        return `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');

  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  return (
    <div>
      <Legend items={series.map((s, i) => ({ label: s, color: seriesColor(i) }))} />
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-44 w-full min-w-[420px]"
          role="img"
          aria-label={`${series.join(' and ')} over time`}
          onMouseLeave={() => setHover(null)}
        >
          {/* Recessive gridlines + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">
                {t}
              </text>
            </g>
          ))}

          {series.map((_, si) => (
            <path
              key={si}
              d={path(si)}
              fill="none"
              stroke={seriesColor(si)}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={si === 0 ? '4 3' : undefined}
              opacity={si === 0 ? 0.7 : 1}
            />
          ))}

          {/* Hover crosshair + markers */}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--faint)" strokeWidth="1" />
          )}
          {hover != null &&
            series.map((_, si) => {
              const v = points[hover].values[si];
              if (v == null) return null;
              return (
                <circle
                  key={si}
                  cx={x(hover)}
                  cy={y(v)}
                  r="4"
                  fill={seriesColor(si)}
                  stroke="var(--card)"
                  strokeWidth="2"
                />
              );
            })}

          {/* Invisible hit targets, wider than the marks */}
          {points.map((p, i) => (
            <rect
              key={i}
              x={x(i) - plotW / points.length / 2}
              y={PAD.top}
              width={plotW / points.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            >
              <title>{`${p.label}: ${p.values.map((v, si) => `${series[si]} ${v == null ? '—' : formatValue(v)}`).join(', ')}`}</title>
            </rect>
          ))}

          {/* First/last x labels only — a label per point would collide */}
          <text x={PAD.left} y={H - 6} fontSize="9" fill="var(--muted-foreground)">{points[0].label}</text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">
            {points[points.length - 1].label}
          </text>
        </svg>
      </div>
      {hover != null && (
        <p className="mt-1 text-center text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{points[hover].label}</span>
          {points[hover].values.map((v, si) => (
            <span key={si}> · {series[si]}: <span className="tabular-nums text-foreground">{v == null ? '—' : formatValue(v)}</span></span>
          ))}
        </p>
      )}
    </div>
  );
}
