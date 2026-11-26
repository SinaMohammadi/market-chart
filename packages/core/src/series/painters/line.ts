import type { LineStyle } from '../../options/chart-options.js';
import type {
  AreaSeriesOptions,
  BaselineSeriesOptions,
  LineSeriesOptions,
  LineType,
} from '../../options/series-options.js';
import { applyLineStyle } from '../../render/draw-utils.js';
import type { SeriesPaintContext } from '../paint-context.js';

/**
 * Calls `fn` for each run of consecutive finite values in [c.from, c.to].
 * Whitespace (NaN) splits runs, so lines break and areas close at gaps.
 */
function forEachRun(c: SeriesPaintContext, fn: (from: number, to: number) => void): void {
  const values = c.store.columnAt(0);
  let start = -1;
  for (let i = c.from; i <= c.to; i++) {
    if (Number.isFinite(values[i]!)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      fn(start, i - 1);
      start = -1;
    }
  }
  if (start >= 0) fn(start, c.to);
}

/** Appends one run as a sub-path (bitmap space). Returns the run's first and last x. */
function traceRun(
  c: SeriesPaintContext,
  from: number,
  to: number,
  lineType: LineType,
): { firstX: number; lastX: number } {
  const { ctx, store, pixelRatio: pr, timeScale, priceScale, mapping } = c;
  const values = store.columnAt(0);
  let firstX = 0;
  let lastX = 0;
  let prevY = 0;
  for (let i = from; i <= to; i++) {
    const x = timeScale.indexToX(mapping[i]!) * pr;
    const y = priceScale.priceToCoordinate(values[i]!) * pr;
    if (i === from) {
      ctx.moveTo(x, y);
      firstX = x;
    } else {
      if (lineType === 'step') ctx.lineTo(x, prevY);
      ctx.lineTo(x, y);
    }
    prevY = y;
    lastX = x;
  }
  if (from === to) {
    // A single point: draw a short horizontal tick so it remains visible.
    const half = Math.max(1, (c.timeScale.barSpacing * pr) / 4);
    ctx.moveTo(firstX - half, prevY);
    ctx.lineTo(firstX + half, prevY);
  }
  return { firstX, lastX };
}

function tracePath(c: SeriesPaintContext, lineType: LineType): void {
  forEachRun(c, (from, to) => traceRun(c, from, to, lineType));
}

/** Closed sub-paths from each run down (or up) to `baseY`. */
function traceArea(c: SeriesPaintContext, lineType: LineType, baseY: number): void {
  forEachRun(c, (from, to) => {
    const { firstX, lastX } = traceRun(c, from, to, lineType);
    c.ctx.lineTo(lastX, baseY);
    c.ctx.lineTo(firstX, baseY);
    c.ctx.closePath();
  });
}

function strokeSetup(c: SeriesPaintContext, color: string, width: number, style: LineStyle): void {
  const { ctx, pixelRatio: pr } = c;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width * pr);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  applyLineStyle(ctx, style, Math.max(1, width) * pr);
}

function paintMarkers(c: SeriesPaintContext, color: string, radius: number): void {
  const { ctx, store, pixelRatio: pr, timeScale, priceScale, mapping } = c;
  const values = store.columnAt(0);
  const r = Math.max(1, radius * pr);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = c.from; i <= c.to; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    const x = timeScale.indexToX(mapping[i]!) * pr;
    const y = priceScale.priceToCoordinate(v) * pr;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

export function paintLine(c: SeriesPaintContext, o: LineSeriesOptions): void {
  const { ctx } = c;
  if (c.to < c.from) return;
  if (o.lineVisible) {
    ctx.beginPath();
    tracePath(c, o.lineType);
    strokeSetup(c, o.color, o.lineWidth, o.lineStyle);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.pointMarkersVisible) paintMarkers(c, o.color, o.pointMarkersRadius ?? o.lineWidth + 1);
}

export function paintArea(c: SeriesPaintContext, o: AreaSeriesOptions): void {
  const { ctx, height } = c;
  if (c.to < c.from) return;
  ctx.beginPath();
  traceArea(c, o.lineType, height);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, o.topColor);
  gradient.addColorStop(1, o.bottomColor);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  tracePath(c, o.lineType);
  strokeSetup(c, o.lineColor, o.lineWidth, o.lineStyle);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function paintBaseline(c: SeriesPaintContext, o: BaselineSeriesOptions): void {
  const { ctx, width, height, pixelRatio: pr } = c;
  if (c.to < c.from) return;
  const baseY = c.priceScale.priceToCoordinate(o.baseValue) * pr;
  if (!Number.isFinite(baseY)) return;
  const clampedBase = Math.min(Math.max(baseY, 0), height);
  const regions: readonly [number, number, string, string][] = [
    [0, clampedBase, o.topFillColor, o.topLineColor],
    [clampedBase, height, o.bottomFillColor, o.bottomLineColor],
  ];
  for (const [y0, y1, fillColor, lineColor] of regions) {
    if (y1 <= y0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, width, y1 - y0);
    ctx.clip();
    ctx.beginPath();
    traceArea(c, 'simple', baseY);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.beginPath();
    tracePath(c, 'simple');
    strokeSetup(c, lineColor, o.lineWidth, o.lineStyle);
    ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);
}
