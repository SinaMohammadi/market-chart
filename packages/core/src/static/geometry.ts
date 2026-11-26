/**
 * DOM-free geometry for static (server-rendered) charts.
 * Nothing in this module touches browser globals; output is deterministic for a given input,
 * so server and client markup match exactly.
 */
import type { LinePoint, OhlcBar } from '../model/types.js';

export interface StaticPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface StaticViewport {
  readonly width: number;
  readonly height: number;
  readonly padding?: Partial<StaticPadding>;
}

export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

export interface LineGeometry {
  /** SVG path data for the line. Empty when there is no data. */
  readonly line: string;
  /** Closed SVG path for the area below the line. */
  readonly area: string;
  readonly range: ValueRange | null;
  readonly last: { readonly x: number; readonly y: number; readonly value: number } | null;
}

export interface CandleGeometry {
  readonly x: number;
  readonly bodyTop: number;
  readonly bodyHeight: number;
  readonly bodyWidth: number;
  readonly wickTop: number;
  readonly wickBottom: number;
  readonly up: boolean;
}

const round = (v: number): number => Math.round(v * 100) / 100;

function resolvePadding(p: Partial<StaticPadding> | undefined): StaticPadding {
  return { top: p?.top ?? 4, right: p?.right ?? 0, bottom: p?.bottom ?? 4, left: p?.left ?? 0 };
}

function isValidPoint(p: LinePoint): boolean {
  return p != null && Number.isFinite(p.time) && Number.isFinite(p.value);
}

function isValidBar(b: OhlcBar): boolean {
  return b != null && [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite);
}

export function valueRange(values: Iterable<number>): ValueRange | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return null;
  if (min === max) {
    const pad = Math.abs(min) * 0.01 || 1;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

function mapper(range: ValueRange, viewport: StaticViewport, count: number) {
  const p = resolvePadding(viewport.padding);
  const innerW = Math.max(0, viewport.width - p.left - p.right);
  const innerH = Math.max(0, viewport.height - p.top - p.bottom);
  const step = count > 1 ? innerW / (count - 1) : 0;
  return {
    x: (i: number) => round(count > 1 ? p.left + i * step : p.left + innerW / 2),
    y: (v: number) => round(p.top + ((range.max - v) / (range.max - range.min)) * innerH),
    bottom: round(p.top + innerH),
    slot: count > 0 ? innerW / count : innerW,
    left: p.left,
  };
}

/** Line/area paths. Points are spaced evenly by index (like the interactive chart's logical axis). */
export function lineGeometry(points: readonly LinePoint[], viewport: StaticViewport): LineGeometry {
  const valid = points.filter(isValidPoint);
  const range = valueRange(valid.map((p) => p.value));
  if (!range || valid.length === 0) return { line: '', area: '', range: null, last: null };
  const m = mapper(range, viewport, valid.length);
  let line = '';
  for (let i = 0; i < valid.length; i++)
    line += `${i === 0 ? 'M' : 'L'}${m.x(i)} ${m.y(valid[i]!.value)}`;
  const lastIndex = valid.length - 1;
  const area = `${line}L${m.x(lastIndex)} ${m.bottom}L${m.x(0)} ${m.bottom}Z`;
  const lastValue = valid[lastIndex]!.value;
  return { line, area, range, last: { x: m.x(lastIndex), y: m.y(lastValue), value: lastValue } };
}

/** Candle rectangles and wicks, one slot per bar. */
export function candleGeometry(
  bars: readonly OhlcBar[],
  viewport: StaticViewport,
): { candles: CandleGeometry[]; range: ValueRange | null } {
  const valid = bars.filter(isValidBar);
  const range = valueRange(valid.flatMap((b) => [b.high, b.low]));
  if (!range || valid.length === 0) return { candles: [], range: null };
  const p = resolvePadding(viewport.padding);
  const innerW = Math.max(0, viewport.width - p.left - p.right);
  const innerH = Math.max(0, viewport.height - p.top - p.bottom);
  const slot = innerW / valid.length;
  const bodyWidth = round(Math.max(0.5, slot * 0.7));
  const y = (v: number): number =>
    round(p.top + ((range.max - v) / (range.max - range.min)) * innerH);
  const candles = valid.map((b, i) => {
    const top = Math.min(y(b.open), y(b.close));
    return {
      x: round(p.left + slot * (i + 0.5)),
      bodyTop: top,
      bodyHeight: round(Math.max(0.5, Math.abs(y(b.open) - y(b.close)))),
      bodyWidth,
      wickTop: y(b.high),
      wickBottom: y(b.low),
      up: b.close >= b.open,
    };
  });
  return { candles, range };
}

/**
 * Downsamples to at most `maxPoints` (keeps first/last and per-bucket extremes) so static charts
 * of long histories stay small in HTML.
 */
export function downsampleLine(points: readonly LinePoint[], maxPoints: number): LinePoint[] {
  if (maxPoints < 4 || points.length <= maxPoints) return points.slice();
  const buckets = Math.floor((maxPoints - 2) / 2);
  const size = (points.length - 2) / buckets;
  const out: LinePoint[] = [points[0]!];
  for (let b = 0; b < buckets; b++) {
    const start = 1 + Math.floor(b * size);
    const end = Math.min(points.length - 1, 1 + Math.floor((b + 1) * size));
    let lo = start;
    let hi = start;
    for (let i = start; i < end; i++) {
      if (points[i]!.value < points[lo]!.value) lo = i;
      if (points[i]!.value > points[hi]!.value) hi = i;
    }
    if (lo === hi) out.push(points[lo]!);
    else out.push(points[Math.min(lo, hi)]!, points[Math.max(lo, hi)]!);
  }
  out.push(points[points.length - 1]!);
  return out;
}
